/**
 * Base Agent class for FT automation agents.
 * All agents (Supervisor, Generator, Fixer) extend this.
 */

import { createLLMClient } from "../langgraph/llm";

export interface AgentConfig {
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel?: string;
}

export interface AgentContext {
  workDir: string;
  runId: string;
  emit: (event: { type: string; timestamp: number; [key: string]: any }) => void;
}

export interface AgentMemory {
  fixHistory: Array<{ attempt: number; error: string; fix: string }>;
  screenshotPaths: string[];
  existingFTs: Array<{ path: string; content: string; fileName: string }>;
}

export abstract class BaseAgent {
  readonly name: string;
  readonly role: string;
  readonly goal: string;
  protected llm: ReturnType<typeof createLLMClient> | null = null;

  constructor(name: string, role: string, goal: string) {
    this.name = name;
    this.role = role;
    this.goal = goal;
  }

  initialize(config: AgentConfig): void {
    this.llm = createLLMClient({
      llmApiKey: config.llmApiKey,
      llmBaseUrl: config.llmBaseUrl,
      llmModel: config.llmModel,
    });
  }

  get isInitialized(): boolean {
    return this.llm !== null;
  }

  protected log(ctx: AgentContext, message: string): void {
    const prefixedMsg = `[${this.name}] ${message}`;
    console.log(prefixedMsg);
    ctx.emit({ type: "log", timestamp: Date.now(), message: prefixedMsg });
  }

  protected async callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
    if (!this.llm) throw new Error(`${this.name} not initialized — call initialize() first`);
    const response = await this.llm.invoke([
      { content: systemPrompt, _getType: () => "system" },
      { content: userPrompt },
    ]);
    return response.content;
  }
}
