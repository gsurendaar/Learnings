import { NextRequest, NextResponse } from "next/server";
import { SparkxReviewService } from "@/services/sparkxReview";

export async function GET() {
  try {
    // Create a minimal service instance just for report operations
    const reviewService = new SparkxReviewService("", "", "", "");
    const result = await reviewService.getReportsList();

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching reports:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json(
      { success: false, message: errorMessage },
      { status: 500 }
    );
  }
}
