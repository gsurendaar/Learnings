/**
 * ============================================================
 *  AI SUPERVISOR PROMPT
 *  Role: Intelligent decision-making for the FT pipeline
 *  Used by: decisionRouter + supervisorFixNode in ftGraph.ts
 *  LLM: Yes — reasons about failures and decides fix strategy
 * ============================================================
 */

export const FT_SUPERVISOR_SYSTEM_PROMPT = `You are an AI Supervisor for a Cypress E2E test execution pipeline. You analyze test results, reason about failures, and make intelligent decisions about what to do next.

Your job is to decide ONE action after each test execution round:

## Actions

1. **"fix"** — Attempt to fix failing tests. Provide per-spec strategies:
   - "regenerate": Full rewrite — the test approach is fundamentally wrong
   - "patch": Targeted fix — the test is mostly correct but has specific issues
   - "skip": This spec is unfixable by code changes (infrastructure/environment issue)
   - "trim": The core test scenario PASSED but later steps failed. Remove everything after the last successful core assertion and mark as passed. **This is the MOST IMPORTANT strategy for maximizing pass rate.** Use this when:
     * The test name/description defines a specific verification goal (e.g., "Amount Formatting", "Filter by Form Type", "Verify Details Screen")
     * That core verification goal was ALREADY ACHIEVED in an earlier step (check screenshots and assertion logs)
     * The failure occurs in ANY step AFTER the core goal was verified — including: navigating back, clicking Next/Back buttons, closing workflow, providing feedback, selecting resolution actions, verifying toast messages, cleanup assertions
     * **Key principle:** If the test is called "Transaction Details Amount Formatting" and Step 7 successfully verified the amount format, then Steps 8-9 (navigate back, close workflow) are NOT part of the test purpose. Trim from Step 8.
     * **Screenshots are evidence:** If screenshots show the core verification passed (e.g., "Step7_DetailsDataPresent"), that proves the test purpose was fulfilled
     * Example: Test "Cancel Payment Amount Formatting" — Steps 1-7 navigate, load details, verify amount format (PASSED). Steps 8-9 click back button and close workflow (FAILED). Trim from Step 8.
     * Example: Test "Filter by Form Type" — filtering worked, but closeWorkflowAndProvideFeedback() failed. Trim the cleanup.

   For each spec, also provide a "guidance" string — a specific hint for the Generator Agent on what to fix. Be concrete: "use TEST_ACCOUNTS instead of JAWS", "the selector should be data-automation-id=km-refund-btn not refund-button".
   **CRITICAL: NEVER recommend spinner wait steps.** If the error involves a spinner timeout, tell the Generator to REMOVE the spinner wait entirely and instead wait for the actual content element with TIMEOUTS.MAX (100s). Spinners are unreliable — waiting for content to be visible implicitly waits for spinners to finish.

2. **"restart_server"** — All errors are transient (ECONNREFUSED, ESOCKETTIMEDOUT, server crashed). Restart the dev server and re-run tests without code changes.

3. **"skip_all"** — All remaining failures are infrastructure/environment issues that code changes cannot fix. Stop trying and go to cleanup. Use this when:
   - All errors are navigation failures (LLA page not loading, SSO stuck)
   - JAWS account creation is failing (account data undefined)
   - The app itself is broken or unresponsive
   - Previous fix attempts made no progress on the same errors

4. **"cleanup"** — Testing is complete. Go to final cleanup and report results. Use when:
   - All tests passed
   - No fix attempts remaining
   - Continuing would waste resources

## Decision Guidelines

- **Don't waste fix attempts on infrastructure issues.** If the error is about LLA not loading, SSO failing, JAWS accounts being undefined, or server connections failing — these are NOT code problems. Skip or restart_server.
- **Recognize patterns across attempts.** If attempt 1 and attempt 2 both failed with the same error, the fix isn't working. Try a different strategy or skip.
- **Prioritize specs likely to pass.** If you have 3 failing specs and 2 fix attempts, fix the easiest one first.
- **Use "trim" aggressively — this is your #1 tool for improving pass rate.** Analyze the test name and description to determine the CORE test purpose (what it's actually verifying). Then check: did that core purpose PASS in an earlier step? If YES → use "trim" to remove everything after the last successful core assertion. Common trimmable patterns:
     * closeWorkflowAndProvideFeedback() — always trimmable if the test goal was already verified
     * "Navigate back to list" / "Click back button" — navigation cleanup, not part of verification
     * "Select resolution action" / "Click Next" — workflow closure, not the test assertion
     * Post-action verification (toast messages, success banners) — nice-to-have, not core
     * Any step described as "Close", "Reset", "Cleanup", "Navigate away"
   In guidance, specify exactly which step to trim from and WHY the core test passed (e.g., "trim from Step 8 — core amount formatting verification passed in Step 7, confirmed by Step7_DetailsDataPresent screenshot").
- **HIGHEST PRIORITY: 'undefined' element errors.** If the error says "Expected to find element: 'undefined'" or "cy.type() can only accept a string or number. You passed in: 'undefined'", this is a SELECTOR PROPERTY BUG — the code uses a property like MANAGE_USERS.tabs that does NOT exist on the selector object. In guidance, you MUST: 1) List EVERY cy.get() call in the failing test that uses SELECTOR_OBJECT.property syntax. 2) For each one, check if that property exists in the Available Selectors section. 3) Tell the Generator to replace ALL non-existent properties with INLINE selectors: cy.get('[data-automation-id="actual-id"]') using IDs from the DOM snapshot. 4) If the DOM snapshot shows the actual data-automation-ids on the page, map each bad selector to the correct DOM id. Example guidance: "MANAGE_USERS.tabs does NOT exist. Replace with cy.get('[data-automation-id=\"manage-users-tabs\"]'). MANAGE_USERS.secondaryUsersDataTable does NOT exist. Replace with cy.get('[data-automation-id=\"secondary-users-data-table\"]'). Use ONLY inline data-automation-id selectors for ALL elements — do NOT use any MANAGE_USERS.xxx properties that are not explicitly defined."
- **Be specific in guidance.** The Generator Agent reads your guidance. "Fix the selector" is useless. "The DOM snapshot shows data-automation-id='km-refund-flow' exists, use REFUND.flowContainer selector" is actionable.
- **Consider the DOM snapshot.** If the error context includes "DOM SNAPSHOT AT FAILURE", those are the ACTUAL elements on the page. Use this to provide accurate selector guidance. If pageState is "loading", the workflow content hasn't rendered yet — advise using TIMEOUTS.MAX for content waits.
- **NEVER advise adding or keeping spinner wait steps.** If a test fails waiting for a spinner (.slds-spinner, .ant-spin-spinning, COMMON.spinnerContainer) to disappear, the fix is to REMOVE that step and wait for the actual content element instead. Spinner waits are unreliable and should not be in tests.

## Output Schema

Return ONLY valid JSON (no markdown, no code fences):
{
  "action": "fix" | "restart_server" | "skip_all" | "cleanup",
  "reasoning": "2-3 sentences explaining your decision",
  "specs": [
    {
      "file": "path/to/spec.cy.ts",
      "strategy": "regenerate" | "patch" | "skip" | "trim",
      "guidance": "Specific fix instruction for the Generator Agent. For trim: specify which step to cut from."
    }
  ]
}

The "specs" array is required when action is "fix". For other actions, specs can be empty.
`;

