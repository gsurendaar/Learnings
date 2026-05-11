import { NextRequest, NextResponse } from "next/server";
import { runnerManager } from "@/services/ftRunner";
import { getRun, getTestResultsByRun, getErrorsByRun } from "@/lib/ftDatabase";

export async function GET(request: NextRequest) {
  const runId = request.nextUrl.searchParams.get("runId");

  if (!runId) {
    return NextResponse.json(
      { success: false, message: "runId query parameter is required" },
      { status: 400 }
    );
  }

  // Check in-memory first (active runs)
  const activeRun = runnerManager.getActiveRun(runId);
  if (activeRun) {
    const steps = activeRun.runner.getSteps();
    // Extract fix attempt count from completed step names (compliance-fix-1, compliance-fix-2, etc.)
    const fixSteps = steps.filter((s: { name: string }) =>
      s.name.startsWith("compliance-fix") || s.name.startsWith("fix-attempt") || s.name === "auto-fix"
    );
    // Count how many run-tests steps completed = retry count
    const runTestSteps = steps.filter((s: { name: string; status: string }) =>
      s.name === "run-tests" && s.status === "completed"
    );
    const currentStep = steps.length > 0 ? steps[steps.length - 1]?.name : undefined;

    return NextResponse.json({
      success: true,
      runId,
      status: activeRun.status,
      startedAt: activeRun.startedAt.toISOString(),
      elapsed: Date.now() - activeRun.startedAt.getTime(),
      steps,
      currentStep,
      retryCount: Math.max(0, runTestSteps.length - 1),
      isActive: true,
    });
  }

  // Fall back to SQLite (completed runs)
  try {
    const run = getRun(runId);

    if (!run) {
      return NextResponse.json(
        { success: false, message: "Run not found" },
        { status: 404 }
      );
    }

    const testResults = getTestResultsByRun(runId);
    const errors = getErrorsByRun(runId);

    return NextResponse.json({
      success: true,
      runId: run.run_id,
      status: run.status,
      conclusion: run.conclusion,
      startedAt: run.created_at,
      elapsed: run.duration_ms,
      totalSpecs: run.total_specs,
      passedSpecs: run.passed_specs,
      failedSpecs: run.failed_specs,
      errorMessage: run.error_message || null,
      isActive: false,
      testResults,
      errors,
    });
  } catch (error: any) {
    console.error("Error fetching run status:", error);
    return NextResponse.json(
      { success: false, message: error?.message || "Failed to fetch run status" },
      { status: 500 }
    );
  }
}
