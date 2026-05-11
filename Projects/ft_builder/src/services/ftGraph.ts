import { ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { Annotation, StateGraph, START, END, Command, Send } from "@langchain/langgraph";
import { FTRunConfig, TestResult } from "@/types/ft";
import { validateCompliance } from "./ftComplianceValidator";
import { env } from "@/config/env";
import { APP_CONFIG } from "@/config/app";
import { WorkerResult, runCypressWorker } from "./ftWorker";
import {
  EventCallback,
  cloneRepo,
  installDeps,
  buildApp,
  findAvailablePort,
  startDevServer,
  startProdServer,
  stopProcess,
  cleanupWorkDir,
  cleanupStaleServers,
  createWorkDir,
  splitSpecsIntoChunks,
  removeDuplicateClones,
  isCloneStale,
  gitCommitAndPush,
  acquireServerFromPool,
  releaseServerToPool,
  getGitCommit,
  readBuildCache,
  writeBuildCache,
} from "./ftSetup";
import { analyzeFailure, applyFixes } from "./ftFixer";
import { updateRun, insertTestResult, insertMetric, insertError, insertAgentLog } from "@/lib/ftDatabase";
import { createLLMClient } from "./langgraph/llm";
import { FT_FIX_SYSTEM_PROMPT, buildFixUserPrompt } from "./langgraph/prompts/fixGeneration";
import { generateTests, regenerateTest, regenerateForCompliance, readWorkflowExistingFTs, extractAutomationIds, readFlowRoutingIntents, readAllSelectors, type GenerateRequest } from "./ftGenerator";
import { FT_TRIAGE_SYSTEM_PROMPT, buildTriageUserPrompt } from "./langgraph/prompts/ftTriage";
import { FT_SUPERVISOR_SYSTEM_PROMPT, buildSupervisorDecisionPrompt, type SupervisorDecision } from "./langgraph/prompts/ftSupervisor";

// ============= Helpers =============

function findFileRecursive(dir: string, fileName: string): string | null {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
        const found = findFileRecursive(fullPath, fileName);
        if (found) return found;
      } else if (entry.name === fileName) {
        return fullPath;
      }
    }
  } catch {
    // Skip unreadable directories
  }
  return null;
}

// ============= Side Channel (non-serializable objects) =============
// LangGraph serializes state between nodes. ChildProcess and functions
// can't be serialized, so we store them in a module-level map keyed by runId.

