import { NextResponse } from "next/server";
import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";

export async function POST() {
  try {
    const repoPath = path.join(process.cwd(), "repos", "sparkxnodeweb");

    if (!fs.existsSync(repoPath)) {
      return NextResponse.json(
        { success: false, message: "Local repository not found. Please clone the repo first." },
        { status: 404 }
      );
    }

    const githubToken = process.env.GIT_TOKEN;
    if (!githubToken) {
      return NextResponse.json(
        { success: false, message: "GIT_TOKEN environment variable is not set." },
        { status: 500 }
      );
    }

    // Ensure remote points to the correct repository
    const newOrigin = `https://x-access-token:${githubToken}@github.com/OnePayPal/sparkxnodeweb.git`;
    
    execSync(`git remote set-url origin ${newOrigin}`, {
      cwd: repoPath,
      encoding: "utf-8",
    });

    const output = execSync("git pull", {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 30000,
    });

    return NextResponse.json({
      success: true,
      message: output.trim() || "Repository updated successfully",
    });
  } catch (error) {
    console.error("Error pulling repo:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to pull from upstream";
    return NextResponse.json(
      { success: false, message: errorMessage },
      { status: 500 }
    );
  }
}
