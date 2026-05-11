import { NextRequest, NextResponse } from "next/server";
import { ftDb } from "@/lib/ftDatabase";

interface Filters {
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  pipeline?: string;
}

function buildDateUserClauses(
  table: "r" | "a" | "t",
  filters: Filters,
  conditions: string[],
  params: any[],
) {
  if (filters.dateFrom) {
    conditions.push(`${table}.created_at >= ?`);
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push(`${table}.created_at <= ?`);
    params.push(filters.dateTo + " 23:59:59");
  }
  if (filters.userId) {
    if (table === "r") {
      conditions.push(`${table}.triggered_by = ?`);
      params.push(filters.userId);
    }
  }
  if (filters.pipeline && table === "a") {
    conditions.push(`${table}.pipeline = ?`);
    params.push(filters.pipeline);
  }
}

function getOverview(filters: Filters) {
  const runConds: string[] = ["r.conclusion IS NOT NULL"];
  const runParams: any[] = [];
  buildDateUserClauses("r", filters, runConds, runParams);
  const runWhere = runConds.length > 0 ? `WHERE ${runConds.join(" AND ")}` : "";

  const runStats = ftDb.prepare(`
    SELECT COUNT(*) as totalRuns,
           ROUND(AVG(CASE WHEN r.total_specs > 0 THEN (r.passed_specs * 100.0 / r.total_specs) ELSE 0 END), 1) as avgPassRate,
           ROUND(AVG(r.duration_ms / 1000.0), 1) as avgDurationSec
    FROM ft_runs r ${runWhere}
  `).get(...runParams) as any;

  const agentConds: string[] = [];
  const agentParams: any[] = [];
  if (filters.userId) {
    agentConds.push(`a.run_id IN (SELECT run_id FROM ft_runs WHERE triggered_by = ?)`);
    agentParams.push(filters.userId);
  }
  buildDateUserClauses("a", { dateFrom: filters.dateFrom, dateTo: filters.dateTo, pipeline: filters.pipeline }, agentConds, agentParams);
  const agentWhere = agentConds.length > 0 ? `WHERE ${agentConds.join(" AND ")}` : "";

  const agentStats = ftDb.prepare(`
    SELECT COUNT(*) as totalLLMCalls,
           SUM(COALESCE(token_count, 0)) as totalTokens
    FROM ft_agent_logs a ${agentWhere}
  `).get(...agentParams) as any;

  const totalTokens = agentStats?.totalTokens || 0;
  // Claude Sonnet blended rate: ~$3 input + $15 output per MTok, assume ~40% output ratio
  // Blended rate: ($3 * 0.6 + $15 * 0.4) / 1M = $7.8 / MTok
  const estimatedCost = parseFloat((totalTokens * 7.8 / 1_000_000).toFixed(2));

  const passTrend = ftDb.prepare(`
    SELECT r.run_id,
           CASE WHEN r.total_specs > 0 THEN ROUND(r.passed_specs * 100.0 / r.total_specs, 0) ELSE 0 END as passRate,
           r.total_specs as totalSpecs,
           r.passed_specs as passedSpecs,
           r.failed_specs as failedSpecs,
           r.created_at as date,
           r.spec_pattern as specPattern
    FROM ft_runs r ${runWhere}
    ORDER BY r.created_at DESC LIMIT 20
  `).all(...runParams) as any[];

  const tokenConds: string[] = ["r.conclusion IS NOT NULL"];
  const tokenParams: any[] = [];
  buildDateUserClauses("r", filters, tokenConds, tokenParams);
  const tokenWhere = tokenConds.join(" AND ");

  const tokenTrend = ftDb.prepare(`
    SELECT r.run_id, r.created_at as date,
           a.agent_name as agent,
           SUM(COALESCE(a.token_count, 0)) as tokens,
           COUNT(*) as calls
    FROM ft_runs r
    JOIN ft_agent_logs a ON r.run_id = a.run_id
    WHERE ${tokenWhere}
    GROUP BY r.run_id, a.agent_name
    ORDER BY r.created_at DESC
    LIMIT 100
  `).all(...tokenParams) as any[];

  const failConds: string[] = ["t.status = 'failed'", "t.file IS NOT NULL"];
  const failParams: any[] = [];
  buildDateUserClauses("t", { dateFrom: filters.dateFrom, dateTo: filters.dateTo }, failConds, failParams);
  if (filters.userId) {
    failConds.push(`t.run_id IN (SELECT run_id FROM ft_runs WHERE triggered_by = ?)`);
    failParams.push(filters.userId);
  }
  const failWhere = failConds.join(" AND ");

  const topFailures = ftDb.prepare(`
    SELECT t.file, COUNT(*) as failCount,
           MAX(t.created_at) as lastFailure
    FROM ft_test_results t
    WHERE ${failWhere}
    GROUP BY t.file
    ORDER BY failCount DESC
    LIMIT 10
  `).all(...failParams) as any[];

  const perfConds: string[] = [];
  const perfParams: any[] = [];
  buildDateUserClauses("a", { dateFrom: filters.dateFrom, dateTo: filters.dateTo, pipeline: filters.pipeline }, perfConds, perfParams);
  if (filters.userId) {
    perfConds.push(`a.run_id IN (SELECT run_id FROM ft_runs WHERE triggered_by = ?)`);
    perfParams.push(filters.userId);
  }
  const perfWhere = perfConds.length > 0 ? `WHERE ${perfConds.join(" AND ")}` : "";

  const agentPerformance = ftDb.prepare(`
    SELECT a.agent_name as agent,
           COUNT(*) as totalCalls,
           ROUND(AVG(COALESCE(a.token_count, 0)), 0) as avgTokens,
           ROUND(AVG(COALESCE(a.duration_ms, 0)) / 1000.0, 1) as avgLatencySec,
           ROUND(SUM(CASE WHEN a.success = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 0) as successRate
    FROM ft_agent_logs a ${perfWhere}
    GROUP BY a.agent_name
    ORDER BY totalCalls DESC
  `).all(...perfParams) as any[];

  return {
    stats: {
      totalRuns: runStats?.totalRuns || 0,
      avgPassRate: runStats?.avgPassRate || 0,
      avgDurationSec: runStats?.avgDurationSec || 0,
      totalLLMCalls: agentStats?.totalLLMCalls || 0,
      totalTokens,
      estimatedCost,
    },
    passTrend: passTrend.reverse(),
    tokenTrend,
    topFailures,
    agentPerformance,
  };
}

