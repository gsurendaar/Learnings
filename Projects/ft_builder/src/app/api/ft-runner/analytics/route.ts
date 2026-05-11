import { NextRequest, NextResponse } from "next/server";
import {
  getSessionStats,
  getRunStats,
  getErrorStats,
  getTestResultsByRun,
  getErrorsByRun,
  getMetricsByRun,
  getAgentLogsByRun,
  getUserActionsByRun,
} from "@/lib/ftDatabase";

/**
 * GET /api/ft-runner/analytics
 *
 * Returns analytics data: session stats, run stats, error summaries.
 * Query params:
 *   - startDate: ISO date string (optional)
 *   - endDate: ISO date string (optional)
 *   - runId: specific run ID for detailed results (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;
    const runId = searchParams.get("runId") || undefined;

    // If runId is provided, return detailed run analytics
    if (runId) {
      const testResults = getTestResultsByRun(runId);
      const errors = getErrorsByRun(runId);
      const metrics = getMetricsByRun(runId);
      const agentLogs = getAgentLogsByRun(runId);
      const userActions = getUserActionsByRun(runId);

      return NextResponse.json({
        success: true,
        runId,
        testResults,
        errors,
        metrics,
        agentLogs,
        userActions,
      });
    }

    // Otherwise return aggregate stats
    const sessionStats = getSessionStats(startDate, endDate);
    const runStats = getRunStats(startDate, endDate);
    const errorStats = getErrorStats(startDate, endDate);

    return NextResponse.json({
      success: true,
      sessions: sessionStats,
      runs: runStats,
      errors: errorStats,
    });
  } catch (error: any) {
    console.error("[Analytics] Error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to fetch analytics" },
      { status: 500 }
    );
  }
}
