/**
 * Centralized environment configuration with graceful fallbacks.
 *
 * Reads from:
 *   1. process.env (populated by Next.js from .env.local)
 *   2. Hardcoded defaults (for non-sensitive values)
 *
 * Usage:
 *   import { env } from "@/config/env";
 *   const key = env.anthropic.apiKey; // string (may be empty)
 *   if (env.anthropic.isConfigured) { ... }
 */

function get(key: string, fallback = ""): string {
  // process.env is always available in Next.js (server & client for NEXT_PUBLIC_ vars)
  // For server-only vars, this only works in API routes and server components
  try {
    return process.env[key] || fallback;
  } catch {
    // Gracefully handle cases where process.env is unavailable
    return fallback;
  }
}

export const env = {
  /** Anthropic Claude LLM configuration */
  anthropic: {
    get apiKey() { return get("ANTHROPIC_API_KEY"); },
    get baseUrl() { return get("ANTHROPIC_BASE_URL", "https://api.anthropic.com"); },
    get model() { return get("ANTHROPIC_MODEL", "claude-sonnet-4.5"); },
    /** True if API key is set (non-empty) */
    get isConfigured() { return !!get("ANTHROPIC_API_KEY"); },
  },

  /** GitHub Enterprise configuration */
  github: {
    get token() { return get("GITHUB_TOKEN"); },
    get baseUrl() { return get("GITHUB_BASE_URL", "https://github.com"); },
    get owner() { return get("GITHUB_OWNER", "OnePayPal"); },
    get repo() { return get("GITHUB_REPO", "sparkxnodeweb"); },
    get branch() { return get("GITHUB_BRANCH", "develop"); },
    /** True if PAT token is set */
    get isConfigured() { return !!get("GITHUB_TOKEN"); },
  },

  /** MySQL database configuration */
  database: {
    get host() { return get("DB_HOST", "localhost"); },
    get user() { return get("DB_USER", "root"); },
    get password() { return get("DB_PASSWORD"); },
    get name() { return get("DB_NAME", "qualitydashboard"); },
    get port() { return parseInt(get("DB_PORT", "3306"), 10); },
  },

  /** Application settings */
  app: {
    get port() { return parseInt(get("PORT", "3210"), 10); },
    get isDev() { return get("NODE_ENV", "development") === "development"; },
  },
};

/**
 * Build LLM credentials object from env + optional request overrides.
 * Request body values take priority over env vars.
 *
 * Usage in API routes:
 *   const creds = getLLMCredentials(body);
 *   if (!creds.apiKey) return error("API key required");
 */
export function getLLMCredentials(requestBody?: Record<string, unknown>) {
  return {
    apiKey:   (requestBody?.llmApiKey as string)   || env.anthropic.apiKey,
    baseUrl:  (requestBody?.llmBaseUrl as string)  || env.anthropic.baseUrl,
    model:    (requestBody?.llmModel as string)    || env.anthropic.model,
    get isConfigured() { return !!this.apiKey; },
  };
}

/**
 * Build GitHub credentials object from env + optional request overrides.
 */
export function getGitHubCredentials(requestBody?: Record<string, unknown>) {
  return {
    token:  (requestBody?.githubToken as string) || env.github.token,
    owner:  (requestBody?.owner as string)       || env.github.owner,
    repo:   (requestBody?.repo as string)        || env.github.repo,
    branch: (requestBody?.branch as string)      || env.github.branch,
    get isConfigured() { return !!this.token; },
  };
}