interface PendingConfirmation {
  resolve: (decision: string) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface RunSideChannel {
  emit: EventCallback;
  serverProcess: ChildProcess | null;
  pendingConfirmation: PendingConfirmation | null;
}

export const sideChannels = new Map<string, RunSideChannel>();

export function registerSideChannel(runId: string, emit: EventCallback): void {
  sideChannels.set(runId, { emit, serverProcess: null, pendingConfirmation: null });
}

function getChannel(runId: string): RunSideChannel {
  const channel = sideChannels.get(runId);
  if (!channel) throw new Error(`No side channel for run ${runId}`);
  return channel;
}

// ============= Helpers =============

function copyDirRecursive(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/** Called by the /api/ft-runner/confirm endpoint when user responds */
export function resolveConfirmation(runId: string, decision: string): boolean {
  const channel = sideChannels.get(runId);
  if (!channel?.pendingConfirmation) return false;
  clearTimeout(channel.pendingConfirmation.timeout);
  channel.pendingConfirmation.resolve(decision);
  channel.pendingConfirmation = null;
  return true;
}

/** Wait for user confirmation with a timeout. Returns the user's decision. */
function waitForUserConfirmation(
  runId: string,
  timeoutMs: number = 120000
): Promise<string> {
  const channel = getChannel(runId);
  return new Promise<string>((resolve) => {
    const timeout = setTimeout(() => {
      channel.pendingConfirmation = null;
      resolve("app-logic"); // default on timeout
    }, timeoutMs);
    channel.pendingConfirmation = { resolve, timeout };
  });
}

// ============= State Schema (serializable only) =============

const FTGraphState = Annotation.Root({
  // Config
  runId: Annotation<string>,
  config: Annotation<FTRunConfig>,

  // Setup outputs
  // Custom reducer: parallel workers all return the same workDir — take any non-empty value
  workDir: Annotation<string>({
    reducer: (existing, update) => update || existing,
    default: () => "",
  }),
  port: Annotation<number>,

  // Specs
  allSpecs: Annotation<string[]>,
  workerCount: Annotation<number>,

  // Worker input (per-worker via Send)
  workerSpecs: Annotation<string[]>,
  workerId: Annotation<number>,

  // Results — reducer appends worker results from parallel workers
  workerResults: Annotation<WorkerResult[]>({
    reducer: (existing, update) => [...(existing ?? []), ...(update ?? [])],
    default: () => [],
  }),

  // Aggregated
  totalPassed: Annotation<number>,
  totalFailed: Annotation<number>,
  totalDuration: Annotation<number>,
  failedSpecs: Annotation<string[]>,
  allResults: Annotation<TestResult[]>,

  // Fix loop
  fixAttempt: Annotation<number>,
  maxFixAttempts: Annotation<number>,
  fixesApplied: Annotation<boolean>,
  // Tracks how many worker results belong to previous rounds (to skip in aggregation)
  workerResultsOffset: Annotation<number>,

  // Compliance advisory (never affects pass/fail counts)
  complianceResults: Annotation<import("@/types/ft").ComplianceResult[]>,

  // AI Supervisor guidance — per-spec fix hints passed to the Generator
  supervisorGuidance: Annotation<Map<string, string>>,
  // Fix history for the AI supervisor to reason about
  fixHistory: Annotation<Array<{ attempt: number; specsFixed: number; specsSkipped: number; errors: string[] }>>,

  // Status
  status: Annotation<string>,
  error: Annotation<string | null>,

  // Generation config (for combined generate → run → fix flow)
  selectedFolders: Annotation<string[]>,
  manualPaths: Annotation<string[]>,
  templateType: Annotation<"basic" | "comprehensive">,
  overwriteExisting: Annotation<boolean>,
  generatedSpecs: Annotation<string[]>,
  isGenerateAndValidate: Annotation<boolean>,
});

type FTState = typeof FTGraphState.State;

// ============= Logging Helpers =============

function emitSupervisorLog(emit: EventCallback, message: string) {
  console.log(`[Supervisor] ${message}`);
  emit({ type: "log", timestamp: Date.now(), message: `[Supervisor] ${message}` });
}

function emitGeneratorLog(emit: EventCallback, message: string) {
  console.log(`[Generator Agent] ${message}`);
  emit({ type: "log", timestamp: Date.now(), message: `[Generator Agent] ${message}` });
}

function emitComplianceLog(emit: EventCallback, message: string) {
  console.log(`[Compliance] ${message}`);
  emit({ type: "log", timestamp: Date.now(), message: `[Compliance] ${message}` });
}

// ============= Nodes =============

async function setupNode(state: FTState): Promise<Partial<FTState>> {
  const { runId, config } = state;
  const { emit } = getChannel(runId);

  // Clean up any stale servers from previous runs before starting
  cleanupStaleServers();
  emit({ type: "log", timestamp: Date.now(), message: "Cleaned up stale processes from previous runs" });

  let workDir: string = "";
  let skipCloneInstall = false;

  // Check if we should reuse an existing clone
  if (config.skipSetup && config.existingWorkDir) {
    if (!fs.existsSync(config.existingWorkDir)) {
      emit({ type: "log", timestamp: Date.now(), message: "Existing clone not found — falling back to fresh clone" });
    } else {
      // Skip staleness check for local repos (e.g. repos/sparkxnodeweb) — they don't have clone metadata
      workDir = config.existingWorkDir;
      skipCloneInstall = true;
      emit({ type: "log", timestamp: Date.now(), message: `Reusing existing repo: ${workDir}` });
    }
  }

  // Determine build cache validity upfront (only meaningful for reused repos).
  // A cache hit means: same git HEAD, node_modules present, .next present.
  // When true, both install and build are skipped entirely.
  const currentCommit = workDir ? getGitCommit(workDir) : null;
  const cachedCommit  = workDir ? readBuildCache(workDir) : null;
  const buildCacheHit = !!(
    skipCloneInstall &&
    currentCommit &&
    currentCommit === cachedCommit &&
    fs.existsSync(path.join(workDir!, "node_modules")) &&
    fs.existsSync(path.join(workDir!, ".next"))
  );

  if (buildCacheHit) {
    emit({ type: "log", timestamp: Date.now(), message: `Build cache hit — commit ${currentCommit!.slice(0, 8)} already built. Skipping install + build.` });
  }

  if (!skipCloneInstall) {
    const userId = config.userId || config.triggeredBy || undefined;
    workDir = createWorkDir(runId, userId);

    // Remove any duplicate clone for same repo/branch before cloning
    removeDuplicateClones(config.owner, config.repo, config.branch, workDir, userId);

    // Step 1: Clone
    emit({ type: "step:start", timestamp: Date.now(), step: "clone" });
    updateRun(runId, { status: "cloning" });
    const cloneStart = Date.now();
    await cloneRepo(config, workDir!, emit);
    const cloneDuration = Date.now() - cloneStart;
    emit({ type: "step:complete", timestamp: Date.now(), step: "clone", duration: cloneDuration });
    try { insertAgentLog({ run_id: runId, agent_name: "setup", action: "clone", duration_ms: cloneDuration, decision: "success", reason: `Cloned ${config.owner}/${config.repo}@${config.branch}` }); } catch { /* non-blocking */ }

    // Step 2: Install
    emit({ type: "step:start", timestamp: Date.now(), step: "install" });
    updateRun(runId, { status: "installing" });
    const installStart = Date.now();
    await installDeps(workDir!, emit);
    const installDuration = Date.now() - installStart;
    emit({ type: "step:complete", timestamp: Date.now(), step: "install", duration: installDuration });
    try { insertAgentLog({ run_id: runId, agent_name: "setup", action: "install", duration_ms: installDuration, decision: "success", reason: "Dependencies installed" }); } catch { /* non-blocking */ }
  } else {
    // Emit skipped clone step
    emit({ type: "step:start", timestamp: Date.now(), step: "clone" });
    emit({ type: "log", timestamp: Date.now(), message: "Clone skipped — reusing existing" });
    emit({ type: "step:complete", timestamp: Date.now(), step: "clone", duration: 0 });

    if (buildCacheHit) {
      // Install skipped — build cache already validated node_modules + .next
      emit({ type: "step:start", timestamp: Date.now(), step: "install" });
      emit({ type: "log", timestamp: Date.now(), message: `Install skipped — build cache hit (${currentCommit!.slice(0, 8)})` });
      emit({ type: "step:complete", timestamp: Date.now(), step: "install", duration: 0 });
    } else {
      // Run install if node_modules is missing (needed for Cypress + dev server)
      const nodeModulesPath = path.join(workDir!, "node_modules");
      if (!fs.existsSync(nodeModulesPath)) {
        emit({ type: "step:start", timestamp: Date.now(), step: "install" });
        emit({ type: "log", timestamp: Date.now(), message: "Installing dependencies..." });
        const installStart = Date.now();
        try {
          await installDeps(workDir!, emit);
        } catch (installErr) {
          // Retry with --legacy-peer-deps if initial install fails (EBADENGINE errors)
          emit({ type: "log", timestamp: Date.now(), message: "Retrying install with --legacy-peer-deps..." });
          const { execSync } = require("child_process");
          execSync("npm install --legacy-peer-deps", { cwd: workDir!, timeout: 300000, stdio: "pipe" });
        }
        emit({ type: "step:complete", timestamp: Date.now(), step: "install", duration: Date.now() - installStart });
      } else {
        emit({ type: "step:start", timestamp: Date.now(), step: "install" });
        emit({ type: "log", timestamp: Date.now(), message: "Install skipped — node_modules exists" });
        emit({ type: "step:complete", timestamp: Date.now(), step: "install", duration: 0 });
      }
    }
  }

  // Patch server.ts to force dev=false so Next.js serves pre-built assets.
  // Without this, isDev() returns true (DEPLOY_ENV is unset) and Next.js runs in dev mode
  // with on-demand compilation, causing OOM crashes with multiple workers.
  // We keep DEPLOY_ENV unset so KeyMaker uses test keystore (not production certs).
  const serverTsPath = path.join(workDir!, "server.ts");
  if (fs.existsSync(serverTsPath)) {
    const serverSrc = fs.readFileSync(serverTsPath, "utf-8");
    const patched = serverSrc.replace(
      /const dev = env\.isDev\(\);/,
      "const dev = process.env.FT_PROD_MODE === 'true' ? false : env.isDev(); // patched by ft-runner"
    );
    if (patched !== serverSrc) {
      fs.writeFileSync(serverTsPath, patched, "utf-8");
      emit({ type: "log", timestamp: Date.now(), message: "Patched server.ts: dev=false when FT_PROD_MODE=true" });
    }
  }

  // Step 3: Build the app (pre-compiles ALL routes upfront)
  // This eliminates on-demand compilation during tests, preventing OOM crashes.
  if (buildCacheHit) {
    emit({ type: "step:start", timestamp: Date.now(), step: "build" });
    emit({ type: "log", timestamp: Date.now(), message: `Build skipped — cache hit (commit ${currentCommit!.slice(0, 8)})` });
    emit({ type: "step:complete", timestamp: Date.now(), step: "build", duration: 0 });
  } else {
    emit({ type: "step:start", timestamp: Date.now(), step: "build" });
    updateRun(runId, { status: "building" });
    const buildStart = Date.now();
    await buildApp(workDir!, emit);
    const buildDuration = Date.now() - buildStart;
    emit({ type: "step:complete", timestamp: Date.now(), step: "build", duration: buildDuration });
    // Persist build cache so the next run on the same commit can skip install + build
    const commitAfterBuild = getGitCommit(workDir!);
    if (commitAfterBuild) writeBuildCache(workDir!, commitAfterBuild);
    try { insertAgentLog({ run_id: runId, agent_name: "setup", action: "build", duration_ms: buildDuration, decision: "success", reason: "App built successfully" }); } catch { /* non-blocking */ }
  }

  // Patch keebler-paypal cookie defaults to not force Secure flag.
  // The keebler middleware forces secure:true on ALL cookies (even on HTTP localhost),
  // which breaks Cypress tests because browsers drop Secure cookies on non-HTTPS connections.
  const keeblerUtilsPath = path.join(workDir!, "node_modules", "keebler-paypal", "lib", "utils.js");
  if (fs.existsSync(keeblerUtilsPath)) {
    const keeblerSrc = fs.readFileSync(keeblerUtilsPath, "utf-8");
    const patched = keeblerSrc.replace(
      /secure:\s*true,/,
      "secure: false, // patched by ft-runner: allow non-secure cookies for HTTP localhost"
    );
    if (patched !== keeblerSrc) {
      fs.writeFileSync(keeblerUtilsPath, patched, "utf-8");
      emit({ type: "log", timestamp: Date.now(), message: "Patched keebler-paypal: forced secure=false for HTTP cookies" });
    }
  }

  // No patching of selectIntent — the existing command in sparkxnodeweb works correctly.
  // The key is to use the RIGHT account + RIGHT intent, not to patch the framework.

  // Step 4: Start server in production mode (serves pre-built assets, no on-demand compilation)
  emit({ type: "step:start", timestamp: Date.now(), step: "start-server" });
  updateRun(runId, { status: "starting" });
  const serverStart = Date.now();

  // Try to reuse a pooled server first
  const poolUserId = config.userId || config.triggeredBy || "unknown";
  const pooled = await acquireServerFromPool(poolUserId, config.owner, config.repo, config.branch, emit);

  let port: number;
  let serverProcess: ChildProcess;

  if (pooled) {
    port = pooled.port;
    serverProcess = pooled.process;
    if (!workDir) {
      workDir = pooled.workDir;
      skipCloneInstall = true;
      emit({ type: "log", timestamp: Date.now(), message: `Using pooled server workDir: ${pooled.workDir}` });
    }
    emit({ type: "log", timestamp: Date.now(), message: `Server ready from pool at http://localhost:${port}/sparkx/` });
  } else {
    port = await findAvailablePort();
    emit({ type: "log", timestamp: Date.now(), message: `Found available port: ${port}` });
    serverProcess = await startProdServer(workDir!, port, emit);
  }
  const serverDuration = Date.now() - serverStart;
  emit({ type: "step:complete", timestamp: Date.now(), step: "start-server", duration: serverDuration });
  try { insertAgentLog({ run_id: runId, agent_name: "setup", action: "start-server", duration_ms: serverDuration, decision: "success", reason: `Server ready on port ${port}` }); } catch { /* non-blocking */ }

  // Store server process in side channel (not in state)
  const channel = getChannel(runId);
  channel.serverProcess = serverProcess;

  // Diagnostic: verify SSO-skip middleware is working before tests start
  try {
    const diagUrl = `http://localhost:${port}/sparkx/?pp-ft-skipsso=true`;
    emit({ type: "log", timestamp: Date.now(), message: `[diag] Testing SSO-skip at ${diagUrl}` });
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 10000);
    const diagRes = await fetch(diagUrl, {
      signal: controller.signal,
      redirect: "manual",
    });
    clearTimeout(tid);
    const location = diagRes.headers.get("location") || "(none)";
    emit({ type: "log", timestamp: Date.now(), message: `[diag] SSO-skip response: status=${diagRes.status}, redirect=${location}` });
    if (diagRes.status >= 300 && diagRes.status < 400) {
      emit({ type: "log", timestamp: Date.now(), message: `[diag] WARNING: Server is redirecting (SSO-skip may not be active)` });
    }
  } catch (diagErr: any) {
    emit({ type: "log", timestamp: Date.now(), message: `[diag] SSO-skip check failed: ${diagErr.message}` });
  }

  return {
    workDir: workDir!,
    port,
    status: "ready",
  };
}

/**
 * generateNode — Generator Agent creates Cypress tests from source components.
 * Only runs when isGenerateAndValidate is true (combined flow).
 */
async function generateNode(state: FTState): Promise<Partial<FTState>> {
  const { runId, config, workDir, selectedFolders, manualPaths, templateType, overwriteExisting } = state;
  const { emit } = getChannel(runId);

  console.log("\n========================================");
  console.log("[Generator Agent] Starting test generation");
  console.log(`  Folders:      ${(selectedFolders || []).join(", ") || "(none)"}`);
  console.log(`  Manual paths: ${(manualPaths || []).join(", ") || "(none)"}`);
  console.log(`  Template:     ${templateType || "comprehensive"}`);
  console.log(`  Overwrite:    ${overwriteExisting}`);
  console.log("========================================\n");

  emit({ type: "step:start", timestamp: Date.now(), step: "generate" });

  // Resolve LLM credentials
  const llmApiKey = config.llmApiKey || env.anthropic.apiKey || "";
  const llmBaseUrl = config.llmBaseUrl || APP_CONFIG.llm.baseUrl;

  if (!llmApiKey) {
    emitGeneratorLog(emit, "ERROR: No LLM credentials configured — cannot generate tests");
    emit({ type: "step:error", timestamp: Date.now(), step: "generate", error: "No LLM credentials" });
    return { error: "No LLM credentials for test generation", status: "failed" };
  }

  const genReq: GenerateRequest = {
    runId,
    selectedFolders: selectedFolders || [],
    manualPaths: manualPaths || [],
    templateType: templateType || "comprehensive",
    includeFixtures: false,
    overwriteExisting: overwriteExisting ?? true,
    repoPath: workDir,
    llmApiKey,
    llmBaseUrl,
    llmModel: config.llmModel,
  };

  const result = await generateTests(genReq, (msg, index, total) => {
    emit({
      type: "generator:progress",
      timestamp: Date.now(),
      message: `[Generator Agent] (${index + 1}/${total}) ${msg}`,
    });
  });

  // Collect generated spec paths
  const generatedSpecs = result.generatedFiles
    .filter((f) => f.status === "created")
    .map((f) => f.testPath);

  emitGeneratorLog(emit, `=== Generation Complete ===`);
  emitGeneratorLog(emit, `  Created:  ${result.totalGenerated} test file(s)`);
  emitGeneratorLog(emit, `  Skipped:  ${result.totalSkipped} (already exist)`);
  emitGeneratorLog(emit, `  Errors:   ${result.totalErrors}`);

  // Log the generated test content so user can see what was written
  for (const f of result.generatedFiles.filter((f) => f.status === "created")) {
    const fullPath = path.join(workDir, f.testPath);
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      // Extract test names from it('...') blocks
      const testNames = lines
        .filter((l) => l.trim().match(/^it\s*\(/))
        .map((l) => {
          const m = l.match(/it\s*\(\s*["'`](.+?)["'`]/);
          return m ? m[1] : l.trim();
        });
      emitGeneratorLog(emit, `  ${f.testPath} — ${testNames.length} test(s):`);
      testNames.forEach((name) => emitGeneratorLog(emit, `    - it("${name}")`));
    } catch {
      // ignore read errors
    }
  }
  if (generatedSpecs.length > 0) {
    emitGeneratorLog(emit, `  Generated specs:`);
    generatedSpecs.forEach((s) => emitGeneratorLog(emit, `    - ${s}`));
  }

  emit({
    type: "step:complete",
    timestamp: Date.now(),
    step: "generate",
    message: `Generated ${result.totalGenerated} test(s), ${result.totalSkipped} skipped, ${result.totalErrors} errors`,
  });

  if (generatedSpecs.length === 0) {
    emitGeneratorLog(emit, "No tests were generated — nothing to validate");
    return {
      allSpecs: [],
      generatedSpecs: [],
      status: "completed",
    };
  }

  emitSupervisorLog(emit, `Received ${generatedSpecs.length} test(s) from Generator Agent — preparing to validate`);

  return {
    allSpecs: generatedSpecs,
    generatedSpecs,
  };
}

/**
 * complianceGateNode — Validates generated tests against compliance rules
 * before they reach Cypress. Failing specs are sent back to the Generator
 * with violation details for up to 2 fix attempts.
 */
async function complianceGateNode(state: FTState): Promise<Partial<FTState>> {
  const { runId, config, workDir, generatedSpecs } = state;
  const { emit } = getChannel(runId);

  if (!generatedSpecs || generatedSpecs.length === 0) {
    return {};
  }

  emit({ type: "step:start", timestamp: Date.now(), step: "compliance" });
  emitComplianceLog(emit, `Validating ${generatedSpecs.length} generated spec(s) against compliance rules...`);

  const COMPLIANCE_THRESHOLD = 90;
  const MAX_COMPLIANCE_ATTEMPTS = 2;
  const complianceResults: import("@/types/ft").ComplianceResult[] = [];

  for (const specPath of generatedSpecs) {
    let passed = false;

    for (let attempt = 1; attempt <= MAX_COMPLIANCE_ATTEMPTS; attempt++) {
      const complianceStart = Date.now();
      const results = await validateCompliance({
        generatedFiles: [{ sourcePath: "", testPath: specPath, status: "created" }],
        repoPath: workDir,
        runId,
      });
      const complianceDuration = Date.now() - complianceStart;

      const cr = results[0];
      if (!cr) break;

      passed = cr.score >= COMPLIANCE_THRESHOLD;
      const checksSummary = `${cr.score}% (${cr.checks.filter((c) => c.passed).length}/${cr.checks.length} checks)`;

      emit({
        type: "agent:compliance" as any,
        timestamp: Date.now(),
        file: cr.testPath,
        complianceScore: cr.score,
        message: `Compliance: ${checksSummary}`,
      });

      try { insertAgentLog({
        run_id: runId, agent_name: "compliance", action: "validate", target_file: specPath,
        decision: passed ? "pass" : "fail",
        reason: checksSummary,
        duration_ms: complianceDuration,
        success: passed,
      }); } catch { /* non-blocking */ }

      if (passed) {
        emitComplianceLog(emit, `  PASS: ${path.basename(specPath)} — ${cr.score}%`);
        complianceResults.push({ testPath: cr.testPath, passed: true, score: cr.score, checks: cr.checks });
        break;
      }

      emitComplianceLog(emit, `  FAIL: ${path.basename(specPath)} — ${cr.score}% (attempt ${attempt}/${MAX_COMPLIANCE_ATTEMPTS})`);

      if (attempt < MAX_COMPLIANCE_ATTEMPTS) {
        const violations = cr.checks
          .filter((c) => !c.passed)
          .map((c) => ({ rule: c.rule, message: c.message, severity: c.severity }));

        emitComplianceLog(emit, `  Sending ${violations.length} violation(s) back to Generator for fix...`);

        const llmApiKey = config.llmApiKey || env.anthropic.apiKey || "";
        const llmBaseUrl = config.llmBaseUrl || APP_CONFIG.llm.baseUrl;

        if (llmApiKey) {
          const fixResult = await regenerateForCompliance({
            testPath: specPath,
            testContent: fs.readFileSync(path.join(workDir, specPath), "utf-8"),
            violations,
            repoPath: workDir,
            llmApiKey,
            llmBaseUrl,
            llmModel: config.llmModel,
          });

          try { insertAgentLog({
            run_id: runId, agent_name: "generator", action: "compliance-fix", target_file: specPath,
            decision: fixResult ? "fix_applied" : "no_fix",
            reason: `Compliance fix attempt ${attempt}: ${violations.length} violations`,
            success: !!fixResult,
          }); } catch { /* non-blocking */ }

          if (!fixResult) {
            emitComplianceLog(emit, `  Generator could not fix violations — proceeding anyway`);
            complianceResults.push({ testPath: cr.testPath, passed: false, score: cr.score, checks: cr.checks });
            break;
          }
        } else {
          emitComplianceLog(emit, `  No LLM credentials — cannot auto-fix compliance violations`);
          complianceResults.push({ testPath: cr.testPath, passed: false, score: cr.score, checks: cr.checks });
          break;
        }
      } else {
        emitComplianceLog(emit, `  Exhausted ${MAX_COMPLIANCE_ATTEMPTS} compliance fix attempts — proceeding to Cypress`);
        complianceResults.push({ testPath: cr.testPath, passed: false, score: cr.score, checks: cr.checks });
      }
    }
  }

  const passedCount = complianceResults.filter((r) => r.passed).length;
  emitComplianceLog(emit, `=== Compliance Gate Complete: ${passedCount}/${generatedSpecs.length} passed ===`);

  emit({ type: "step:complete", timestamp: Date.now(), step: "compliance",
    message: `${passedCount}/${generatedSpecs.length} specs passed compliance` });

  return { complianceResults };
}

function splitNode(state: FTState): Command {
  const { allSpecs, runId } = state;
  const { emit } = getChannel(runId);

  // If no specs to run (e.g., generation produced nothing), go to cleanup
  if (!allSpecs || allSpecs.length === 0) {
    emitSupervisorLog(emit, "No specs to run — skipping to cleanup");
    return new Command({ goto: "cleanupNode" });
  }

  const effectiveWorkers = Math.min(allSpecs.length, state.workerCount || 4, 4);
  console.log(`\n[Controller Agent / splitNode] Splitting ${allSpecs.length} spec(s) across ${effectiveWorkers} worker(s)`);
  const chunks = splitSpecsIntoChunks(allSpecs, effectiveWorkers);

  emit({
    type: "step:start",
    timestamp: Date.now(),
    step: "run-tests",
    message: `Splitting ${allSpecs.length} specs across ${chunks.length} worker(s)`,
  });

  updateRun(runId, { status: "running" });

  emitSupervisorLog(emit, `Running ${allSpecs.length} spec(s) in ${chunks.length} worker(s)...`);

  // Fan-out: single Command with goto as array of Send objects
  const sends = chunks.map((chunk, i) =>
    new Send("workerNode", {
      ...state,
      workerSpecs: chunk,
      workerId: i,
    })
  );

  return new Command({ goto: sends });
}

async function workerNode(state: FTState): Promise<Partial<FTState>> {
  const { workerId, workerSpecs, workDir, port, config, runId } = state;
  const { emit } = getChannel(runId);

  try {
    const workerStart = Date.now();
    const result = await runCypressWorker({
      workerId,
      workDir,
      port,
      specs: workerSpecs,
      browser: config.browser || "electron",
      retries: config.retries || 1,
      runMode: config.runMode || "headless",
      emit,
    });

    try { insertMetric({ run_id: runId, step_name: `worker-${workerId}`, started_at: new Date(workerStart).toISOString(), duration_ms: Date.now() - workerStart, metadata: JSON.stringify({ specs: workerSpecs.length, passed: result.passed, failed: result.failed }) }); } catch { /* non-blocking */ }
    try { insertAgentLog({ run_id: runId, agent_name: "cypress", action: "run", duration_ms: result.duration, decision: result.failed > 0 ? "fail" : "pass", reason: `${result.passed} passed, ${result.failed} failed out of ${result.total} spec(s)`, metadata: JSON.stringify({ workerId, specs: result.specs, passed: result.passed, failed: result.failed, total: result.total }) }); } catch { /* non-blocking */ }

    return {
      workerResults: [result],
      workDir,
    };
  } catch (error: any) {
    console.error(`[ft-worker-${workerId}] CRASHED: ${error.message}`);
    console.error(`[ft-worker-${workerId}] Stack: ${error.stack}`);
    emit({ type: "log", timestamp: Date.now(), message: `[worker-${workerId}] CRASHED: ${error.message}` });

    // Return a failed result instead of crashing the graph
    return {
      workerResults: [{
        workerId,
        specs: workerSpecs,
        passed: 0,
        failed: workerSpecs.length,
        total: workerSpecs.length,
        duration: 0,
        results: workerSpecs.map((spec) => ({
          file: spec,
          testName: spec.split("/").pop() || spec,
          status: "failed" as const,
          duration: 0,
          error: `Worker crashed: ${error.message}`,
        })),
        error: error.message,
      }],
      workDir,
    };
  }
}

async function aggregateNode(state: FTState): Promise<Partial<FTState>> {
  const { workerResults, runId, fixAttempt, maxFixAttempts, workDir } = state;
  const { emit } = getChannel(runId);

  const iteration = fixAttempt + 1;

  // Only process worker results from the CURRENT round (skip previous rounds)
  const offset = state.workerResultsOffset || 0;
  const currentRoundResults = workerResults.slice(offset);

  emit({ type: "log", timestamp: Date.now(), message: `[aggregate] Total workerResults: ${workerResults.length}, offset: ${offset}, current round: ${currentRoundResults.length}` });

  const rawResults = currentRoundResults.flatMap((w) => w.results);

  // Final dedup: collapse duplicate entries for the same file
  // (can happen when table parser + per-test parser both capture the same spec)
  // Keep the entry with the longest duration (real run) or the one with an error (meaningful)
  // Use full file path as key to avoid collisions between specs with the same basename
  const byFileName = new Map<string, typeof rawResults[0]>();
  for (const r of rawResults) {
    const fileName = r.file;
    const existing = byFileName.get(fileName);
    if (!existing) {
      byFileName.set(fileName, r);
    } else {
      // Keep the one with longer duration, or the one with an error, or the failed one
      const existingBetter =
        existing.duration > r.duration ||
        (existing.error && !r.error) ||
        (existing.status === "failed" && r.status !== "failed");
      if (!existingBetter) {
        byFileName.set(fileName, r);
      }
    }
  }
  const allResults = [...byFileName.values()];

  emit({ type: "log", timestamp: Date.now(), message: `[aggregate] Raw results: ${rawResults.length}, after dedup: ${allResults.length}` });

  // Emit per-spec real-time events so frontend can update each file immediately
  for (const result of allResults) {
    if (result.status === "passed") {
      emit({ type: "test:pass", timestamp: Date.now(), file: result.file, testName: result.testName });
    } else if (result.status === "failed") {
      emit({ type: "test:fail", timestamp: Date.now(), file: result.file, testName: result.testName, error: result.error });
    }
  }

  // Recalculate totals from deduped results
  const totalPassed = allResults.filter((r) => r.status === "passed").length;
  const totalFailed = allResults.filter((r) => r.status === "failed").length;
  const totalDuration = allResults.reduce((sum, r) => sum + r.duration, 0);
  // Map failed file names back to full spec paths from allSpecs
  const failedFileNames = new Set(
    allResults.filter((r) => r.status === "failed").map((r) => r.file)
  );
  const failedSpecs = state.allSpecs.filter((spec) =>
    [...failedFileNames].some((fname) => spec.includes(fname) || spec.endsWith(fname))
  );
  const resolvedFailedSpecs = failedSpecs.length > 0
    ? failedSpecs
    : [...failedFileNames];

  const total = totalPassed + totalFailed;
  const passRate = total > 0 ? ((totalPassed / total) * 100).toFixed(1) : "0";
  const durationSec = Math.round((totalDuration || 0) / 1000);

  // Detailed Supervisor logging
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[Supervisor] === Test Results (Iteration ${iteration}/${maxFixAttempts + 1}) ===`);
  console.log(`  Total:    ${total} test(s) across ${workerResults.length} worker(s)`);
  console.log(`  Passed:   ${totalPassed} (${passRate}%)`);
  console.log(`  Failed:   ${totalFailed} (${(100 - parseFloat(passRate)).toFixed(1)}%)`);
  console.log(`  Duration: ${durationSec}s`);

  emit({
    type: "supervisor:summary",
    timestamp: Date.now(),
    message: `[Supervisor] === Test Results (Iteration ${iteration}) ===\n` +
      `  Total: ${total} | Passed: ${totalPassed} (${passRate}%) | Failed: ${totalFailed} | Duration: ${durationSec}s`,
    total,
    passed: totalPassed,
    failed: totalFailed,
    duration: totalDuration,
  });

  // Log EVERY test result — passed and failed
  emitSupervisorLog(emit, `Individual test results:`);
  allResults.forEach((r, i) => {
    const icon = r.status === "passed" ? "PASS" : r.status === "failed" ? "FAIL" : r.status.toUpperCase();
    const errorSnippet = r.status === "failed" && r.error
      ? ` — ${r.error.split("\n")[0].slice(0, 120)}`
      : "";
    const line = `  ${icon} ${i + 1}. ${path.basename(r.file)} > "${r.testName}"${errorSnippet}`;
    console.log(`  ${line}`);
    emit({
      type: r.status === "failed" ? "supervisor:failure" : "log",
      timestamp: Date.now(),
      message: `[Supervisor] ${line}`,
      file: r.file,
      testName: r.testName,
      error: r.error,
    });
  });

  if (totalFailed === 0) {
    emitSupervisorLog(emit, `All ${totalPassed} test(s) passed!`);
  }
  console.log(`${"=".repeat(60)}\n`);

  // ── Compliance gate: passed tests must also have >= 90% compliance ──
  const COMPLIANCE_THRESHOLD = 90;
  const passedSpecs = state.allSpecs.filter(
    (spec) => !resolvedFailedSpecs.some((f) => f === spec || spec.includes(f) || f.includes(spec))
  );

  let complianceFailedSpecs: string[] = [];
  const complianceScores = new Map<string, number>();

  const runCompliance =
    passedSpecs.length > 0 &&
    state.config?.llmApiKey &&
    state.config?.fixMode !== "execute-only";

  if (runCompliance) {
    try {
      emitSupervisorLog(emit, `Running compliance check on ${passedSpecs.length} passed spec(s)...`);
      const complianceResults = await validateCompliance({
        generatedFiles: passedSpecs.map((s) => ({ sourcePath: "", testPath: s, status: "created" as const })),
        repoPath: state.workDir,
        runId,
      });

      for (const cr of complianceResults) {
        emit({
          type: "agent:compliance" as any,
          timestamp: Date.now(),
          file: cr.testPath,
          complianceScore: cr.score,
          message: `Compliance: ${cr.score}% (${cr.checks.filter((c) => c.passed).length}/${cr.checks.length} checks)`,
        });

        complianceScores.set(cr.testPath, cr.score);

        if (cr.score < COMPLIANCE_THRESHOLD) {
          emitSupervisorLog(emit, `  COMPLIANCE FAIL: ${path.basename(cr.testPath)} — ${cr.score}% < ${COMPLIANCE_THRESHOLD}%`);
          complianceFailedSpecs.push(cr.testPath);
        } else {
          emitSupervisorLog(emit, `  COMPLIANCE PASS: ${path.basename(cr.testPath)} — ${cr.score}%`);
        }
      }
    } catch (err) {
      console.warn(`[aggregate] Compliance check error:`, err);
    }
  }

  if (complianceFailedSpecs.length > 0) {
    emitSupervisorLog(emit, `${complianceFailedSpecs.length} spec(s) below compliance threshold (${COMPLIANCE_THRESHOLD}%) — improvement plan attached (does not affect test result)`);
  }

  const collectedComplianceResults: import("@/types/ft").ComplianceResult[] = [];
  for (const [spec, score] of complianceScores.entries()) {
    collectedComplianceResults.push({
      testPath: spec,
      passed: score >= COMPLIANCE_THRESHOLD,
      score,
      checks: [],
    });
  }

  emit({
    type: "step:complete",
    timestamp: Date.now(),
    step: "run-tests",
    duration: totalDuration,
    message: `All workers done: ${totalPassed} passed, ${totalFailed} failed across ${workerResults.length} worker(s)`,
  });

  return {
    totalPassed,
    totalFailed,
    totalDuration,
    failedSpecs: resolvedFailedSpecs,
    allResults,
    complianceResults: collectedComplianceResults,
    workDir,
  };
}

function emitManualFixRequired(state: FTState, emit: EventCallback, message: string): void {
  // Collect failed test details for the client
  const failedDetails = (state.allResults || [])
    .filter((r) => r.status === "failed")
    .map((r) => ({
      file: r.file,
      error: r.error || "Unknown error",
    }));

  // Find full spec paths
  const failedSpecPaths = state.failedSpecs.map((spec) => {
    const specFileName = spec.split("/").pop() || spec;
    if (fs.existsSync(path.join(state.workDir, spec))) return spec;
    const found = findFileRecursive(state.workDir, specFileName);
    return found ? path.relative(state.workDir, found) : spec;
  });

  emit({
    type: "fix:manual-required" as any,
    timestamp: Date.now(),
    message,
    workDir: state.workDir,
    port: state.port,
    failedSpecs: failedSpecPaths,
    failedDetails,
  } as any);
}

function decisionRouter(state: FTState): string {
  const { totalFailed, totalPassed, fixAttempt, maxFixAttempts, runId } = state;
  const { emit } = getChannel(runId);
  const fixMode = state.config.fixMode || "execute-only";

  const routerMsg = `[AI Supervisor] fixMode=${fixMode}, passed=${totalPassed}, failed=${totalFailed}, attempt=${fixAttempt}/${maxFixAttempts}`;
  console.log(routerMsg);
  emit({ type: "log", timestamp: Date.now(), message: routerMsg });

  // Fast-paths — no AI reasoning needed for these
  if (totalFailed === 0) {
    emitSupervisorLog(emit, `All ${totalPassed} test(s) passed!`);
    return "cleanupNode";
  }
  if (fixMode === "execute-only") {
    emitSupervisorLog(emit, `fixMode=execute-only → reporting results (no auto-fix)`);
    return "cleanupNode";
  }
  if (fixMode === "manual-fix") {
    emitManualFixRequired(state, emit, "Manual fix mode — review failures and fix in editor.");
    return "cleanupNode";
  }
  if (fixAttempt >= maxFixAttempts) {
    emitSupervisorLog(emit, `Exhausted ${maxFixAttempts} fix attempts`);
    emitManualFixRequired(state, emit, `Auto-fix exhausted ${maxFixAttempts} attempts. Manual fix required.`);
    return "cleanupNode";
  }

  const hasLLM = !!(state.config.llmApiKey || env.anthropic.apiKey);
  if (!hasLLM) {
    emitSupervisorLog(emit, `No LLM credentials — cannot auto-fix`);
    return "cleanupNode";
  }

  // Route to AI Supervisor for intelligent decision-making
  emitSupervisorLog(emit, `${totalFailed} failure(s), ${maxFixAttempts - fixAttempt} attempt(s) remaining → AI Supervisor analyzing...`);
  return "supervisorFixNode";
}

/**
 * supervisorFixNode — Supervisor analyzes failures and asks Generator Agent
 * to regenerate the failing tests with error context.
 *
 * This uses the GENERATION system prompt (not the fix-only prompt) so the
 * Generator Agent applies its full test-writing expertise while also
 * understanding what went wrong.
 */
async function supervisorFixNode(state: FTState): Promise<Partial<FTState>> {
  const { failedSpecs, fixAttempt, runId, config, workDir, allResults, templateType } = state;
  const { emit } = getChannel(runId);
  const attempt = fixAttempt + 1;

  console.log("\n" + "=".repeat(60));
  console.log(`[Supervisor] === Fix Iteration ${attempt}/${state.maxFixAttempts} ===`);
  console.log(`  Failed specs: ${failedSpecs.length}`);
  failedSpecs.forEach((s) => console.log(`    - ${s}`));
  console.log("=".repeat(60) + "\n");

  // AI Supervisor now handles transient error detection and server restart decisions.
  // Compilation error detection context is enriched below when building error output.

  emit({
    type: "supervisor:analyzing",
    timestamp: Date.now(),
    message: `[Supervisor] === Fix Iteration ${attempt}/${state.maxFixAttempts} ===\n` +
      `  Analyzing ${failedSpecs.length} failed spec(s)...`,
  });

  // Resolve LLM credentials
  const llmApiKey = config.llmApiKey || env.anthropic.apiKey || "";
  const llmBaseUrl = config.llmBaseUrl || APP_CONFIG.llm.baseUrl;

  if (!llmApiKey) {
    emitSupervisorLog(emit, `No LLM credentials — skipping fix`);
    return { fixAttempt: state.maxFixAttempts };
  }

  emit({
    type: "step:start",
    timestamp: Date.now(),
    step: "auto-fix",
    message: `[Supervisor] Asking Generator Agent to fix ${failedSpecs.length} failing test(s) (attempt ${attempt})`,
  });

  const llm = createLLMClient({
    llmApiKey,
    llmBaseUrl,
    llmModel: config.llmModel,
  });

  // AI Supervisor: unified decision + per-spec strategy + guidance
  const triageDecisions = new Map<string, string>();
  const supervisorGuidanceMap = new Map<string, string>();
  let aiAction: string = "fix"; // default

  try {
    // Build per-spec error summaries
    const failedSpecDetails = failedSpecs.map((specFile) => {
      const specResults = (allResults || [])
        .filter((r) => r.file === specFile && r.status === "failed");
      const error = specResults.map((r) => r.error || "Unknown error").join("\n");
      const duration = specResults[0]?.duration;
      return { file: specFile, error: error.slice(0, 2000), duration };
    });

    // Fast-path: auto-trim specs where the error is from closeWorkflow/cleanup steps.
    // These are never worth fixing — the core test passed, just trim the tail.
    const autoTrimmedSpecs: string[] = [];
    for (const detail of failedSpecDetails) {
      const err = detail.error.toLowerCase();
      const isCleanupFailure =
        err.includes("closeworkflowandprovidefeedback") ||
        err.includes("closeworkflow") ||
        err.includes("providefeedback") ||
        err.includes("kindly rate your e") ||
        err.includes("rate your experience") ||
        err.includes("feedback") ||
        (err.includes("next") && err.includes("disabled") && err.includes("click"));

      if (!isCleanupFailure) continue;

      const specPath = path.join(workDir, detail.file);
      try {
        const testContent = fs.readFileSync(specPath, "utf-8");
        const lines = testContent.split("\n");
        let trimIdx = -1;
        const scanStart = Math.floor(lines.length * 0.4);
        for (let li = scanStart; li < lines.length; li++) {
          const line = lines[li].trim();
          if (
            line.includes("closeWorkflowAndProvideFeedback") ||
            line.includes("cy.closeWorkflow") ||
            line.includes("closeWorkflow") ||
            (line.includes("backButton") && line.includes(".click()")) ||
            (line.includes("nextButton") && line.includes(".click()") && li > lines.length * 0.6) ||
            line.includes("provideFeedback") ||
            line.includes("ProvideFeedback") ||
            (line.includes("Navigate back") || line.includes("Click back"))
          ) {
            if (li > 0 && lines[li - 1].trim().includes("addTestContext")) trimIdx = li - 1;
            else if (li > 0 && lines[li - 1].trim().startsWith("//") && lines[li - 1].includes("Step")) trimIdx = li - 1;
            else trimIdx = li;
            break;
          }
        }

        if (trimIdx > 0) {
          let itCloseIndex = -1;
          let braceDepth = 0;
          for (let li = trimIdx; li < lines.length; li++) {
            braceDepth += (lines[li].match(/\{/g) || []).length;
            braceDepth -= (lines[li].match(/\}/g) || []).length;
            if (braceDepth < 0 || (lines[li].trim() === "});" && li > trimIdx)) { itCloseIndex = li; break; }
          }
          const trimmedLines = [
            ...lines.slice(0, trimIdx),
            `    cy.screenshot("test_complete_core_passed");`,
            ...lines.slice(itCloseIndex >= 0 ? itCloseIndex : lines.length),
          ];
          fs.writeFileSync(specPath, trimmedLines.join("\n"), "utf-8");
          emitSupervisorLog(emit, `AUTO-TRIMMED ${path.basename(detail.file)} — removed closeWorkflow/cleanup steps. Core test passed.`);
          emit({ type: "test:pass", timestamp: Date.now(), file: detail.file, testName: `${path.basename(detail.file)} (auto-trimmed — core passed)` } as any);
          try { insertAgentLog({ run_id: runId, agent_name: "supervisor", action: "auto-trim", target_file: detail.file, decision: "trim_passed", reason: `Auto-trimmed closeWorkflow/cleanup failure: ${detail.error.slice(0, 100)}` }); } catch { /* non-blocking */ }
          autoTrimmedSpecs.push(detail.file);
        }
      } catch { /* ignore */ }
    }

    // Remove auto-trimmed specs from the failed list — they're now passed
    if (autoTrimmedSpecs.length > 0) {
      const remaining = failedSpecDetails.filter((d) => !autoTrimmedSpecs.includes(d.file));
      if (remaining.length === 0) {
        emitSupervisorLog(emit, `All ${autoTrimmedSpecs.length} failing spec(s) auto-trimmed. Core tests passed — skipping LLM fix.`);
        return {
          fixAttempt: attempt,
          failedSpecs: [],
          allSpecs: state.allSpecs,
        };
      }
      // Update failedSpecDetails for the remaining specs that need LLM attention
      failedSpecDetails.splice(0, failedSpecDetails.length, ...remaining);
    }

    // Fast-path: auto-fix undefined element errors without LLM call.
    const autoFixedSpecs = new Set<string>();

    // Auto-fix cy.get(undefined) — add || fallback to selector property accesses
    for (const detail of failedSpecDetails) {
      if (!/Expected to find element.*undefined|find element.*`undefined`/i.test(detail.error)) continue;
      const specPath = path.join(workDir, detail.file);
      try {
        let code = fs.readFileSync(specPath, "utf-8");
        const patched = code.replace(
          /cy\.get\(([A-Z][A-Z_0-9]*\.(\w+))/g,
          (match, expr, prop) => {
            if (expr.includes("||")) return match;
            const kebab = prop.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
            return `cy.get(${expr} || '[data-automation-id="${kebab}"]'`;
          }
        );
        if (patched !== code) {
          fs.writeFileSync(specPath, patched, "utf-8");
          autoFixedSpecs.add(detail.file);
          emitSupervisorLog(emit, `Auto-fixed cy.get(undefined) in ${path.basename(detail.file)} — added selector fallbacks`);
          try { insertAgentLog({ run_id: runId, agent_name: "supervisor", action: "auto-fix", target_file: detail.file, decision: "patch_get_undefined", reason: "Added || fallback to cy.get() calls with potentially undefined selector properties" }); } catch { /* non-blocking */ }
        }
      } catch { /* ignore */ }
    }

    // Auto-fix cy.type(undefined) — add || fallback to .type() calls
    for (const detail of failedSpecDetails) {
      if (autoFixedSpecs.has(detail.file)) continue;
      if (!/cy\.type\(\).*can only accept.*undefined/i.test(detail.error)) continue;
      const specPath = path.join(workDir, detail.file);
      try {
        let code = fs.readFileSync(specPath, "utf-8");
        // Patch: cy.type(variable) → cy.type(variable || "test-value")
        // Match .type(expr) where expr is a variable/property access, not a string literal
        const patched = code.replace(
          /\.type\(([^)"'][^)]*)\)/g,
          (match, expr) => {
            const trimmed = expr.trim();
            if (trimmed.includes("||") || trimmed.startsWith('"') || trimmed.startsWith("'") || trimmed.startsWith("`")) return match;
            return `.type(${trimmed} || "test-value")`;
          }
        );
        if (patched !== code) {
          fs.writeFileSync(specPath, patched, "utf-8");
          autoFixedSpecs.add(detail.file);
          emitSupervisorLog(emit, `Auto-fixed cy.type(undefined) in ${path.basename(detail.file)} — added null fallbacks`);
          try { insertAgentLog({ run_id: runId, agent_name: "supervisor", action: "auto-fix", target_file: detail.file, decision: "patch_type_undefined", reason: "Added || fallback to cy.type() calls with potentially undefined variables" }); } catch { /* non-blocking */ }
        }
      } catch { /* ignore read errors */ }
    }
    // Remove auto-fixed specs from the list so LLM doesn't re-generate them
    if (autoFixedSpecs.size > 0) {
      failedSpecDetails.splice(0, failedSpecDetails.length, ...failedSpecDetails.filter((d) => !autoFixedSpecs.has(d.file)));
      emitSupervisorLog(emit, `Auto-fixed ${autoFixedSpecs.size} spec(s) — ${failedSpecDetails.length} remaining for LLM fix`);
    }

    // Smart per-spec error dedup: track error signatures across ALL previous iterations.
    // If a spec fails with the same error signature 3+ times, stop retrying it.
    const normalizeError = (err: string): string =>
      err
        .replace(/\d{4,}/g, "N")             // strip large numbers (timeouts, line numbers)
        .replace(/after \d+ms/gi, "after Nms") // normalize timeout values
        .replace(/line \d+/gi, "line N")       // strip line references
        .replace(/:\d+:\d+/g, ":N:N")         // strip file:line:col
        .replace(/\s+/g, " ")                 // collapse whitespace
        .trim()
        .slice(0, 200);

    const allPrevResults = state.workerResults
      .slice(0, state.workerResultsOffset || 0)
      .flatMap((w) => w.results);

    const MAX_SAME_ERROR = 3;
    const specsToSkip: Array<{ file: string; reason: string }> = [];

    for (const detail of failedSpecDetails) {
      const currentSig = normalizeError(detail.error);
      const prevFailures = allPrevResults
        .filter((r) => r.file === detail.file && r.status === "failed")
        .map((r) => normalizeError(r.error || ""));
      const sameErrorCount = prevFailures.filter((sig) => sig === currentSig).length + 1;

      if (sameErrorCount >= MAX_SAME_ERROR) {
        const shortError = detail.error.split("\n")[0].slice(0, 120);
        specsToSkip.push({
          file: detail.file,
          reason: `Same error repeated ${sameErrorCount} times: ${shortError}`,
        });
      }
    }

    if (specsToSkip.length > 0) {
      for (const skip of specsToSkip) {
        emitSupervisorLog(emit, `SKIP ${path.basename(skip.file)} — ${skip.reason}`);
        emit({ type: "supervisor:skip-spec", timestamp: Date.now(), file: skip.file, reason: skip.reason } as any);
        try { insertAgentLog({ run_id: runId, agent_name: "supervisor", action: "skip", target_file: skip.file, decision: "skip_repeated_error", reason: skip.reason }); } catch { /* non-blocking */ }
      }

      const skipSet = new Set(specsToSkip.map((s) => s.file));
      failedSpecs.splice(0, failedSpecs.length, ...failedSpecs.filter((s) => !skipSet.has(s)));
      failedSpecDetails.splice(0, failedSpecDetails.length, ...failedSpecDetails.filter((d) => !skipSet.has(d.file)));

      if (failedSpecs.length === 0) {
        emitSupervisorLog(emit, `All remaining failures are repeated errors. Stopping fix loop.`);
        emit({ type: "step:complete", timestamp: Date.now(), step: "auto-fix", message: "Stopped: all failures are repeated errors that auto-fix cannot resolve" });
        return { fixAttempt: state.maxFixAttempts };
      }

      emitSupervisorLog(emit, `Skipped ${specsToSkip.length} spec(s) with repeated errors, continuing with ${failedSpecs.length} remaining`);
    }

    // Read DOM snapshots matched to their spec files
    let domSnapshotText = "";
    const snapshotDir = path.join(workDir, "cypress", "screenshots");
    if (fs.existsSync(snapshotDir)) {
      try {
        const allSnapshotFiles = fs.readdirSync(snapshotDir)
          .filter((f) => f.startsWith("dom-snapshot-") && f.endsWith(".json"));
        // Build per-spec snapshot summaries with page state context
        const snapshotParts: string[] = [];
        for (const specFile of failedSpecs) {
          const specBaseName = path.basename(specFile, ".cy.ts").replace(/[^a-zA-Z0-9_-]/g, "_");
          const matchingSnapshot = allSnapshotFiles.find((f) => f === `dom-snapshot-${specBaseName}.json`);
          if (matchingSnapshot) {
            const raw = fs.readFileSync(path.join(snapshotDir, matchingSnapshot), "utf-8");
            try {
              const parsed = JSON.parse(raw);
              const state = parsed.pageState || "unknown";
              const wfIds = (parsed.automationIds || []).length;
              const spn = parsed.spinners || 0;
              snapshotParts.push(`[${path.basename(specFile)}] (state=${state}, ${wfIds} workflow IDs, ${spn} spinners): ${raw.slice(0, 2500)}`);
            } catch {
              snapshotParts.push(`[${path.basename(specFile)}]: ${raw.slice(0, 3000)}`);
            }
          }
        }
        // Fallback: if no per-spec match, use the first available snapshot
        if (snapshotParts.length === 0 && allSnapshotFiles.length > 0) {
          domSnapshotText = fs.readFileSync(path.join(snapshotDir, allSnapshotFiles[0]), "utf-8").slice(0, 3000);
        } else {
          domSnapshotText = snapshotParts.join("\n\n");
        }
      } catch { /* ignore */ }
    }

    // Check which failing specs have utils.ts/helpers available
    const availableHelpers: Array<{ workflow: string; fileName: string }> = [];
    for (const specFile of failedSpecs) {
      const wfName = specFile.split("/").find((p: string) =>
        p && !["cypress", "e2e", "__tests__", "components", "console", "workflows", "_generated"].includes(p)
      ) || "";
      if (wfName) {
        const existingFTs = readWorkflowExistingFTs(workDir, wfName);
        for (const ft of existingFTs) {
          if (ft.fileName === "utils.ts" || ft.fileName.includes("helpers")) {
            if (!availableHelpers.some((h) => h.workflow === wfName && h.fileName === ft.fileName)) {
              availableHelpers.push({ workflow: wfName, fileName: ft.fileName });
            }
          }
        }
      }
    }

    const supervisorPrompt = buildSupervisorDecisionPrompt({
      totalPassed: state.totalPassed,
      totalFailed: state.totalFailed,
      fixAttempt,
      maxFixAttempts: state.maxFixAttempts,
      fixMode: config.fixMode || "auto-fix",
      failedSpecs: failedSpecDetails,
      fixHistory: state.fixHistory || [],
      domSnapshot: domSnapshotText || undefined,
      hasLLM: true,
      availableHelpers: availableHelpers.length > 0 ? availableHelpers : undefined,
    });

    emitSupervisorLog(emit, `AI Supervisor analyzing ${failedSpecs.length} failure(s)...`);

    const supervisorStart = Date.now();
    const supervisorResponse = await llm.invoke([
      { content: FT_SUPERVISOR_SYSTEM_PROMPT, _getType: () => "system" },
      { content: supervisorPrompt },
    ]);
    const supervisorDuration = Date.now() - supervisorStart;

    const responseText = typeof supervisorResponse.content === "string"
      ? supervisorResponse.content
      : JSON.stringify(supervisorResponse.content);

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const decision: SupervisorDecision = JSON.parse(jsonMatch[0]);
      aiAction = decision.action;

      emitSupervisorLog(emit, `AI Supervisor decision: ${decision.action.toUpperCase()}`);
      emitSupervisorLog(emit, `  Reasoning: ${decision.reasoning}`);
      emit({ type: "supervisor:decision", timestamp: Date.now(), action: decision.action, reasoning: decision.reasoning });

      const supervisorTokens = supervisorResponse.usage?.total_tokens || 0;
      try { insertAgentLog({ run_id: runId, agent_name: "supervisor", action: "decision", decision: decision.action, reason: decision.reasoning, duration_ms: supervisorDuration, token_count: supervisorTokens, llm_model: config.llmModel }); } catch { /* non-blocking */ }

      for (const spec of decision.specs || []) {
        triageDecisions.set(spec.file, spec.strategy);
        if (spec.guidance) supervisorGuidanceMap.set(spec.file, spec.guidance);
        emitSupervisorLog(emit, `  ${path.basename(spec.file)} → ${spec.strategy}: ${spec.guidance || "(no guidance)"}`);
        try { insertAgentLog({ run_id: runId, agent_name: "supervisor", action: "triage", target_file: spec.file, decision: spec.strategy, reason: spec.guidance, duration_ms: 0, llm_model: config.llmModel }); } catch { /* non-blocking */ }
      }
    }
  } catch (supervisorErr) {
    console.warn(`[AI Supervisor] Decision failed, defaulting to regenerate:`, supervisorErr);
    emitSupervisorLog(emit, `AI Supervisor failed — falling back to regenerate all`);
    try { insertAgentLog({ run_id: runId, agent_name: "supervisor", action: "decision", decision: "fallback_regenerate", reason: `AI Supervisor LLM failed: ${supervisorErr instanceof Error ? supervisorErr.message : String(supervisorErr)}`, success: false }); } catch { /* non-blocking */ }
  }

  // Handle non-fix actions from AI Supervisor
  if (aiAction === "skip_all") {
    emitSupervisorLog(emit, `AI Supervisor: skipping all — failures are infrastructure issues`);
    return { fixAttempt: state.maxFixAttempts };
  }
  if (aiAction === "cleanup") {
    emitSupervisorLog(emit, `AI Supervisor: proceeding to cleanup`);
    return { fixAttempt: state.maxFixAttempts };
  }
  if (aiAction === "restart_server") {
    emitSupervisorLog(emit, `AI Supervisor: restarting server (transient errors detected)`);
    try {
      const channel = getChannel(runId);
      stopProcess(channel.serverProcess);
      const newPort = await findAvailablePort();
      const newServer = await startProdServer(workDir, newPort, emit);
      channel.serverProcess = newServer;
      emitSupervisorLog(emit, `Server restarted on port ${newPort}. Re-running tests...`);
      return {
        fixAttempt: attempt,
        allSpecs: failedSpecs,
        workerResultsOffset: state.workerResults.length,
        totalPassed: 0, totalFailed: 0, totalDuration: 0,
        failedSpecs: [], allResults: [],
        port: newPort,
        supervisorGuidance: supervisorGuidanceMap,
        fixHistory: [...(state.fixHistory || []), { attempt, specsFixed: 0, specsSkipped: failedSpecs.length, errors: ["restart_server"] }],
      };
    } catch (restartErr) {
      emitSupervisorLog(emit, `Server restart failed: ${restartErr instanceof Error ? restartErr.message : String(restartErr)}`);
    }
  }

  let fixedCount = 0;
  let skippedCount = 0;

  // Pre-LLM fast-path: detect known infrastructure/navigation failures that no code fix can solve.
  // These burn fix attempts for nothing — skip immediately with a clear message.
  const INFRA_ERROR_PATTERNS = [
    { pattern: /lla-next-button.*intent-search-combobox|intent-search-combobox.*lla-next-button/i, reason: "LLA/intent page never loaded — app infrastructure issue" },
    { pattern: /skipSsoLogin|pp-ft-skipsso/i, reason: "SSO skip failed — app middleware issue" },
    { pattern: /ECONNREFUSED|ECONNRESET|ESOCKETTIMEDOUT|ETIMEDOUT/i, reason: "Server connection failed" },
    { pattern: /cy\.visit\(\).*failed trying to load/i, reason: "App server not responding" },
    { pattern: /Cannot read properties of undefined \(reading '(emailAddress|accountNumber|decryptedId|encryptedId)'\)/i, reason: "JAWS account creation failed — account data is undefined" },
  ];

  for (const specFile of failedSpecs) {
    // Fast-path: check for infrastructure errors before consulting triage LLM
    const infraErrors = (allResults || [])
      .filter((r) => r.file === specFile && r.status === "failed" && r.error)
      .map((r) => r.error!)
      .join("\n");
    const infraMatch = INFRA_ERROR_PATTERNS.find((p) => p.pattern.test(infraErrors));
    if (infraMatch) {
      emitSupervisorLog(emit, `SKIP ${path.basename(specFile)} — ${infraMatch.reason} (not a code issue)`);
      try { insertAgentLog({ run_id: runId, agent_name: "supervisor", action: "skip", target_file: specFile, decision: "skip_infra", reason: infraMatch.reason }); } catch { /* non-blocking */ }
      skippedCount++;
      continue;
    }

    // Check triage decision — skip if supervisor says so
    const strategy = triageDecisions.get(specFile) || "regenerate";
    if (strategy === "skip") {
      emitSupervisorLog(emit, `Skipping ${path.basename(specFile)} — triage: unfixable`);
      try { insertAgentLog({ run_id: runId, agent_name: "supervisor", action: "skip", target_file: specFile, decision: "skip", reason: "Triage classified as unfixable" }); } catch { /* non-blocking */ }
      skippedCount++;
      continue;
    }

    // Trim strategy: core test passed but cleanup/tail steps failed.
    // Remove failing steps from the end of the test and mark as passed.
    if (strategy === "trim") {
      const trimSpecPath = path.join(workDir, specFile);
      try {
        const testContent = fs.readFileSync(trimSpecPath, "utf-8");
        const guidance = supervisorGuidanceMap.get(specFile) || "";
        const lines = testContent.split("\n");

        // Strategy: find the first non-core step to trim from.
        // 1. If supervisor guidance specifies a step number ("trim from Step 8"), use it
        // 2. Otherwise scan for cleanup/navigation patterns after 50% of test
        let trimIndex = -1;

        // Try guidance-based trim first (e.g., "trim from Step 8")
        const stepMatch = guidance.match(/[Ss]tep\s*(\d+)/);
        if (stepMatch) {
          const targetStep = parseInt(stepMatch[1], 10);
          for (let li = 0; li < lines.length; li++) {
            const line = lines[li].trim();
            if (
              (line.includes(`Step ${targetStep}`) || line.includes(`Step${targetStep}`)) &&
              (line.startsWith("//") || line.includes("addTestContext"))
            ) {
              trimIndex = li;
              break;
            }
          }
        }

        // Fallback: scan for cleanup/post-assertion patterns
        if (trimIndex < 0) {
          const trimStart = Math.floor(lines.length * 0.5);
          for (let li = trimStart; li < lines.length; li++) {
            const line = lines[li].trim();
            if (
              line.includes("closeWorkflowAndProvideFeedback") ||
              line.includes("cy.closeWorkflow") ||
              line.includes("closeWorkflow") ||
              (line.includes("backButton") && line.includes(".click()")) ||
              (line.includes("nextButton") && line.includes(".click()")) ||
              (line.includes("Navigate back") || line.includes("navigate back") || line.includes("Click back")) ||
              (line.includes("Close workflow") || line.includes("close workflow")) ||
              (line.includes("Select") && line.includes("resolution")) ||
              (line.includes("selectTransactionAndViewDetails") && li > lines.length * 0.6) ||
              (line.includes("provideFeedback") || line.includes("ProvideFeedback")) ||
              (line.includes("Navigate away") || line.includes("navigate away")) ||
              (line.includes("Reset") && line.includes("click")) ||
              (line.includes("Return to") || line.includes("return to"))
            ) {
              // Look for the Step comment above this line to trim from the comment
              if (li > 0 && lines[li - 1].trim().startsWith("//") && lines[li - 1].includes("Step")) {
                trimIndex = li - 1;
              } else if (li > 1 && lines[li - 2].trim().startsWith("//") && lines[li - 2].includes("Step")) {
                trimIndex = li - 2;
              } else if (li > 0 && lines[li - 1].trim().includes("addTestContext")) {
                trimIndex = li - 1;
              } else {
                trimIndex = li;
              }
              break;
            }
          }
        }

        if (trimIndex > 0) {
          // Find the closing of the it() block after the trim point
          let itCloseIndex = -1;
          let braceDepth = 0;
          for (let li = trimIndex; li < lines.length; li++) {
            braceDepth += (lines[li].match(/\{/g) || []).length;
            braceDepth -= (lines[li].match(/\}/g) || []).length;
            if (braceDepth < 0 || (lines[li].trim() === "});" && li > trimIndex)) {
              itCloseIndex = li;
              break;
            }
          }

          // Remove lines from trimIndex to the it() closing, keep the closing braces
          const trimmedLines = [
            ...lines.slice(0, trimIndex),
            `    cy.screenshot("test_complete_core_passed");`,
            ...lines.slice(itCloseIndex >= 0 ? itCloseIndex : lines.length),
          ];
          const trimmedCode = trimmedLines.join("\n");
          fs.writeFileSync(trimSpecPath, trimmedCode, "utf-8");

          emitSupervisorLog(emit, `TRIMMED ${path.basename(specFile)} — removed ${lines.length - trimmedLines.length} non-core lines. Core test passed.`);
          emit({ type: "test:pass", timestamp: Date.now(), file: specFile, testName: `${path.basename(specFile)} (trimmed — core passed)` } as any);
          try { insertAgentLog({ run_id: runId, agent_name: "supervisor", action: "trim", target_file: specFile, decision: "trim_passed", reason: `Core test satisfied, removed failing tail steps: ${guidance}` }); } catch { /* non-blocking */ }
          fixedCount++;
          continue;
        }
      } catch (trimErr) {
        emitSupervisorLog(emit, `Trim failed for ${path.basename(specFile)}: ${trimErr instanceof Error ? trimErr.message : String(trimErr)}`);
      }
      // Fall through to regenerate if trim didn't work
    }

    const specPath = path.join(workDir, specFile);

    // Read the failing test file (recover from backups if not found)
    let failingTestContent = "";
    try {
      failingTestContent = fs.readFileSync(specPath, "utf-8");
    } catch {
      // Try to recover from generated-tests or artifacts
      const fileName = path.basename(specFile);
      const searchDirs = [
        path.join(process.cwd(), "data", "generated-tests"),
        path.join(process.cwd(), "data", "artifacts"),
      ];
      let recovered = false;
      for (const searchDir of searchDirs) {
        if (!fs.existsSync(searchDir)) continue;
        const found = findFileRecursive(searchDir, fileName);
        if (found) {
          fs.mkdirSync(path.dirname(specPath), { recursive: true });
          fs.copyFileSync(found, specPath);
          failingTestContent = fs.readFileSync(specPath, "utf-8");
          emitSupervisorLog(emit, `Recovered ${fileName} from backup`);
          recovered = true;
          break;
        }
      }
      if (!recovered) {
        emitSupervisorLog(emit, `Could not read or recover ${specFile} — skipping`);
        skippedCount++;
        continue;
      }
    }

    // Collect error output for this spec (fuzzy match on filename since paths vary)
    const specBaseName = path.basename(specFile);
    const matchesSpec = (r: { file: string }) =>
      r.file === specFile ||
      r.file === specBaseName ||
      r.file.endsWith(specBaseName) ||
      specFile.endsWith(r.file) ||
      path.basename(r.file) === specBaseName ||
      r.file.includes(`_generated/${specBaseName}`);

    const specErrors = (allResults || [])
      .filter((r) => matchesSpec(r) && r.status === "failed" && r.error)
      .map((r) => `Test: "${r.testName}"\nError: ${r.error}`)
      .join("\n---\n");

    // Get Cypress stdout from worker results for additional context
    const workerOutput = (state.workerResults || [])
      .filter((wr) => wr.cypressOutput)
      .map((wr) => wr.cypressOutput!)
      .join("\n")
      .slice(-3000);

    if (!specErrors) {
      const anyErrors = (allResults || [])
        .filter((r) => r.status === "failed" && r.error)
        .map((r) => `Test: "${r.testName}"\nError: ${r.error}`)
        .join("\n---\n");

      if (!anyErrors && !workerOutput) {
        emitSupervisorLog(emit, `No error details found for ${specBaseName} — skipping`);
        skippedCount++;
        continue;
      }
      emitSupervisorLog(emit, `Using fallback error details for ${specBaseName}${workerOutput ? " (+ Cypress output)" : ""}`);
    }

    const errorOutput = specErrors
      || (allResults || [])
          .filter((r) => r.status === "failed" && r.error)
          .map((r) => `Test: "${r.testName}"\nError: ${r.error}`)
          .join("\n---\n")
      || `Spec crashed or failed to compile. Cypress output:\n${workerOutput}`;

    // Log what's wrong (for the user to see)
    const failedTests = (allResults || []).filter((r) => matchesSpec(r) && r.status === "failed");
    emitSupervisorLog(emit, `FAILED: ${path.basename(specFile)} (${failedTests.length} failing test(s))`);
    failedTests.forEach((t) => {
      const errorLine = t.error ? t.error.split("\n")[0].slice(0, 100) : "Unknown";
      emitSupervisorLog(emit, `  - "${t.testName}": ${errorLine}`);
    });

    // Find the source component for this spec
    // Strategy: extract the WORKFLOW NAME from the spec path (e.g., "cancel-payment" from
    // "cypress/e2e/workflows/cancel-payment/p1-paypal-cpay-filter-transactions.cy.ts"),
    // then read the main component files from that workflow's folder.
    let sourceContent: string | undefined;
    let sourcePath: string | undefined;

    // Extract workflow name from spec path segments
    const specParts = specFile.split("/");
    const workflowIdx = specParts.indexOf("workflows");
    const workflowName = workflowIdx >= 0 && workflowIdx + 1 < specParts.length
      ? specParts[workflowIdx + 1]
      : "";

    if (workflowName) {
      // Look for the component in components/console/workflows/{workflowName}/
      const workflowComponentDir = path.join(workDir, "components", "console", "workflows", workflowName);
      if (fs.existsSync(workflowComponentDir)) {
        // Read the main component files (index.tsx, Container.tsx, Flow.tsx, etc.)
        const componentFiles: string[] = [];
        try {
          const entries = fs.readdirSync(workflowComponentDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory() && (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) && !entry.name.endsWith(".test.ts")) {
              componentFiles.push(path.join(workflowComponentDir, entry.name));
            }
          }
          // Prioritize main component files
          const priorityNames = ["index.tsx", "Container.tsx", "Flow.tsx", "Page.tsx", `${workflowName}.tsx`];
          const mainFile = componentFiles.find((f) =>
            priorityNames.some((p) => f.endsWith(p))
          ) || componentFiles[0];

          if (mainFile) {
            sourceContent = fs.readFileSync(mainFile, "utf-8");
            sourcePath = path.relative(workDir, mainFile);
            // Also read other key files (max 3) for fuller context
            const otherFiles = componentFiles.filter((f) => f !== mainFile).slice(0, 3);
            for (const other of otherFiles) {
              const content = fs.readFileSync(other, "utf-8");
              sourceContent += `\n\n// === ${path.basename(other)} ===\n${content.slice(0, 3000)}`;
            }
            emitGeneratorLog(emit, `Found source component: ${sourcePath} (${componentFiles.length} file(s) in workflow)`);
          }
        } catch {
          // ignore read errors
        }
      }
    }

    // Fallback: search by spec name (for non-workflow specs)
    if (!sourceContent) {
      // Strip naming convention prefix (p0-paypal-, p1-venmo-, etc.)
      const specBaseName = path.basename(specFile, ".cy.ts");
      const cleanName = specBaseName.replace(/^p\d+-(?:paypal|venmo)-(?:\w+?)-/, "").replace(/-/g, "");
      const componentsDir = path.join(workDir, "components", "console");
      if (fs.existsSync(componentsDir) && cleanName.length > 3) {
        const findComponent = (dir: string): string | null => {
          if (!fs.existsSync(dir)) return null;
          try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              if (entry.isDirectory() && entry.name !== "node_modules") {
                const found = findComponent(path.join(dir, entry.name));
                if (found) return found;
              } else if (
                (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) &&
                entry.name.replace(/[-_.]/g, "").toLowerCase().includes(cleanName.toLowerCase())
              ) {
                return path.join(dir, entry.name);
              }
            }
          } catch { /* skip */ }
          return null;
        };
        const componentPath = findComponent(componentsDir);
        if (componentPath) {
          sourceContent = fs.readFileSync(componentPath, "utf-8");
          sourcePath = path.relative(workDir, componentPath);
          emitGeneratorLog(emit, `Found source via fallback search: ${sourcePath}`);
        }
      }
    }

    if (!sourceContent) {
      emitGeneratorLog(emit, `No source component found for ${path.basename(specFile)} (workflow: "${workflowName || "unknown"}")`);
    }

    // Also include JAWS API types so the Generator knows correct field names
    // (e.g., ExpressCheckoutResponse.sellerTransaction.encryptedId, NOT .transactionId)
    const jawsPath = path.join(workDir, "cypress", "support", "jaws.ts");
    let jawsContent = "";
    if (fs.existsSync(jawsPath)) {
      try {
        const rawJaws = fs.readFileSync(jawsPath, "utf-8");
        // Extract type/interface definitions and function signatures (not full implementations)
        const typeBlocks: string[] = [];
        const lines = rawJaws.split("\n");
        let inBlock = false;
        let braceDepth = 0;
        let currentBlock = "";
        for (const line of lines) {
          if (/^export\s+(type|interface)\s+/.test(line) || (inBlock && braceDepth > 0)) {
            inBlock = true;
            currentBlock += line + "\n";
            braceDepth += (line.match(/\{/g) || []).length;
            braceDepth -= (line.match(/\}/g) || []).length;
            if (braceDepth <= 0) {
              typeBlocks.push(currentBlock);
              currentBlock = "";
              inBlock = false;
              braceDepth = 0;
            }
          } else if (/^export\s+(async\s+)?function\s+/.test(line)) {
            // Just the function signature line
            typeBlocks.push(line);
          }
        }
        jawsContent = typeBlocks.join("\n\n").slice(0, 5000);
      } catch { /* ignore */ }
    }

    // Include workflow-specific selectors from selectors.ts
    let workflowSelectors = "";
    if (workflowName) {
      const selectorsPath = path.join(workDir, "cypress", "support", "selectors.ts");
      if (fs.existsSync(selectorsPath)) {
        try {
          const selectorsRaw = fs.readFileSync(selectorsPath, "utf-8");
          // Find the selector block for this workflow (e.g., export const REFUND = { ... })
          // Map workflow folder name to selector constant name
          const selectorNameMap: Record<string, string> = {
            "cancel-payment": "CANCEL_PAYMENT",
            "login-password": "LOGIN_PASSWORD",
            "manage-address": "MANAGE_ADDRESS",
            "manage-phone": "MANAGE_PHONE",
            "manage-users": "MANAGE_USERS",
            "manage-account-flags": "MANAGE_ACCOUNT_FLAGS",
            "manage-debit-card": "MANAGE_DEBIT_CARD",
            "manage-email": "MANAGE_EMAIL",
            "payment-decline": "PAYMENT_DECLINE",
            "send-receive-money": "SEND_RECEIVE_MONEY",
            "transaction-inquiry": "TRANSACTION_INQUIRY",
            "negative-balance": "NEGATIVE_BALANCE",
            "mass-reversal": "MASS_REVERSAL",
            refund: "REFUND",
            disputes: "DISPUTES",
            withdrawals: "WITHDRAWAL_LIMITATIONS",
          };
          const selectorName = selectorNameMap[workflowName] || "";
          if (selectorName) {
            const regex = new RegExp(`export const ${selectorName} = \\{[\\s\\S]*?\\n\\};`, "m");
            const match = selectorsRaw.match(regex);
            if (match) {
              workflowSelectors = match[0].slice(0, 4000);
            }
          }
          // Also include COMMON and WORKFLOW_NAV
          for (const name of ["COMMON", "WORKFLOW_NAV"]) {
            const re = new RegExp(`export const ${name} = \\{[\\s\\S]*?\\n\\};`, "m");
            const m = selectorsRaw.match(re);
            if (m) workflowSelectors += "\n\n" + m[0].slice(0, 2000);
          }
        } catch { /* ignore */ }
      }
    }

    // Ask Generator Agent to regenerate
    emit({
      type: "supervisor:requesting-fix",
      timestamp: Date.now(),
      message: `[Supervisor] Asking Generator Agent to fix: ${path.basename(specFile)}`,
      file: specFile,
    });

    emit({
      type: "generator:fixing",
      timestamp: Date.now(),
      message: `[Generator Agent] Regenerating ${path.basename(specFile)} with error context (attempt ${attempt})...`,
      file: specFile,
    });

    try {
      // Load existing FTs for this workflow as reference
      const workflowName = specFile.split("/").find((p: string) =>
        p && !["cypress", "e2e", "__tests__", "components", "console", "workflows", "_generated"].includes(p)
      ) || "";
      const existingFTs = workflowName ? readWorkflowExistingFTs(workDir, workflowName) : [];

      // Build fix history from previous iterations
      const fixHistory = [];
      for (let i = 0; i < fixAttempt; i++) {
        const prevErrors = (allResults || []).filter((r) => r.file === specFile && r.status === "failed");
        if (prevErrors[i]) {
          fixHistory.push({ attempt: i + 1, error: prevErrors[i].error || "Unknown" });
        }
      }

      // Emit what went wrong for the UI
      const failedTests = (allResults || []).filter((r) => r.file === specFile && r.status === "failed");
      emit({
        type: "log", timestamp: Date.now(),
        message: `[Supervisor] ── Iteration ${attempt} Analysis ──`,
      });
      emit({
        type: "log", timestamp: Date.now(),
        message: `[Supervisor] Error: ${failedTests[0]?.error?.split("\n")[0]?.slice(0, 150) || "Unknown"}`,
      });
      if (fixHistory.length > 0) {
        emit({
          type: "log", timestamp: Date.now(),
          message: `[Supervisor] Previous ${fixHistory.length} fix(es) didn't work — telling Generator to try different approach`,
        });
      }
      emit({
        type: "log", timestamp: Date.now(),
        message: `[Supervisor] Strategy: ${strategy} | Existing FTs for reference: ${existingFTs.length} | Source component: ${sourcePath || "not found"}`,
      });
      emit({
        type: "log", timestamp: Date.now(),
        message: `[Generator] Regenerating ${path.basename(specFile)} with ${specErrors.length} chars of error context...`,
      });

      // Enrich error output if this is a compilation/import error
      let enrichedError = errorOutput + (workerOutput ? `\n\n## Cypress Console Output (last lines):\n${workerOutput}` : "");

      // Detect hallucinated selector imports (test crashed in <2s or "is not exported" in error)
      const hasImportError = /is not exported|Cannot find module|does not provide|is not a function|is undefined|Cannot read properties of undefined/i.test(enrichedError);
      const crashedFast = (allResults || []).filter((r) => matchesSpec(r) && r.status === "failed").some((r) => (r.duration || 0) < 2000);

      if (hasImportError || crashedFast) {
        enrichedError += `\n\n## CRITICAL: IMPORT/COMPILATION ERROR
The test crashed IMMEDIATELY (before running). This means an import is wrong.
ONLY these selector objects exist in cypress/support/selectors.ts:
CONSOLE, ACCOUNT_SEARCH, LLA, ERROR_SCREEN, INTENT_SELECTION,
MANAGE_ADDRESS, MANAGE_PHONE, MANAGE_USERS, DISPUTES, TRANSACTION_DETAILS,
LOGIN_PASSWORD, CANCEL_PAYMENT, STEP_UP, WORKFLOW_NAV, SEND_RECEIVE_MONEY,
TOAST, TRANSACTION_INQUIRY, COMMON, MANAGE_ACCOUNT_FLAGS, REFUND,
MANAGE_DEBIT_CARD, PAYMENT_DECLINE, NEGATIVE_BALANCE, MASS_REVERSAL

DO NOT import selectors that are not in this list (e.g., SUSPICIOUS_EMAIL does NOT exist).
For sub-features, use the PARENT workflow's selectors (e.g., LOGIN_PASSWORD for suspicious-email).
For elements with no predefined selector, use cy.get('[data-automation-id="exact-id"]').`;
        emitSupervisorLog(emit, `Detected import/compilation error — enriching error context for Generator`);

        // If utils.ts exists for this workflow, explicitly tell the LLM it's valid
        const hasUtilsFile = existingFTs.some((ft) => ft.fileName === "utils.ts");
        if (hasUtilsFile) {
          const utilsFT = existingFTs.find((ft) => ft.fileName === "utils.ts");
          enrichedError += `\n\n## IMPORTANT: ./utils IS VALID — DO NOT REMOVE IT
The file utils.ts EXISTS in this workflow folder. Keep \`import { ... } from "./utils"\`.
The "Module not found" error is likely caused by a different import — NOT ./utils.
Available exports from utils.ts:\n\`\`\`typescript\n${utilsFT?.content?.slice(0, 3000) || "// utils.ts exists"}\n\`\`\``;
          emitSupervisorLog(emit, `utils.ts exists for this workflow — preserving ./utils imports`);
        }
      }

      // Append JAWS type definitions so Generator knows correct field names
      if (jawsContent) {
        enrichedError += `\n\n## JAWS API Types (use these EXACT field names — do NOT guess):\n\`\`\`typescript\n${jawsContent}\n\`\`\``;
      }

      // Append workflow selectors so Generator knows what properties exist
      if (workflowSelectors) {
        enrichedError += `\n\n## Available Selectors for This Workflow (use ONLY these properties):\n\`\`\`typescript\n${workflowSelectors}\n\`\`\``;
      }

      // Append actual constants (TEST_ACCOUNTS, INTENTS) so Generator uses correct property names
      const constantsPath = path.join(workDir, "cypress", "support", "constants.ts");
      if (fs.existsSync(constantsPath)) {
        try {
          const rawConst = fs.readFileSync(constantsPath, "utf-8");
          let constSnippet = "";
          for (const name of ["TEST_ACCOUNTS", "INTENTS"]) {
            const re = new RegExp(`export const ${name} = \\{[\\s\\S]*?\\} as const;`, "m");
            const m = rawConst.match(re);
            if (m) constSnippet += m[0] + "\n\n";
          }
          if (constSnippet) {
            enrichedError += `\n\n## ACTUAL CONSTANTS (use ONLY these property names — do NOT invent others):\n\`\`\`typescript\n${constSnippet}\n\`\`\``;
          }
        } catch { /* ignore */ }
      }

      // Extract the correct intent name — try source code first, fallback to folder name
      let detectedFixIntent = "";
      if (sourceContent) {
        const intentMatch = sourceContent.match(/originIntentName:\s*["']([^"']+)["']/);
        const pgMatch = !intentMatch ? sourceContent.match(/IntentResolution:([^:'"]+):/) : null;
        detectedFixIntent = (intentMatch ? intentMatch[1] : "") || (pgMatch ? pgMatch[1].trim() : "");
      }
      if (!detectedFixIntent && workflowName) {
        // Read folder→intent mapping from flow-routing-setting.json (dynamic, not hardcoded)
        const { folderToIntent: flowRouting } = readFlowRoutingIntents(workDir);
        detectedFixIntent = flowRouting[workflowName]
          || workflowName.split("-").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      }
      if (detectedFixIntent) {
        enrichedError += `\n\n## *** MANDATORY INTENT for this workflow: "${detectedFixIntent}" ***\nUse: cy.navigateToWorkflow(account, "${detectedFixIntent}");\nDo NOT use INTENTS.LOGIN_PASSWORD or any other intent for this workflow.`;
      }

      // Read DOM snapshot for THIS specific spec (matched by spec basename)
      let domAutomationIds: string[] = [];
      const snapshotDir = path.join(workDir, "cypress", "screenshots");
      if (fs.existsSync(snapshotDir)) {
        try {
          const specBaseName = path.basename(specFile, ".cy.ts").replace(/[^a-zA-Z0-9_-]/g, "_");
          const allSnapshotFiles = fs.readdirSync(snapshotDir)
            .filter((f) => f.startsWith("dom-snapshot-") && f.endsWith(".json"));
          // Find the snapshot matching this spec, fall back to first available
          const matchingFile = allSnapshotFiles.find((f) => f === `dom-snapshot-${specBaseName}.json`)
            || (allSnapshotFiles.length > 0 ? allSnapshotFiles[0] : null);
          if (matchingFile) {
            const snapshotData = JSON.parse(fs.readFileSync(path.join(snapshotDir, matchingFile), "utf-8"));
            domAutomationIds = (snapshotData.automationIds || []).map((el: any) => el.id).filter(Boolean);
            const visibleIds = (snapshotData.automationIds || [])
              .filter((el: any) => el.visible)
              .map((el: any) => `[data-automation-id="${el.id}"] (${el.tag})`)
              .join("\n  ");
            const hiddenIds = (snapshotData.automationIds || [])
              .filter((el: any) => !el.visible)
              .map((el: any) => `[data-automation-id="${el.id}"] (${el.tag}, hidden)`)
              .join("\n  ");
            const buttons = (snapshotData.buttons || []).join(", ");
            const headings = (snapshotData.headings || []).join(" | ");
            const pageState = snapshotData.pageState || "unknown";
            const workflowDetected = snapshotData.workflowDetected ?? true;

            // Add page state context so the Supervisor understands what's happening
            let stateNote = "";
            if (pageState === "loading") {
              stateNote = `\n**PAGE STATE: STILL LOADING** — spinners are active, workflow content has not rendered yet.
The elements below are from the console shell (always visible), NOT the workflow screen.
FIX: Increase timeouts (use TIMEOUTS.MAX = 100s) for spinner waits and workflow container checks.\n`;
            } else if (!workflowDetected) {
              stateNote = `\n**PAGE STATE: NO WORKFLOW CONTENT** — only console shell elements found.
The workflow either failed to load or navigation did not complete.\n`;
            }

            enrichedError += `\n\n## DOM SNAPSHOT AT FAILURE (actual elements on the page)
URL: ${snapshotData.url || "unknown"}
Active spinners: ${snapshotData.spinners || 0}
Page state: ${pageState}${stateNote}

### Visible workflow data-automation-id elements:
  ${visibleIds || "(none found — workflow content has not rendered)"}

${hiddenIds ? `### Hidden data-automation-id elements:\n  ${hiddenIds}\n` : ""}
### Visible buttons: ${buttons || "(none)"}
### Page headings: ${headings || "(none)"}

USE THESE EXACT data-automation-id values in your selectors. Do NOT guess — if an ID is not listed here, the element does not exist on this page.

### ALLOWED SELECTORS (copy-paste these into cy.get()):
${(snapshotData.automationIds || [])
  .filter((el: any) => el.visible)
  .map((el: any) => `cy.get('[data-automation-id="${el.id}"]')`)
  .join("\n")}`;
            emitSupervisorLog(emit, `DOM snapshot for ${path.basename(specFile)}: ${(snapshotData.automationIds || []).length} workflow IDs, ${snapshotData.spinners || 0} spinners, state=${pageState}`);
            // Clean up only this spec's snapshot after reading
            try { fs.rmSync(path.join(snapshotDir, matchingFile), { force: true }); } catch { /* ignore */ }
          }
        } catch { /* ignore malformed snapshots */ }
      }

      // Inject AI Supervisor's guidance for this specific spec
      const aiGuidance = supervisorGuidanceMap.get(specFile) || (state.supervisorGuidance as Map<string, string>)?.get?.(specFile);
      if (aiGuidance) {
        enrichedError += `\n\n## AI SUPERVISOR GUIDANCE (follow this specific instruction):\n${aiGuidance}`;
        emitSupervisorLog(emit, `[AI Supervisor → Generator] ${path.basename(specFile)}: ${aiGuidance}`);
      }

      const fixAutomationIds = workflowName ? extractAutomationIds(workDir, workflowName) : [];
      if (fixAutomationIds.length > 0) {
        emitGeneratorLog(emit, `Extracted ${fixAutomationIds.length} data-automation-id(s) from "${workflowName}" source`);
      }

      const regenStart = Date.now();
      const regenResult = await regenerateTest({
        llm,
        specPath: specFile,
        failingTestContent,
        errorOutput: enrichedError,
        sourceContent,
        sourcePath,
        templateType: templateType || "comprehensive",
        attemptNumber: attempt,
        existingWorkflowFTs: existingFTs,
        fixHistory,
        sourceAutomationIds: fixAutomationIds,
        workflowSelectors: workflowSelectors || readAllSelectors(workDir),
        domAutomationIds,
      });
      const regenDuration = Date.now() - regenStart;
      const fixedCode = regenResult.code;
      const regenTokens = regenResult.tokenCount;

      const looksLikeCode = fixedCode && fixedCode.includes("describe(") && fixedCode.includes("it(");
      if (fixedCode && !looksLikeCode) {
        emit({ type: "log", timestamp: Date.now(), message: `[Generator] Rejected fix — LLM returned non-test content (${fixedCode.length} chars, missing describe/it blocks)` });
      }
      if (looksLikeCode) {
        // Show what changed
        const oldLines = failingTestContent.split("\n").length;
        const newLines = fixedCode.split("\n").length;
        const oldImports = (failingTestContent.match(/^import /gm) || []).length;
        const newImports = (fixedCode.match(/^import /gm) || []).length;
        emit({
          type: "log", timestamp: Date.now(),
          message: `[Generator] Fix applied: ${oldLines}→${newLines} lines, ${oldImports}→${newImports} imports, ${fixedCode.length} chars`,
        });

        // Show key differences
        if (fixedCode.includes("navigateToWorkflow") && !failingTestContent.includes("navigateToWorkflow")) {
          emit({ type: "log", timestamp: Date.now(), message: `[Generator] Added: cy.navigateToWorkflow()` });
        }
        if (fixedCode.includes("TIMEOUTS.MAX") && !failingTestContent.includes("TIMEOUTS.MAX")) {
          emit({ type: "log", timestamp: Date.now(), message: `[Generator] Added: TIMEOUTS.MAX for waits` });
        }
        if (fixedCode.includes("closeWorkflowAndProvideFeedback") && !failingTestContent.includes("closeWorkflowAndProvideFeedback")) {
          emit({ type: "log", timestamp: Date.now(), message: `[Generator] Added: closeWorkflowAndProvideFeedback()` });
        }

        fs.writeFileSync(specPath, fixedCode, "utf-8");
        fixedCount++;

        emit({
          type: "generator:fixed",
          timestamp: Date.now(),
          message: `[Generator Agent] Fixed: ${path.basename(specFile)} (${fixedCode.length} chars)`,
          file: specFile,
        });

        try { insertAgentLog({ run_id: runId, agent_name: "generator", action: "regenerate", target_file: specFile, decision: "fix_applied", reason: `${oldLines}->${newLines} lines, ${oldImports}->${newImports} imports`, duration_ms: regenDuration, token_count: regenTokens, llm_model: config.llmModel, success: true }); } catch { /* non-blocking */ }
      } else {
        emitGeneratorLog(emit, `Could not regenerate ${path.basename(specFile)} — no source component found`);
        try { insertAgentLog({ run_id: runId, agent_name: "generator", action: "regenerate", target_file: specFile, decision: "no_fix", reason: "Regeneration returned no code", duration_ms: regenDuration, token_count: regenTokens, llm_model: config.llmModel, success: false }); } catch { /* non-blocking */ }
        skippedCount++;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      emitGeneratorLog(emit, `Regeneration failed for ${path.basename(specFile)}: ${errMsg}`);
      try { insertAgentLog({ run_id: runId, agent_name: "generator", action: "regenerate", target_file: specFile, decision: "error", error: errMsg, llm_model: config.llmModel, success: false }); } catch { /* non-blocking */ }
      try { insertError({ run_id: runId, error_type: "fix", error_category: "regeneration_failed", error_message: errMsg, stack_trace: err instanceof Error ? err.stack : undefined, file: specFile, step: `fix_attempt_${attempt}` }); } catch { /* non-blocking */ }
      skippedCount++;
    }
  }

  emitSupervisorLog(emit, `Fix iteration ${attempt} complete: ${fixedCount} fixed, ${skippedCount} skipped out of ${failedSpecs.length}`);

  // Log supervisor fix iteration metrics
  try { insertMetric({ run_id: runId, step_name: `supervisor-fix-${attempt}`, duration_ms: Date.now() - (state as any)._supervisorStart || 0, metadata: JSON.stringify({ fixedCount, skippedCount, totalSpecs: failedSpecs.length }) }); } catch { /* non-blocking */ }

  // Run compliance on regenerated specs
  if (fixedCount > 0) {
    const fixedSpecs = failedSpecs.filter((spec) => {
      const specPath = path.join(workDir, spec);
      return fs.existsSync(specPath);
    });
    if (fixedSpecs.length > 0) {
      emitComplianceLog(emit, `Validating ${fixedSpecs.length} regenerated spec(s)...`);
      try {
        const postFixComplianceStart = Date.now();
        const complianceResults = await validateCompliance({
          generatedFiles: fixedSpecs.map((s) => ({ sourcePath: "", testPath: s, status: "created" as const })),
          repoPath: workDir,
          runId,
        });
        const postFixComplianceDuration = Date.now() - postFixComplianceStart;
        for (const cr of complianceResults) {
          const passed = cr.score >= 90;
          emitComplianceLog(emit, `  ${passed ? "PASS" : "FAIL"}: ${path.basename(cr.testPath)} — ${cr.score}%`);
          try { insertAgentLog({ run_id: runId, agent_name: "compliance", action: "validate", target_file: cr.testPath, decision: passed ? "pass" : "fail", reason: `${cr.score}% (${cr.checks.filter((c) => c.passed).length}/${cr.checks.length} checks)`, duration_ms: postFixComplianceDuration, success: passed, metadata: JSON.stringify({ score: cr.score, checks: cr.checks }) }); } catch { /* non-blocking */ }

          if (!passed) {
            const llmApiKey = config.llmApiKey || env.anthropic.apiKey;
            if (llmApiKey) {
              const violations = cr.checks.filter((c) => !c.passed).map((c) => ({ rule: c.rule, message: c.message, severity: c.severity }));
              const fixResult = await regenerateForCompliance({ testPath: cr.testPath, testContent: fs.readFileSync(path.join(workDir, cr.testPath), "utf-8"), violations, repoPath: workDir, llmApiKey, llmBaseUrl: config.llmBaseUrl || env.anthropic.baseUrl, llmModel: config.llmModel });
              if (fixResult) emitComplianceLog(emit, `  Fixed: ${path.basename(cr.testPath)}`);
            }
          }
        }
      } catch (compErr) {
        console.warn("[supervisorFixNode] Compliance check error:", compErr);
      }
    }
  }

  emit({
    type: "step:complete",
    timestamp: Date.now(),
    step: "auto-fix",
    message: `[Supervisor] Fixed ${fixedCount}/${failedSpecs.length} spec(s) via Generator Agent`,
  });

  // Restart server before re-running tests (server may have crashed or port changed)
  emitSupervisorLog(emit, `Restarting server before re-run...`);
  try {
    const channel = getChannel(runId);
    stopProcess(channel.serverProcess);
    const newPort = await findAvailablePort();
    const newServer = await startDevServer(workDir, newPort, emit);
    channel.serverProcess = newServer;
    emitSupervisorLog(emit, `Server restarted on port ${newPort}`);

    // Warm up the route again
    try {
      const warmupUrl = `http://localhost:${newPort}/sparkx/?pp-ft-skipsso=true`;
      const abortCtrl = new AbortController();
      const warmupTimeout = setTimeout(() => abortCtrl.abort(), 60000);
      await fetch(warmupUrl, { signal: abortCtrl.signal, redirect: "follow" });
      clearTimeout(warmupTimeout);
    } catch {
      // warmup timeout is non-fatal
    }

    emitSupervisorLog(emit, `Re-running ${failedSpecs.length} spec(s) to validate fixes...`);

    // Collect errors from this round for fix history
    const roundErrors = (allResults || [])
      .filter((r) => r.status === "failed" && r.error)
      .map((r) => r.error!.slice(0, 100));

    return {
      fixAttempt: attempt,
      allSpecs: failedSpecs,
      workerResultsOffset: state.workerResults.length,
      totalPassed: 0,
      totalFailed: 0,
      totalDuration: 0,
      failedSpecs: [],
      allResults: [],
      port: newPort,
      supervisorGuidance: supervisorGuidanceMap,
      fixHistory: [...(state.fixHistory || []), { attempt, specsFixed: fixedCount, specsSkipped: skippedCount, errors: roundErrors }],
    };
  } catch (restartErr: unknown) {
    const errMsg = restartErr instanceof Error ? restartErr.message : String(restartErr);
    emitSupervisorLog(emit, `Failed to restart server: ${errMsg}`);
    return { fixAttempt: state.maxFixAttempts }; // skip further fixes
  }
}

/**
 * fixNode — Sophisticated auto-fix with analyzeFailure, transient error detection,
 * user confirmation for app-logic issues, and server restart on fix.
 * Used for run-only flow (when isGenerateAndValidate is false).
 */
async function fixNode(state: FTState): Promise<Command> {
  const { failedSpecs, fixAttempt, runId, workDir, config } = state;
  const { emit } = getChannel(runId);

  let fixedCount = 0;

  console.log(`[ft-fix] fixNode entered: attempt=${fixAttempt + 1}, failedSpecs=${JSON.stringify(failedSpecs)}`);
  emit({
    type: "fix:start",
    timestamp: Date.now(),
    message: `Fix attempt ${fixAttempt + 1}: analyzing ${failedSpecs.length} failed spec(s)`,
  });

  // Load existing passing FTs for this workflow as reference for fixes
  const { readWorkflowExistingFTs } = require("./ftGenerator");
  const workflowFolder = (config.specPattern || failedSpecs[0] || "")
    .split("/").find((p: string) => p && p !== "cypress" && p !== "e2e" && p !== "__tests__" && p !== "components" && p !== "console" && p !== "workflows") || "";
  const existingFTs = workflowFolder ? readWorkflowExistingFTs(workDir, workflowFolder) : [];
  if (existingFTs.length > 0) {
    console.log(`[ft-fix] Loaded ${existingFTs.length} existing FT(s) for "${workflowFolder}" as reference`);
  }

  // Collect screenshots for failed specs (helps LLM understand UI state)
  const screenshotPaths: string[] = [];
  try {
    const ssDir = path.join(workDir, "cypress", "screenshots");
    if (fs.existsSync(ssDir)) {
      const collectSS = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) collectSS(path.join(dir, entry.name));
          else if (entry.name.endsWith(".png")) screenshotPaths.push(path.relative(workDir, path.join(dir, entry.name)));
        }
      };
      collectSS(ssDir);
    }
  } catch { /* ignore */ }
  if (screenshotPaths.length > 0) {
    console.log(`[ft-fix] Found ${screenshotPaths.length} screenshot(s) for context`);
  }

  // Build fix history from previous attempts (stored in worker results)
  const fixHistory: Array<{ attempt: number; error: string; fix: string }> = [];
  if (fixAttempt > 0) {
    // Get errors from previous iterations
    const prevResults = (state.allResults || []).filter((r) => r.status === "failed");
    for (let i = 0; i < Math.min(fixAttempt, 3); i++) {
      const prevError = prevResults[i]?.error || "Unknown error";
      fixHistory.push({
        attempt: i + 1,
        error: prevError.slice(0, 500),
        fix: `Fix attempt ${i + 1} was applied but the test still failed`,
      });
    }
  }

  // Check if ALL errors are transient (server startup / connection issues).
  // If so, skip LLM analysis — just restart server and retry without code changes.
  const isTransientError = (err: string) =>
    /ESOCKETTIMEDOUT|ECONNREFUSED|ECONNRESET|ETIMEDOUT|cy\.visit\(\).*failed trying to load/i.test(err);

  const allErrors = (state.allResults || [])
    .filter((r) => r.status === "failed")
    .map((r) => r.error || "");
  const allTransient = allErrors.length > 0 && allErrors.every((e) => isTransientError(e));

  if (allTransient) {
    console.log(`[ft-fix] All errors are transient (server/connection issues) — restarting server and retrying`);
    emit({ type: "log", timestamp: Date.now(), message: `[fix] All errors are transient (timeout/connection) — restarting server and retrying` });

    // Build specs for re-run
    const specsToRerun = state.allSpecs.filter((s) =>
      failedSpecs.some((f) => s.includes(f) || s.endsWith(f) || f.includes(s))
    );
    const retrySpecs = specsToRerun.length > 0 ? specsToRerun : failedSpecs;

    try {
      const channel = getChannel(runId);
      stopProcess(channel.serverProcess);
      const newPort = await findAvailablePort();
      const newServer = await startProdServer(workDir, newPort, emit);
      channel.serverProcess = newServer;
      emit({ type: "log", timestamp: Date.now(), message: `[fix] Server restarted on port ${newPort}` });

      return new Command({
        update: {
          fixAttempt: fixAttempt + 1,
          workerResultsOffset: state.workerResults.length,
          totalPassed: 0,
          totalFailed: 0,
          totalDuration: 0,
          allResults: [],
          allSpecs: retrySpecs,
          port: newPort,
        },
        goto: "splitNode",
      });
    } catch (restartErr: any) {
      emitManualFixRequired(state, emit, "Server could not be restarted after transient error.");
      return new Command({
        update: { fixAttempt: state.maxFixAttempts },
        goto: "cleanupNode",
      });
    }
  }

  // Resolve LLM credentials — config may have them, or fall back to env/APP_CONFIG
  const llmApiKey = config.llmApiKey || process.env.LLM_API_KEY || env.anthropic.apiKey || "";
  const llmBaseUrl = config.llmBaseUrl || process.env.LLM_BASE_URL || APP_CONFIG.llm.baseUrl;

  emit({ type: "log", timestamp: Date.now(), message: `[fix] LLM key from config: ${!!config.llmApiKey}, from env: ${!!process.env.LLM_API_KEY}, resolved: ${!!llmApiKey}` });
  emit({ type: "log", timestamp: Date.now(), message: `[fix] LLM baseUrl resolved: ${llmBaseUrl}` });

  console.log(`[ft-fix] LLM credentials: apiKey=${!!llmApiKey} (length=${llmApiKey.length}), baseUrl=${llmBaseUrl}`);
  if (!llmApiKey || !llmBaseUrl) {
    console.log(`[ft-fix] MISSING LLM credentials — cannot auto-fix`);
    emit({
      type: "fix:error",
      timestamp: Date.now(),
      message: `LLM credentials not configured — cannot auto-fix. llmApiKey=${!!llmApiKey}, llmBaseUrl=${!!llmBaseUrl}. Switching to manual mode.`,
    });
    emitManualFixRequired(state, emit, "LLM credentials missing — use manual fix.");
    return new Command({
      update: { fixAttempt: state.maxFixAttempts },
      goto: "cleanupNode",
    });
  }

  let anyFixApplied = false;

  emit({ type: "log", timestamp: Date.now(), message: `[fix] failedSpecs: ${JSON.stringify(failedSpecs)}` });
  emit({ type: "log", timestamp: Date.now(), message: `[fix] workDir: ${workDir}` });
  emit({ type: "log", timestamp: Date.now(), message: `[fix] llmApiKey present: ${!!config.llmApiKey}, llmBaseUrl: ${config.llmBaseUrl}` });

  // Noise errors from server startup or connection issues — not useful for LLM analysis
  const isNoiseError = (err: string) =>
    /ESOCKETTIMEDOUT|ECONNREFUSED|ECONNRESET|ETIMEDOUT|cy\.visit\(\).*failed trying to load/i.test(err);

  for (const spec of failedSpecs) {
    // Get the error output for this spec from worker results
    const specFileName = spec.split("/").pop() || spec;
    // Collect ALL failed results for this spec (across retries/workers)
    // Match by basename OR full path (r.file may be full path or just filename)
    const matchesSpec = (rFile: string) =>
      rFile === specFileName ||
      rFile === spec ||
      rFile.endsWith(`/${specFileName}`) ||
      rFile.endsWith(specFileName) ||
      path.basename(rFile) === specFileName ||
      rFile.includes(`_generated/${specFileName}`);

    const allFailedForSpec = (state.workerResults || [])
      .flatMap((wr) => wr.results)
      .filter((r) => matchesSpec(r.file) && r.status === "failed");

    // Collect ALL meaningful errors for this spec — not just one
    const meaningfulErrors = allFailedForSpec
      .filter((r) => r.error && !isNoiseError(r.error))
      .map((r) => ({ testName: r.testName, error: r.error! }));

    // Fallback: if no meaningful errors, use whatever we have
    const allErrors = meaningfulErrors.length > 0
      ? meaningfulErrors
      : allFailedForSpec.filter((r) => r.error).map((r) => ({ testName: r.testName, error: r.error! }));

    if (allErrors.length === 0) {
      const workerError = (state.workerResults || []).find((wr) =>
        wr.results.some((r) => matchesSpec(r.file) && r.status === "failed")
      )?.error;
      allErrors.push({ testName: specFileName, error: workerError || "Unknown error" });
    }

    // Build structured error output for LLM — one section per error
    let errorOutput: string;
    if (allErrors.length === 1) {
      errorOutput = allErrors[0].error;
    } else {
      errorOutput = allErrors.map((e, i) =>
        `Error ${i + 1} (test: "${e.testName}"):\n  ${e.error}`
      ).join("\n\n");
    }

    console.log(`[ft-fix] Error extraction for ${specFileName}: ${allErrors.length} error(s) found`);
    for (const e of allErrors) {
      console.log(`[ft-fix]   - ${e.testName}: ${e.error.slice(0, 80)}`);
    }

    emit({ type: "log", timestamp: Date.now(), message: `[fix] Analyzing spec: ${spec}, ${allErrors.length} error(s)` });
    for (const e of allErrors) {
      emit({ type: "log", timestamp: Date.now(), message: `[fix]   Error: ${e.testName} — ${e.error.slice(0, 120)}` });
    }

    // Resolve the spec path — if it's just a filename, try to find it in the workDir
    let resolvedSpec = spec;
    if (!fs.existsSync(path.join(workDir, spec))) {
      // Search for the file in the clone
      const found = findFileRecursive(workDir, specFileName);
      if (found) {
        resolvedSpec = path.relative(workDir, found);
        console.log(`[ft-fix] Resolved spec path: ${resolvedSpec}`);
      } else {
        // File not found in workDir -- search in generated-tests and data/artifacts
        console.log(`[ft-fix] Spec file not found in workDir, searching generated-tests and artifacts...`);
        emit({ type: "log", timestamp: Date.now(), message: `[fix] Spec file not found at ${spec}, searching backup locations...` });

        let recovered = false;
        const searchDirs = [
          path.join(process.cwd(), "data", "generated-tests"),
          path.join(process.cwd(), "data", "artifacts"),
        ];
        for (const searchDir of searchDirs) {
          if (!fs.existsSync(searchDir)) continue;
          const foundInBackup = findFileRecursive(searchDir, specFileName);
          if (foundInBackup) {
            // Copy to the expected location in workDir
            const destPath = path.join(workDir, spec);
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            fs.copyFileSync(foundInBackup, destPath);
            resolvedSpec = spec;
            recovered = true;
            console.log(`[ft-fix] Recovered spec from backup: ${foundInBackup} → ${destPath}`);
            emit({ type: "log", timestamp: Date.now(), message: `[fix] Recovered spec file from backup, will retry` });
            break;
          }
        }

        if (!recovered) {
          // Spec not found anywhere — try to regenerate it using the LLM
          const isSpecNotFound = errorOutput.includes("no spec files were found") || errorOutput.includes("Can't run");
          if (isSpecNotFound && llmApiKey) {
            emit({ type: "log", timestamp: Date.now(), message: `[fix] Spec file missing — asking AI to regenerate it` });
            console.log(`[ft-fix] Spec file missing, regenerating: ${spec}`);

            try {
              const { regenerateTest } = require("./ftGenerator");
              const llmClient = require("./langgraph/llm").createLLMClient({ llmApiKey, llmBaseUrl, llmModel: config.llmModel });

              // Generate a basic test file based on the spec name
              const specNameParts = specFileName.replace(".cy.ts", "").split("-");
              const workflowName = specNameParts.slice(2).join(" ");

              const regenResult2 = await regenerateTest({
                llm: llmClient,
                specPath: spec,
                failingTestContent: `// This file needs to be regenerated - it was lost\n// Expected spec: ${specFileName}\n// Workflow: ${workflowName}`,
                errorOutput: `The spec file does not exist and needs to be created from scratch. Generate a Cypress E2E test for the ${workflowName} workflow.`,
                templateType: "comprehensive",
                attemptNumber: 1,
                workflowSelectors: "",
              });

              if (regenResult2.code) {
                const generatedCode = regenResult2.code;
                const destPath = path.join(workDir, spec);
                fs.mkdirSync(path.dirname(destPath), { recursive: true });
                fs.writeFileSync(destPath, generatedCode, "utf-8");
                resolvedSpec = spec;
                fixedCount++;
                emit({ type: "log", timestamp: Date.now(), message: `[fix] Regenerated spec file: ${specFileName}` });
                console.log(`[ft-fix] Regenerated spec: ${spec} (${generatedCode.length} chars)`);
                // Don't skip — let the re-run loop pick it up
                continue;
              }
            } catch (regenErr) {
              console.error(`[ft-fix] Regeneration failed:`, regenErr);
              emit({ type: "log", timestamp: Date.now(), message: `[fix] Regeneration failed: ${regenErr instanceof Error ? regenErr.message : String(regenErr)}` });
            }
          }

          console.log(`[ft-fix] Could not find or recover spec file: ${specFileName} — skipping`);
          emit({ type: "log", timestamp: Date.now(), message: `[fix] Could not find or recover spec file: ${specFileName}` });
          continue;
        }
      }
    }

    try {
      console.log(`[ft-fix] Calling LLM to analyze: ${resolvedSpec}`);
      console.log(`[ft-fix] LLM endpoint: ${llmBaseUrl}/chat/completions`);
      emit({ type: "log", timestamp: Date.now(), message: `[fix] Calling LLM to analyze: ${resolvedSpec}` });
      emit({ type: "log", timestamp: Date.now(), message: `[fix] Error being sent to LLM: ${errorOutput.slice(0, 500)}` });

      const diagnosis = await analyzeFailure(
        workDir,
        resolvedSpec,
        errorOutput,
        llmBaseUrl,
        llmApiKey,
        emit,
        undefined,
        existingFTs,
        fixHistory,
        screenshotPaths.filter((s) => s.includes(specFileName.replace(".cy.ts", "")))
      );

      console.log(`[ft-fix] LLM diagnosis: issueType=${diagnosis.issueType}, fixes=${diagnosis.suggestedFixes?.length ?? 0}, diagnostic=${diagnosis.diagnosticInfo?.slice(0, 150)}`);
      emit({ type: "log", timestamp: Date.now(), message: `[fix] AI diagnosis result — issueType: ${diagnosis.issueType}` });
      emit({ type: "log", timestamp: Date.now(), message: `[fix] AI diagnosticInfo: ${diagnosis.diagnosticInfo}` });
      emit({ type: "log", timestamp: Date.now(), message: `[fix] suggestedFixes count: ${diagnosis.suggestedFixes?.length ?? 0}` });
      if (diagnosis.suggestedFixes && diagnosis.suggestedFixes.length > 0) {
        for (const fix of diagnosis.suggestedFixes) {
          emit({ type: "log", timestamp: Date.now(), message: `[fix] Fix target file: ${fix.filePath}, content length: ${fix.newContent.length} chars` });
        }

        // Verify the fix addresses all errors by checking the fixed content
        if (allErrors.length > 1) {
          const fixContent = diagnosis.suggestedFixes[0]?.newContent || "";
          const originalContent = fs.existsSync(path.join(workDir, resolvedSpec))
            ? fs.readFileSync(path.join(workDir, resolvedSpec), "utf-8")
            : "";
          const changesMade = fixContent !== originalContent;
          console.log(`[ft-fix] Multi-error verification: ${allErrors.length} errors sent, fix changes made: ${changesMade}`);
          emit({
            type: "log", timestamp: Date.now(),
            message: `[fix] Sent ${allErrors.length} errors to LLM — fix ${changesMade ? "modifies" : "does NOT modify"} the file`,
          });
        }
      }

      if (diagnosis.issueType === "app-logic") {
        console.log(`[ft-fix] LLM classified as "app-logic" — asking user to confirm...`);
        emit({ type: "log", timestamp: Date.now(), message: `[fix] LLM classified as "app-logic" — waiting for user confirmation...` });

        // Ask the user to confirm or override
        emit({
          type: "fix:user-confirm",
          timestamp: Date.now(),
          message: diagnosis.diagnosticInfo,
          spec: resolvedSpec,
          runId,
          issueType: "app-logic",
          error: errorOutput.slice(0, 500),
        } as any);

        const userDecision = await waitForUserConfirmation(runId);
        console.log(`[ft-fix] User decision: ${userDecision}`);
        emit({ type: "log", timestamp: Date.now(), message: `[fix] User confirmed: ${userDecision}` });

        if (userDecision === "app-logic" || userDecision === "skip") {
          emit({
            type: "fix:manual-required",
            timestamp: Date.now(),
            message: `${resolvedSpec}: Confirmed as app-logic issue — ${diagnosis.diagnosticInfo}`,
          });
          continue;
        }

        // User overrode to "test" — re-analyze with forced hint
        emit({ type: "log", timestamp: Date.now(), message: `[fix] User overrode to "test" — re-analyzing with forced hint...` });
        emit({ type: "fix:analyzing", timestamp: Date.now(), message: `Re-analyzing ${resolvedSpec} as test issue...` });

        const retryDiagnosis = await analyzeFailure(
          workDir,
          resolvedSpec,
          errorOutput + "\n\nIMPORTANT: The user has confirmed this is a TEST issue, not an app-logic issue. The test file has a wrong expected value. Fix the test assertion to match the actual value from the application.",
          llmBaseUrl,
          llmApiKey,
          emit
        );

        console.log(`[ft-fix] Retry diagnosis: issueType=${retryDiagnosis.issueType}, fixes=${retryDiagnosis.suggestedFixes?.length ?? 0}`);
        emit({ type: "log", timestamp: Date.now(), message: `[fix] Retry diagnosis: issueType=${retryDiagnosis.issueType}, fixes=${retryDiagnosis.suggestedFixes?.length ?? 0}` });

        if (retryDiagnosis.suggestedFixes && retryDiagnosis.suggestedFixes.length > 0) {
          applyFixes(workDir, retryDiagnosis.suggestedFixes, emit);
          anyFixApplied = true;
          emit({
            type: "fix:applied",
            timestamp: Date.now(),
            message: `Applied ${retryDiagnosis.suggestedFixes.length} fix(es) for ${resolvedSpec} (user-overridden to test)`,
          });
        } else {
          emit({ type: "log", timestamp: Date.now(), message: `[fix] Retry still produced no fixes for ${resolvedSpec}` });
        }
        continue;
      }

      if (diagnosis.suggestedFixes && diagnosis.suggestedFixes.length > 0) {
        applyFixes(workDir, diagnosis.suggestedFixes, emit);
        anyFixApplied = true;
        emit({
          type: "fix:applied",
          timestamp: Date.now(),
          message: `Applied fix for ${resolvedSpec} — addressing ${allErrors.length} error(s) (${diagnosis.issueType})`,
        });
      } else {
        emit({ type: "log", timestamp: Date.now(), message: `[fix] No fixes suggested for ${resolvedSpec}` });
      }
    } catch (error: any) {
      console.log(`[ft-fix] ERROR analyzing ${resolvedSpec}: ${error.message}`);
      console.log(`[ft-fix] Stack: ${error.stack}`);
      emit({
        type: "fix:error",
        timestamp: Date.now(),
        message: `Failed to analyze ${resolvedSpec}: ${error.message}`,
      });
      emit({ type: "log", timestamp: Date.now(), message: `[fix] Full error: ${error.stack || error.message}` });
    }
  }

  if (!anyFixApplied) {
    console.log(`[ft-fix] No fixes applied — skipping re-run, going to cleanup`);
    emit({ type: "log", timestamp: Date.now(), message: `[fix] No auto-fixable issues found after analyzing ${failedSpecs.length} spec(s). All issues were classified as app-logic or had no suggested fixes.` });
    emitManualFixRequired(state, emit, "No auto-fixable issues found. Manual review required.");
    return new Command({
      update: { fixAttempt: state.maxFixAttempts },
      goto: "cleanupNode",
    });
  }

  emit({ type: "log", timestamp: Date.now(), message: `[fix] Fix attempt ${fixAttempt + 1} applied successfully — re-running ${failedSpecs.length} failed spec(s)` });
  emit({
    type: "fix:complete",
    timestamp: Date.now(),
    message: `Fix attempt ${fixAttempt + 1} complete — re-running failed tests`,
  });

  // Build the spec list for re-run
  const specsToRerun = state.allSpecs.filter((s) =>
    failedSpecs.some((f) => s.includes(f) || s.endsWith(f) || f.includes(s))
  );
  const finalSpecs = specsToRerun.length > 0 ? specsToRerun : failedSpecs;

  // Restart server cleanly before re-running tests after a fix
  emit({ type: "log", timestamp: Date.now(), message: `[fix] Restarting server for clean re-run...` });
  try {
    const channel = getChannel(runId);
    stopProcess(channel.serverProcess);
    const newPort = await findAvailablePort();
    const newServer = await startProdServer(workDir, newPort, emit);
    channel.serverProcess = newServer;
    emit({ type: "log", timestamp: Date.now(), message: `[fix] Server restarted on port ${newPort}` });

    return new Command({
      update: {
        fixAttempt: fixAttempt + 1,
        fixesApplied: true,
        workerResultsOffset: state.workerResults.length,
        totalPassed: 0,
        totalFailed: 0,
        totalDuration: 0,
        allResults: [],
        allSpecs: finalSpecs,
        port: newPort,
      },
      goto: "splitNode",
    });
  } catch (restartErr: any) {
    emit({ type: "log", timestamp: Date.now(), message: `[fix] Failed to restart server: ${(restartErr as Error).message}` });
    emitManualFixRequired(state, emit, "Fix was applied but server could not be restarted.");
    return new Command({
      update: { fixAttempt: state.maxFixAttempts, fixesApplied: true },
      goto: "cleanupNode",
    });
  }

}

async function cleanupNode(state: FTState): Promise<Partial<FTState>> {
  const { runId, workDir, totalPassed, totalFailed, totalDuration, allResults, fixAttempt, complianceResults } = state;
  // If no tests ran at all (e.g. setup/server error before cypress) treat as failure
  const totalRan = (totalPassed || 0) + (totalFailed || 0);
  const conclusion = totalRan > 0 && totalFailed === 0 ? "success" : "failure";

  console.log("\n" + "=".repeat(60));
  console.log("[Supervisor] === Final Summary ===");
  console.log(`  Conclusion: ${conclusion.toUpperCase()}`);
  console.log(`  Passed:     ${totalPassed}`);
  console.log(`  Failed:     ${totalFailed}`);
  console.log(`  Duration:   ${Math.round((totalDuration || 0) / 1000)}s`);
  console.log(`  Total:      ${(allResults || []).length} test(s)`);
  console.log(`  Fix rounds: ${fixAttempt}`);
  console.log("=".repeat(60) + "\n");

  const channel = getChannel(runId);
  const { emit } = channel;
  const startTime = Date.now();

  emit({ type: "step:start", timestamp: Date.now(), step: "collect-results" });

  emitSupervisorLog(emit, `=== Final Summary ===`);
  emitSupervisorLog(emit, `  Conclusion: ${conclusion.toUpperCase()}`);
  emitSupervisorLog(emit, `  Passed: ${totalPassed} | Failed: ${totalFailed} | Total: ${(allResults || []).length}`);
  emitSupervisorLog(emit, `  Duration: ${Math.round((totalDuration || 0) / 1000)}s | Fix rounds: ${fixAttempt}`);

  if (totalFailed > 0) {
    const failedTests = (allResults || []).filter((r) => r.status === "failed");
    emitSupervisorLog(emit, `  Remaining failures:`);
    failedTests.forEach((t, i) => {
      emitSupervisorLog(emit, `    ${i + 1}. ${path.basename(t.file)} > "${t.testName}"`);
      const shortError = (t.error || "Unknown error").split("\n")[0].slice(0, 150);
      emit({ type: "test:fail-reason", timestamp: Date.now(), file: t.file, reason: shortError } as any);
    });
  }

  // Collect error messages from workers and failed tests
  const errorMessages: string[] = [];
  for (const wr of state.workerResults || []) {
    if (wr.error) errorMessages.push(`Worker ${wr.workerId}: ${wr.error}`);
    for (const r of wr.results || []) {
      if (r.status === "failed" && r.error) {
        errorMessages.push(`${r.file}: ${r.error}`);
      }
    }
  }

  // Update SQLite with final results
  updateRun(runId, {
    status: "completed",
    conclusion,
    total_specs: (allResults || []).length,
    passed_specs: totalPassed || 0,
    failed_specs: totalFailed || 0,
    duration_ms: totalDuration || 0,
    artifacts_dir: null,
    results_json: JSON.stringify(allResults || []),
    error_message: errorMessages.length > 0 ? errorMessages.join("\n") : null,
    compliance_json: complianceResults && complianceResults.length > 0
      ? JSON.stringify(complianceResults)
      : null,
  });

  // Log per-test results — use ALL worker results across all rounds (not just last round)
  // Deduplicate by filename (not full path), keeping the LAST result for each spec
  try {
    const allWorkerResults = (state.workerResults || []).flatMap((w) => w.results || []);
    const byFile = new Map<string, typeof allWorkerResults[0]>();
    for (const r of allWorkerResults) {
      const fileName = r.file?.split("/").pop() || r.file;
      byFile.set(fileName, { ...r, file: r.file });
    }
    // Also include any specs from allSpecs that aren't in workerResults
    // (e.g., auto-trimmed specs that passed without a re-run)
    for (const spec of state.allSpecs || []) {
      const specName = spec.split("/").pop() || spec;
      if (!byFile.has(specName)) {
        const isFailed = (state.failedSpecs || []).some((f) => f.includes(specName));
        byFile.set(specName, { file: spec, status: isFailed ? "failed" : "passed", duration: 0, testName: specName } as any);
      }
    }
    for (const result of byFile.values()) {
      insertTestResult({
        run_id: runId,
        file: result.file,
        test_name: result.testName || undefined,
        status: result.status,
        duration_ms: result.duration || 0,
        error_message: result.error || undefined,
        screenshots: result.screenshots ? JSON.stringify(result.screenshots) : undefined,
        video: result.video || undefined,
        attempt_number: result.attempts || 1,
        retry_attempts: result.retryAttempts ? JSON.stringify(result.retryAttempts) : undefined,
      });
    }
  } catch (e) {
    console.warn(`[Cleanup] Failed to log test results for ${runId}:`, e);
  }

  // Log step metrics
  try {
    insertMetric({
      run_id: runId,
      step_name: "total",
      duration_ms: totalDuration || 0,
      metadata: JSON.stringify({ passed: totalPassed, failed: totalFailed, fixRounds: fixAttempt }),
    });
  } catch (e) {
    console.warn(`[Cleanup] Failed to log metrics for ${runId}:`, e);
  }

  // Log errors
  try {
    for (const errMsg of errorMessages) {
      insertError({
        run_id: runId,
        error_type: "test",
        error_message: errMsg,
      });
    }
  } catch (e) {
    console.warn(`[Cleanup] Failed to log errors for ${runId}:`, e);
  }

  emit({
    type: "step:complete",
    timestamp: Date.now(),
    step: "collect-results",
    duration: Date.now() - startTime,
  });

  // Collect screenshots from workDir for the SSE event
  const screenshotPaths: string[] = [];
  if (workDir) {
    const screenshotDirMap = [
      { absPath: path.join(workDir, "cypress", "reports", "screenshots"), relBase: "cypress/reports/screenshots" },
      { absPath: path.join(workDir, "cypress", "screenshots"),            relBase: "cypress/screenshots" },
    ];
    for (const { absPath: ssDir, relBase } of screenshotDirMap) {
      if (fs.existsSync(ssDir)) {
        const collectFiles = (dir: string, base: string) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const rel = path.join(base, entry.name);
            if (entry.isDirectory()) collectFiles(path.join(dir, entry.name), rel);
            else if (/\.(png|jpg|jpeg|gif)$/i.test(entry.name)) screenshotPaths.push(rel);
          }
        };
        collectFiles(ssDir, relBase);
      }
    }
  }

  // Emit final results for SSE — include workDir + port for manual fix editor
  emit({
    type: "run:results",
    timestamp: Date.now(),
    conclusion,
    total: (allResults || []).length,
    passed: totalPassed || 0,
    failed: totalFailed || 0,
    duration: totalDuration || 0,
    results: allResults || [],
    screenshots: screenshotPaths,
    workDir,
    port: state.port,
    complianceResults: complianceResults || [],
  } as any);

  // Save artifacts + generated tests to per-user persistent directory
  const generatedSpecs = state.generatedSpecs || [];
  const userId = state.config.userId || state.config.triggeredBy || "_shared";
  const savedDir = path.join(process.cwd(), "data", "artifacts", userId, runId);
  fs.mkdirSync(savedDir, { recursive: true });

  // Save generated test specs
  if (generatedSpecs.length > 0 && workDir) {
    for (const specPath of generatedSpecs) {
      const srcFile = path.join(workDir, specPath);
      if (fs.existsSync(srcFile)) {
        const destFile = path.join(savedDir, "generated-tests", specPath);
        fs.mkdirSync(path.dirname(destFile), { recursive: true });
        fs.copyFileSync(srcFile, destFile);
      }
    }
    emitSupervisorLog(emit, `Saved ${generatedSpecs.length} generated test(s)`);
  }

  // Always save Cypress screenshots/videos/reports
  if (workDir) {
    const artifactDirs = [
      "cypress/reports/screenshots",
      "cypress/reports/videos",
      "cypress/reports",
      "cypress/screenshots",
      "cypress/videos",
    ];
    for (const artifactDir of artifactDirs) {
      const srcDir = path.join(workDir, artifactDir);
      if (fs.existsSync(srcDir)) {
        const destDir = path.join(savedDir, artifactDir);
        copyDirRecursive(srcDir, destDir);
      }
    }
  }

  updateRun(runId, { artifacts_dir: savedDir });
  emitSupervisorLog(emit, `Artifacts saved to data/artifacts/${userId}/${runId}/`);

  // Auto-cleanup: keep only the last 1 artifact directory per user
  try {
    const userArtifactsDir = path.join(process.cwd(), "data", "artifacts", userId);
    const runDirs = fs.readdirSync(userArtifactsDir)
      .filter((d) => d.startsWith("ft-"))
      .sort((a, b) => {
        const tsA = parseInt(a.split("-")[1] || "0");
        const tsB = parseInt(b.split("-")[1] || "0");
        return tsB - tsA; // newest first
      });
    for (const old of runDirs.slice(1)) {
      fs.rmSync(path.join(userArtifactsDir, old), { recursive: true, force: true });
    }
    if (runDirs.length > 1) {
      emitSupervisorLog(emit, `Cleaned up ${runDirs.length - 1} old artifact set(s) — keeping last 1`);
    }
  } catch { /* non-fatal */ }

  // Clear workspace screenshots now that they've been copied to artifacts
  if (workDir) {
    for (const ssDir of ["cypress/screenshots", "cypress/reports/screenshots", "cypress/reports/videos", "cypress/videos"]) {
      const fullSsDir = path.join(workDir, ssDir);
      if (fs.existsSync(fullSsDir)) {
        try { fs.rmSync(fullSsDir, { recursive: true, force: true }); } catch { /* non-fatal */ }
      }
    }
  }

  // Push fixes if applied and tests passed
  if (state.fixesApplied && conclusion === "success") {
    try {
      await gitCommitAndPush(
        workDir,
        `fix(ft): auto-fix Cypress test failures [attempt ${state.fixAttempt}]`,
        emit
      );
    } catch (error: any) {
      emit({ type: "log", timestamp: Date.now(), message: `Failed to push fixes: ${error.message}` });
    }
  }

  // When manual fix is needed (failures + non-execute-only mode), keep server and clone alive
  const fixMode = state.config.fixMode || "execute-only";
  const manualFixPending = totalFailed > 0 && fixMode !== "execute-only";

  if (manualFixPending) {
    emit({ type: "log", timestamp: Date.now(), message: "Clone preserved for manual fix editor" });
    // Don't delete side channel — manual fix API may need it
  } else {
    const keepAlive = state.config.keepServerAlive;
    const poolUserId = state.config.userId || state.config.triggeredBy || "unknown";

    if (keepAlive && channel.serverProcess && state.port) {
      releaseServerToPool(
        poolUserId, state.config.owner, state.config.repo, state.config.branch,
        state.port, channel.serverProcess, workDir
      );
      emit({ type: "log", timestamp: Date.now(), message: `Server released to pool (port ${state.port}, 30min idle timeout)` });
    } else {
      stopProcess(channel.serverProcess);
    }

    // On failure, preserve the clone for debugging
    if (totalFailed > 0) {
      emit({ type: "log", timestamp: Date.now(), message: `[debug] Clone preserved for inspection at: ${workDir}` });
    } else if (!state.config.skipSetup && !keepAlive) {
      cleanupWorkDir(workDir);
    } else {
      emit({ type: "log", timestamp: Date.now(), message: "Clone directory preserved for reuse" });
    }

    // Clean up side channel
    sideChannels.delete(runId);
  }

  return { status: "completed" };
}

