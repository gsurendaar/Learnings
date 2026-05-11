import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { execCommand, buildCleanEnv, getUserRepoPath } from "@/services/ftSetup";
import { insertUserAction } from "@/lib/ftDatabase";

/**
 * POST /api/ft-runner/create-pr
 *
 * Commits approved generated FTs to a new branch and creates a PR in sparkxnodeweb.
 *
 * Flow:
 * 1. Create a new branch from the current branch in the user's clone
 * 2. Stage and commit the generated test files
 * 3. Push the branch to remote using the user's PAT token
 * 4. Create a PR via GitHub Enterprise API
 *
 * Accepts:
 *   userId, githubToken, owner, repo, branch (base branch),
 *   files: Array<{ path: string; content: string }> — the test files to commit
 *   prTitle, prDescription
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      userId,
      githubToken,
      owner = "OnePayPal",
      repo = "sparkxnodeweb",
      branch = "main",
      files,
      prTitle,
      prDescription,
      source,
    } = body;

    const callerSource: "FTRunner" | "FTBuilder" =
      source === "FTRunner" ? "FTRunner" : "FTBuilder";

    if (!userId || !githubToken) {
      return NextResponse.json(
        { success: false, error: "userId and githubToken are required" },
        { status: 400 }
      );
    }

    if (!files || !Array.isArray(files) || files.length === 0) {
      return NextResponse.json(
        { success: false, error: "files array is required and must not be empty" },
        { status: 400 }
      );
    }

    // Find the user's repo clone
    const repoPath = getUserRepoPath(userId, repo, { owner, branch, source: callerSource });
    if (!repoPath) {
      return NextResponse.json(
        { success: false, error: "User repo not found. Please ensure workspace is set up first." },
        { status: 400 }
      );
    }

    const logs: string[] = [];
    const log = (msg: string) => {
      console.log(`[create-pr] ${msg}`);
      logs.push(msg);
    };

    // Build env with the user's PAT token for push auth
    const githubBaseUrl = process.env.GITHUB_BASE_URL || "https://github.com";
    const env = buildCleanEnv();

    // 1. Read generated file content from disk BEFORE git reset wipes them
    const fileContents: Record<string, string> = {};
    for (const file of files) {
      const filePath = path.join(repoPath, file.path);
      if (file.content && file.content.trim().length > 0) {
        fileContents[file.path] = file.content;
        log(`Content from request: ${file.path} (${file.content.length} chars)`);
      } else if (fs.existsSync(filePath)) {
        fileContents[file.path] = fs.readFileSync(filePath, "utf-8");
        log(`Content from disk: ${file.path} (${fileContents[file.path].length} chars)`);
      } else {
        log(`WARNING: No content and file does not exist: ${file.path}`);
      }
    }

    // 2. Make sure we're on the base branch and up to date
    log(`Checking out base branch: ${branch}`);
    try {
      const { execSync } = require("child_process");
      execSync(`git checkout ${branch}`, { cwd: repoPath, stdio: "pipe", env });
      execSync(`git fetch origin`, { cwd: repoPath, stdio: "pipe", timeout: 30000, env });
      execSync(`git reset --hard origin/${branch}`, { cwd: repoPath, stdio: "pipe", env });
    } catch (e: any) {
      log(`Warning: could not update base branch: ${e.message}`);
    }

    // 3. Create a new branch
    const timestamp = Date.now();
    const branchName = `ft/auto-generated-${userId}-${timestamp}`;
    log(`Creating branch: ${branchName}`);
    const { execSync } = require("child_process");
    execSync(`git checkout -b ${branchName}`, { cwd: repoPath, stdio: "pipe", env });

    // 4. Write the test files with preserved content
    for (const file of files) {
      const content = fileContents[file.path];
      if (!content) {
        log(`SKIP: ${file.path} — no content available`);
        continue;
      }
      const filePath = path.join(repoPath, file.path);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, "utf-8");
      log(`Wrote: ${file.path} (${content.length} chars)`);
    }

    // 4. Stage and commit
    const filePaths = files.map((f: { path: string }) => f.path);
    execSync(`git add ${filePaths.map((f: string) => `"${f}"`).join(" ")}`, {
      cwd: repoPath,
      stdio: "pipe",
      env,
    });

    const commitMsg = prTitle || `feat(ft): add ${files.length} auto-generated Cypress test(s)`;
    execSync(`git commit --no-verify -m "${commitMsg}"`, { cwd: repoPath, stdio: "pipe", env });
    log(`Committed ${files.length} file(s)`);

    // 5. Push the branch (set remote URL with token for auth)
    const remoteUrl = `${githubBaseUrl}/${owner}/${repo}.git`.replace(
      "https://",
      `https://${githubToken}@`
    );
    execSync(`git remote set-url origin "${remoteUrl}"`, { cwd: repoPath, stdio: "pipe", env });
    execSync(`git push -u origin ${branchName}`, { cwd: repoPath, stdio: "pipe", timeout: 60000, env });
    log(`Pushed branch: ${branchName}`);

    // Reset remote URL (remove token)
    const cleanUrl = `${githubBaseUrl}/${owner}/${repo}.git`;
    execSync(`git remote set-url origin "${cleanUrl}"`, { cwd: repoPath, stdio: "pipe", env });

    // 6. Create PR via GitHub API
    log(`Creating PR: ${branchName} -> ${branch}`);
    const prBody = prDescription ||
      `## Auto-Generated Functional Tests\n\n` +
      `Generated by FT Builder for user \`${userId}\`.\n\n` +
      `### Files\n${filePaths.map((f: string) => `- \`${f}\``).join("\n")}\n\n` +
      `### Test Count\n${files.length} test file(s)\n`;

    const prResult = await createGitHubPR({
      githubBaseUrl,
      githubToken,
      owner,
      repo,
      head: branchName,
      base: branch,
      title: commitMsg,
      body: prBody,
    });

    log(`PR created: ${prResult.html_url}`);
    try { insertUserAction({ user_id: userId, action: "create_pr", details: JSON.stringify({ branch: branchName, prUrl: prResult.html_url, prNumber: prResult.number, filesCommitted: files.length }) }); } catch { /* non-blocking */ }

    // Switch back to base branch
    try {
      execSync(`git checkout ${branch}`, { cwd: repoPath, stdio: "pipe", env });
    } catch { /* non-critical */ }

    return NextResponse.json({
      success: true,
      branch: branchName,
      prUrl: prResult.html_url,
      prNumber: prResult.number,
      filesCommitted: files.length,
      logs,
    });
  } catch (error: any) {
    console.error("[create-pr] Error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to create PR" },
      { status: 500 }
    );
  }
}

