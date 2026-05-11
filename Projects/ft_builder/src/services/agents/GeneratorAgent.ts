/**
 * Generator Agent
 *
 * Role: Generates and regenerates Cypress E2E tests.
 *       Uses full context: source code, knowledge base, existing tests, fix history.
 *
 * Tools: readSourceCode, readExistingTests, writeTestFile, readKnowledgeBase
 * Called by: SupervisorAgent (during fix loop), CreateFTPanel (during generation)
 */

import fs from "fs";
import path from "path";
import { BaseAgent, AgentContext, AgentMemory } from "./BaseAgent";
import { FT_GENERATION_SYSTEM_PROMPT, buildRegenerationUserPrompt } from "../langgraph/prompts/ftGeneration";

export interface RegenerateParams {
  specPath: string;
  failingTestContent: string;
  errorOutput: string;
  sourceContent?: string;
  sourcePath?: string;
  templateType: "basic" | "comprehensive";
  attemptNumber: number;
  memory: AgentMemory;
}

export class GeneratorAgent extends BaseAgent {
  constructor() {
    super(
      "Generator",
      "FT Test Generator Agent",
      "Generate high-quality Cypress E2E tests from source code analysis. When fixing, use error output + existing passing tests as reference to produce tests that follow proven patterns."
    );
  }

  /**
   * Regenerate a failing test with full context.
   */
  async regenerate(ctx: AgentContext, params: RegenerateParams): Promise<string | null> {
    const { specPath, failingTestContent, errorOutput, sourceContent, sourcePath, templateType, attemptNumber, memory } = params;

    this.log(ctx, `Regenerating ${path.basename(specPath)} with ${errorOutput.length} chars of error context...`);

    if (!sourceContent && !sourcePath) {
      this.log(ctx, `No source component found — regenerating from test content + error only`);
    }

    const userPrompt = buildRegenerationUserPrompt({
      sourcePath: sourcePath || specPath,
      sourceContent: sourceContent || "// Source component not found",
      templateType,
      previousTestContent: failingTestContent,
      cypressErrors: errorOutput,
      attemptNumber,
      existingWorkflowFTs: memory.existingFTs,
      fixHistory: memory.fixHistory,
    });

    try {
      const response = await this.callLLM(FT_GENERATION_SYSTEM_PROMPT, userPrompt);

      // Extract code from response
      const codeMatch = response.match(/```(?:typescript|ts|javascript|js)?\s*\n([\s\S]*?)\n\s*```/);
      const code = codeMatch ? codeMatch[1].trim() : response.trim();

      if (code.length < 50) {
        this.log(ctx, `Regeneration returned insufficient code (${code.length} chars)`);
        return null;
      }

      // Report what changed
      const oldLines = failingTestContent.split("\n").length;
      const newLines = code.split("\n").length;
      this.log(ctx, `Fix applied: ${oldLines}→${newLines} lines, ${code.length} chars`);

      // Report key changes
      if (code.includes("navigateToWorkflow") && !failingTestContent.includes("navigateToWorkflow")) {
        this.log(ctx, `Added: cy.navigateToWorkflow()`);
      }
      if (code.includes("TIMEOUTS.MAX") && !failingTestContent.includes("TIMEOUTS.MAX")) {
        this.log(ctx, `Added: TIMEOUTS.MAX for waits`);
      }
      if (code.includes("closeWorkflowAndProvideFeedback") && !failingTestContent.includes("closeWorkflowAndProvideFeedback")) {
        this.log(ctx, `Added: closeWorkflowAndProvideFeedback()`);
      }

      return code;
    } catch (err) {
      this.log(ctx, `Regeneration failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Review a generated test for pattern compliance (pre-run check).
   */
  reviewTest(testContent: string): string[] {
    const issues: string[] = [];

    if (!testContent.includes("navigateToWorkflow")) {
      issues.push("Missing cy.navigateToWorkflow() — uses manual navigation");
    }
    if (!testContent.includes("TIMEOUTS")) {
      issues.push("Not using TIMEOUTS constants — hardcoded or missing timeouts");
    }
    if (!testContent.includes("closeWorkflowAndProvideFeedback")) {
      issues.push("Missing closeWorkflowAndProvideFeedback() at test end");
    }
    if (testContent.includes("cy.visit(")) {
      issues.push("Uses cy.visit() instead of navigateToWorkflow — SSO will block it");
    }
    if (/timeout:\s*\d{4}\b/.test(testContent) && !testContent.includes("TIMEOUTS")) {
      issues.push("Hardcoded timeout values — should use TIMEOUTS constants");
    }
    if (!testContent.includes("addTestContext")) {
      issues.push("Missing cy.addTestContext() — no step documentation");
    }

    return issues;
  }
}

// Singleton instance
export const generatorAgent = new GeneratorAgent();