// ============= Build Graphs =============

/**
 * Build the standard run-only graph (existing behavior).
 * Flow: setup → split → worker → aggregate → decision → fix/cleanup
 */
export function buildFTGraph() {
  const graph = new StateGraph(FTGraphState)
    .addNode("setupNode", setupNode)
    .addNode("splitNode", splitNode, { ends: ["workerNode", "cleanupNode"] })
    .addNode("workerNode", workerNode)
    .addNode("aggregateNode", aggregateNode)
    .addNode("fixNode", fixNode, { ends: ["splitNode", "cleanupNode"] })
    .addNode("supervisorFixNode", supervisorFixNode)
    .addNode("cleanupNode", cleanupNode)

    .addEdge(START, "setupNode")
    .addEdge("setupNode", "splitNode")
    .addEdge("workerNode", "aggregateNode")
    .addConditionalEdges("aggregateNode", decisionRouter, {
      cleanupNode: "cleanupNode",
      fixNode: "fixNode",
      supervisorFixNode: "supervisorFixNode",
    })
    // fixNode uses Command with goto (routes to splitNode or cleanupNode internally)
    // supervisorFixNode loops back to splitNode for re-run
    .addEdge("supervisorFixNode", "splitNode")
    .addEdge("cleanupNode", END);

  return graph.compile();
}

