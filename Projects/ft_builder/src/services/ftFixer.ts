import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import { FixDiagnosis } from "@/types/ft";
import { EventCallback } from "./ftSetup";
import { APP_CONFIG } from "@/config/app";

// ============= LLM Request =============

function makeLLMRequest(
  baseUrl: string,
  apiKey: string,
  prompt: string,
  systemPrompt: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/chat/completions`);
    const isHttps = url.protocol === "https:";
    const transport = isHttps ? https : http;

    const model = APP_CONFIG.llm.defaultModel;
    const requestBody = JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      max_tokens: 8000,
      temperature: 0.2,
    });

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(requestBody),
      },
    };

    console.log(`[ft-fixer] LLM request: ${url.toString()}, model: ${model}, prompt length: ${requestBody.length}`);

    const req = transport.request(options, (res) => {
      let data = "";
      console.log(`[ft-fixer] LLM response status: ${res.statusCode}`);
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        console.log(`[ft-fixer] LLM response body (first 500): ${data.slice(0, 500)}`);
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.message?.content;
          if (content) {
            resolve(content);
          } else {
            reject(new Error(`LLM response missing content: ${data.slice(0, 500)}`));
          }
        } catch (err) {
          reject(new Error(`Failed to parse LLM response: ${data.slice(0, 500)}`));
        }
      });
    });

    req.on("error", (err) => {
      console.log(`[ft-fixer] LLM request error: ${err.message}`);
      reject(err);
    });
    req.setTimeout(120000, () => {
      console.log(`[ft-fixer] LLM request timeout after 120s`);
      req.destroy();
      reject(new Error("LLM request timeout (120s)"));
    });

    req.write(requestBody);
    req.end();
  });
}

// ============= Analysis =============

const SYSTEM_PROMPT = `You are a senior QA automation engineer debugging failing Cypress E2E tests for sparkxnodeweb, a PayPal Customer Support React application.

You MUST respond with valid JSON only — no markdown, no code fences, no explanation outside the JSON.

## Your Expertise
- Cypress selector strategies (data-automation-id, CSS classes, cy.contains)
- React component lifecycle and async rendering
- Network request stubbing with cy.intercept()
- Debugging assertion failures, timeout errors, and element visibility issues
- PayPal sparkxnodeweb component architecture

## App-Specific Knowledge
- The app uses data-automation-id selectors, NOT data-testid
- Tests use cy.navigateToWorkflow() for initial navigation (handles SSO, case creation, LLA)
- cy.closeWorkflowAndProvideFeedback() at the end of each test
- NEVER use raw cy.visit() — always use cy.navigateToWorkflow()
- Import TIMEOUTS, INTENTS, TEST_ACCOUNTS from cypress/support/constants.ts
- Import selectors from cypress/support/selectors.ts

## CRITICAL: Timeout Rules
- ALWAYS use TIMEOUTS.MAX (120000ms) for workflow navigation and page loads
- Use TIMEOUTS.MEDIUM (60000ms) for element visibility checks after navigation
- Use TIMEOUTS.SHORT (30000ms) for UI interactions after the page is loaded
- The app loads slowly (60-90 seconds for first route compilation)
- NEVER use hardcoded timeout values — always use TIMEOUTS constants

## CRITICAL: Reference Existing Passing Tests
When existing passing tests for the same workflow are provided:
1. COPY their navigation pattern exactly (cy.navigateToWorkflow account + intent)
2. COPY their selector usage and import structure
3. COPY their wait/timeout patterns
4. If the failing test uses a different approach, switch to the passing test's approach

## Response Format
Your response must be a JSON object with this exact structure:
{
  "issueType": "test" | "missing-testid" | "app-logic",
  "diagnosticInfo": "Human-readable explanation of the failure and what was fixed",
  "suggestedFixes": [
    {
      "filePath": "relative/path/to/file",
      "newContent": "entire fixed file content"
    }
  ]
}

## Issue Type Classification
- "test": The Cypress test file has a bug (wrong selector, timing issue, stale assertion, wrong expected value, wrong navigation). Fix the TEST file.
- "missing-testid": The app component is missing a data-testid attribute. Add data-testid to the COMPONENT file AND update the test.
- "app-logic": The app code has a real bug OR a downstream service is down (502, 503 errors). Do NOT provide suggestedFixes.

## Common Failure Patterns & Fixes
1. **Timeout on workflow load** → Use TIMEOUTS.MAX, verify navigateToWorkflow uses correct account + intent
2. **Wrong selectors** → Update to data-automation-id, check existing passing tests for correct selectors
3. **JAWS/API 502 errors** → This is app-logic (downstream service down), NOT fixable by test changes
4. **Element not found** → Check if element renders after async load, add proper wait with TIMEOUTS
5. **Assertion mismatch** → If actual value looks correct for the scenario, fix the expected value in test
6. **"Cannot find module" / compile errors** → Check imports, may need different import path

## CRITICAL — Assertion Mismatch
When you see "expected 'X' to equal 'Y'":
- ACTUAL value from app = 'X', EXPECTED in test = 'Y'
- If 'X' looks correct for the scenario → classify as "test", fix expected value
- Only classify as "app-logic" if actual value is null/undefined/clearly wrong
- When in doubt, prefer "test" over "app-logic"

## Multiple Errors
Fix ALL errors in a single response. Do not fix only the first one.

## Output Rules
- suggestedFixes MUST contain the COMPLETE file content (not a diff)
- For "app-logic" issues, suggestedFixes should be an empty array
- If mixed issues, classify as "test", fix what you can, note app-logic in diagnosticInfo`;

export async function analyzeFailure(
  workDir: string,
  failedSpec: string,
  errorOutput: string,
  llmBaseUrl: string | undefined,
  llmApiKey: string,
  emit: EventCallback,
  screenshotPath?: string,
  existingWorkflowFTs?: Array<{ path: string; content: string; fileName: string }>,
  fixHistory?: Array<{ attempt: number; error: string; fix: string }>,
  screenshotPaths?: string[]
): Promise<FixDiagnosis> {
  const resolvedBaseUrl = llmBaseUrl || APP_CONFIG.llm.baseUrl;
  emit({ type: "fix:analyzing", timestamp: Date.now(), message: `Analyzing failure in ${failedSpec}` });

  // Read the test file
  const testFilePath = path.join(workDir, failedSpec);
  let testContent = "";
  try {
    testContent = fs.readFileSync(testFilePath, "utf-8");
  } catch {
    testContent = "[Could not read test file]";
  }

  // Read any imports/support files referenced in the test
  const importPaths = extractImports(testContent, path.dirname(testFilePath));

  // Build the prompt — errorOutput may contain multiple numbered errors
  const errorCount = (errorOutput.match(/^Error \d+ \(/gm) || []).length;
  const multiErrorNote = errorCount > 1
    ? `\n**IMPORTANT: This file has ${errorCount} distinct test failures. Your fix MUST address ALL ${errorCount} errors. Do not fix only one — fix every assertion/selector/timing issue listed below.**\n`
    : "";

  let prompt = `## Failed Cypress Test

**File:** ${failedSpec}
${multiErrorNote}
**Test File Content:**
\`\`\`typescript
${testContent}
\`\`\`

**Error Output:**
\`\`\`
${errorOutput.slice(0, 6000)}
\`\`\`
`;

  if (importPaths.length > 0) {
    prompt += "\n**Imported Support Files:**\n";
    for (const imp of importPaths.slice(0, 3)) {
      prompt += `\n*${imp.relativePath}:*\n\`\`\`typescript\n${imp.content.slice(0, 2000)}\n\`\`\`\n`;
    }
  }

  // Include previous fix attempts so LLM knows what was already tried
  if (fixHistory && fixHistory.length > 0) {
    prompt += `\n## PREVIOUS FIX ATTEMPTS (do NOT repeat the same fixes)\n`;
    for (const h of fixHistory) {
      prompt += `\n### Attempt ${h.attempt}:\n**Error:** ${h.error.slice(0, 500)}\n**Fix applied:** ${h.fix.slice(0, 300)}\n`;
    }
    prompt += `\n**IMPORTANT:** The above fixes did NOT work. Try a DIFFERENT approach.\n`;
  }

  // Include screenshot paths so LLM knows what UI state was captured
  if (screenshotPaths && screenshotPaths.length > 0) {
    prompt += `\n## CYPRESS SCREENSHOTS CAPTURED\nThese screenshots were taken during the test run. The filenames indicate what step the test was on when each screenshot was captured:\n`;
    for (const ss of screenshotPaths) {
      const name = ss.split("/").pop() || ss;
      prompt += `- ${name}\n`;
    }
    prompt += `\nScreenshot names ending with "(failed)" indicate the point of failure.\n`;
  }

  // Include existing passing tests as reference
  if (existingWorkflowFTs && existingWorkflowFTs.length > 0) {
    prompt += `\n## EXISTING PASSING TESTS (REFERENCE — copy their patterns)\nThese tests for the same workflow are currently passing. If the failing test uses different navigation, timeouts, or selectors, switch to the pattern used by these passing tests.\n\n`;
    for (const ft of existingWorkflowFTs.slice(0, 2)) {
      prompt += `### ${ft.fileName}\n\`\`\`typescript\n${ft.content.slice(0, 4000)}\n\`\`\`\n\n`;
    }
  }

  prompt += "\nAnalyze this failure and provide a fix if possible. Use TIMEOUTS.MAX for all navigation waits.";

  try {
    emit({ type: "log", timestamp: Date.now(), message: `[fixer] Sending LLM request to ${resolvedBaseUrl}/chat/completions` });
    emit({ type: "log", timestamp: Date.now(), message: `[fixer] Prompt length: ${prompt.length} chars, test file length: ${testContent.length} chars` });

    const response = await makeLLMRequest(resolvedBaseUrl, llmApiKey, prompt, SYSTEM_PROMPT);

    emit({ type: "log", timestamp: Date.now(), message: `[fixer] LLM response received, length: ${response.length} chars` });
    emit({ type: "log", timestamp: Date.now(), message: `[fixer] LLM raw response (first 500): ${response.slice(0, 500)}` });

    // Parse JSON from response (handle markdown code fences if present)
    const jsonStr = response.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr: any) {
      emit({ type: "log", timestamp: Date.now(), message: `[fixer] JSON parse failed: ${parseErr.message}` });
      emit({ type: "log", timestamp: Date.now(), message: `[fixer] Attempted to parse: ${jsonStr.slice(0, 300)}` });
      throw new Error(`LLM returned invalid JSON: ${parseErr.message}`);
    }

    emit({ type: "log", timestamp: Date.now(), message: `[fixer] Parsed diagnosis — issueType: ${parsed.issueType}, fixes: ${parsed.suggestedFixes?.length ?? 0}` });

    return {
      issueType: parsed.issueType || "app-logic",
      failedFile: failedSpec,
      errorMessage: errorOutput.slice(0, 2000),
      suggestedFixes: parsed.suggestedFixes || [],
      diagnosticInfo: parsed.diagnosticInfo || "No diagnostic information available",
      screenshot: screenshotPath,
    };
  } catch (error: any) {
    emit({ type: "log", timestamp: Date.now(), message: `[fixer] AI analysis failed: ${error.message}` });
    emit({ type: "log", timestamp: Date.now(), message: `[fixer] Full error: ${error.stack || error.message}` });
    return {
      issueType: "app-logic",
      failedFile: failedSpec,
      errorMessage: errorOutput.slice(0, 2000),
      suggestedFixes: [],
      diagnosticInfo: `AI analysis failed: ${error.message}. Manual review required.`,
      screenshot: screenshotPath,
    };
  }
}

