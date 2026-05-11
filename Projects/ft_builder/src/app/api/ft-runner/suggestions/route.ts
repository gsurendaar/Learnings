import { NextRequest, NextResponse } from "next/server";
import * as path from "path";
import * as fs from "fs";
import { getLLMCredentials, getGitHubCredentials } from "@/config/env";
import { generateSuggestions } from "@/services/ftSuggestions";
import { getUserRepoPath } from "@/services/ftSetup";

// Increase timeout for this route — LLM calls can take 2-3 minutes across multiple batches
export const maxDuration = 300; // 5 minutes

/**
 * POST /api/ft-runner/suggestions
 *
 * Analyzes source code and returns suggested FT test cases.
 * This is a synchronous call — waits for LLM response and returns suggestions inline.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const selectedFolders: string[] = body.selectedFolders || [];
    const manualPaths: string[] = body.manualPaths || [];

    if (selectedFolders.length === 0 && manualPaths.length === 0) {
      return NextResponse.json(
        { error: "At least one folder or manual path is required" },
        { status: 400 }
      );
    }

    const llm = getLLMCredentials(body);
    const gh = getGitHubCredentials(body);

    if (!llm.isConfigured) {
      return NextResponse.json(
        { error: "LLM API key not configured. Set ANTHROPIC_API_KEY or provide llmApiKey." },
        { status: 400 }
      );
    }

    console.log("\n╔══════════════════════════════════════════╗");
    console.log("║  /api/ft-runner/suggestions              ║");
    console.log("╚══════════════════════════════════════════╝");
    console.log(`  Folders:      ${selectedFolders.join(", ") || "(none)"}`);
    console.log(`  Manual paths: ${manualPaths.length > 0 ? manualPaths.join(", ") : "(none)"}`);
    console.log(`  LLM Model:   ${llm.model}`);
    console.log(`  LLM BaseURL: ${llm.baseUrl}`);
    console.log(`  LLM Key:     ${llm.apiKey ? llm.apiKey.slice(0, 8) + "..." : "(none)"}`);

    // Resolve repo path — prefer per-user clone, fall back to shared
    const userId = (body.userId || body.triggeredBy) as string | undefined;
    const repoName = gh.repo || "sparkxnodeweb";
    const callerSource: "FTRunner" | "FTBuilder" =
      body.source === "FTRunner" ? "FTRunner" : "FTBuilder";
    let repoPath: string | null = null;

    console.log(`  userId:     ${userId || "(none)"}`);
    console.log(`  repoName:   ${repoName}`);

    // 1. Try per-user repo
    if (userId) {
      repoPath = getUserRepoPath(userId, repoName, {
        owner: gh.owner,
        branch: gh.branch,
        source: callerSource,
      });
      console.log(`  user repo:  ${repoPath || "not found"}`);
    }
    // 2. Fall back to legacy shared location
    if (!repoPath) {
      const legacyRepo = path.join(process.cwd(), "repos", repoName);
      if (fs.existsSync(legacyRepo)) {
        repoPath = legacyRepo;
        console.log(`  legacy repo: ${repoPath}`);
      }
    }
    // 3. Try repos/sparkxnodeweb if repoName differs
    if (!repoPath && repoName !== "sparkxnodeweb") {
      const fallback = path.join(process.cwd(), "repos", "sparkxnodeweb");
      if (fs.existsSync(fallback)) {
        repoPath = fallback;
        console.log(`  fallback repo: ${repoPath}`);
      }
    }
    // 3. No repo found
    if (!repoPath) {
      return NextResponse.json(
        { error: "Repository not set up yet. Please wait for workspace setup to complete, then try again." },
        { status: 400 }
      );
    }

    const result = await generateSuggestions({
      selectedFolders,
      manualPaths,
      repoPath,
      llmApiKey: llm.apiKey,
      llmBaseUrl: llm.baseUrl,
      llmModel: llm.model,
      customPrompt: (body.customPrompt as string) || undefined,
      runId: (body.runId as string) || undefined,
      triggeredBy: (body.triggeredBy as string) || userId || undefined,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[Suggestions API] Error:", errorMsg);
    return NextResponse.json(
      { error: `Failed to generate suggestions: ${errorMsg}` },
      { status: 500 }
    );
  }
}