function searchTraces(params: {
  q?: string;
  agent?: string;
  actionFilter?: string;
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  pipeline?: string;
}) {
  const { q, agent, actionFilter, limit = 50 } = params;

  const conditions: string[] = [];
  const queryParams: any[] = [];

  if (q) {
    conditions.push("(a.reason LIKE ? OR a.decision LIKE ? OR a.error LIKE ? OR a.target_file LIKE ? OR a.agent_name LIKE ? OR a.action LIKE ? OR a.metadata LIKE ? OR a.run_id IN (SELECT run_id FROM ft_runs WHERE spec_pattern LIKE ? OR error_message LIKE ?))");
    const like = `%${q}%`;
    queryParams.push(like, like, like, like, like, like, like, like, like);
  }
  if (agent && agent !== "all") {
    conditions.push("a.agent_name = ?");
    queryParams.push(agent);
  }
  if (actionFilter && actionFilter !== "all") {
    conditions.push("a.action = ?");
    queryParams.push(actionFilter);
  }
  buildDateUserClauses("a", { dateFrom: params.dateFrom, dateTo: params.dateTo, pipeline: params.pipeline }, conditions, queryParams);
  if (params.userId) {
    conditions.push(`a.run_id IN (SELECT run_id FROM ft_runs WHERE triggered_by = ?)`);
    queryParams.push(params.userId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const results = ftDb.prepare(`
    SELECT a.id, a.run_id as runId, a.agent_name as agent, a.action, a.target_file as targetFile,
           a.decision, a.reason, a.duration_ms as durationMs, a.token_count as tokenCount,
           a.success, a.error, a.llm_model as model, a.created_at as timestamp
    FROM ft_agent_logs a
    ${where}
    ORDER BY a.created_at DESC
    LIMIT ?
  `).all(...queryParams, limit) as any[];

  return { results, total: results.length };
}

function getUsers() {
  const users = ftDb.prepare(`
    SELECT DISTINCT triggered_by as userId
    FROM ft_runs
    WHERE triggered_by IS NOT NULL AND triggered_by != ''
    ORDER BY triggered_by
  `).all() as Array<{ userId: string }>;
  return users.map((u) => u.userId);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "overview";

    const filters: Filters = {
      dateFrom: searchParams.get("dateFrom") || undefined,
      dateTo: searchParams.get("dateTo") || undefined,
      userId: searchParams.get("userId") || undefined,
      pipeline: searchParams.get("pipeline") || undefined,
    };

    if (action === "overview") {
      const data = getOverview(filters);
      return NextResponse.json({ success: true, ...data });
    }

    if (action === "search") {
      const data = searchTraces({
        q: searchParams.get("q") || undefined,
        agent: searchParams.get("agent") || undefined,
        actionFilter: searchParams.get("actionFilter") || undefined,
        limit: parseInt(searchParams.get("limit") || "50"),
        ...filters,
      });
      return NextResponse.json({ success: true, ...data });
    }

    if (action === "users") {
      const users = getUsers();
      return NextResponse.json({ success: true, users });
    }

    if (action === "pipelines") {
      const pipelines = ftDb.prepare(`
        SELECT DISTINCT pipeline FROM ft_agent_logs
        WHERE pipeline IS NOT NULL
        ORDER BY pipeline
      `).all() as Array<{ pipeline: string }>;
      return NextResponse.json({ success: true, pipelines: pipelines.map((p) => p.pipeline) });
    }

    return NextResponse.json({ success: false, message: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Failed to fetch data" },
      { status: 500 }
    );
  }
}
