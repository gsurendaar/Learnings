/**
 * ============================================================
 *  SUPERVISOR AGENT
 *  Role: Test execution monitoring, failure analysis, auto-fix
 *  Nodes: workerNode (execution) + fixNode (auto-fix) in ftGraph.ts
 *  LLM: Yes (for auto-fix only)
 * ============================================================
 *
 * ADD YOUR CONTEXT BELOW — this controls how the supervisor
 * runs tests and how it uses the LLM to fix failures.
 */

// ===================== YOUR CONTEXT HERE =====================
// Edit this object to control the supervisor agent's behavior.
// These values are read by workerNode and fixNode in ftGraph.ts.

export const SUPERVISOR_AGENT_CONTEXT = {
  /**
   * Agent identity
   */
  name: "Supervisor Agent",
  description: "Runs Cypress tests, monitors results, and auto-fixes failures using AI",

  // ----- EXECUTION SETTINGS -----

  /**
   * Cypress execution configuration.
   * These are defaults; per-run config from UI takes priority.
   */
  execution: {
    defaultBrowser: "electron",
    defaultRetries: 1,        // Cypress-level retries per spec
    defaultRunMode: "headless",
    cypressTimeout: 300000,   // 5 min max per spec
    command: "npx cypress run",
  },

  /**
   * How to parse Cypress output to detect pass/fail.
   * The worker parses stdout line-by-line looking for these patterns:
   */
  outputPatterns: {
    specStart: /Running:\s+(.+\.cy\.ts)\s+\((\d+) of (\d+)\)/,
    testPass: /[✓✔]\s+(.+)\s+\((\d+)ms\)/,
    testFail: /(\d+) failing/,
    allPassed: /All specs passed/,
  },

  // ----- AUTO-FIX SETTINGS -----

  /**
   * Auto-fix configuration.
   * When tests fail, the supervisor can use the LLM to fix them.
   */
  autoFix: {
    /** Whether auto-fix is enabled at all */
    enabled: true,

    /** Requires LLM credentials (llmApiKey + llmBaseUrl in FTRunConfig) */
    requiresLLM: true,

    /** What happens if no LLM credentials are provided */
    fallbackWithoutLLM: "skip-fix-and-report-failures",

    /**
     * How the supervisor finds the source component for a failing test.
     *
     * Strategy: Extract the base name from the spec filename
     * (e.g., "home-widget.cy.ts" → "homewidget"), then search
     * components/console/ recursively for a .tsx/.ts file with
     * a matching name (case-insensitive, ignoring hyphens/dots).
     *
     * This source code is included in the fix prompt so the LLM
     * can see the correct selectors and component structure.
     */
    sourceDiscoveryStrategy: "fuzzy-filename-match",
    sourceSearchDir: "components/console/",

    /**
     * What context is sent to the LLM for each failing test.
     * The fix prompt (in fixGeneration.ts) assembles these pieces:
     */
    llmContextIncludes: [
      "Failing test file content (full .cy.ts file)",
      "Cypress error output — assertion errors, timeouts, stack traces (max 4000 chars)",
      "Source component code if found (max 6000 chars)",
      "Fix attempt number (so LLM knows if previous fixes didn't work)",
    ],

    /**
     * Max characters to send from Cypress error output.
     * Increase if your errors are getting truncated.
     */
    maxErrorOutputChars: 4000,

    /**
     * Max characters to send from source component.
     * Increase for very large components.
     */
    maxSourceChars: 6000,

    /**
     * Minimum response length to accept from LLM.
     * If the LLM returns less than this many chars, the fix is rejected.
     */
    minResponseLength: 50,
  },

  // ----- POST-FIX BEHAVIOR -----

  /**
   * After fixing, the supervisor hands control back to the controller
   * which narrows allSpecs to only the failed specs and re-runs.
   */
  postFixBehavior: {
    routeTo: "splitNode → workerNode → aggregateNode (re-enter execution loop)",
    scopeNarrowing: "Only failed specs are re-run, passing specs are preserved",
  },
};

/**
 * The actual LLM prompts used by the supervisor's auto-fix are in:
 *   ./fixGeneration.ts
 *
 * - FT_FIX_SYSTEM_PROMPT: Defines the LLM's debugging role & fix strategies
 * - buildFixUserPrompt(): Assembles failing test + error + source into one message
 *
 * Edit those to change WHAT the LLM sees during auto-fix.
 * Edit THIS file to change HOW the supervisor decides to invoke the LLM.
 */
