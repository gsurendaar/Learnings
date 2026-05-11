import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";

interface PRData {
  number: number;
  title: string;
  author: string;
  body: string;
  state: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  files: PRFile[];
  diff: string;
}

interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

interface CommitData {
  sha: string;
  message: string;
  author: string;
  date: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  files: PRFile[];
  diff: string;
}

interface ReviewResult {
  success: boolean;
  prNumber?: string;
  commitId?: string;
  title?: string;
  author?: string;
  filesChanged?: number;
  additions?: number;
  deletions?: number;
  review?: {
    summary: string;
    codeQuality: {
      score: number;
      findings: string[];
    };
    bestPractices: {
      score: number;
      findings: string[];
    };
    maintainability: {
      score: number;
      findings: string[];
    };
    impactAnalysis: {
      score: number;
      findings: string[];
    };
    suggestions: string[];
    detailedAnalysis: string;
  };
  error?: string;
}

export class SparkxReviewService {
  private readonly githubBaseUrl = "api.github.com";
  private readonly repoOwner = "OnePayPal";
  private readonly repoName = "sparkxnodeweb";
  private readonly localRepoPath: string;
  private readonly githubToken: string;
  private readonly llmApiUrl: string;
  private readonly llmApiKey: string;
  private readonly llmModel: string;

  constructor(
    githubToken: string,
    llmApiUrl: string,
    llmApiKey: string,
    llmModel?: string,
  ) {
    this.githubToken = githubToken;
    this.llmApiUrl = llmApiUrl;
    this.llmApiKey = llmApiKey;
    this.llmModel = llmModel || "claude-sonnet-4.5";
    this.localRepoPath = path.join(process.cwd(), "repos", "sparkxnodeweb");
  }

