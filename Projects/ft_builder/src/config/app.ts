/**
 * App-level configuration defaults.
 * Values here can be overridden by environment variables where noted.
 */
export const APP_CONFIG = {
  llm: {
    baseUrl:
      process.env.LLM_BASE_URL ||
      process.env.baseUrl ||
      "https://aiplatform.dev51.cbf.dev.paypalinc.com/cosmosai/llm/v1",
    defaultModel:
      process.env.LLM_MODEL ||
      process.env.model ||
      "claude-opus-4-6",
  },
  github: {
    baseUrl: process.env.GITHUB_BASE_URL || "https://github.com",
  },
};
