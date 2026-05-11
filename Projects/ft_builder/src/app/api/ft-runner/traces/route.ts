import { NextRequest, NextResponse } from "next/server";
import { getAgentLogsByRun, getMetricsByRun, getErrorsByRun } from "@/lib/ftDatabase";

/**
 * GET /api/ft-runner/traces?runId=X
 *
 * Returns all agent traces, metrics, and errors for a run.
 * Used by the Agent Traces panel in FT Builder.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId");

  if (!runId) {
    return NextResponse.json(
      { success: false, message: "runId is required" },
      { status: 400 }
    );
  }

  try {
    const agentLogs = getAgentLogsByRun(runId);
    const metrics = getMetricsByRun(runId);
    const errors = getErrorsByRun(runId);

    // Calculate aggregate stats
    let totalTokens = 0;
    let totalLatencyMs = 0;
    let totalCalls = 0;
    const agentBreakdown: Record<string, { calls: number; tokens: number; latencyMs: number; successes: number; failures: number }> = {};

    for (const log of agentLogs) {
      const agentName = log.agent_name || "unknown";
      if (!agentBreakdown[agentName]) {
        agentBreakdown[agentName] = { calls: 0, tokens: 0, latencyMs: 0, successes: 0, failures: 0 };
      }

      const tokens = log.token_count || 0;
      const latency = log.duration_ms || 0;

      totalTokens += tokens;
      totalLatencyMs += latency;
      totalCalls++;

      agentBreakdown[agentName].calls++;
      agentBreakdown[agentName].tokens += tokens;
      agentBreakdown[agentName].latencyMs += latency;
      if (log.success !== false) agentBreakdown[agentName].successes++;
      else agentBreakdown[agentName].failures++;
    }

    // Rough cost estimate (GPT-4 pricing as baseline: $0.03/1K prompt, $0.06/1K completion)
    const costEstimate = totalTokens > 0 ? (totalTokens / 1000) * 0.04 : 0;

    return NextResponse.json({
      success: true,
      runId,
      summary: {
        totalCalls,
        totalTokens,
        totalLatencyMs,
        costEstimate: Math.round(costEstimate * 100) / 100,
        agentBreakdown,
      },
      traces: agentLogs.map((log: any) => ({
        id: log.id,
        timestamp: log.created_at,
        agent: log.agent_name,
        action: log.action,
        targetFile: log.target_file,
        decision: log.decision,
        reason: log.reason,
        durationMs: log.duration_ms,
        tokenCount: log.token_count,
        model: log.llm_model,
        success: log.success,
        error: log.error,
        metadata: log.metadata ? JSON.parse(log.metadata) : null,
      })),
      metrics: metrics.map((m: any) => ({
        step: m.step_name,
        durationMs: m.duration_ms,
        startedAt: m.started_at,
        completedAt: m.completed_at,
        metadata: m.metadata ? JSON.parse(m.metadata) : null,
      })),
      errors: errors.map((e: any) => ({
        type: e.error_type,
        category: e.error_category,
        message: e.error_message,
        file: e.file,
        step: e.step,
        timestamp: e.created_at,
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Failed to fetch traces" },
      { status: 500 }
    );
  }
}
