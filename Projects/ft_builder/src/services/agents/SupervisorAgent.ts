/**
 * Supervisor Agent
 *
 * Role: Orchestrates the fix loop. Triages failures, decides strategy per spec,
 *       delegates to Generator Agent for fixes, tracks fix history.
 *
 * Tools: triage (LLM call), readScreenshots, readFixHistory
 * Delegates to: GeneratorAgent
 */

import { BaseAgent, AgentContext, AgentMemory } from "./BaseAgent";
import { FT_TRIAGE_SYSTEM_PROMPT, buildTriageUserPrompt } from "../langgraph/prompts/ftTriage";

export type TriageStrategy = "regenerate" | "patch" | "skip";

export interface TriageDecision {
  specFile: string;
  strategy: TriageStrategy;
  reason: string;
}

export interface FailedSpec {
  specFile: string;
  error: string;
  previousAttempts: number;
}

export class SupervisorAgent extends BaseAgent {
  constructor() {
    super(
      "Supervisor",
      "FT Test Execution Supervisor",
      "Analyze test failures, triage each spec (regenerate/patch/skip), and delegate fixes to the Generator Agent. Track fix history to avoid repeating failed approaches."
    );
  }

  /**
   * Triage failed specs — decide fix strategy for each one.
   */
  async triage(
    ctx: AgentContext,
    failedSpecs: FailedSpec[],
    remainingAttempts: number
  ): Promise<Map<string, TriageDecision>> {
    const decisions = new Map<string, TriageDecision>();

    this.log(ctx, `Triaging ${failedSpecs.length} failing spec(s), ${remainingAttempts} attempt(s) remaining`);

    try {
      const prompt = buildTriageUserPrompt({ failedSpecs, remainingAttempts });
      const response = await this.callLLM(FT_TRIAGE_SYSTEM_PROMPT, prompt);

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        for (const d of parsed.decisions || []) {
          const decision: TriageDecision = {
            specFile: d.specFile,
            strategy: d.strategy || "regenerate",
            reason: d.reason || "No reason provided",
          };
          decisions.set(d.specFile, decision);
          this.log(ctx, `Triage: ${d.specFile.split("/").pop()} → ${decision.strategy} (${decision.reason})`);
        }
      }
    } catch (err) {
      this.log(ctx, `Triage failed, defaulting all to regenerate: ${err instanceof Error ? err.message : String(err)}`);
      for (const spec of failedSpecs) {
        decisions.set(spec.specFile, { specFile: spec.specFile, strategy: "regenerate", reason: "Triage failed" });
      }
    }

    return decisions;
  }

  /**
   * Analyze a failure — emit rich context for the UI.
   */
  emitAnalysis(
    ctx: AgentContext,
    specFile: string,
    error: string,
    strategy: TriageStrategy,
    memory: AgentMemory,
    sourcePath?: string,
    attempt: number = 1
  ): void {
    this.log(ctx, `── Iteration ${attempt} Analysis ──`);
    this.log(ctx, `Error: ${error.split("\n")[0]?.slice(0, 150) || "Unknown"}`);

    if (memory.fixHistory.length > 0) {
      this.log(ctx, `Previous ${memory.fixHistory.length} fix(es) didn't work — telling Generator to try different approach`);
    }

    this.log(ctx, `Strategy: ${strategy} | Existing FTs: ${memory.existingFTs.length} | Source: ${sourcePath || "not found"}`);

    if (memory.screenshotPaths.length > 0) {
      this.log(ctx, `Screenshots captured: ${memory.screenshotPaths.length} (for failure context)`);
    }
  }

  /**
   * Check if errors are transient (server/connection issues).
   */
  isTransientError(error: string): boolean {
    return /ESOCKETTIMEDOUT|ECONNREFUSED|ECONNRESET|ETIMEDOUT|cy\.visit\(\).*failed trying to load/i.test(error);
  }

  /**
   * Check if ALL errors are transient.
   */
  allErrorsTransient(errors: string[]): boolean {
    return errors.length > 0 && errors.every((e) => this.isTransientError(e));
  }
}

// Singleton instance
export const supervisorAgent = new SupervisorAgent();
