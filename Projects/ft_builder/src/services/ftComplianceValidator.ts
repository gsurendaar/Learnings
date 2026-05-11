import * as fs from "fs";
import * as path from "path";
import { createLLMClient } from "./langgraph/llm";
import {
  FT_COMPLIANCE_SYSTEM_PROMPT,
  buildComplianceUserPrompt,
} from "./langgraph/prompts/ftCompliance";
import { readKnowledgeBase } from "./ftGenerator";
import { insertAgentLog } from "@/lib/ftDatabase";
import type { ComplianceCheck, ComplianceResult } from "@/types/ft";

interface GeneratedTestFile {
  sourcePath: string;
  testPath: string;
  status: "created" | "skipped" | "error";
  error?: string;
}

// ── Static Rule Checks (no LLM needed) ──

function checkFileNaming(fileName: string): ComplianceCheck {
  // Expected: {priority}-{tenant}-{workflow}-{feature}.cy.ts
  const pattern = /^p[012]-(?:paypal|venmo)-[a-z]+-[a-z0-9-]+\.cy\.ts$/;
  const passed = pattern.test(fileName);
  return {
    rule: "File naming convention",
    passed,
    severity: "warning",
    message: passed
      ? "Follows {priority}-{tenant}-{workflow}-{feature}.cy.ts"
      : `File "${fileName}" doesn't match pattern: {priority}-{tenant}-{workflow}-{feature}.cy.ts`,
  };
}

