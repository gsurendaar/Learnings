import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

/**
 * POST /api/ft-runner/list-subfolders
 *
 * Lists immediate subdirectories of a folder in the repo.
 * Used by CreateFTPanel to show workflow subfolders.
 *
 * Accepts: { folder, repoPath? (optional - auto-detected if omitted), userId? }
 * Returns: { success, subfolders: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { folder, userId } = body;
    let { repoPath } = body;

    if (!folder) {
      return NextResponse.json(
        { success: false, error: "folder is required" },
        { status: 400 }
      );
    }

    // Auto-detect repo path: per-user first, then shared
    if (!repoPath) {
      const candidates = [
        // Per-user repo (highest priority)
        userId ? path.join(process.cwd(), "repos", userId, "sparkxnodeweb") : null,
        // Legacy shared repo
        path.join(process.cwd(), "repos", "sparkxnodeweb"),
      ].filter(Boolean) as string[];

      for (const c of candidates) {
        if (fs.existsSync(path.join(c, folder))) {
          repoPath = c;
          break;
        }
      }
    }

    if (!repoPath) {
      return NextResponse.json({ success: true, subfolders: [] });
    }

    const fullPath = path.resolve(repoPath, folder);

    // Path traversal protection
    if (!fullPath.startsWith(path.resolve(repoPath))) {
      return NextResponse.json(
        { success: false, error: "Invalid folder path" },
        { status: 403 }
      );
    }

    if (!fs.existsSync(fullPath)) {
      return NextResponse.json({ success: true, subfolders: [] });
    }

    // For cypress test folders, use git ls-tree to only list committed files
    let trackedFiles: Set<string> | null = null;
    if (folder.startsWith("cypress/")) {
      try {
        const gitOutput = execSync(`git ls-tree -r --name-only HEAD -- "${folder}"`, {
          cwd: repoPath,
          encoding: "utf-8",
          timeout: 5000,
        }).trim();
        trackedFiles = new Set(
          gitOutput ? gitOutput.split("\n").map((f) => path.basename(f)) : []
        );
      } catch { /* fall back to filesystem listing */ }
    }

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const subfolders = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
      .map((e) => e.name)
      .sort();

    const files = entries
      .filter((e) => {
        if (!e.isFile()) return false;
        if (!e.name.endsWith(".cy.ts") && !e.name.endsWith(".cy.js")) return false;
        if (trackedFiles) return trackedFiles.has(e.name);
        return true;
      })
      .map((e) => e.name)
      .sort();

    return NextResponse.json({ success: true, subfolders, files });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to list subfolders" },
      { status: 500 }
    );
  }
}
