import { NextRequest, NextResponse } from "next/server";
import { runnerManager } from "@/services/ftRunner";

/**
 * GET /api/ft-runner/generate/status?genId={genId}
 *
 * Returns the current status and results of a generation job.
 */
export async function GET(request: NextRequest) {
  const genId = request.nextUrl.searchParams.get("genId");

  if (!genId) {
    return NextResponse.json(
      { error: "genId query parameter is required" },
      { status: 400 }
    );
  }

  const activeRun = runnerManager.getActiveRun(genId);

  if (!activeRun) {
    return NextResponse.json(
      { error: "Generation job not found. It may have completed and been cleaned up." },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    genId,
    status: activeRun.status,
    startedAt: activeRun.startedAt,
    elapsed: activeRun.runner.getElapsed(),
    steps: activeRun.runner.getSteps(),
    ...(activeRun.generationResult || {}),
  });
}