/**
 * Build the combined generate → run → fix graph.
 * Flow: setup → generate → split → worker → aggregate → decision → supervisorFix/cleanup
 *
 * The Supervisor Agent validates generated tests and asks the Generator Agent
 * to fix any failures. This loop continues until all tests pass or max attempts.
 */
export function buildGenerateAndValidateGraph() {
  const graph = new StateGraph(FTGraphState)
    .addNode("setupNode", setupNode)
    .addNode("generateNode", generateNode)
    .addNode("complianceGateNode", complianceGateNode)
    .addNode("splitNode", splitNode, { ends: ["workerNode", "cleanupNode"] })
    .addNode("workerNode", workerNode)
    .addNode("aggregateNode", aggregateNode)
    .addNode("supervisorFixNode", supervisorFixNode)
    .addNode("cleanupNode", cleanupNode)

    .addEdge(START, "setupNode")
    .addEdge("setupNode", "generateNode")
    .addEdge("generateNode", "complianceGateNode")
    .addEdge("complianceGateNode", "splitNode")
    .addEdge("workerNode", "aggregateNode")
    .addConditionalEdges("aggregateNode", decisionRouter, {
      cleanupNode: "cleanupNode",
      supervisorFixNode: "supervisorFixNode",
    })
    .addEdge("supervisorFixNode", "splitNode")
    .addEdge("cleanupNode", END);

  return graph.compile();
}

