import { NextRequest, NextResponse } from "next/server";
import { SparkxReviewService } from "@/services/sparkxReview";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prNumber, review, githubToken: requestGithubToken } = body;

    if (!prNumber) {
      return NextResponse.json(
        { success: false, message: "PR number is required" },
        { status: 400 }
      );
    }

    if (!review) {
      return NextResponse.json(
        { success: false, message: "Review data is required" },
        { status: 400 }
      );
    }

    // Use credentials from request body only (required)
    const githubToken = requestGithubToken;

    if (!githubToken) {
      return NextResponse.json(
        { success: false, message: "GitHub token is required. Please initialize credentials first." },
        { status: 400 }
      );
    }

    // We don't need LLM for posting, but service requires these params
    const reviewService = new SparkxReviewService(
      githubToken,
      "", // Not needed for posting
      "", // Not needed for posting
      ""  // Not needed for posting
    );

    console.log(`Posting review to GitHub PR #${prNumber}`);
    const result = await reviewService.postReviewToGitHub(parseInt(prNumber, 10), review);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error posting review to GitHub:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json(
      { success: false, message: errorMessage },
      { status: 500 }
    );
  }
}
