import * as fs from "fs";
import * as path from "path";
import { createLLMClient } from "./langgraph/llm";
import {
  FT_SUGGESTIONS_SYSTEM_PROMPT,
  FT_COMPOSITE_SUGGESTIONS_SYSTEM_PROMPT,
  buildSuggestionsUserPrompt,
  buildCompositeUserPrompt,
} from "./langgraph/prompts/ftSuggestions";
import {
  findSourceFiles,
  readKnowledgeBase,
  readExistingCypressTests,
  extractAutomationCoverage,
} from "./ftGenerator";
import { insertAgentLog, insertRun } from "@/lib/ftDatabase";
import type { FTSuggestion, SuggestionsResponse } from "@/types/ft";

const MAX_SOURCE_CHARS_PER_BATCH = 40000;

/**
 * Extract JSON from a response that may be wrapped in markdown code fences.
 */
function extractJSON(text: string): string {
  // Try to find JSON in code fences first (greedy to capture full content)
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try to find a JSON object with { "suggestions": [...] } pattern
  const objMatch = text.match(/\{\s*"suggestions"\s*:\s*\[[\s\S]*\]\s*\}/);
  if (objMatch) return objMatch[0];

  // Try to find any JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];

  // Try to find a JSON array directly
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];

  return text.trim();
}

/**
 * Analyze source code and generate FT suggestions using LLM.
 */