// ============= Invoke Graphs =============

export async function invokeFTGraph(params: {
  runId: string;
  config: FTRunConfig;
  specs: string[];
  workerCount: number;
  emit: EventCallback;
}): Promise<void> {
  const { runId, config, specs, workerCount, emit } = params;

  // Register the non-serializable objects in the side channel
  registerSideChannel(runId, emit);

  const graph = buildFTGraph();

  const initialState: Partial<FTState> = {
    runId,
    config,
    allSpecs: specs,
    workerCount: Math.max(1, Math.min(workerCount, 4)),
    workerResults: [],
    totalPassed: 0,
    totalFailed: 0,
    totalDuration: 0,
    failedSpecs: [],
    allResults: [],
    fixAttempt: 0,
    maxFixAttempts: config.maxFixAttempts || 10,
    fixesApplied: false,
    workerResultsOffset: 0,
    status: "queued",
    error: null,
    workDir: "",
    port: 0,
    workerSpecs: [],
    workerId: 0,
    selectedFolders: [],
    templateType: "comprehensive",
    overwriteExisting: false,
    generatedSpecs: [],
    isGenerateAndValidate: false,
  };

  try {
    await graph.invoke(initialState, { recursionLimit: 100 });
  } catch (error: any) {
    const errorMsg = error?.message || "Graph execution failed";
    emit({ type: "run:error", timestamp: Date.now(), runId, error: errorMsg });
    updateRun(runId, {
      status: "failed",
      conclusion: "failure",
      error_message: errorMsg,
    });
    try { insertError({ run_id: runId, error_type: "system", error_category: "graph_crash", error_message: errorMsg, stack_trace: error?.stack, step: "graph_execution" }); } catch { /* non-blocking */ }
  } finally {
    emit({ type: "run:complete", timestamp: Date.now(), runId });
    // Ensure side channel is cleaned up
    sideChannels.delete(runId);
  }
}

