import { NextRequest, NextResponse } from "next/server";
import { ensureUserRepo, getUserRepoPath } from "@/services/ftSetup";
import { getGitHubCredentials } from "@/config/env";
import { insertSession } from "@/lib/ftDatabase";

/**
 * POST /api/ft-runner/ensure-repo
 *
 * Ensures a per-user clone of the repo exists.
 * Called automatically on FT Runner page load.
 * If the repo exists, updates it (git fetch + reset). If not, clones it.
 *
 * Returns: { success, repoPath, cloned, status }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, owner, repo, branch, source } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: "userId is required" },
        { status: 400 }
      );
    }

    const callerSource: "FTRunner" | "FTBuilder" =
      source === "FTRunner" ? "FTRunner" : "FTBuilder";

    // FTRunner requires explicit owner, repo, and branch — no env fallbacks
    if (callerSource === "FTRunner" && (!owner || !repo || !branch)) {
      return NextResponse.json(
        { success: false, error: "FTRunner workspaces require owner, repo, and branch" },
        { status: 400 }
      );
    }

    const gh = getGitHubCredentials(body);

    if (!gh.isConfigured) {
      return NextResponse.json(
        { success: false, error: "GitHub token not configured. Set GITHUB_TOKEN or provide githubToken." },
        { status: 400 }
      );
    }

    // Log session
    try {
      const sessionId = `session-${userId}-${Date.now()}`;
      insertSession({
        session_id: sessionId,
        user_id: userId,
        user_name: body.userName || userId,
      });
    } catch { /* non-critical */ }

    const logs: string[] = [];

    const result = await ensureUserRepo({
      userId,
      githubToken: gh.token,
      owner: owner || gh.owner,
      repo: repo || gh.repo,
      branch: branch || gh.branch,
      source: callerSource,
      onProgress: (msg) => logs.push(msg),
    });

    return NextResponse.json({
      success: true,
      repoPath: result.repoPath,
      cloned: result.cloned,
      status: result.cloned ? "cloned" : "updated",
      warning: result.warning,
      logs,
    });
  } catch (error: any) {
    console.error("[ensure-repo] Error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to ensure repo" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/ft-runner/ensure-repo?userId=...&repo=...
 *
 * Quick check if the user's repo exists without cloning.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");
  const repo = searchParams.get("repo") || "sparkxnodeweb";
  const owner = searchParams.get("owner") || undefined;
  const branch = searchParams.get("branch") || undefined;
  const source = searchParams.get("source");
  const callerSource: "FTRunner" | "FTBuilder" =
    source === "FTRunner" ? "FTRunner" : "FTBuilder";

  if (!userId) {
    return NextResponse.json({ exists: false, error: "userId required" }, { status: 400 });
  }

  const repoPath = getUserRepoPath(userId, repo, { owner, branch, source: callerSource });
  return NextResponse.json({
    exists: !!repoPath,
    repoPath: repoPath || null,
  });
}
