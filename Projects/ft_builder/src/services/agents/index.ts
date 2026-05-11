/**
 * FT Automation Agent System
 *
 * Three agents collaborate to generate, run, and fix Cypress E2E tests:
 *
 * 1. Supervisor Agent — Orchestrates the fix loop
 *    - Triages failures: regenerate / patch / skip
 *    - Detects transient errors (server restart without LLM)
 *    - Tracks fix history to avoid repeating failed approaches
 *    - Delegates to Generator Agent for actual code fixes
 *
 * 2. Generator Agent — Creates and fixes test code
 *    - Generates new tests from source code + knowledge base
 *    - Regenerates failing tests with error context + existing patterns
 *    - Reviews generated tests for pattern compliance (pre-run)
 *    - Uses existing passing FTs as source of truth
 *
 * 3. Fixer Agent (legacy) — Standalone fix analysis
 *    - Used as fallback when no LLM credentials available
 *    - Simpler prompt, JSON-based fix suggestions
 *    - Being phased out in favor of Supervisor + Generator
 *
 * Flow:
 *   Create FT: User → Suggestions → Generator creates → Supervisor reviews → User sees clean test
 *   Run FT:    Cypress runs → fails → Supervisor triages → Generator fixes → re-run → loop
 */

export { BaseAgent, type AgentConfig, type AgentContext, type AgentMemory } from "./BaseAgent";
export { SupervisorAgent, supervisorAgent, type TriageDecision, type TriageStrategy } from "./SupervisorAgent";
export { GeneratorAgent, generatorAgent, type RegenerateParams } from "./GeneratorAgent";
