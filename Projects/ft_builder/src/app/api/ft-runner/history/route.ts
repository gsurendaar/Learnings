import { NextRequest, NextResponse } from "next/server";
import { getRunHistory, deleteRun, clearHistory, ftDb } from "@/lib/ftDatabase";

/**
 * Extract distinct workflow names from spec_pattern values.
 */
function extractWorkflows(): string[] {
  const rows = ftDb.prepare("SELECT DISTINCT spec_pattern FROM ft_runs WHERE spec_pattern IS NOT NULL").all() as any[];
  const workflows = new Set<string>();
  for (const row of rows) {
    const pattern = row.spec_pattern || "";
    const match = pattern.match(/workflows\/([^/]+)\//);
    if (match) workflows.add(match[1]);
  }
  return [...workflows].sort();
}

/**
 * GET /api/ft-runner/history?userId=...&workflow=...&conclusion=...&limit=...&offset=...
 *
 * Returns run history with optional filters. Also returns available workflow names for filter dropdowns.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");
    const workflow = searchParams.get("workflow");
    const conclusion = searchParams.get("conclusion");
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    const conditions: string[] = [];
    const params: any[] = [];

    if (userId) {
      conditions.push("triggered_by = ?");
      params.push(userId);
    }
    if (workflow) {
      conditions.push("spec_pattern LIKE ?");
      params.push(`%/workflows/${workflow}/%`);
    }
    if (conclusion) {
      conditions.push("conclusion = ?");
      params.push(conclusion);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRow = ftDb.prepare(
      `SELECT COUNT(*) as total FROM ft_runs ${where}`
    ).get(...params) as any;

    const runs = ftDb.prepare(
      `SELECT run_id, owner, repo, branch, spec_pattern, browser, run_mode, triggered_by,
              status, conclusion, total_specs, passed_specs, failed_specs, duration_ms,
              artifacts_dir, created_at, updated_at
       FROM ft_runs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    const workflows = extractWorkflows();

    return NextResponse.json({ success: true, runs, total: countRow?.total || 0, limit, offset, workflows });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Failed to fetch history" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, owner, repo, limit = 20, offset = 0, runId, clearAll } = body;

    // Delete actions via POST (more reliable than DELETE with body)
    if (action === "delete") {
      if (runId) {
        deleteRun(runId);
        return NextResponse.json({ success: true, message: `Deleted run ${runId}` });
      }
      if (clearAll) {
        const count = clearHistory(owner, repo);
        return NextResponse.json({ success: true, message: `Deleted ${count} run(s)`, count });
      }
      return NextResponse.json(
        { success: false, message: "Provide runId or clearAll" },
        { status: 400 }
      );
    }

    // Default: fetch history
    const { runs, total } = getRunHistory({ owner, repo, limit, offset });

    return NextResponse.json({
      success: true,
      runs,
      total,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error("Error fetching run history:", error);
    return NextResponse.json(
      { success: false, message: error?.message || "Failed to fetch run history" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { runId, owner, repo, clearAll } = body;

    if (runId) {
      deleteRun(runId);
      return NextResponse.json({ success: true, message: `Deleted run ${runId}` });
    }

    if (clearAll || (owner && repo)) {
      const count = clearHistory(owner, repo);
      return NextResponse.json({ success: true, message: `Deleted ${count} run(s)`, count });
    }

    return NextResponse.json(
      { success: false, message: "Provide runId, clearAll, or owner+repo" },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("Error deleting run history:", error);
    return NextResponse.json(
      { success: false, message: error?.message || "Failed to delete history" },
      { status: 500 }
    );
  }
}
