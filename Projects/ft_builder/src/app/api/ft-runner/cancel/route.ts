import { NextRequest, NextResponse } from "next/server";
import { runnerManager } from "@/services/ftRunner";
import { insertUserAction } from "@/lib/ftDatabase";

/**
 * POST /api/ft-runner/cancel
 *
 * Cancels a running FT run. Kills the dev server process and marks the run as failed.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { runId } = body;

    if (!runId) {
      return NextResponse.json({ success: false, error: "runId is required" }, { status: 400 });
    }

    const cancelled = runnerManager.cancelRun(runId);

    try { insertUserAction({ run_id: runId, action: "cancel_run", details: JSON.stringify({ cancelled }) }); } catch { /* non-blocking */ }

    return NextResponse.json({
      success: cancelled,
      message: cancelled ? "Run cancelled and server killed" : "Run not found (may have already completed)",
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to cancel run" },
      { status: 500 }
    );
  }
}