// Helper to create a PR via GitHub Enterprise API
async function createGitHubPR(params: {
  githubBaseUrl: string;
  githubToken: string;
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
}): Promise<{ html_url: string; number: number }> {
  const https = require("https");
  const http = require("http");
  // Public GitHub uses api.github.com, Enterprise uses {base}/api/v3
  const apiBase = params.githubBaseUrl.includes("github.com") && !params.githubBaseUrl.includes("api.")
    ? `https://api.github.com`
    : `${params.githubBaseUrl}/api/v3`;
  const url = new URL(`${apiBase}/repos/${params.owner}/${params.repo}/pulls`);

  const requestBody = JSON.stringify({
    title: params.title,
    head: params.head,
    base: params.base,
    body: params.body,
  });

  return new Promise((resolve, reject) => {
    const protocol = url.protocol === "https:" ? https : http;
    const req = protocol.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `token ${params.githubToken}`,
          "Content-Length": Buffer.byteLength(requestBody),
          "User-Agent": "gitlog-ft-builder",
        },
        rejectUnauthorized: false,
      },
      (res: any) => {
        let data = "";
        res.on("data", (chunk: string) => { data += chunk; });
        res.on("end", () => {
          const statusCode = res.statusCode || 0;
          if (statusCode >= 200 && statusCode < 300) {
            try {
              const parsed = JSON.parse(data);
              resolve({ html_url: parsed.html_url, number: parsed.number });
            } catch {
              reject(new Error(`Failed to parse PR response: ${data.slice(0, 200)}`));
            }
          } else {
            reject(new Error(`GitHub API error (${statusCode}): ${data.slice(0, 500)}`));
          }
        });
      }
    );
    req.on("error", (err: Error) => reject(err));
    req.write(requestBody);
    req.end();
  });
}
