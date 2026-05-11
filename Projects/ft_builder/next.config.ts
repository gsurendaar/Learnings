import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  serverExternalPackages: [
    "better-sqlite3",
    "mysql2",
    "@anthropic-ai/sdk",
    "@langchain/langgraph",
    "@langchain/core",
    "@langchain/openai",
  ],
};

export default nextConfig;
