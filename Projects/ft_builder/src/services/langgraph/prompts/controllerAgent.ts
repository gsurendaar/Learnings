/**
 * ============================================================
 *  CONTROLLER AGENT
 *  Role: Orchestration, spec splitting, and decision routing
 *  Nodes: splitNode, aggregateNode, decisionRouter in ftGraph.ts
 *  LLM: No (deterministic logic)
 * ============================================================
 *
 * ADD YOUR CONTEXT BELOW — this controls how work is distributed
 * and when to retry vs give up.
 */

// ===================== YOUR CONTEXT HERE =====================
// Edit this object to control the controller agent's behavior.
// These values are read by splitNode, aggregateNode, decisionRouter.

export const CONTROLLER_AGENT_CONTEXT = {
  /**
   * Agent identity
   */
  name: "Controller Agent",
  description: "Orchestrates the test pipeline — splits work, aggregates results, decides next action",

  /**
   * How to distribute specs across workers.
   * "round-robin" = distribute evenly across workers
   * "by-folder"   = group specs from same folder to same worker
   */
  splitStrategy: "round-robin" as const,

  /**
   * Max parallel workers (1 = sequential, 2-4 = parallel).
   * Can be overridden per-run via the UI workerCount config.
   */
  defaultWorkerCount: 1,

  /**
   * Decision rules after tests complete.
   * The controller checks these conditions IN ORDER:
   */
  decisionRules: {
    /** If all tests passed → go to cleanup (success) */
    allPassed: "cleanupNode",

    /** If max fix attempts reached → go to cleanup (with failures) */
    maxRetriesReached: "cleanupNode",

    /** If failures remain and retries left → go to fix node */
    failuresWithRetriesLeft: "fixNode",
  },

  /**
   * Max auto-fix attempts before giving up.
   * After this many fix+retry cycles, the pipeline stops and reports failures.
   */
  maxFixAttempts: 2,

  /**
   * What to re-run on retry.
   * "failed-only" = only re-run the specs that failed (narrowing)
   * "all"         = re-run all original specs
   */
  retryScope: "failed-only" as const,

  /**
   * State reset behavior on retry.
   * These state fields are cleared before re-entering the split→worker→aggregate loop.
   */
  stateResetOnRetry: [
    "workerResults",   // clear accumulated results
    "totalPassed",     // reset counters
    "totalFailed",
    "totalDuration",
    "failedSpecs",
    "allResults",
  ],
};