  private makeGitHubRequest(
    endpoint: string,
    perPage: number = 100,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      // Add pagination parameters if not already present
      const separator = endpoint.includes("?") ? "&" : "?";
      const paginatedEndpoint = endpoint.includes("per_page")
        ? endpoint
        : `${endpoint}${separator}per_page=${perPage}`;

      const options = {
        hostname: this.githubBaseUrl,
        port: 443,
        path: `${paginatedEndpoint}`,
        method: "GET",
        headers: {
          Authorization: `token ${this.githubToken}`,
          "User-Agent": "GitLogs-SparkxReview/1.0",
          Accept: "application/vnd.github.v3+json",
        },
      };

      console.log(`Making GitHub request to: ${options.path}`);

      const req = https.request(options, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          const statusCode = res.statusCode || 0;
          if (statusCode >= 200 && statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (error) {
              reject(new Error(`Failed to parse JSON response`));
            }
          } else {
            reject(
              new Error(
                `GitHub API request failed with status ${statusCode}: ${data}`,
              ),
            );
          }
        });
      });

      req.on("error", (error) => {
        reject(error);
      });

      req.end();
    });
  }

  private async fetchAllPRFiles(prNumber: number): Promise<any[]> {
    const allFiles: any[] = [];
    let page = 1;
    const perPage = 100; // Maximum allowed by GitHub API
    let hasMore = true;

    console.log(`Fetching all files for PR #${prNumber} with pagination...`);

    while (hasMore) {
      const filesEndpoint = `/repos/${this.repoOwner}/${this.repoName}/pulls/${prNumber}/files?per_page=${perPage}&page=${page}`;
      try {
        const filesData = await this.makeGitHubRequest(filesEndpoint);

        if (Array.isArray(filesData) && filesData.length > 0) {
          allFiles.push(...filesData);
          console.log(
            `Fetched page ${page}: ${filesData.length} files (total: ${allFiles.length})`,
          );

          // If we got fewer files than perPage, we've reached the last page
          if (filesData.length < perPage) {
            hasMore = false;
          } else {
            page++;
          }
        } else {
          hasMore = false;
        }
      } catch (error) {
        console.error(`Error fetching page ${page} of files:`, error);
        // If we already have some files, continue with what we have
        if (allFiles.length > 0) {
          console.log(
            `Continuing with ${allFiles.length} files fetched before error`,
          );
          hasMore = false;
        } else {
          throw error;
        }
      }

      // Safety limit to prevent infinite loops
      if (page > 20) {
        console.log("Reached maximum page limit (20), stopping pagination");
        hasMore = false;
      }
    }

    console.log(`Total files fetched for PR #${prNumber}: ${allFiles.length}`);
    return allFiles;
  }

  private makeGitHubPostRequest(endpoint: string, body: object): Promise<any> {
    return new Promise((resolve, reject) => {
      const bodyStr = JSON.stringify(body);

      const options = {
        hostname: this.githubBaseUrl,
        port: 443,
        path: `${endpoint}`,
        method: "POST",
        headers: {
          Authorization: `token ${this.githubToken}`,
          "User-Agent": "GitLogs-SparkxReview/1.0",
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(bodyStr),
        },
      };

      console.log(`Making GitHub POST request to: ${options.path}`);

      const req = https.request(options, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          const statusCode = res.statusCode || 0;
          if (statusCode >= 200 && statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (error) {
              resolve({ success: true }); // Some endpoints return empty response
            }
          } else {
            reject(
              new Error(
                `GitHub API POST request failed with status ${statusCode}: ${data}`,
              ),
            );
          }
        });
      });

      req.on("error", (error) => {
        reject(error);
      });

      req.write(bodyStr);
      req.end();
    });
  }

  private makeGitHubDiffRequest(endpoint: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.githubBaseUrl,
        port: 443,
        path: `${endpoint}`,
        method: "GET",
        headers: {
          Authorization: `token ${this.githubToken}`,
          "User-Agent": "GitLogs-SparkxReview/1.0",
          Accept: "application/vnd.github.v3.diff",
        },
      };

      const req = https.request(options, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          const statusCode = res.statusCode || 0;
          if (statusCode >= 200 && statusCode < 300) {
            resolve(data);
          } else {
            reject(
              new Error(`GitHub API request failed with status ${statusCode}`),
            );
          }
        });
      });

      req.on("error", (error) => {
        reject(error);
      });

      req.end();
    });
  }

  async getPullRequest(prNumber: number): Promise<PRData> {
    const prEndpoint = `/repos/${this.repoOwner}/${this.repoName}/pulls/${prNumber}`;

    // Fetch PR data first
    const prData = await this.makeGitHubRequest(prEndpoint);

    // Fetch diff with error handling for large PRs
    let diff = "";
    try {
      diff = await this.makeGitHubDiffRequest(prEndpoint);
    } catch (error) {
      console.warn(
        `Could not fetch diff for PR #${prNumber}, will use file patches instead:`,
        error,
      );
    }

    // Fetch all files with pagination support for large PRs
    const filesData = await this.fetchAllPRFiles(prNumber);

    // For very large PRs, construct diff from file patches if diff fetch failed
    if (!diff && filesData.length > 0) {
      console.log("Constructing diff from file patches...");
      diff = filesData
        .filter((file: any) => file.patch)
        .map(
          (file: any) =>
            `diff --git a/${file.filename} b/${file.filename}\n${file.patch}`,
        )
        .join("\n\n");
    }

    return {
      number: prData.number,
      title: prData.title,
      author: prData.user?.login || "Unknown",
      body: prData.body || "",
      state: prData.state,
      filesChanged: filesData.length,
      additions: prData.additions,
      deletions: prData.deletions,
      files: filesData.map((file: any) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch,
      })),
      diff: diff,
    };
  }

  async getCommit(sha: string): Promise<CommitData> {
    const commitEndpoint = `/repos/${this.repoOwner}/${this.repoName}/commits/${sha}`;
    const [commitData, diff] = await Promise.all([
      this.makeGitHubRequest(commitEndpoint),
      this.makeGitHubDiffRequest(commitEndpoint),
    ]);

    return {
      sha: commitData.sha,
      message: commitData.commit?.message || "",
      author:
        commitData.commit?.author?.name ||
        commitData.author?.login ||
        "Unknown",
      date: commitData.commit?.author?.date || "",
      filesChanged: commitData.files?.length || 0,
      additions: commitData.stats?.additions || 0,
      deletions: commitData.stats?.deletions || 0,
      files: (commitData.files || []).map((file: any) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch,
      })),
      diff: diff,
    };
  }

  private getRelevantLocalFiles(changedFiles: PRFile[]): Map<string, string> {
    const localFiles = new Map<string, string>();

    for (const file of changedFiles) {
      // Skip deleted files
      if (file.status === "removed") {
        console.log(`Skipping deleted file: ${file.filename}`);
        continue;
      }

      const localPath = path.join(this.localRepoPath, file.filename);

      try {
        if (fs.existsSync(localPath)) {
          const content = fs.readFileSync(localPath, "utf-8");
          localFiles.set(file.filename, content);
          console.log(
            `Loaded local file: ${file.filename} (${content.length} chars)`,
          );
        } else {
          console.log(
            `Local file not found (new file in PR): ${file.filename}`,
          );
        }
      } catch (error) {
        console.log(`Could not read local file: ${file.filename}`, error);
      }
    }

    console.log(`Total local files loaded: ${localFiles.size}`);
    return localFiles;
  }

  private getRelatedLocalFiles(changedFiles: PRFile[]): Map<string, string> {
    // Get additional context files that might be related to the changes
    const relatedFiles = new Map<string, string>();
    const processedDirs = new Set<string>();

    for (const file of changedFiles) {
      const dir = path.dirname(file.filename);
      if (processedDirs.has(dir)) continue;
      processedDirs.add(dir);

      const localDir = path.join(this.localRepoPath, dir);

      try {
        if (fs.existsSync(localDir) && fs.statSync(localDir).isDirectory()) {
          const filesInDir = fs.readdirSync(localDir);

          for (const fileName of filesInDir) {
            const fullPath = path.join(dir, fileName);
            const localPath = path.join(this.localRepoPath, fullPath);

            // Only include code files, skip already included files
            if (
              this.isCodeFile(fileName) &&
              !changedFiles.some((f) => f.filename === fullPath) &&
              fs.statSync(localPath).isFile()
            ) {
              try {
                const content = fs.readFileSync(localPath, "utf-8");
                relatedFiles.set(fullPath, content);
              } catch (e) {
                // Skip files that can't be read
              }
            }
          }
        }
      } catch (error) {
        // Skip directories that can't be read
      }
    }

    return relatedFiles;
  }

  private isCodeFile(filename: string): boolean {
    const codeExtensions = [
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
      ".json",
      ".css",
      ".scss",
      ".less",
      ".html",
      ".vue",
      ".py",
      ".java",
      ".go",
      ".rb",
      ".php",
    ];
    return codeExtensions.some((ext) => filename.endsWith(ext));
  }

  private getLanguageFromFilename(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const languageMap: Record<string, string> = {
      ".js": "javascript",
      ".jsx": "jsx",
      ".ts": "typescript",
      ".tsx": "tsx",
      ".json": "json",
      ".css": "css",
      ".scss": "scss",
      ".less": "less",
      ".html": "html",
      ".vue": "vue",
      ".py": "python",
      ".java": "java",
      ".go": "go",
      ".rb": "ruby",
      ".php": "php",
      ".md": "markdown",
      ".yaml": "yaml",
      ".yml": "yaml",
    };
    return languageMap[ext] || "";
  }

  private async callLLMForReview(
    diff: string,
    localFiles: Map<string, string>,
    metadata: { title?: string; message?: string; author: string },
    customInstructions?: string,
    relatedFiles?: Map<string, string>,
    totalFilesInPR?: number,
  ): Promise<ReviewResult["review"]> {
    const isLargePR = totalFilesInPR && totalFilesInPR > 30;

    // For large PRs, include fewer files but more context about the scope
    const maxLocalFiles = isLargePR ? 15 : 10;
    const maxRelatedFiles = isLargePR ? 3 : 5;
    const maxDiffLength = isLargePR ? 20000 : 12000;
    const maxFileContentLength = isLargePR ? 3000 : 5000;

    // Build context from LOCAL repository files (current codebase state)
    const localFilesContext = Array.from(localFiles.entries())
      .slice(0, maxLocalFiles)
      .map(([filename, content]) => {
        const truncatedContent =
          content.length > maxFileContentLength
            ? content.substring(0, maxFileContentLength) +
              "\n... (file truncated for brevity)"
            : content;
        return `### ${filename} (Current version in repository)\n\`\`\`${this.getLanguageFromFilename(filename)}\n${truncatedContent}\n\`\`\``;
      })
      .join("\n\n");

    // Build context from related files in the same directories
    const relatedFilesContext =
      relatedFiles && relatedFiles.size > 0
        ? Array.from(relatedFiles.entries())
            .slice(0, maxRelatedFiles)
            .map(([filename, content]) => {
              const truncatedContent =
                content.length > 2000
                  ? content.substring(0, 2000) + "\n... (file truncated)"
                  : content;
              return `### ${filename} (Related file in same directory)\n\`\`\`${this.getLanguageFromFilename(filename)}\n${truncatedContent}\n\`\`\``;
            })
            .join("\n\n")
        : "";

    // Add note about large PRs
    const largePRNote =
      isLargePR && totalFilesInPR
        ? `\n\n**NOTE: This is a large PR with ${totalFilesInPR} files. Only the most significant changes are shown. Focus your review on the patterns and issues visible in the provided context.**\n`
        : "";

    const truncatedDiff =
      diff.length > maxDiffLength
        ? diff.substring(0, maxDiffLength) +
          `\n... (diff truncated - showing first ${maxDiffLength} characters of ${diff.length} total)`
        : diff;

    const customInstructionsSection = customInstructions
      ? `\n## IMPORTANT: Custom Review Focus\nThe reviewer has specifically requested you focus on the following:\n${customInstructions}\n\nPlease prioritize these aspects in your review and address them directly in your findings and detailed analysis.\n`
      : "";

    const serverActionGuidelines = `
**REMINDER: Apply the Server Action Detection Rules from your system instructions.** Scan every file in this diff for "use server" and report any violations as CRITICAL findings. If no server actions are found, skip silently.
`;

    const prompt = `You are an expert code reviewer for the SparkX application. Your task is to review proposed code changes by comparing them against the EXISTING CODEBASE.

## IMPORTANT: Codebase Comparison Context
You are provided with:
1. **The proposed changes (diff)** - What the developer wants to change
2. **The current files from the repository** - The existing code that will be modified
${relatedFilesContext ? "3. **Related files in the same directories** - For understanding patterns and dependencies\n" : ""}
Your review should focus on how well the proposed changes integrate with and maintain consistency with the existing codebase.

## Change Context
- Title/Message: ${metadata.title || metadata.message || "No title"}
- Author: ${metadata.author}
${customInstructionsSection}${largePRNote}
---

## EXISTING CODEBASE FILES (Current State)
${localFilesContext || "No existing files found - these may be new files being added."}

${relatedFilesContext ? `## RELATED FILES IN SAME DIRECTORIES (For Context)\n${relatedFilesContext}\n` : ""}
---

## PROPOSED CHANGES (Diff to Review)
\`\`\`diff
${truncatedDiff}
\`\`\`

---

## Review Instructions
##Compare the proposed changes against the existing codebase and evaluate:


1. **Code Quality** - Clean code principles, readability, complexity, error handling
   - Does the new code match the quality standards of the existing codebase?
   - Are there any regressions in code quality?

2. **Best Practices** - Design patterns, coding standards, naming conventions, security
   - Does the new code follow the patterns established in the existing code?
   - Are naming conventions consistent with the codebase?

3. **Maintainability** - Modularity, documentation, testability, code organization
   - Will these changes make the codebase harder to maintain?
   - Is the code properly integrated with existing modules?

4. **Impact on Existing Functionality** - Regression risk, breaking changes, side effects
   - Could these changes break any existing features or workflows?
   - Are there any potential side effects on other parts of the codebase?
   - Do the changes maintain backward compatibility where needed?
   - Are there any shared dependencies or utilities that might be affected?

${customInstructions ? "**CUSTOM FOCUS AREAS:** Pay special attention to the custom review requirements specified above.\n" : ""}
${serverActionGuidelines}

For each category, provide 3-5 specific findings with file references where applicable.

The "detailedAnalysis" field is the MOST IMPORTANT part of the review. It MUST be a comprehensive markdown analysis including:
- How the changes integrate with the existing codebase
- Consistency with existing code patterns and style
- Specific issues found when comparing old vs new code
- Impact analysis on existing functionality
${customInstructions ? "- Response to custom review instructions\n" : ""}- Security considerations
- Performance implications
- Recommendations for improvement

IMPORTANT: You MUST provide a thorough detailedAnalysis. Do NOT leave it empty or provide a placeholder.

Respond in this exact JSON format (note: detailedAnalysis comes BEFORE the score categories to ensure it is not truncated):
{
  "summary": "3-4 sentence overview: what the changes do, how they fit with the existing codebase, and overall assessment",
  "detailedAnalysis": "## Overview\\n\\nComprehensive analysis of how changes integrate with existing codebase...\\n\\n## Comparison with Existing Code\\n\\n...\\n\\n## Impact on Existing Functionality\\n\\n...\\n\\n## Issues Found\\n\\n...\\n\\n## Recommendations\\n\\n...",
  "codeQuality": {
    "score": <number 1-10>,
    "findings": ["Finding comparing new code to existing patterns", "Another finding", "More findings..."]
  },
  "bestPractices": {
    "score": <number 1-10>,
    "findings": ["Finding about consistency with codebase", "Another finding", "More findings..."]
  },
  "maintainability": {
    "score": <number 1-10>,
    "findings": ["Finding about integration with existing code", "Another finding", "More findings..."]
  },
  "impactAnalysis": {
    "score": <number 1-10>,
    "findings": ["Finding about potential impact on existing features", "Another finding about regression risk", "More findings..."]
  },
  "suggestions": ["Actionable suggestion based on codebase patterns", "Another suggestion", "More suggestions..."]
}`;

    try {
      const response = await this.makeLLMRequest(prompt);
      return this.parseLLMResponse(response);
    } catch (error) {
      console.error("LLM request failed:", error);
      throw new Error("Failed to get AI review");
    }
  }

  private async makeLLMRequest(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.llmApiUrl);

      const requestBody = JSON.stringify({
        model: this.llmModel,
        messages: [
          {
            role: "system",
            content: `You are a senior software engineer and expert code reviewer specializing in JavaScript/TypeScript, Node.js, React, and web applications.

Your reviews should be:
- Thorough and actionable with specific examples
- Include file names and line references when possible
- Focus on real issues, not nitpicks
- Provide constructive feedback with solutions
- Consider security, performance, and maintainability
- Ignore styling-only changes (CSS, SCSS, LESS, Tailwind config, etc.).
- Fatal issues (runtime errors, crashes, security risks, data corruption).
- Serious code inefficiencies (unnecessary re-renders, heavy computations in render, N+1 calls, etc.).
- Poor patterns in React (loops or expensive logic inside  useEffect , missing dependency arrays, potential memory leaks, or infinite loops).
- Poor state management (overly complex state, redundant state, incorrect derived state, race conditions).
- Clearly bad code quality (duplicated logic, unclear naming, dead code, poor error handling).
  - For every issue you find that matches the above, provide:
  - The file path and, if possible, the approximate location (function/component name or line range).
  - A brief description of the problem.
  - A concrete remediation suggestion or improved code pattern.
  - At the end of the review, output:
  - A bullet list of all files where you found issues and what type of issues they had (fatal, inefficiency, state handling, etc.).
  - A separate bullet list of all files you reviewed in this PR (even if no issues were found).

## MANDATORY: Server Action Detection Rules
You MUST scan every file in the diff for the following patterns. These are NON-NEGOTIABLE checks that must be performed on EVERY review:

**Check 1 — "use server" directive detection:**
- Scan the diff for the literal strings: "use server" or 'use server'
- If ANY file contains this directive (added or modified lines starting with +), flag it as a **CRITICAL** finding in your review under codeQuality or bestPractices findings.
- Server actions are DISCOURAGED — the team uses /api routes instead. Any new "use server" usage requires explicit justification.
- Report the exact filename and quote the line from the diff.

**Check 2 — Missing createParallelAction wrapper:**
- If a file has "use server" AND exports async functions, check if those functions are wrapped with createParallelAction() from @/lib/server/parallel-actions.
- If the wrapper is missing, flag as **CRITICAL**. Without it, server actions run sequentially causing performance degradation.

**Check 3 — Wrong directory for server actions:**
- If any file with "use server" is NOT inside the /actions/ directory, flag as **CRITICAL**.
- Server actions must be in /actions/{feature-name}-actions/ with:
  - {feature-name}-actions.ts (implementation with "use server")
  - index.ts (public API without "use server", using runParallelAction())

If NONE of the diff files contain "use server", you may skip these checks silently.

Always respond with valid JSON. Use markdown formatting in the detailedAnalysis field for better readability.`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.4,
        max_tokens: 16000,
      });

      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.llmApiKey}`,
          "Content-Length": Buffer.byteLength(requestBody),
        },
      };

      const protocol = url.protocol === "https:" ? https : http;

      const req = protocol.request(options, (res: any) => {
        let data = "";

        res.on("data", (chunk: string) => {
          data += chunk;
        });

        res.on("end", () => {
          const statusCode = res.statusCode || 0;
          if (statusCode >= 200 && statusCode < 300) {
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.message?.content || "";
              resolve(content);
            } catch (error) {
              reject(new Error("Failed to parse LLM response"));
            }
          } else {
            reject(
              new Error(
                `LLM API request failed with status ${statusCode}: ${data}`,
              ),
            );
          }
        });
      });

      req.on("error", (error: Error) => {
        reject(error);
      });

      req.write(requestBody);
      req.end();
    });
  }

  private extractJsonFromResponse(response: string): string | null {
    // Strategy 1: Find the outermost balanced JSON object
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < response.length; i++) {
      const char = response[i];

      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (char === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0 && start !== -1) {
          return response.substring(start, i + 1);
        }
      }
    }

    // If we have an unclosed JSON (truncated response), return from start to end
    if (start !== -1 && depth > 0) {
      return response.substring(start);
    }

    return null;
  }

  private parseLLMResponse(response: string): ReviewResult["review"] {
    try {
      // Use balanced brace extraction instead of greedy regex
      let jsonStr = this.extractJsonFromResponse(response);
      if (!jsonStr) {
        throw new Error("No JSON found in response");
      }

      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (parseError) {
        console.log("Initial JSON parse failed, attempting repair...");
        jsonStr = this.repairTruncatedJson(jsonStr);
        try {
          parsed = JSON.parse(jsonStr);
        } catch (secondError) {
          console.log("Repair failed, falling back to partial extraction");
          throw secondError;
        }
      }

      // Validate detailedAnalysis — treat empty/whitespace-only as missing
      const detailedAnalysis =
        typeof parsed.detailedAnalysis === "string" && parsed.detailedAnalysis.trim().length > 0
          ? parsed.detailedAnalysis
          : null;

      return {
        summary: parsed.summary || "No summary provided",
        codeQuality: {
          score: Math.min(
            10,
            Math.max(1, parseInt(parsed.codeQuality?.score) || 5),
          ),
          findings: Array.isArray(parsed.codeQuality?.findings)
            ? parsed.codeQuality.findings
            : [],
        },
        bestPractices: {
          score: Math.min(
            10,
            Math.max(1, parseInt(parsed.bestPractices?.score) || 5),
          ),
          findings: Array.isArray(parsed.bestPractices?.findings)
            ? parsed.bestPractices.findings
            : [],
        },
        maintainability: {
          score: Math.min(
            10,
            Math.max(1, parseInt(parsed.maintainability?.score) || 5),
          ),
          findings: Array.isArray(parsed.maintainability?.findings)
            ? parsed.maintainability.findings
            : [],
        },
        impactAnalysis: {
          score: Math.min(
            10,
            Math.max(1, parseInt(parsed.impactAnalysis?.score) || 5),
          ),
          findings: Array.isArray(parsed.impactAnalysis?.findings)
            ? parsed.impactAnalysis.findings
            : [],
        },
        suggestions: Array.isArray(parsed.suggestions)
          ? parsed.suggestions
          : [],
        detailedAnalysis:
          detailedAnalysis || "No detailed analysis provided",
      };
    } catch (error) {
      console.error("Failed to parse LLM response:", error);
      console.log("Raw LLM response (first 2000 chars):", response.substring(0, 2000));

      // Try to extract partial data from response
      const partialData = this.extractPartialData(response);

      return {
        summary:
          partialData.summary ||
          "AI analysis completed but response was truncated.",
        codeQuality: partialData.codeQuality || {
          score: 5,
          findings: ["Response was truncated"],
        },
        bestPractices: partialData.bestPractices || {
          score: 5,
          findings: ["Response was truncated"],
        },
        maintainability: partialData.maintainability || {
          score: 5,
          findings: ["Response was truncated"],
        },
        impactAnalysis: partialData.impactAnalysis || {
          score: 5,
          findings: ["Response was truncated"],
        },
        suggestions: partialData.suggestions || [
          "Response was truncated - please try with a smaller PR/commit",
        ],
        detailedAnalysis:
          partialData.detailedAnalysis || response.substring(0, 5000),
      };
    }
  }

  private repairTruncatedJson(jsonStr: string): string {
    // Count open brackets and braces
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < jsonStr.length; i++) {
      const char = jsonStr[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === "{") openBraces++;
        else if (char === "}") openBraces--;
        else if (char === "[") openBrackets++;
        else if (char === "]") openBrackets--;
      }
    }

    // If we're inside a string, close it
    if (inString) {
      jsonStr += '"';
    }

    // Close any open brackets and braces
    while (openBrackets > 0) {
      jsonStr += "]";
      openBrackets--;
    }
    while (openBraces > 0) {
      jsonStr += "}";
      openBraces--;
    }

    return jsonStr;
  }

  private extractPartialData(
    response: string,
  ): Partial<NonNullable<ReviewResult["review"]>> {
    const result: Partial<NonNullable<ReviewResult["review"]>> = {};

    // Try to extract summary
    const summaryMatch = response.match(/"summary"\s*:\s*"([^"]+)"/);
    if (summaryMatch) {
      result.summary = summaryMatch[1];
    }

    // Try to extract detailedAnalysis — handle escaped content in the string
    const detailedMatch = response.match(/"detailedAnalysis"\s*:\s*"/);
    if (detailedMatch) {
      const startIdx = (detailedMatch.index || 0) + detailedMatch[0].length;
      let endIdx = startIdx;
      let escaped = false;
      for (let i = startIdx; i < response.length; i++) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (response[i] === "\\") {
          escaped = true;
          continue;
        }
        if (response[i] === '"') {
          endIdx = i;
          break;
        }
        endIdx = i + 1; // in case string is truncated without closing quote
      }
      const extracted = response.substring(startIdx, endIdx);
      if (extracted.trim().length > 0) {
        // Unescape JSON string escapes
        try {
          result.detailedAnalysis = JSON.parse(`"${extracted}"`);
        } catch {
          result.detailedAnalysis = extracted.replace(/\\n/g, "\n").replace(/\\"/g, '"');
        }
      }
    }

    // Try to extract scores
    const codeQualityScoreMatch = response.match(
      /"codeQuality"\s*:\s*\{[^}]*"score"\s*:\s*(\d+)/,
    );
    if (codeQualityScoreMatch) {
      result.codeQuality = {
        score: parseInt(codeQualityScoreMatch[1]),
        findings: this.extractFindings(response, "codeQuality"),
      };
    }

    const bestPracticesScoreMatch = response.match(
      /"bestPractices"\s*:\s*\{[^}]*"score"\s*:\s*(\d+)/,
    );
    if (bestPracticesScoreMatch) {
      result.bestPractices = {
        score: parseInt(bestPracticesScoreMatch[1]),
        findings: this.extractFindings(response, "bestPractices"),
      };
    }

    const maintainabilityScoreMatch = response.match(
      /"maintainability"\s*:\s*\{[^}]*"score"\s*:\s*(\d+)/,
    );
    if (maintainabilityScoreMatch) {
      result.maintainability = {
        score: parseInt(maintainabilityScoreMatch[1]),
        findings: this.extractFindings(response, "maintainability"),
      };
    }

    const impactAnalysisScoreMatch = response.match(
      /"impactAnalysis"\s*:\s*\{[^}]*"score"\s*:\s*(\d+)/,
    );
    if (impactAnalysisScoreMatch) {
      result.impactAnalysis = {
        score: parseInt(impactAnalysisScoreMatch[1]),
        findings: this.extractFindings(response, "impactAnalysis"),
      };
    }

    return result;
  }

  private extractFindings(response: string, category: string): string[] {
    const regex = new RegExp(
      `"${category}"\\s*:\\s*\\{[^}]*"findings"\\s*:\\s*\\[([^\\]]+)`,
      "s",
    );
    const match = response.match(regex);
    if (match) {
      const findingsStr = match[1];
      const findings = findingsStr.match(/"([^"]+)"/g);
      if (findings) {
        return findings.map((f) => f.replace(/"/g, "")).slice(0, 5);
      }
    }
    return [];
  }

  async reviewPullRequest(
    prNumber: number,
    customInstructions?: string,
  ): Promise<ReviewResult> {
    try {
      console.log(`Starting review for PR #${prNumber}`);
      console.log(`Local repo path: ${this.localRepoPath}`);
      if (customInstructions) {
        console.log(
          `Custom instructions provided: ${customInstructions.substring(0, 100)}...`,
        );
      }

      const prData = await this.getPullRequest(prNumber);
      console.log(`Fetched PR data: ${prData.filesChanged} files changed`);

      // Get the current state of files from the cloned repository
      const localFiles = this.getRelevantLocalFiles(prData.files);
      console.log(
        `Loaded ${localFiles.size} files from local repository for comparison`,
      );

      // Get related files for additional context
      const relatedFiles = this.getRelatedLocalFiles(prData.files);
      console.log(`Loaded ${relatedFiles.size} related files for context`);

      const review = await this.callLLMForReview(
        prData.diff,
        localFiles,
        {
          title: prData.title,
          author: prData.author,
        },
        customInstructions,
        relatedFiles,
        prData.filesChanged,
      );

      return {
        success: true,
        prNumber: prNumber.toString(),
        title: prData.title,
        author: prData.author,
        filesChanged: prData.filesChanged,
        additions: prData.additions,
        deletions: prData.deletions,
        review,
      };
    } catch (error) {
      console.error(`Failed to review PR #${prNumber}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: `Failed to review PR: ${errorMessage}`,
      };
    }
  }

  async reviewCommit(
    sha: string,
    customInstructions?: string,
  ): Promise<ReviewResult> {
    try {
      console.log(`Starting review for commit ${sha}`);
      console.log(`Local repo path: ${this.localRepoPath}`);
      if (customInstructions) {
        console.log(
          `Custom instructions provided: ${customInstructions.substring(0, 100)}...`,
        );
      }

      const commitData = await this.getCommit(sha);
      console.log(
        `Fetched commit data: ${commitData.filesChanged} files changed`,
      );

      // Get the current state of files from the cloned repository
      const localFiles = this.getRelevantLocalFiles(commitData.files);
      console.log(
        `Loaded ${localFiles.size} files from local repository for comparison`,
      );

      // Get related files for additional context
      const relatedFiles = this.getRelatedLocalFiles(commitData.files);
      console.log(`Loaded ${relatedFiles.size} related files for context`);

      const review = await this.callLLMForReview(
        commitData.diff,
        localFiles,
        {
          message: commitData.message,
          author: commitData.author,
        },
        customInstructions,
        relatedFiles,
        commitData.filesChanged,
      );

      return {
        success: true,
        commitId: commitData.sha,
        title: commitData.message.split("\n")[0],
        author: commitData.author,
        filesChanged: commitData.filesChanged,
        additions: commitData.additions,
        deletions: commitData.deletions,
        review,
      };
    } catch (error) {
      console.error(`Failed to review commit ${sha}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: `Failed to review commit: ${errorMessage}`,
      };
    }
  }

  async postReviewToGitHub(
    prNumber: number,
    review: ReviewResult["review"],
  ): Promise<{ success: boolean; commentUrl?: string; error?: string }> {
    if (!review) {
      return { success: false, error: "No review data to post" };
    }

    try {
      const comment = this.formatReviewAsGitHubComment(review);
      const endpoint = `/repos/${this.repoOwner}/${this.repoName}/issues/${prNumber}/comments`;

      const response = await this.makeGitHubPostRequest(endpoint, {
        body: comment,
      });

      console.log(`Posted review comment to PR #${prNumber}`);

      return {
        success: true,
        commentUrl:
          response.html_url ||
          `https://github.com/${this.repoOwner}/${this.repoName}/pull/${prNumber}`,
      };
    } catch (error) {
      console.error(`Failed to post review to GitHub:`, error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: `Failed to post review: ${errorMessage}`,
      };
    }
  }

  private formatReviewAsGitHubComment(review: ReviewResult["review"]): string {
    if (!review) return "";

    const getScoreEmoji = (score: number): string => {
      if (score >= 8) return "🟢";
      if (score >= 6) return "🟡";
      return "🔴";
    };

    const getScoreLabel = (score: number): string => {
      if (score >= 8) return "Excellent";
      if (score >= 6) return "Good";
      if (score >= 4) return "Needs Improvement";
      return "Poor";
    };

    const avgScore = (
      (review.codeQuality.score +
        review.bestPractices.score +
        review.maintainability.score +
        review.impactAnalysis.score) /
      4
    ).toFixed(1);

    const comment = `## Code Review Summary

### Overall Score: ${getScoreEmoji(parseFloat(avgScore))} ${avgScore}/10 (${getScoreLabel(parseFloat(avgScore))})

---

### 📋 Summary
${review.summary}

---

### 📊 Scores Breakdown

| Category | Score | Status |
|----------|-------|--------|
| Code Quality | ${review.codeQuality.score}/10 | ${getScoreEmoji(review.codeQuality.score)} ${getScoreLabel(review.codeQuality.score)} |
| Best Practices | ${review.bestPractices.score}/10 | ${getScoreEmoji(review.bestPractices.score)} ${getScoreLabel(review.bestPractices.score)} |
| Maintainability | ${review.maintainability.score}/10 | ${getScoreEmoji(review.maintainability.score)} ${getScoreLabel(review.maintainability.score)} |
| Impact on Existing Functionality | ${review.impactAnalysis.score}/10 | ${getScoreEmoji(review.impactAnalysis.score)} ${getScoreLabel(review.impactAnalysis.score)} |

---

### 🔍 Code Quality Findings
${review.codeQuality.findings.map((f) => `- ${f}`).join("\n")}

### ✅ Best Practices Findings
${review.bestPractices.findings.map((f) => `- ${f}`).join("\n")}

### 🔧 Maintainability Findings
${review.maintainability.findings.map((f) => `- ${f}`).join("\n")}

### ⚠️ Impact on Existing Functionality
${review.impactAnalysis.findings.map((f) => `- ${f}`).join("\n")}

---

### 💡 Suggestions for Improvement
${review.suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n")}

---

### 📝 Detailed Analysis

${review.detailedAnalysis}

---
`;

    return comment;
  }

  async saveReportToFile(
    result: ReviewResult,
    customInstructions?: string,
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    try {
      const reportsDir = path.join(process.cwd(), "reports");

      // Ensure reports directory exists
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }

      // Generate filename based on PR number or commit ID
      const identifier = result.prNumber
        ? `PR-${result.prNumber}`
        : `commit-${result.commitId?.substring(0, 8) || "unknown"}`;
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `${identifier}_${timestamp}.json`;
      const filePath = path.join(reportsDir, fileName);

      // Prepare report data
      const reportData = {
        metadata: {
          generatedAt: new Date().toISOString(),
          identifier: result.prNumber
            ? `PR #${result.prNumber}`
            : `Commit ${result.commitId}`,
          title: result.title,
          author: result.author,
          filesChanged: result.filesChanged,
          additions: result.additions,
          deletions: result.deletions,
        },
        customInstructions: customInstructions || null,
        review: result.review,
        scores: result.review
          ? {
              codeQuality: result.review.codeQuality.score,
              bestPractices: result.review.bestPractices.score,
              maintainability: result.review.maintainability.score,
              impactAnalysis: result.review.impactAnalysis.score,
              overall: parseFloat(
                (
                  (result.review.codeQuality.score +
                    result.review.bestPractices.score +
                    result.review.maintainability.score +
                    result.review.impactAnalysis.score) /
                  4
                ).toFixed(1),
              ),
            }
          : null,
      };

      // Write to file
      fs.writeFileSync(filePath, JSON.stringify(reportData, null, 2), "utf-8");

      console.log(`Report saved to: ${filePath}`);

      return {
        success: true,
        filePath: fileName,
      };
    } catch (error) {
      console.error("Failed to save report:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: `Failed to save report: ${errorMessage}`,
      };
    }
  }

  async getReportsList(): Promise<{
    success: boolean;
    reports?: Array<{
      fileName: string;
      identifier: string;
      generatedAt: string;
      overallScore: number;
    }>;
    error?: string;
  }> {
    try {
      const reportsDir = path.join(process.cwd(), "reports");

      if (!fs.existsSync(reportsDir)) {
        return { success: true, reports: [] };
      }

      const files = fs
        .readdirSync(reportsDir)
        .filter((f) => f.endsWith(".json"));
      const reports = [];

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(reportsDir, file), "utf-8");
          const data = JSON.parse(content);
          reports.push({
            fileName: file,
            identifier: data.metadata?.identifier || "Unknown",
            generatedAt: data.metadata?.generatedAt || "Unknown",
            overallScore: data.scores?.overall || 0,
          });
        } catch (e) {
          // Skip files that can't be parsed
        }
      }

      // Sort by date, newest first
      reports.sort(
        (a, b) =>
          new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
      );

      return { success: true, reports };
    } catch (error) {
      console.error("Failed to get reports list:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: `Failed to get reports: ${errorMessage}`,
      };
    }
  }

  async getReport(fileName: string): Promise<{
    success: boolean;
    report?: any;
    error?: string;
  }> {
    try {
      const reportsDir = path.join(process.cwd(), "reports");
      const filePath = path.join(reportsDir, fileName);

      if (!fs.existsSync(filePath)) {
        return { success: false, error: "Report not found" };
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const report = JSON.parse(content);

      return { success: true, report };
    } catch (error) {
      console.error("Failed to get report:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: `Failed to get report: ${errorMessage}`,
      };
    }
  }
}
