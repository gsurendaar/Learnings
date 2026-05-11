/**
 * ============================================================
 *  SETUP AGENT
 *  Role: Environment preparation and validation
 *  Node: setupNode in ftGraph.ts
 *  LLM: No (pure infrastructure logic)
 * ============================================================
 *
 * ADD YOUR CONTEXT BELOW — this controls the setup agent's behavior.
 */

// ===================== YOUR CONTEXT HERE =====================
// Edit this object to control what the setup agent does.
// These values are read by setupNode in ftGraph.ts.

export const SETUP_AGENT_CONTEXT = {
  /**
   * Agent identity
   */
  name: "Setup Agent",
  description: "Prepares the environment before any tests can run",

  /**
   * Steps to execute (in order).
   * Each step emits SSE events so the UI shows progress.
   * To skip a step, set enabled: false.
   */
  steps: {
    clone: {
      enabled: true,
      description: "Clone the target repository into a temp directory",
      cloneDepth: 1, // shallow clone for speed (set 0 for full clone)
    },
    install: {
      enabled: true,
      description: "Install npm dependencies via npm ci",
    },
    startServer: {
      enabled: true,
      description: "Start the dev server and wait for it to be ready",
      portRange: { start: 3001, end: 3020 },
      readyTimeout: 90000, // ms to wait for server to respond
    },
  },

  /**
   * What happens if a step fails.
   * "abort" = stop the entire pipeline
   * "warn"  = log warning and continue (use for optional steps)
   */
  onStepFailure: "abort" as const,

  /**
   * Additional environment checks to run after setup.
   * Add custom validations here.
   */
  validations: [
    "cypress.config.ts or cypress.config.js exists in repo root",
    "node_modules/cypress/bin/cypress is executable",
  ],

  /**
   * Custom environment variables this agent should set
   * before handing off to the next agent.
   */
  environmentOverrides: {
    // Example: NODE_ENV: "test",
    // Example: CYPRESS_BASE_URL: "http://localhost:3001/sparkx",
  },
};