// ============= Fix Application =============

export function applyFixes(
  workDir: string,
  fixes: Array<{ filePath: string; newContent: string }>,
  emit: EventCallback
): void {
  for (const fix of fixes) {
    const fullPath = path.join(workDir, fix.filePath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, fix.newContent, "utf-8");
    emit({ type: "log", timestamp: Date.now(), message: `Applied fix to ${fix.filePath}` });
  }
}

// ============= Helpers =============

interface ImportedFile {
  relativePath: string;
  content: string;
}

function extractImports(content: string, baseDir: string): ImportedFile[] {
  const imports: ImportedFile[] = [];
  const importRegex = /(?:import|require)\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s*from\s*['"]([^'"]+)['"]/g;

  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    // Only resolve relative imports
    if (!importPath.startsWith(".")) continue;

    const resolved = path.resolve(baseDir, importPath);
    const extensions = ["", ".ts", ".tsx", ".js", ".jsx"];

    for (const ext of extensions) {
      const fullPath = resolved + ext;
      if (fs.existsSync(fullPath)) {
        try {
          imports.push({
            relativePath: path.relative(baseDir, fullPath),
            content: fs.readFileSync(fullPath, "utf-8"),
          });
        } catch {
          // skip unreadable files
        }
        break;
      }
    }
  }

  return imports;
}
