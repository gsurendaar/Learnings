import { NextRequest, NextResponse } from "next/server";
import { SparkxReviewService } from "@/services/sparkxReview";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileName: string }> }
) {
  try {
    const { fileName } = await params;

    if (!fileName) {
      return NextResponse.json(
        { success: false, message: "File name is required" },
        { status: 400 }
      );
    }

    // Create a minimal service instance just for report operations
    const reviewService = new SparkxReviewService("", "", "", "");
    const result = await reviewService.getReport(fileName);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching report:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json(
      { success: false, message: errorMessage },
      { status: 500 }
    );
  }
}
