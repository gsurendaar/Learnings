import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import { killUserServers } from "@/services/ftSetup";

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

/** Find all git workspace roots (dirs containing .git) under a base dir */
function findWorkspaces(dir: string, depth = 0): string[] {
  if (depth > 5 || !fs.existsSync(dir)) return [];
  const workspaces: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (fs.existsSync(path.join(full, ".git"))) {
      workspaces.push(full);
    } else {
      workspaces.push(...findWorkspaces(full, depth + 1));
    }
  }
  return workspaces;
}

export async function POST(request: NextRequest) {
  const results: string[] = [];

  try {
    const body = await request.json().catch(() => ({}));
    const userId = body.userId as string | undefined;

    if (!userId) {
      return NextResponse.json(
        { success: false, message: "userId is required — cleanup is user-scoped" },
        { status: 400 }
      );
    }

    // 1. Kill only THIS user's pooled FT dev servers (safe for multi-user GCP)
    const killedServers = killUserServers(userId);
    if (killedServers > 0) results.push(`Killed ${killedServers} FT server(s) for user ${userId}`);

    // 2. Remove temp clone directories scoped to this user (ft-clones/{userId}/*)
    const userTmpDir = path.join(os.tmpdir(), "ft-clones", userId);
    if (fs.existsSync(userTmpDir)) {
      try {
        fs.rmSync(userTmpDir, { recursive: true, force: true });
        results.push(`Removed temp clone directory for ${userId}`);
      } catch { /* skip */ }
    }

    // 3. Remove THIS user's workspaces (repos/{userId}/*) idle >3 hours
    const userReposDir = path.join(process.cwd(), "repos", userId);
    if (fs.existsSync(userReposDir)) {
      const now = Date.now();
      const workspaces = findWorkspaces(userReposDir);
      let cleanedWorkspaces = 0;
      for (const ws of workspaces) {
        try {
          const gitIndex = path.join(ws, ".git", "index");
          const stat = fs.existsSync(gitIndex) ? fs.statSync(gitIndex) : fs.statSync(ws);
          if (now - stat.mtimeMs > THREE_HOURS_MS) {
            fs.rmSync(ws, { recursive: true, force: true });
            cleanedWorkspaces++;
          }
        } catch { /* skip */ }
      }
      if (cleanedWorkspaces > 0) results.push(`Removed ${cleanedWorkspaces} stale workspace${cleanedWorkspaces > 1 ? "s" : ""} idle >3h`);
    }

    // 4. Keep only the last 1 artifact set for THIS user
    const userArtifactsDir = path.join(process.cwd(), "data", "artifacts", userId);
    if (fs.existsSync(userArtifactsDir)) {
      const runs = fs.readdirSync(userArtifactsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name.startsWith("ft-"))
        .map((e) => e.name)
        .sort((a, b) => {
          const tsA = parseInt(a.split("-")[1] || "0");
          const tsB = parseInt(b.split("-")[1] || "0");
          return tsB - tsA; // newest first
        });
      let deletedArtifacts = 0;
      for (const old of runs.slice(1)) {
        try { fs.rmSync(path.join(userArtifactsDir, old), { recursive: true, force: true }); deletedArtifacts++; } catch { /* skip */ }
      }
      if (deletedArtifacts > 0) results.push(`Removed ${deletedArtifacts} old artifact set${deletedArtifacts > 1 ? "s" : ""} (kept last 1)`);
    }

    // 5. Clear screenshots from THIS user's remaining active workspaces
    if (fs.existsSync(userReposDir)) {
      const workspaces = findWorkspaces(userReposDir);
      let clearedScreenshots = 0;
      for (const ws of workspaces) {
        for (const ssDir of ["cypress/screenshots", "cypress/reports/screenshots", "cypress/reports/videos", "cypress/videos"]) {
          const full = path.join(ws, ssDir);
          if (fs.existsSync(full)) {
            try { fs.rmSync(full, { recursive: true, force: true }); clearedScreenshots++; } catch { /* skip */ }
          }
        }
      }
      if (clearedScreenshots > 0) results.push(`Cleared screenshot/video dirs from ${clearedScreenshots} workspace location(s)`);
    }

    if (results.length === 0) results.push("Nothing to clean up — all clear");

    return NextResponse.json({ success: true, message: results.join(". "), details: results });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error?.message || "Cleanup failed" }, { status: 500 });
  }
}