function checkSingleDescribe(code: string): ComplianceCheck {
  const matches = code.match(/\bdescribe\s*\(/g) || [];
  const passed = matches.length === 1;
  return {
    rule: "Single describe block",
    passed,
    severity: "error",
    message: passed
      ? "Has exactly 1 describe block"
      : `Found ${matches.length} describe blocks — should be exactly 1`,
  };
}

function checkSingleIt(code: string): ComplianceCheck {
  const matches = code.match(/\bit\s*\(/g) || [];
  const passed = matches.length === 1;
  return {
    rule: "Single it() block",
    passed,
    severity: "error",
    message: passed
      ? "Has exactly 1 it() block with sequential steps"
      : `Found ${matches.length} it() blocks — workflow tests should use single it() with sequential steps`,
  };
}

function checkNoInlineSelectors(code: string): ComplianceCheck {
  const inlinePattern = /\[data-automation-id=["'][^"']+["']\]/g;
  const matches = code.match(inlinePattern) || [];
  const passed = matches.length === 0;
  return {
    rule: "No inline selectors",
    passed,
    severity: "error",
    message: passed
      ? "All selectors imported from selectors.ts"
      : `Found ${matches.length} inline [data-automation-id="..."] — use selectors from cypress/support/selectors.ts`,
  };
}

function checkNoHardWaits(code: string): ComplianceCheck {
  // cy.wait(5000) is bad, cy.wait("@alias") is fine
  const hardWaitPattern = /cy\.wait\(\s*\d/g;
  const matches = code.match(hardWaitPattern) || [];
  const passed = matches.length === 0;
  return {
    rule: "No hard waits",
    passed,
    severity: "error",
    message: passed
      ? "No cy.wait(ms) — uses dynamic waits"
      : `Found ${matches.length} cy.wait(ms) — use TIMEOUTS constants with .should() assertions instead`,
  };
}

function checkNavigateToWorkflow(code: string): ComplianceCheck {
  const passed = code.includes("cy.navigateToWorkflow(") || code.includes("navigateToWorkflow(");
  return {
    rule: "Uses navigateToWorkflow()",
    passed,
    severity: "warning",
    message: passed
      ? "Uses cy.navigateToWorkflow() for pre-flow setup"
      : "Missing cy.navigateToWorkflow() — use it instead of manual SSO/case/search/LLA chain",
  };
}

function checkClosesWorkflow(code: string): ComplianceCheck {
  const passed = code.includes("closeWorkflowAndProvideFeedback(");
  return {
    rule: "Closes workflow with feedback",
    passed,
    severity: "warning",
    message: passed
      ? "Ends with cy.closeWorkflowAndProvideFeedback()"
      : "Missing cy.closeWorkflowAndProvideFeedback() — every test should close the workflow with a rating",
  };
}

function checkUsesTimeouts(code: string): ComplianceCheck {
  const passed = code.includes("TIMEOUTS.");
  return {
    rule: "Uses TIMEOUTS constants",
    passed,
    severity: "warning",
    message: passed
      ? "Uses TIMEOUTS constants from support/constants.ts"
      : "Not using TIMEOUTS constants — import and use TIMEOUTS.SHORT/MEDIUM/LONG/MAX",
  };
}

function checkUsesAddTestContext(code: string): ComplianceCheck {
  const passed = code.includes("cy.addTestContext(");
  return {
    rule: "Uses addTestContext()",
    passed,
    severity: "info",
    message: passed
      ? "Uses cy.addTestContext() for step documentation"
      : "Missing cy.addTestContext() — add step descriptions for mochawesome reports",
  };
}

function checkNoConditionalAssertions(code: string): ComplianceCheck {
  // Look for if/else inside .then() callbacks
  const thenBlocks = code.match(/\.then\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\n\s*\}\s*\)/g) || [];
  let hasConditional = false;
  for (const block of thenBlocks) {
    if (/\bif\s*\(/.test(block) || /\belse\s*\{/.test(block)) {
      hasConditional = true;
      break;
    }
  }
  const passed = !hasConditional;
  return {
    rule: "No conditional assertions",
    passed,
    severity: "error",
    message: passed
      ? "No if/else in .then() callbacks"
      : "Found conditional logic inside .then() — tests must fail when features are broken, not fall through",
  };
}

function checkImportsSelectors(code: string): ComplianceCheck {
  const passed = /import\s+.*from\s+["'].*support\/selectors/.test(code) ||
    /import\s+.*from\s+["'].*selectors/.test(code);
  return {
    rule: "Imports selectors",
    passed,
    severity: "warning",
    message: passed
      ? "Imports selectors from support/selectors.ts"
      : "Not importing from cypress/support/selectors.ts — all selectors must be centralized",
  };
}

function checkImportsConstants(code: string): ComplianceCheck {
  const passed = /import\s+.*from\s+["'].*support\/constants/.test(code) ||
    /import\s+.*from\s+["'].*constants/.test(code);
  return {
    rule: "Imports constants",
    passed,
    severity: "warning",
    message: passed
      ? "Imports constants from support/constants.ts"
      : "Not importing from cypress/support/constants.ts — use TIMEOUTS, INTENTS, etc.",
  };
}

function checkBeforeEachNotBefore(code: string): ComplianceCheck {
  const hasBeforeEach = /\bbeforeEach\s*\(/.test(code);
  const hasBefore = /\bbefore\s*\(/.test(code);
  // beforeEach is preferred (re-runs on retry), before is discouraged
  const passed = hasBeforeEach || !hasBefore;
  return {
    rule: "Uses beforeEach (not before)",
    passed,
    severity: "warning",
    message: passed
      ? "Uses beforeEach for setup (re-runs on Cypress retry)"
      : "Uses before() — prefer beforeEach() so account creation re-runs on retry",
  };
}

function checkItNamingConvention(code: string): ComplianceCheck {
  // Expected: "P0 | PayPal | WorkflowName | Features"
  const itMatch = code.match(/it\s*\(\s*["'`]([^"'`]+)["'`]/);
  if (!itMatch) {
    return { rule: "it() naming convention", passed: false, severity: "warning", message: "No it() block found" };
  }
  const itName = itMatch[1];
  const pattern = /^P[012]\s*\|\s*(PayPal|Venmo)\s*\|\s*\w/;
  const passed = pattern.test(itName);
  return {
    rule: "it() naming convention",
    passed,
    severity: "warning",
    message: passed
      ? `Follows "Priority | Tenant | Workflow | Features" format`
      : `it() name "${itName.slice(0, 60)}..." should follow: "P0 | PayPal | WorkflowName | Features"`,
  };
}

// ── Rule 5: Unique test data (JAWS / venmoService) ──

function checkUniqueTestData(code: string): ComplianceCheck {
  const usesJAWS = /JAWS|jaws|cy\.createJawsAccount|jawsAccount|Fresh|createFreshAccount/i.test(code);
  const usesVenmoService = /venmoService|createVenmoAccount/i.test(code);
  const usesTestAccounts = /TEST_ACCOUNTS\./i.test(code);
  const passed = usesJAWS || usesVenmoService || usesTestAccounts;
  return {
    rule: "Uses unique test data",
    passed,
    severity: "warning",
    message: passed
      ? "Uses JAWS, venmoService, or TEST_ACCOUNTS for test data"
      : "No JAWS/venmoService/TEST_ACCOUNTS found — use unique test data to avoid conflicts between parallel runs",
  };
}

// ── Rule 7: Data validation commands ──

function checkDataValidation(code: string): ComplianceCheck {
  const usesValidateTableRow = /validateTableRow|cy\.validateTableRow/i.test(code);
  const usesValidateDetail = /validateDetailSection|cy\.validateDetailSection/i.test(code);
  const usesContains = /cy\.contains\(/.test(code);
  const usesShould = /\.should\(/.test(code);
  const passed = usesValidateTableRow || usesValidateDetail || (usesContains && usesShould);
  return {
    rule: "Data validation",
    passed,
    severity: "info",
    message: passed
      ? "Uses data validation (validateTableRow/validateDetailSection or cy.contains + should)"
      : "Missing data validation — use validateTableRow(), validateDetailSection(), or cy.contains().should() to verify displayed data",
  };
}

// ── Rule: Test case documentation ──

function checkTestCaseDoc(testPath: string, repoPath: string): ComplianceCheck {
  // Extract workflow name from test path
  // e.g., "cypress/e2e/workflows/cancel-payment/p1-paypal-cancel-payment-..." → "cancel-payment"
  const parts = testPath.split("/");
  const workflowIdx = parts.indexOf("workflows");
  const workflowFolder = workflowIdx >= 0 && workflowIdx + 1 < parts.length
    ? parts[workflowIdx + 1]
    : "";

  if (!workflowFolder) {
    return {
      rule: "Test case documentation",
      passed: false,
      severity: "warning",
      message: "Could not determine workflow name from test path to check for test case doc",
    };
  }

  // Convert folder name to PascalCase for doc filename: "cancel-payment" → "CancelPayment"
  const docName = workflowFolder
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  const docPath = path.join(repoPath, "docs", "test-cases", `${docName}_TestCases.md`);
  const exists = fs.existsSync(docPath);

  return {
    rule: "Test case documentation",
    passed: exists,
    severity: "warning",
    message: exists
      ? `Test case doc exists: docs/test-cases/${docName}_TestCases.md`
      : `Missing test case doc: docs/test-cases/${docName}_TestCases.md — should be created/updated with test details`,
  };
}

// ── Run All Static Checks ──

function runStaticChecks(testPath: string, code: string, repoPath: string): ComplianceCheck[] {
  const fileName = path.basename(testPath);
  return [
    checkFileNaming(fileName),
    checkSingleDescribe(code),
    checkSingleIt(code),
    checkItNamingConvention(code),
    checkNoInlineSelectors(code),
    checkNoHardWaits(code),
    checkUniqueTestData(code),
    checkNavigateToWorkflow(code),
    checkClosesWorkflow(code),
    checkDataValidation(code),
    checkUsesTimeouts(code),
    checkUsesAddTestContext(code),
    checkNoConditionalAssertions(code),
    checkImportsSelectors(code),
    checkImportsConstants(code),
    checkBeforeEachNotBefore(code),
    checkTestCaseDoc(testPath, repoPath),
  ];
}

function calculateScore(checks: ComplianceCheck[]): number {
  if (checks.length === 0) return 100;
  const weights: Record<string, number> = { error: 3, warning: 1, info: 0.5 };
  const totalWeight = checks.reduce((sum, c) => sum + (weights[c.severity] || 1), 0);
  const passedWeight = checks
    .filter((c) => c.passed)
    .reduce((sum, c) => sum + (weights[c.severity] || 1), 0);
  return Math.round((passedWeight / totalWeight) * 100);
}

// ── Main Validation Function ──

export async function validateCompliance(params: {
  generatedFiles: GeneratedTestFile[];
  repoPath: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmModel?: string;
  runId?: string;
}): Promise<ComplianceResult[]> {
  const { generatedFiles, repoPath } = params;
  const results: ComplianceResult[] = [];

  // Only validate files that were actually created
  const createdFiles = generatedFiles.filter((f) => f.status === "created");

  if (createdFiles.length === 0) {
    console.log("[Compliance] No created files to validate");
    return results;
  }

  console.log(`\n[Compliance] Validating ${createdFiles.length} generated file(s)...`);

  // Load FT Guide for LLM review
  const knowledgeBase = readKnowledgeBase();
  const ftGuide = knowledgeBase.find((kb) => kb.name.includes("FUNCTIONAL_TESTING_GUIDE"));
  const guideExcerpt = ftGuide?.content.slice(0, 8000) || "";

  // LLM client (optional — only for semantic review)
  let llm: ReturnType<typeof createLLMClient> | null = null;
  if (params.llmApiKey) {
    try {
      llm = createLLMClient({
        llmApiKey: params.llmApiKey,
        llmBaseUrl: params.llmBaseUrl,
        llmModel: params.llmModel,
      });
    } catch {
      console.log("[Compliance] LLM not available — static checks only");
    }
  }

  for (const file of createdFiles) {
    const absPath = path.join(repoPath, file.testPath);
    let code: string;

    try {
      code = fs.readFileSync(absPath, "utf-8");
    } catch {
      console.warn(`[Compliance] Could not read: ${absPath}`);
      results.push({
        testPath: file.testPath,
        passed: false,
        score: 0,
        checks: [{ rule: "File readable", passed: false, severity: "error", message: `Could not read file: ${file.testPath}` }],
      });
      continue;
    }

    // Part A: Static checks
    const checks = runStaticChecks(file.testPath, code, repoPath);

    // Part B: LLM review (if available)
    if (llm && guideExcerpt) {
      try {
        console.log(`[Compliance] LLM reviewing: ${file.testPath}`);
        const userPrompt = buildComplianceUserPrompt({
          testPath: file.testPath,
          testContent: code,
          guideExcerpt,
        });

        const response = await llm.invoke([
          { content: FT_COMPLIANCE_SYSTEM_PROMPT, _getType: () => "system" },
          { content: userPrompt },
        ]);

        // Parse LLM response
        const jsonStr = response.content.match(/\{[\s\S]*\}/)?.[0] || "{}";
        const parsed = JSON.parse(jsonStr);
        const llmIssues = parsed.issues || [];

        for (const issue of llmIssues) {
          // Only add if not already covered by static checks
          const alreadyCovered = checks.some(
            (c) => c.rule.toLowerCase() === (issue.rule || "").toLowerCase()
          );
          if (!alreadyCovered) {
            checks.push({
              rule: issue.rule || "LLM Review",
              passed: false,
              severity: issue.severity || "info",
              message: `${issue.description || ""}${issue.suggestion ? ` — Fix: ${issue.suggestion}` : ""}`,
            });
          }
        }
        console.log(`[Compliance] LLM found ${llmIssues.length} additional issue(s)`);
        if (params.runId) {
          try { insertAgentLog({ run_id: params.runId, agent_name: "compliance", action: "review", target_file: file.testPath, decision: llmIssues.length > 0 ? "issues_found" : "passed", reason: `${llmIssues.length} issue(s)`, duration_ms: response.latencyMs, token_count: response.usage?.total_tokens, llm_model: params.llmModel, success: true }); } catch { /* non-blocking */ }
        }
      } catch (err) {
        console.warn(`[Compliance] LLM review failed:`, err instanceof Error ? err.message : err);
      }
    }

    const score = calculateScore(checks);
    const passed = checks.filter((c) => c.severity === "error").every((c) => c.passed);

    console.log(`[Compliance] ${file.testPath}: score=${score}, passed=${passed}, checks=${checks.length}`);

    results.push({ testPath: file.testPath, passed, score, checks });
  }

  console.log(`[Compliance] Done. ${results.length} file(s) validated.`);
  return results;
}
