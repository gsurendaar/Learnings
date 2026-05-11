import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = process.env.FT_DB_PATH || path.join(DB_DIR, "ft-runner.db");

// Ensure data directory exists
fs.mkdirSync(DB_DIR, { recursive: true });

// Singleton pattern for Next.js (survives hot reloads in dev)
const globalForDB = globalThis as unknown as { ftDb: Database.Database };

function createDatabase(): Database.Database {
  const db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS ft_runs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id          TEXT NOT NULL UNIQUE,
      owner           TEXT NOT NULL,
      repo            TEXT NOT NULL,
      branch          TEXT NOT NULL,
      spec_pattern    TEXT NOT NULL,
      browser         TEXT DEFAULT 'electron',
      retries         INTEGER DEFAULT 1,
      run_mode        TEXT DEFAULT 'headless',
      triggered_by    TEXT,
      status          TEXT DEFAULT 'queued',
      conclusion      TEXT CHECK(conclusion IN ('success','failure','cancelled',NULL)),
      total_specs     INTEGER DEFAULT 0,
      passed_specs    INTEGER DEFAULT 0,
      failed_specs    INTEGER DEFAULT 0,
      duration_ms     INTEGER DEFAULT 0,
      artifacts_dir   TEXT,
      error_message   TEXT,
      results_json    TEXT,
      compliance_json TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    -- Add compliance_json to existing databases that predate this column
    CREATE INDEX IF NOT EXISTS idx_ft_run_id ON ft_runs(run_id);
    CREATE INDEX IF NOT EXISTS idx_ft_branch ON ft_runs(branch);
    CREATE INDEX IF NOT EXISTS idx_ft_status ON ft_runs(status);
    CREATE INDEX IF NOT EXISTS idx_ft_triggered_by ON ft_runs(triggered_by);
    CREATE INDEX IF NOT EXISTS idx_ft_created_at ON ft_runs(created_at);
    CREATE INDEX IF NOT EXISTS idx_ft_repo ON ft_runs(owner, repo);

    -- User sessions: track visits and activity
    CREATE TABLE IF NOT EXISTS ft_sessions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      TEXT NOT NULL UNIQUE,
      user_id         TEXT,
      user_name       TEXT,
      ip_address      TEXT,
      user_agent      TEXT,
      started_at      TEXT DEFAULT (datetime('now')),
      last_active_at  TEXT DEFAULT (datetime('now')),
      page_views      INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_ft_sessions_user ON ft_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_ft_sessions_started ON ft_sessions(started_at);

    -- Per-test-case results linked to a run
    CREATE TABLE IF NOT EXISTS ft_test_results (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id          TEXT NOT NULL,
      file            TEXT NOT NULL,
      test_name       TEXT,
      status          TEXT NOT NULL CHECK(status IN ('passed','failed','skipped','pending')),
      duration_ms     INTEGER DEFAULT 0,
      error_message   TEXT,
      error_category  TEXT,
      screenshots     TEXT,
      video           TEXT,
      attempt_number  INTEGER DEFAULT 1,
      retry_attempts  TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ft_test_results_run ON ft_test_results(run_id);
    CREATE INDEX IF NOT EXISTS idx_ft_test_results_status ON ft_test_results(status);

    -- Test generation events
    CREATE TABLE IF NOT EXISTS ft_generation_logs (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id                TEXT,
      session_id            TEXT,
      source_file           TEXT,
      spec_file             TEXT,
      status                TEXT DEFAULT 'created' CHECK(status IN ('created','skipped','error')),
      generation_duration_ms INTEGER DEFAULT 0,
      llm_model             TEXT,
      token_count           INTEGER,
      compliance_score      REAL,
      created_at            TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ft_gen_logs_run ON ft_generation_logs(run_id);
    CREATE INDEX IF NOT EXISTS idx_ft_gen_logs_session ON ft_generation_logs(session_id);

    -- Centralized error log
    CREATE TABLE IF NOT EXISTS ft_errors (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id          TEXT,
      session_id      TEXT,
      error_type      TEXT CHECK(error_type IN ('setup','test','generation','fix','system')),
      error_category  TEXT,
      error_message   TEXT NOT NULL,
      stack_trace     TEXT,
      file            TEXT,
      step            TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ft_errors_run ON ft_errors(run_id);
    CREATE INDEX IF NOT EXISTS idx_ft_errors_type ON ft_errors(error_type);

    -- Time breakdown and performance metrics per step
    CREATE TABLE IF NOT EXISTS ft_metrics (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id          TEXT NOT NULL,
      step_name       TEXT NOT NULL,
      started_at      TEXT,
      completed_at    TEXT,
      duration_ms     INTEGER DEFAULT 0,
      metadata        TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ft_metrics_run ON ft_metrics(run_id);

    -- User inputs per run
    CREATE TABLE IF NOT EXISTS ft_user_inputs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id          TEXT NOT NULL,
      session_id      TEXT,
      user_id         TEXT,
      owner           TEXT,
      repo            TEXT,
      branch          TEXT,
      selected_files  TEXT,
      browser         TEXT,
      retries         INTEGER,
      run_mode        TEXT,
      worker_count    INTEGER,
      fix_mode        TEXT,
      skip_setup      INTEGER DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ft_user_inputs_run ON ft_user_inputs(run_id);
    CREATE INDEX IF NOT EXISTS idx_ft_user_inputs_user ON ft_user_inputs(user_id);
    CREATE INDEX IF NOT EXISTS idx_ft_user_inputs_session ON ft_user_inputs(session_id);

    -- Agent activity logs — centralized across all pipelines
    -- pipeline: ft-builder, ft-runner, code-review, etc.
    CREATE TABLE IF NOT EXISTS ft_agent_logs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id          TEXT NOT NULL,
      pipeline        TEXT DEFAULT 'ft-builder',
      agent_name      TEXT NOT NULL,
      action          TEXT NOT NULL,
      target_file     TEXT,
      decision        TEXT,
      reason          TEXT,
      duration_ms     INTEGER DEFAULT 0,
      llm_model       TEXT,
      token_count     INTEGER,
      success         INTEGER DEFAULT 1,
      error           TEXT,
      metadata        TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ft_agent_logs_run ON ft_agent_logs(run_id);
    CREATE INDEX IF NOT EXISTS idx_ft_agent_logs_agent ON ft_agent_logs(agent_name);

    -- User action audit trail
    CREATE TABLE IF NOT EXISTS ft_user_actions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id          TEXT,
      session_id      TEXT,
      user_id         TEXT,
      action          TEXT NOT NULL,
      details         TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ft_user_actions_run ON ft_user_actions(run_id);
    CREATE INDEX IF NOT EXISTS idx_ft_user_actions_user ON ft_user_actions(user_id);
    CREATE INDEX IF NOT EXISTS idx_ft_user_actions_action ON ft_user_actions(action);
  `);

  // Migration: remove CHECK constraint on ft_runs.status (old DBs have it, blocks new statuses like 'building')
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ft_runs'").get() as any;
    if (tableInfo?.sql?.includes("CHECK(status IN")) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ft_runs_new (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id          TEXT NOT NULL UNIQUE,
          owner           TEXT NOT NULL,
          repo            TEXT NOT NULL,
          branch          TEXT NOT NULL,
          spec_pattern    TEXT NOT NULL,
          browser         TEXT DEFAULT 'electron',
          retries         INTEGER DEFAULT 1,
          run_mode        TEXT DEFAULT 'headless',
          triggered_by    TEXT,
          status          TEXT DEFAULT 'queued',
          conclusion      TEXT CHECK(conclusion IN ('success','failure','cancelled',NULL)),
          total_specs     INTEGER DEFAULT 0,
          passed_specs    INTEGER DEFAULT 0,
          failed_specs    INTEGER DEFAULT 0,
          duration_ms     INTEGER DEFAULT 0,
          artifacts_dir   TEXT,
          error_message   TEXT,
          results_json    TEXT,
          created_at      TEXT DEFAULT (datetime('now')),
          updated_at      TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO ft_runs_new SELECT * FROM ft_runs;
        DROP TABLE ft_runs;
        ALTER TABLE ft_runs_new RENAME TO ft_runs;
        CREATE INDEX IF NOT EXISTS idx_ft_run_id ON ft_runs(run_id);
        CREATE INDEX IF NOT EXISTS idx_ft_branch ON ft_runs(branch);
        CREATE INDEX IF NOT EXISTS idx_ft_status ON ft_runs(status);
        CREATE INDEX IF NOT EXISTS idx_ft_triggered_by ON ft_runs(triggered_by);
        CREATE INDEX IF NOT EXISTS idx_ft_created_at ON ft_runs(created_at);
        CREATE INDEX IF NOT EXISTS idx_ft_repo ON ft_runs(owner, repo);
      `);
      console.log("[ftDatabase] Migrated ft_runs: removed CHECK constraint on status");
    }

    // Add compliance_json column if it doesn't exist yet (idempotent)
    try {
      db.exec("ALTER TABLE ft_runs ADD COLUMN compliance_json TEXT");
      console.log("[ftDatabase] Added compliance_json column to ft_runs");
    } catch {
      // Column already exists — fine
    }
    // Migration: remove CHECK constraint on agent_name and add pipeline column
    try {
      const agentTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ft_agent_logs'").get() as any;
      if (agentTable?.sql && (agentTable.sql.includes("CHECK(agent_name") || !agentTable.sql.includes("pipeline"))) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS ft_agent_logs_new (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id          TEXT NOT NULL,
            pipeline        TEXT DEFAULT 'ft-builder',
            agent_name      TEXT NOT NULL,
            action          TEXT NOT NULL,
            target_file     TEXT,
            decision        TEXT,
            reason          TEXT,
            duration_ms     INTEGER DEFAULT 0,
            llm_model       TEXT,
            token_count     INTEGER DEFAULT 0,
            success         INTEGER DEFAULT 1,
            error           TEXT,
            metadata        TEXT,
            created_at      TEXT DEFAULT (datetime('now'))
          );
          INSERT INTO ft_agent_logs_new (id, run_id, agent_name, action, target_file, decision, reason, duration_ms, llm_model, token_count, success, error, metadata, created_at)
            SELECT id, run_id, agent_name, action, target_file, decision, reason, duration_ms, llm_model, token_count, success, error, metadata, created_at FROM ft_agent_logs;
          DROP TABLE ft_agent_logs;
          ALTER TABLE ft_agent_logs_new RENAME TO ft_agent_logs;
          CREATE INDEX IF NOT EXISTS idx_ft_agent_logs_run ON ft_agent_logs(run_id);
          CREATE INDEX IF NOT EXISTS idx_ft_agent_logs_agent ON ft_agent_logs(agent_name);
          CREATE INDEX IF NOT EXISTS idx_ft_agent_logs_pipeline ON ft_agent_logs(pipeline);
        `);
        console.log("[ftDatabase] Migrated ft_agent_logs: added pipeline column, removed CHECK constraint");
      }
    } catch {
      // Table might not exist yet or migration already done — fine
    }
  } catch (migErr) {
    console.warn("[ftDatabase] Migration check failed (non-fatal):", migErr);
  }

  return db;
}

export const ftDb = globalForDB.ftDb ?? createDatabase();

if (process.env.NODE_ENV !== "production") {
  globalForDB.ftDb = ftDb;
}

// ============= Query Helpers =============

export function insertRun(params: {
  run_id: string;
  owner: string;
  repo: string;
  branch: string;
  spec_pattern: string;
  browser?: string;
  retries?: number;
  run_mode?: string;
  triggered_by?: string;
}): void {
  const stmt = ftDb.prepare(`
    INSERT INTO ft_runs (run_id, owner, repo, branch, spec_pattern, browser, retries, run_mode, triggered_by)
    VALUES (@run_id, @owner, @repo, @branch, @spec_pattern, @browser, @retries, @run_mode, @triggered_by)
  `);
  stmt.run({
    browser: "electron",
    retries: 1,
    run_mode: "headless",
    triggered_by: "unknown",
    ...params,
  });
}

export function updateRun(runId: string, fields: Record<string, any>): void {
  const sets: string[] = [];
  const values: Record<string, any> = {};

  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = @${key}`);
    values[key] = value;
  }

  sets.push("updated_at = datetime('now')");
  values.run_id = runId;

  const sql = `UPDATE ft_runs SET ${sets.join(", ")} WHERE run_id = @run_id`;
  ftDb.prepare(sql).run(values);
}

export function getRun(runId: string): any {
  return ftDb.prepare("SELECT * FROM ft_runs WHERE run_id = ?").get(runId);
}

export function getRunHistory(params: {
  owner?: string;
  repo?: string;
  limit?: number;
  offset?: number;
}): { runs: any[]; total: number } {
  const { owner, repo, limit = 20, offset = 0 } = params;

  let where = "";
  const queryParams: any[] = [];

  if (owner && repo) {
    where = "WHERE owner = ? AND repo = ?";
    queryParams.push(owner, repo);
  }

  const countRow = ftDb
    .prepare(`SELECT COUNT(*) as total FROM ft_runs ${where}`)
    .get(...queryParams) as any;

  const runs = ftDb
    .prepare(
      `SELECT run_id, owner, repo, branch, spec_pattern, browser, run_mode, triggered_by,
              status, conclusion, total_specs, passed_specs, failed_specs, duration_ms,
              created_at, updated_at
       FROM ft_runs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...queryParams, limit, offset);

  return { runs, total: countRow?.total || 0 };
}

export function deleteRun(runId: string): void {
  ftDb.prepare("DELETE FROM ft_runs WHERE run_id = ?").run(runId);
}

export function clearHistory(owner?: string, repo?: string): number {
  if (owner && repo) {
    const result = ftDb.prepare("DELETE FROM ft_runs WHERE owner = ? AND repo = ?").run(owner, repo);
    return result.changes;
  }
  const result = ftDb.prepare("DELETE FROM ft_runs").run();
  return result.changes;
}

// ============= Session Helpers =============

export function insertSession(params: {
  session_id: string;
  user_id?: string;
  user_name?: string;
  ip_address?: string;
  user_agent?: string;
}): void {
  ftDb.prepare(`
    INSERT OR IGNORE INTO ft_sessions (session_id, user_id, user_name, ip_address, user_agent)
    VALUES (@session_id, @user_id, @user_name, @ip_address, @user_agent)
  `).run(params);
}

export function updateSessionActivity(sessionId: string): void {
  ftDb.prepare(`
    UPDATE ft_sessions SET last_active_at = datetime('now'), page_views = page_views + 1
    WHERE session_id = ?
  `).run(sessionId);
}

// ============= Test Result Helpers =============

export function insertTestResult(params: {
  run_id: string;
  file: string;
  test_name?: string;
  status: string;
  duration_ms?: number;
  error_message?: string;
  error_category?: string;
  screenshots?: string;
  video?: string;
  attempt_number?: number;
  retry_attempts?: string;
}): void {
  ftDb.prepare(`
    INSERT INTO ft_test_results (run_id, file, test_name, status, duration_ms, error_message, error_category, screenshots, video, attempt_number, retry_attempts)
    VALUES (@run_id, @file, @test_name, @status, @duration_ms, @error_message, @error_category, @screenshots, @video, @attempt_number, @retry_attempts)
  `).run({
    test_name: null,
    duration_ms: 0,
    error_message: null,
    error_category: null,
    screenshots: null,
    video: null,
    attempt_number: 1,
    retry_attempts: null,
    ...params,
  });
}

export function getTestResultsByRun(runId: string): any[] {
  return ftDb.prepare("SELECT * FROM ft_test_results WHERE run_id = ? ORDER BY id").all(runId);
}

// ============= Generation Log Helpers =============

export function insertGenerationLog(params: {
  run_id?: string;
  session_id?: string;
  source_file?: string;
  spec_file?: string;
  status?: string;
  generation_duration_ms?: number;
  llm_model?: string;
  token_count?: number;
  compliance_score?: number;
}): void {
  ftDb.prepare(`
    INSERT INTO ft_generation_logs (run_id, session_id, source_file, spec_file, status, generation_duration_ms, llm_model, token_count, compliance_score)
    VALUES (@run_id, @session_id, @source_file, @spec_file, @status, @generation_duration_ms, @llm_model, @token_count, @compliance_score)
  `).run({
    run_id: null,
    session_id: null,
    source_file: null,
    spec_file: null,
    status: "created",
    generation_duration_ms: 0,
    llm_model: null,
    token_count: null,
    compliance_score: null,
    ...params,
  });
}

// ============= Error Helpers =============

export function insertError(params: {
  run_id?: string;
  session_id?: string;
  error_type: string;
  error_category?: string;
  error_message: string;
  stack_trace?: string;
  file?: string;
  step?: string;
}): void {
  ftDb.prepare(`
    INSERT INTO ft_errors (run_id, session_id, error_type, error_category, error_message, stack_trace, file, step)
    VALUES (@run_id, @session_id, @error_type, @error_category, @error_message, @stack_trace, @file, @step)
  `).run({
    run_id: null,
    session_id: null,
    error_category: null,
    stack_trace: null,
    file: null,
    step: null,
    ...params,
  });
}

export function getErrorsByRun(runId: string): any[] {
  return ftDb.prepare("SELECT * FROM ft_errors WHERE run_id = ? ORDER BY created_at").all(runId);
}

// ============= Metric Helpers =============

export function insertMetric(params: {
  run_id: string;
  step_name: string;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  metadata?: string;
}): void {
  ftDb.prepare(`
    INSERT INTO ft_metrics (run_id, step_name, started_at, completed_at, duration_ms, metadata)
    VALUES (@run_id, @step_name, @started_at, @completed_at, @duration_ms, @metadata)
  `).run({
    started_at: null,
    completed_at: null,
    duration_ms: 0,
    metadata: null,
    ...params,
  });
}

export function getMetricsByRun(runId: string): any[] {
  return ftDb.prepare("SELECT * FROM ft_metrics WHERE run_id = ? ORDER BY id").all(runId);
}

// ============= User Input Helpers =============

export function insertUserInput(params: {
  run_id: string;
  session_id?: string;
  user_id?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  selected_files?: string;
  browser?: string;
  retries?: number;
  run_mode?: string;
  worker_count?: number;
  fix_mode?: string;
  skip_setup?: boolean;
}): void {
  ftDb.prepare(`
    INSERT INTO ft_user_inputs (run_id, session_id, user_id, owner, repo, branch, selected_files, browser, retries, run_mode, worker_count, fix_mode, skip_setup)
    VALUES (@run_id, @session_id, @user_id, @owner, @repo, @branch, @selected_files, @browser, @retries, @run_mode, @worker_count, @fix_mode, @skip_setup)
  `).run({
    session_id: null,
    user_id: null,
    owner: null,
    repo: null,
    branch: null,
    selected_files: null,
    browser: null,
    retries: null,
    run_mode: null,
    worker_count: null,
    fix_mode: null,
    ...params,
    skip_setup: params.skip_setup ? 1 : 0,
  });
}

// ============= Agent Log Helpers =============

export function insertAgentLog(params: {
  run_id: string;
  pipeline?: string;
  agent_name: string;
  action: string;
  target_file?: string;
  decision?: string;
  reason?: string;
  duration_ms?: number;
  llm_model?: string;
  token_count?: number;
  success?: boolean;
  error?: string;
  metadata?: string;
}): void {
  ftDb.prepare(`
    INSERT INTO ft_agent_logs (run_id, pipeline, agent_name, action, target_file, decision, reason, duration_ms, llm_model, token_count, success, error, metadata)
    VALUES (@run_id, @pipeline, @agent_name, @action, @target_file, @decision, @reason, @duration_ms, @llm_model, @token_count, @success, @error, @metadata)
  `).run({
    pipeline: "ft-builder",
    target_file: null,
    decision: null,
    reason: null,
    duration_ms: 0,
    llm_model: null,
    token_count: null,
    success: 1,
    error: null,
    metadata: null,
    ...params,
    success: params.success === false ? 0 : 1,
  });
}

export function getAgentLogsByRun(runId: string): any[] {
  return ftDb.prepare("SELECT * FROM ft_agent_logs WHERE run_id = ? ORDER BY created_at").all(runId);
}

export function copyAgentLogs(fromRunId: string, toRunId: string): number {
  const logs = getAgentLogsByRun(fromRunId);
  for (const log of logs) {
    insertAgentLog({
      run_id: toRunId,
      pipeline: log.pipeline,
      agent_name: log.agent_name,
      action: log.action,
      target_file: log.target_file,
      decision: log.decision,
      reason: log.reason,
      duration_ms: log.duration_ms,
      llm_model: log.llm_model,
      token_count: log.token_count,
      success: log.success === 1,
      error: log.error,
      metadata: log.metadata,
    });
  }
  return logs.length;
}

export function findRecentSuggestionsRun(triggeredBy: string, withinMinutes = 30): string | null {
  const row = ftDb.prepare(
    `SELECT run_id FROM ft_runs
     WHERE run_mode = 'suggestions' AND triggered_by = ?
       AND created_at > datetime('now', ?)
     ORDER BY created_at DESC LIMIT 1`
  ).get(triggeredBy, `-${withinMinutes} minutes`) as any;
  return row?.run_id || null;
}

// ============= User Action Helpers =============

export function insertUserAction(params: {
  run_id?: string;
  session_id?: string;
  user_id?: string;
  action: string;
  details?: string;
}): void {
  ftDb.prepare(`
    INSERT INTO ft_user_actions (run_id, session_id, user_id, action, details)
    VALUES (@run_id, @session_id, @user_id, @action, @details)
  `).run({
    run_id: null,
    session_id: null,
    user_id: null,
    details: null,
    ...params,
  });
}

export function getUserActionsByRun(runId: string): any[] {
  return ftDb.prepare("SELECT * FROM ft_user_actions WHERE run_id = ? ORDER BY created_at").all(runId);
}

// ============= Analytics Helpers =============

export function getSessionStats(startDate?: string, endDate?: string): {
  totalSessions: number;
  uniqueUsers: number;
  totalPageViews: number;
} {
  let where = "";
  const queryParams: string[] = [];

  if (startDate && endDate) {
    where = "WHERE started_at BETWEEN ? AND ?";
    queryParams.push(startDate, endDate);
  } else if (startDate) {
    where = "WHERE started_at >= ?";
    queryParams.push(startDate);
  }

  const sessionRow = ftDb.prepare(`
    SELECT
      COUNT(*) as totalSessions,
      COUNT(DISTINCT user_id) as uniqueUsers,
      COALESCE(SUM(page_views), 0) as totalPageViews
    FROM ft_sessions ${where}
  `).get(...queryParams) as any;

  // Also count unique users from ft_runs (covers runs before session tracking was added)
  const runUsersRow = ftDb.prepare(`
    SELECT COUNT(DISTINCT triggered_by) as uniqueRunUsers
    FROM ft_runs WHERE triggered_by IS NOT NULL AND triggered_by != ''
  `).get() as any;

  const sessionUsers = sessionRow?.uniqueUsers || 0;
  const runUsers = runUsersRow?.uniqueRunUsers || 0;

  return {
    totalSessions: sessionRow?.totalSessions || 0,
    uniqueUsers: Math.max(sessionUsers, runUsers),
    totalPageViews: sessionRow?.totalPageViews || 0,
  };
}

export function getRunStats(startDate?: string, endDate?: string): {
  totalRuns: number;
  totalPassed: number;
  totalFailed: number;
  avgDuration: number;
} {
  let where = "";
  const queryParams: string[] = [];

  if (startDate && endDate) {
    where = "WHERE created_at BETWEEN ? AND ?";
    queryParams.push(startDate, endDate);
  } else if (startDate) {
    where = "WHERE created_at >= ?";
    queryParams.push(startDate);
  }

  const row = ftDb.prepare(`
    SELECT
      COUNT(*) as totalRuns,
      COALESCE(SUM(passed_specs), 0) as totalPassed,
      COALESCE(SUM(failed_specs), 0) as totalFailed,
      COALESCE(AVG(duration_ms), 0) as avgDuration
    FROM ft_runs ${where}
  `).get(...queryParams) as any;

  return {
    totalRuns: row?.totalRuns || 0,
    totalPassed: row?.totalPassed || 0,
    totalFailed: row?.totalFailed || 0,
    avgDuration: Math.round(row?.avgDuration || 0),
  };
}

export function getErrorStats(startDate?: string, endDate?: string): any[] {
  let where = "";
  const queryParams: string[] = [];

  if (startDate && endDate) {
    where = "WHERE created_at BETWEEN ? AND ?";
    queryParams.push(startDate, endDate);
  } else if (startDate) {
    where = "WHERE created_at >= ?";
    queryParams.push(startDate);
  }

  return ftDb.prepare(`
    SELECT error_type, error_category, COUNT(*) as count
    FROM ft_errors ${where}
    GROUP BY error_type, error_category
    ORDER BY count DESC
  `).all(...queryParams);
}
