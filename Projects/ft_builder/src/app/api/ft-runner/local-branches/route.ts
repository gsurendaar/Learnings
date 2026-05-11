import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import fs from "fs";

function runGit(args: string, cwd: string): string {
  return execSync(`git -C "${cwd}" ${args}`, { encoding: "utf-8", stdio: "pipe" }).trim();
}

/** GET ?path=... — list branches and return the current one */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const localPath = searchParams.get("path");

  if (!localPath) {
    return NextResponse.json({ success: false, message: "path is required" }, { status: 400 });
  }

  if (!fs.existsSync(localPath)) {
    return NextResponse.json({ success: false, message: "Path not found" }, { status: 400 });
  }

  try {
    const currentBranch = runGit("rev-parse --abbrev-ref HEAD", localPath);

    // `git branch` prefixes current branch with "* " — strip it
    const branchOutput = runGit("branch", localPath);
    const branches = branchOutput
      .split("\n")
      .map((b) => b.replace(/^\*?\s+/, "").trim())
      .filter(Boolean);

    return NextResponse.json({ success: true, currentBranch, branches });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, message: `Not a git repository or git error: ${err.message}` },
      { status: 400 }
    );
  }
}

/** POST { path, branch } — checkout a branch */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { path: localPath, branch } = body;

  if (!localPath || !branch) {
    return NextResponse.json({ success: false, message: "path and branch are required" }, { status: 400 });
  }

  try {
    // Check for uncommitted changes first
    const status = runGit("status --porcelain", localPath);
    const hasChanges = status.length > 0;

    runGit(`checkout "${branch}"`, localPath);

    return NextResponse.json({
      success: true,
      branch,
      warning: hasChanges
        ? "You had uncommitted changes — they are preserved on the new branch."
        : undefined,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, message: `Checkout failed: ${err.message}` },
      { status: 500 }
    );
  }
}
