import { NextRequest, NextResponse } from "next/server";
import { resolveConfirmation } from "@/services/ftGraph";
import { insertUserAction } from "@/lib/ftDatabase";

export async function POST(request: NextRequest) {
  try {
    const { runId, decision } = await request.json();

    if (!runId || !decision) {
      return NextResponse.json(
        { success: false, message: "runId and decision are required" },
        { status: 400 }
      );
    }

    if (!["test", "app-logic", "skip"].includes(decision)) {
      return NextResponse.json(
        { success: false, message: "decision must be 'test', 'app-logic', or 'skip'" },
        { status: 400 }
      );
    }

    const resolved = resolveConfirmation(runId, decision);
    try { insertUserAction({ run_id: runId, action: "fix_decision", details: JSON.stringify({ decision, resolved }) }); } catch { /* non-blocking */ }

    if (!resolved) {
      return NextResponse.json(
        { success: false, message: "No pending confirmation for this run" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Confirmation received: ${decision}`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Failed to process confirmation" },
      { status: 500 }
    );
  }
}