export async function generateSuggestions(params: {
  selectedFolders: string[];
  manualPaths: string[];
  repoPath: string;
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel?: string;
  customPrompt?: string;
  runId?: string;
  includeComposites?: boolean;
  triggeredBy?: string;
}): Promise<SuggestionsResponse> {
  const { selectedFolders, manualPaths, repoPath } = params;

  console.log(`\n[FT Suggestions] Starting analysis...`);
  console.log(`  Folders: ${selectedFolders.join(", ") || "none"}`);
  console.log(`  Manual paths: ${manualPaths.length}`);
  console.log(`  Repo path: ${repoPath}`);

  // Skip patterns — files that don't produce meaningful E2E test suggestions
  const SKIP_PATTERNS = [
    "index.ts", "index.tsx",       // barrel re-exports
    "constants.ts", "constants.tsx", // static data
    "types.ts", "types.tsx",       // type definitions
    "utils.ts", "utils.tsx",       // utilities
    "helpers.ts", "helpers.tsx",   // helpers
    "styles.ts", "styles.tsx",     // styles
    ".test.", ".spec.", ".stories.", ".cy.", ".d.ts", // test/story files
  ];

  const shouldSkip = (filePath: string) => {
    const fileName = path.basename(filePath);
    return SKIP_PATTERNS.some((p) => fileName.includes(p) || fileName === p);
  };

  // 1. Collect source files (skip non-testable files)
  const allFiles: Array<{ absolutePath: string; relativePath: string }> = [];

  for (const folder of selectedFolders) {
    const folderPath = path.join(repoPath, "components", "console", folder);
    const files = findSourceFiles(folderPath).filter((f) => !shouldSkip(f));
    for (const f of files) {
      const relativePath = path.relative(repoPath, f);
      allFiles.push({ absolutePath: f, relativePath });
    }
  }

  for (const mp of manualPaths) {
    if (!mp.trim()) continue;
    const absPath = path.join(repoPath, mp.trim());
    if (!fs.existsSync(absPath)) continue;

    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      // Recursively find source files in the directory
      const files = findSourceFiles(absPath);
      for (const f of files) {
        const relativePath = path.relative(repoPath, f);
        allFiles.push({ absolutePath: f, relativePath });
      }
    } else {
      allFiles.push({ absolutePath: absPath, relativePath: mp.trim() });
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  const uniqueFiles = allFiles.filter((f) => {
    if (seen.has(f.relativePath)) return false;
    seen.add(f.relativePath);
    return true;
  });

  // Cap at 15 most important files (prioritize main components over sub-components)
  const MAX_SOURCE_FILES = 10;
  if (uniqueFiles.length > MAX_SOURCE_FILES) {
    console.log(`[FT Suggestions] Capping from ${uniqueFiles.length} to ${MAX_SOURCE_FILES} source files`);
    // Prioritize files with "Flow", "Workflow", "Container", "Page" in name
    uniqueFiles.sort((a, b) => {
      const priority = (p: string) => {
        const name = path.basename(p);
        if (/Flow|Workflow|Container|Page/i.test(name)) return 0;
        if (/use[A-Z]/.test(name)) return 1; // hooks
        return 2;
      };
      return priority(a.relativePath) - priority(b.relativePath);
    });
    uniqueFiles.splice(MAX_SOURCE_FILES);
  }

  console.log(`[FT Suggestions] Found ${uniqueFiles.length} source files`);

  if (uniqueFiles.length === 0) {
    return { suggestions: [], sourceFiles: [], totalSourceFiles: 0 };
  }

  // 2. Read file contents
  const sourceFilesWithContent: Array<{ path: string; content: string }> = [];
  for (const file of uniqueFiles) {
    try {
      let content = fs.readFileSync(file.absolutePath, "utf-8");
      if (content.length > 50000) {
        console.log(`[FT Suggestions] Large file (${content.length} chars), truncating: ${file.relativePath}`);
        content = content.slice(0, 50000);
      }
      sourceFilesWithContent.push({ path: file.relativePath, content });
    } catch {
      console.warn(`[FT Suggestions] Could not read: ${file.absolutePath}`);
    }
  }

  // 3. Load knowledge base and existing test examples
  const knowledgeBase = readKnowledgeBase();
  const existingTests = readExistingCypressTests(repoPath, 2);

  // 4. Create LLM client
  const llm = createLLMClient({
    llmApiKey: params.llmApiKey,
    llmBaseUrl: params.llmBaseUrl,
    llmModel: params.llmModel,
  });

  // 5. Batch source files if needed and call LLM
  const batches: Array<Array<{ path: string; content: string }>> = [];
  let currentBatch: Array<{ path: string; content: string }> = [];
  let currentSize = 0;

  for (const file of sourceFilesWithContent) {
    if (currentSize + file.content.length > MAX_SOURCE_CHARS_PER_BATCH && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }
    currentBatch.push(file);
    currentSize += file.content.length;
  }
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  console.log(`[FT Suggestions] Processing ${batches.length} batch(es)`);

  let systemPrompt = FT_SUGGESTIONS_SYSTEM_PROMPT;
  if (params.customPrompt) {
    systemPrompt += `\n\n## IMPORTANT — Custom Instructions from User (HIGH PRIORITY — follow these above all other guidelines)\n${params.customPrompt}`;
  }

  const suggestionsRunId = params.runId || `suggestions-${Date.now()}`;

  try {
    insertRun({
      run_id: suggestionsRunId,
      owner: "",
      repo: "",
      branch: "",
      spec_pattern: "suggestions",
      browser: "none",
      retries: 0,
      run_mode: "suggestions",
      triggered_by: params.triggeredBy || "unknown",
    });
  } catch { /* non-blocking */ }

  const batchResults = await Promise.allSettled(
    batches.map(async (batch, i) => {
      console.log(`[FT Suggestions] Batch ${i + 1}/${batches.length}: ${batch.length} files`);

      const userPrompt = buildSuggestionsUserPrompt({
        sourceFiles: batch,
        knowledgeBase,
        existingTests,
      });

      const systemMessage = {
        content: systemPrompt,
        _getType: () => "system" as const,
      };
      const userMessage = { content: userPrompt };

      const batchStart = Date.now();
      const response = await llm.invoke([systemMessage, userMessage]);
      const batchDuration = Date.now() - batchStart;
      const batchTokens = response.usage?.total_tokens || 0;

      console.log(`[FT Suggestions] Batch ${i + 1} raw response (first 500 chars):`, response.content.slice(0, 500));

      const jsonStr = extractJSON(response.content);
      console.log(`[FT Suggestions] Batch ${i + 1} extracted JSON (first 300 chars):`, jsonStr.slice(0, 300));

      const parsed = JSON.parse(jsonStr);
      const suggestionsArray = Array.isArray(parsed) ? parsed : (parsed.suggestions || []);

      console.log(`[FT Suggestions] Batch ${i + 1} returned ${suggestionsArray.length} suggestions, ${batchTokens} tokens, ${batchDuration}ms`);

      try {
        insertAgentLog({
          run_id: suggestionsRunId,
          pipeline: "ft-builder",
          agent_name: "suggestions",
          action: "analyze",
          decision: suggestionsArray.length > 0 ? "suggestions_generated" : "no_suggestions",
          reason: `Batch ${i + 1}/${batches.length}: ${batch.length} files → ${suggestionsArray.length} suggestions`,
          duration_ms: batchDuration,
          llm_model: params.llmModel,
          token_count: batchTokens,
          success: true,
          metadata: JSON.stringify({
            batchIndex: i,
            totalBatches: batches.length,
            filesInBatch: batch.map((f) => f.path),
            selectedFolders: params.selectedFolders,
          }),
        });
      } catch { /* non-blocking */ }

      return suggestionsArray;
    })
  );

  const allSuggestions: FTSuggestion[] = [];
  let suggestionCounter = 1;
  let failCount = 0;

  for (let i = 0; i < batchResults.length; i++) {
    const result = batchResults[i];
    if (result.status === "fulfilled") {
      for (const s of result.value as Array<Partial<FTSuggestion>>) {
        allSuggestions.push({
          id: `sug-${String(suggestionCounter++).padStart(3, "0")}`,
          title: s.title || "Untitled",
          description: s.description || "",
          priority: s.priority || "P1",
          tenant: s.tenant || "Both",
          category: s.category || "interaction",
          sourceFile: s.sourceFile || "",
          specFileName: s.specFileName || "",
          selected: true,
        });
      }
    } else {
      failCount++;
      const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error(`[FT Suggestions] Batch ${i + 1} failed:`, result.reason);
      try {
        insertAgentLog({
          run_id: suggestionsRunId,
          pipeline: "ft-builder",
          agent_name: "suggestions",
          action: "analyze",
          decision: "error",
          reason: `Batch ${i + 1}/${batches.length} failed`,
          llm_model: params.llmModel,
          success: false,
          error: errorMsg,
        });
      } catch { /* non-blocking */ }
    }
  }

  if (failCount === batches.length && batches.length > 0) {
    throw new Error(`All ${batches.length} LLM suggestion batch(es) failed`);
  }

  console.log(`[FT Suggestions] Total: ${allSuggestions.length} suggestions`);

  // Mark individual suggestions as single type
  for (const s of allSuggestions) {
    s.type = "single";
  }

  // ── Post-processing: combine related suggestions into end-to-end composites ──
  if (allSuggestions.length >= 3) {
    console.log(`[FT Suggestions] Analyzing ${allSuggestions.length} suggestions for composite end-to-end cases...`);

    try {
      const compositeUserPrompt = buildCompositeUserPrompt(allSuggestions);
      const compositeStart = Date.now();
      const compositeResponse = await llm.invoke([
        { content: FT_COMPOSITE_SUGGESTIONS_SYSTEM_PROMPT, _getType: () => "system" as const },
        { content: compositeUserPrompt },
      ]);
      const compositeDuration = Date.now() - compositeStart;
      const compositeTokens = compositeResponse.usage?.total_tokens || 0;

      const compositeJsonStr = extractJSON(compositeResponse.content);
      const compositeParsed = JSON.parse(compositeJsonStr);
      const composites: Array<Partial<FTSuggestion>> = Array.isArray(compositeParsed)
        ? compositeParsed
        : (compositeParsed.composites || []);

      console.log(`[FT Suggestions] Composite analysis returned ${composites.length} end-to-end case(s), ${compositeTokens} tokens, ${compositeDuration}ms`);

      for (const c of composites) {
        allSuggestions.push({
          id: `sug-${String(suggestionCounter++).padStart(3, "0")}`,
          title: c.title || "End-to-End Lifecycle Test",
          description: c.description || "",
          priority: c.priority || "P0",
          tenant: c.tenant || "Both",
          category: "lifecycle",
          sourceFile: c.sourceFile || "",
          specFileName: c.specFileName || "",
          selected: true,
          type: "composite",
          compositeSources: c.compositeSources || [],
        });
      }

      try {
        insertAgentLog({
          run_id: suggestionsRunId,
          pipeline: "ft-builder",
          agent_name: "suggestions",
          action: "combine",
          decision: composites.length > 0 ? "composites_generated" : "no_composites",
          reason: `${allSuggestions.filter((s) => s.type === "single").length} individual → ${composites.length} composite end-to-end case(s)`,
          duration_ms: compositeDuration,
          llm_model: params.llmModel,
          token_count: compositeTokens,
          success: true,
          metadata: JSON.stringify({
            individualCount: allSuggestions.filter((s) => s.type === "single").length,
            compositeCount: composites.length,
            compositeSources: composites.map((c) => c.compositeSources),
          }),
        });
      } catch { /* non-blocking */ }
    } catch (compositeErr) {
      const errorMsg = compositeErr instanceof Error ? compositeErr.message : String(compositeErr);
      console.warn(`[FT Suggestions] Composite analysis failed (non-blocking): ${errorMsg}`);
      try {
        insertAgentLog({
          run_id: suggestionsRunId,
          pipeline: "ft-builder",
          agent_name: "suggestions",
          action: "combine",
          decision: "error",
          reason: "Composite suggestion analysis failed",
          llm_model: params.llmModel,
          success: false,
          error: errorMsg,
        });
      } catch { /* non-blocking */ }
    }
  } else {
    console.log(`[FT Suggestions] Skipping composite analysis (need 3+ suggestions, have ${allSuggestions.length})`);
  }

  // Check if suggested spec files already exist in the repo
  const cypressE2eDir = path.join(repoPath, "cypress", "e2e");
  const existingSpecFiles = new Set<string>();

  if (fs.existsSync(cypressE2eDir)) {
    const collectSpecFiles = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            collectSpecFiles(fullPath);
          } else if (entry.name.endsWith(".cy.ts") || entry.name.endsWith(".cy.js")) {
            existingSpecFiles.add(entry.name);
          }
        }
      } catch {
        // Skip unreadable directories
      }
    };
    collectSpecFiles(cypressE2eDir);
  }

  // Also check __tests__ directory
  const testsDir = path.join(repoPath, "__tests__");
  if (fs.existsSync(testsDir)) {
    const collectTestFiles = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            collectTestFiles(fullPath);
          } else if (entry.name.endsWith(".cy.ts") || entry.name.endsWith(".cy.js")) {
            existingSpecFiles.add(entry.name);
          }
        }
      } catch {
        // Skip unreadable directories
      }
    };
    collectTestFiles(testsDir);
  }

  console.log(`[FT Suggestions] Found ${existingSpecFiles.size} existing spec files in repo`);

  // Mark suggestions that already have matching spec files
  for (const suggestion of allSuggestions) {
    if (suggestion.specFileName && existingSpecFiles.has(suggestion.specFileName)) {
      suggestion.exists = true;
      suggestion.selected = false; // Auto-deselect existing tests
    } else {
      suggestion.exists = false;
    }
  }

  const existingCount = allSuggestions.filter((s) => s.exists).length;
  if (existingCount > 0) {
    console.log(`[FT Suggestions] ${existingCount} suggestion(s) match existing spec files (auto-deselected)`);
  }

  // Inject demo test suggestion for cancel-payment workflow (for showcasing auto-fix)
  const isCancelPayment = params.selectedFolders.some((f) => f.includes("cancel-payment"));
  if (isCancelPayment) {
    const demoExists = allSuggestions.some((s) => s.specFileName === "p2-paypal-cpay-workflow-launch.cy.ts");
    if (!demoExists) {
      allSuggestions.push({
        id: `sug-${String(suggestionCounter++).padStart(3, "0")}`,
        title: "Cancel Payment - Workflow Launch Smoke Test",
        description: "P2 smoke test: Navigate to Cancel Payment workflow and verify the page header renders correctly. Simple navigation-only test — does not depend on JAWS or transaction data. Good for validating basic workflow routing.",
        priority: "P2",
        tenant: "PayPal",
        category: "rendering",
        sourceFile: "components/console/workflows/cancel-payment/useCancelPaymentNavigation.ts",
        specFileName: "p2-paypal-cpay-workflow-launch.cy.ts",
        selected: true,
        exists: false,
      });
    }
  }

  // Enforce hard caps on priority counts (LLM sometimes ignores limits)
  const MAX_P0 = 2;
  const MAX_P1 = 3;
  const MAX_P2 = 5;
  const MAX_TOTAL = 10;

  // Filter existing (already deselected) separately
  const newSuggestions = allSuggestions.filter((s) => !s.exists);
  const existingSuggestions = allSuggestions.filter((s) => s.exists);

  // Cap each priority level
  let p0Count = 0, p1Count = 0, p2Count = 0;
  const cappedNew = newSuggestions.filter((s) => {
    if (s.priority === "P0" && p0Count >= MAX_P0) return false;
    if (s.priority === "P1" && p1Count >= MAX_P1) return false;
    if (s.priority === "P2" && p2Count >= MAX_P2) return false;
    if (s.priority === "P0") p0Count++;
    else if (s.priority === "P1") p1Count++;
    else p2Count++;
    return true;
  });

  // Cap total
  const finalNew = cappedNew.slice(0, MAX_TOTAL);
  const trimmed = newSuggestions.length - finalNew.length;
  if (trimmed > 0) {
    console.log(`[FT Suggestions] Trimmed ${trimmed} suggestion(s) to enforce limits (P0:${p0Count}/${MAX_P0}, P1:${p1Count}/${MAX_P1}, P2:${p2Count}/${MAX_P2}, total:${finalNew.length}/${MAX_TOTAL})`);
  }

  // Filter out complex categories that the model isn't mature enough to handle yet
  const EXCLUDED_CATEGORIES = new Set(["error-handling", "conditional-rendering", "form-validation"]);
  const filteredNew = finalNew.filter((s) => !EXCLUDED_CATEGORIES.has(s.category));
  if (filteredNew.length < finalNew.length) {
    console.log(`[FT Suggestions] Filtered ${finalNew.length - filteredNew.length} complex-category suggestion(s) (error-handling, conditional-rendering, form-validation)`);
  }

  // Only return NEW suggestions — existing tests are already shown in the "Existing FTs" section
  const finalSuggestions = filteredNew;

  if (finalSuggestions.length === 0 && sourceFilesWithContent.length > 0) {
    console.warn(`[FT Suggestions] WARNING: 0 suggestions returned from ${sourceFilesWithContent.length} source files across ${batches.length} batch(es). LLM may have returned unparseable response.`);
  }

  // Count automation IDs and interactive elements for coverage
  let totalAutomationIds = 0;
  let totalInteractiveElements = 0;
  let automationCoverage = 0;
  for (const folder of selectedFolders) {
    const workflowFolder = folder.split("/").pop() || folder;
    const cov = extractAutomationCoverage(repoPath, workflowFolder);
    totalAutomationIds += cov.automationIds;
    totalInteractiveElements += cov.interactiveElements;
  }
  automationCoverage = totalInteractiveElements > 0
    ? Math.round((totalAutomationIds / totalInteractiveElements) * 100)
    : totalAutomationIds > 0 ? 100 : 0;

  return {
    suggestions: finalSuggestions,
    sourceFiles: sourceFilesWithContent.map((f) => f.path),
    totalSourceFiles: sourceFilesWithContent.length,
    suggestionsRunId,
    totalAutomationIds,
    totalInteractiveElements,
    automationCoverage,
    warning: finalSuggestions.length === 0 && sourceFilesWithContent.length > 0
      ? "AI returned no suggestions. This may be due to an API key issue, timeout, or the LLM response could not be parsed. Check your Anthropic API key."
      : undefined,
  };
}