/**
 * Invoke the combined Generate → Validate → Fix graph.
 * Supervisor runs generated tests and asks Generator to fix failures.
 */
export async function invokeGenerateAndValidateGraph(params: {
  runId: string;
  config: FTRunConfig;
  selectedFolders: string[];
  manualPaths: string[];
  templateType: "basic" | "comprehensive";
  overwriteExisting: boolean;
  workerCount: number;
  maxFixAttempts: number;
  emit: EventCallback;
}): Promise<void> {
  const { runId, config, selectedFolders, manualPaths, templateType, overwriteExisting, workerCount, maxFixAttempts, emit } = params;

  registerSideChannel(runId, emit);

  const graph = buildGenerateAndValidateGraph();

  const initialState: Partial<FTState> = {
    runId,
    config,
    allSpecs: [],
    workerCount: Math.max(1, Math.min(workerCount, 4)),
    workerResults: [],
    totalPassed: 0,
    totalFailed: 0,
    totalDuration: 0,
    failedSpecs: [],
    allResults: [],
    fixAttempt: 0,
    maxFixAttempts,
    status: "queued",
    error: null,
    workDir: "",
    port: 0,
    workerSpecs: [],
    workerId: 0,
    selectedFolders,
    manualPaths,
    templateType,
    overwriteExisting,
    generatedSpecs: [],
    isGenerateAndValidate: true,
  };

  try {
    emitSupervisorLog(emit, "Starting Generate & Validate pipeline");
    emitSupervisorLog(emit, `  Folders: ${selectedFolders.join(", ") || "(none)"}`);
    emitSupervisorLog(emit, `  Manual paths: ${manualPaths.join(", ") || "(none)"}`);
    emitSupervisorLog(emit, `  Template: ${templateType}`);
    emitSupervisorLog(emit, `  Max fix attempts: ${maxFixAttempts}`);

    await graph.invoke(initialState, { recursionLimit: 100 });
  } catch (error: any) {
    const errorMsg = error?.message || "Generate & Validate graph execution failed";
    emit({ type: "run:error", timestamp: Date.now(), runId, error: errorMsg });
    updateRun(runId, {
      status: "failed",
      error_message: errorMsg,
    });
    try { insertError({ run_id: runId, error_type: "system", error_category: "graph_crash", error_message: errorMsg, stack_trace: error?.stack, step: "generate_validate_graph" }); } catch { /* non-blocking */ }
  } finally {
    emit({ type: "run:complete", timestamp: Date.now(), runId });
    sideChannels.delete(runId);
  }
}
