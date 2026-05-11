import { NextRequest, NextResponse } from "next/server";
import * as https from "https";
import * as http from "http";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

interface InitializeRequest {
  llmApiKey: string;
  githubToken: string;
  baseUrl: string;
}

interface InitializeResponse {
  success: boolean;
  llmValid: boolean;
  githubValid: boolean;
  sparkxInitialized: boolean;
  message?: string;
  error?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse<InitializeResponse>> {
  try {
    const body = await request.json() as InitializeRequest;
    const { llmApiKey, githubToken, baseUrl } = body;

    // Validate input
    if (!llmApiKey || !githubToken || !baseUrl) {
      return NextResponse.json(
        {
          success: false,
          llmValid: false,
          githubValid: false,
          sparkxInitialized: false,
          error: "Missing required fields: llmApiKey, githubToken, baseUrl",
        },
        { status: 400 }
      );
    }

    let llmValid = false;
    let githubValid = false;
    let sparkxInitialized = false;
    const errors: string[] = [];

    // Step 1: Validate LLM API Key
    try {
      llmValid = await validateLLMKey(baseUrl, llmApiKey);
      if (!llmValid) {
        errors.push("LLM API key validation failed");
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      errors.push(`LLM validation error: ${errorMsg}`);
    }

    // Step 2: Validate GitHub Token
    try {
      githubValid = await validateGitHubToken(githubToken);
      if (!githubValid) {
        errors.push("GitHub PAT token validation failed");
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      errors.push(`GitHub validation error: ${errorMsg}`);
    }

    // Step 3: Initialize SparkX Node Web (only if other validations passed)
    if (llmValid && githubValid) {
      try {
        sparkxInitialized = await initializeSparkxRepository(githubToken);
        if (!sparkxInitialized) {
          errors.push("SparkX Node Web initialization failed");
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        errors.push(`SparkX initialization error: ${errorMsg}`);
      }
    }

    // Determine overall success
    const success = llmValid && githubValid && sparkxInitialized;

    if (success) {
      return NextResponse.json(
        {
          success: true,
          llmValid: true,
          githubValid: true,
          sparkxInitialized: true,
          message: "Initialization successful",
        },
        { status: 200 }
      );
    } else {
      return NextResponse.json(
        {
          success: false,
          llmValid,
          githubValid,
          sparkxInitialized,
          error: errors.join("; "),
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Error in initialization API:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json(
      {
        success: false,
        llmValid: false,
        githubValid: false,
        sparkxInitialized: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}

function validateLLMKey(baseUrl: string, apiKey: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const url = new URL(`${baseUrl}/chat/completions`);

      const requestBody = JSON.stringify({
        model: "test",
        messages: [
          {
            role: "user",
            content: "test",
          },
        ],
        max_tokens: 10,
      });

      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Length": Buffer.byteLength(requestBody),
        },
      };

      const protocol = url.protocol === "https:" ? https : http;

      const req = protocol.request(options, (res: any) => {
        const statusCode = res.statusCode || 0;
        // We're just checking if the API accepts our key (any response means the key format is valid)
        // 200-299: Success, 401/403: Invalid key, others: API issue but key might be valid
        resolve(statusCode !== 401 && statusCode !== 403);
      });

      req.on("error", () => {
        resolve(false);
      });

      req.write(requestBody);
      req.end();

      // Timeout after 5 seconds
      setTimeout(() => {
        resolve(false);
      }, 5000);
    } catch (error) {
      console.error("LLM validation error:", error);
      resolve(false);
    }
  });
}

function validateGitHubToken(token: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const options = {
        hostname: "api.github.com",
        port: 443,
        path: "/user",
        method: "GET",
        headers: {
          Authorization: `token ${token}`,
          "User-Agent": "SparkX-Review/1.0",
          Accept: "application/vnd.github.v3+json",
        },
      };

      const req = https.request(options, (res: any) => {
        const statusCode = res.statusCode || 0;
        resolve(statusCode >= 200 && statusCode < 300);
      });

      req.on("error", () => {
        resolve(false);
      });

      req.end();

      // Timeout after 5 seconds
      setTimeout(() => {
        resolve(false);
      }, 5000);
    } catch (error) {
      console.error("GitHub validation error:", error);
      resolve(false);
    }
  });
}

async function initializeSparkxRepository(githubToken: string): Promise<boolean> {
  try {
    const repoPath = path.join(process.cwd(), "repos", "sparkxnodeweb");
    const reposDir = path.join(process.cwd(), "repos");

    // Ensure repos directory exists
    if (!fs.existsSync(reposDir)) {
      fs.mkdirSync(reposDir, { recursive: true });
    }

    // Check if repository already exists
    if (!fs.existsSync(repoPath)) {
      // Clone the repository
      console.log(`Cloning SparkX repository to ${repoPath}`);
      const cloneUrl = `https://x-access-token:${githubToken}@github.com/OnePayPal/sparkxnodeweb.git`;
      execSync(`git clone ${cloneUrl} sparkxnodeweb`, {
        cwd: reposDir,
        stdio: "inherit",
      });
    } else {
      // Update existing repository
      console.log(`Updating existing SparkX repository at ${repoPath}`);
      execSync("git pull", {
        cwd: repoPath,
        stdio: "inherit",
      });
    }

    return true;
  } catch (error) {
    console.error("SparkX initialization error:", error);
    return false;
  }
}
