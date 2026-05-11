import * as https from "https";
import * as http from "http";
import { env } from "@/config/env";

export interface LLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface LLMResponse {
  content: string;
  usage?: LLMUsage;
  latencyMs: number;
  model: string;
  promptPreview: string;
}

/**
 * Creates an LLM client for the PayPal OpenAI-compatible proxy.
 * Uses the same request pattern as sparkxReview.ts (chat/completions).
 *
 * Credential resolution:
 *   1. Explicit params passed to this function
 *   2. .env.local via centralized env config
 */
export function createLLMClient(credentials?: {
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmModel?: string;
}) {
  const apiKey = credentials?.llmApiKey || env.anthropic.apiKey;
  const baseUrl = credentials?.llmBaseUrl || env.anthropic.baseUrl;
  const model = credentials?.llmModel || env.anthropic.model;

  if (!apiKey) {
    throw new Error(
      "LLM API key not configured. Set ANTHROPIC_API_KEY in .env.local or pass llmApiKey."
    );
  }

  return {
    async invoke(
      messages: Array<{ content: string; _getType?: () => string }>
    ): Promise<LLMResponse> {
      const systemMsg = messages.find((m) => m._getType?.() === "system");
      const userMsgs = messages.filter((m) => m !== systemMsg);

      const chatMessages: Array<{ role: string; content: string }> = [];
      if (systemMsg) {
        chatMessages.push({ role: "system", content: systemMsg.content });
      }
      for (const msg of userMsgs) {
        chatMessages.push({ role: "user", content: msg.content });
      }

      const startTime = Date.now();
      console.log(`[LLM Client] Calling ${model} at ${baseUrl}`);

      const MAX_RETRIES = 2;
      let lastError: Error | null = null;
      let result: ChatCompletionResult | null = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          result = await callChatCompletions({
            baseUrl,
            apiKey,
            model,
            messages: chatMessages,
            temperature: 0.1,
            maxTokens: 16000,
          });
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          const isRetryable = /ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up/i.test(lastError.message);
          if (!isRetryable || attempt === MAX_RETRIES) throw lastError;
          const delay = (attempt + 1) * 3000;
          console.warn(`[LLM Client] Retry ${attempt + 1}/${MAX_RETRIES} after ${delay}ms — ${lastError.message}`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      if (!result) throw lastError || new Error("LLM call failed");

      const latencyMs = Date.now() - startTime;
      const tokensLog = result.usage
        ? ` | ${result.usage.prompt_tokens} in / ${result.usage.completion_tokens} out (${result.usage.total_tokens} total)`
        : "";
      console.log(`[LLM Client] Response: ${result.content.length} chars | ${latencyMs}ms${tokensLog}`);

      // Store a preview of the prompt (last user message, truncated) for conversation replay
      const lastUserMsg = chatMessages.filter((m) => m.role === "user").pop();
      const promptPreview = lastUserMsg?.content.slice(0, 2000) || "";

      return {
        content: result.content,
        usage: result.usage,
        latencyMs,
        model,
        promptPreview,
      };
    },
  };
}

interface ChatCompletionResult {
  content: string;
  usage?: LLMUsage;
}

function callChatCompletions(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  maxTokens: number;
}): Promise<ChatCompletionResult> {
  return new Promise((resolve, reject) => {
    let fullUrl = params.baseUrl;
    if (!fullUrl.endsWith("/chat/completions")) {
      fullUrl = fullUrl.replace(/\/+$/, "") + "/chat/completions";
    }

    const url = new URL(fullUrl);

    const requestBody = JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
    });

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Length": Buffer.byteLength(requestBody),
      },
      rejectUnauthorized: url.hostname.includes("paypal") ? false : true,
    };

    const protocol = url.protocol === "https:" ? https : http;

    const req = protocol.request(options, (res) => {
      let data = "";

      res.on("data", (chunk: string) => {
        data += chunk;
      });

      res.on("end", () => {
        const statusCode = res.statusCode || 0;
        if (statusCode >= 200 && statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.message?.content || "";
            if (!content) {
              reject(new Error("LLM returned empty content"));
            } else {
              resolve({
                content,
                usage: parsed.usage ? {
                  prompt_tokens: parsed.usage.prompt_tokens || 0,
                  completion_tokens: parsed.usage.completion_tokens || 0,
                  total_tokens: parsed.usage.total_tokens || 0,
                } : undefined,
              });
            }
          } catch {
            reject(new Error(`Failed to parse LLM response: ${data.slice(0, 200)}`));
          }
        } else {
          reject(new Error(`LLM API failed (status ${statusCode}): ${data.slice(0, 500)}`));
        }
      });
    });

    req.on("error", (error: Error) => {
      reject(new Error(`LLM API connection error: ${error.message}`));
    });

    req.write(requestBody);
    req.end();
  });
}