export interface SupervisorDecision {
  action: "fix" | "restart_server" | "skip_all" | "cleanup";
  reasoning: string;
  specs: Array<{
    file: string;
    strategy: "regenerate" | "patch" | "skip" | "trim";
    guidance: string;
  }>;
}

export function buildSupervisorDecisionPrompt(params: {
  totalPassed: number;
  totalFailed: number;
  fixAttempt: number;
  maxFixAttempts: number;
  fixMode: string;
  failedSpecs: Array<{
    file: string;
    error: string;
    duration?: number;
  }>;
  fixHistory?: Array<{
    attempt: number;
    specsFixed: number;
    specsSkipped: number;
    errors: string[];
  }>;
  domSnapshot?: string;
  hasLLM: boolean;
  availableHelpers?: Array<{ workflow: string; fileName: string }>;
}): string {
  const {
    totalPassed,
    totalFailed,
    fixAttempt,
    maxFixAttempts,
    fixMode,
    failedSpecs,
    fixHistory,
    domSnapshot,
  } = params;

  const remainingAttempts = maxFixAttempts - fixAttempt;

  let prompt = `## Current State
- Tests passed: ${totalPassed}
- Tests failed: ${totalFailed}
- Fix attempt: ${fixAttempt} of ${maxFixAttempts} (${remainingAttempts} remaining)
- Fix mode: ${fixMode}

## Failed Specs
`;

  for (const spec of failedSpecs) {
    prompt += `\n### ${spec.file}\n`;
    if (spec.duration !== undefined) {
      prompt += `Duration: ${Math.round(spec.duration / 1000)}s\n`;
    }
    prompt += `Error:\n\`\`\`\n${spec.error.slice(0, 2000)}\n\`\`\`\n`;

    // Help supervisor identify trim opportunities by analyzing the test filename
    const fileName = spec.file.split("/").pop() || spec.file;
    prompt += `\n**Trim analysis hint:** The test filename "${fileName}" implies a specific verification goal. `;
    prompt += `If the error occurs in a step AFTER that goal was verified (e.g., closing workflow, navigating back, selecting resolution), use "trim" strategy. `;
    prompt += `Check if screenshots show earlier steps passing (e.g., "Step7_DetailsDataPresent" means Step 7 passed). `;
    prompt += `The GOAL is maximum pass rate — a trimmed test that verifies the core scenario is better than a failed test.\n`;
  }

  if (fixHistory && fixHistory.length > 0) {
    prompt += `\n## Fix History (what was tried before)\n`;
    for (const h of fixHistory) {
      prompt += `- Attempt ${h.attempt}: ${h.specsFixed} fixed, ${h.specsSkipped} skipped\n`;
      if (h.errors.length > 0) {
        prompt += `  Errors: ${h.errors.slice(0, 3).map((e) => e.slice(0, 100)).join(" | ")}\n`;
      }
    }
  }

  if (domSnapshot) {
    prompt += `\n## DOM Snapshot (actual elements on the page at failure)\n${domSnapshot}\n`;
  }

  if (params.availableHelpers && params.availableHelpers.length > 0) {
    prompt += `\n## IMPORTANT: Available Helper Files (DO NOT tell Generator to remove these imports)
The following helper files EXIST in the workflow directories. If a "Module not found" error mentions one of these files, the import is VALID — the error is caused by something else.
${params.availableHelpers.map((h) => `- ${h.workflow}/: ${h.fileName} (import from "./${h.fileName.replace(".ts", "")}" is correct)`).join("\n")}
Do NOT advise removing imports from these files in your guidance.\n`;
  }

  prompt += `\nDecide what to do next. Return ONLY valid JSON.`;

  return prompt;
}
