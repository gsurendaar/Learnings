import { NextRequest, NextResponse } from "next/server";
import { SparkxReviewService } from "@/services/sparkxReview";
import Database from "@/lib/database";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { input, customInstructions, model, username, githubToken: requestGithubToken, llmApiKey: requestLlmApiKey, baseUrl: requestBaseUrl } = body;

    if (!input) {
      return NextResponse.json(
        { success: false, message: "PR number or Commit ID is required" },
        { status: 400 }
      );
    }

    if (!model) {
      return NextResponse.json(
        { success: false, message: "Please select an LLM model" },
        { status: 400 }
      );
    }

    // Use credentials from request body only (required)
    const githubToken = requestGithubToken;
    const llmBaseUrl = requestBaseUrl;
    const llmApiKey = requestLlmApiKey;

    if (!githubToken) {
      return NextResponse.json(
        { success: false, message: "GitHub token is required. Please initialize credentials first." },
        { status: 400 }
      );
    }

    if (!llmBaseUrl || !llmApiKey) {
      return NextResponse.json(
        { success: false, message: "LLM API credentials are required. Please initialize with valid credentials." },
        { status: 400 }
      );
    }

    // Construct the chat completions endpoint URL
    const llmApiUrl = `${llmBaseUrl}/chat/completions`;
    // Use the model selected by the user instead of environment variable
    const reviewService = new SparkxReviewService(githubToken, llmApiUrl, llmApiKey, model);
    console.log(`Using LLM model: ${model}`);

    // Determine if input is a PR number or commit SHA
    const isPRNumber = /^#?\d+$/.test(input.trim());
    const cleanedInput = input.trim().replace(/^#/, "");

    let result;

    if (isPRNumber) {
      console.log(`Processing PR review request for PR #${cleanedInput}`);
      result = await reviewService.reviewPullRequest(parseInt(cleanedInput, 10), customInstructions);
    } else {
      console.log(`Processing commit review request for commit ${cleanedInput}`);
      result = await reviewService.reviewCommit(cleanedInput, customInstructions);
    }

    // Save report to local file if review was successful
    let savedReport = null;
    if (result.success && result.review) {
      const saveResult = await reviewService.saveReportToFile(result, customInstructions);
      if (saveResult.success) {
        savedReport = saveResult.filePath;
        console.log(`Report saved: ${saveResult.filePath}`);
      } else {
        console.error(`Failed to save report: ${saveResult.error}`);
      }
    }

    // Insert tracking entry if review was successful and we have username
    if (result.success && username && result.review) {
      try {
        // Calculate overall review score from the 4 categories
        const review = result.review;
        const scores = [
          review.codeQuality?.score || 0,
          review.bestPractices?.score || 0,
          review.maintainability?.score || 0,
          review.impactAnalysis?.score || 0,
        ];
        const overallScore = scores.reduce((a, b) => a + b, 0) / scores.length;

        // Determine PR number or commit ID
        const prNumber = isPRNumber ? parseInt(cleanedInput, 10) : null;
        const commitId = !isPRNumber ? cleanedInput : null;

        await Database.query(
          `INSERT INTO review_tracking (username, pr_number, commit_id, model_name, review_score, files_scanned, report_location)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [username, prNumber, commitId, model, overallScore, result.filesChanged || null, savedReport]
        );
        console.log(`Tracking entry saved for user ${username}`);
      } catch (trackingError) {
        console.error("Error saving tracking entry:", trackingError);
        // Don't fail the review if tracking insert fails
      }
    }

    return NextResponse.json({ ...result, savedReport });
  } catch (error) {
    console.error("Error in review-sparkx API:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json(
      { success: false, message: errorMessage },
      { status: 500 }
    );
  }
}
