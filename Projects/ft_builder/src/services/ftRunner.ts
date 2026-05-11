import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { FTRunConfig, FTRunStep } from "@/types/ft";
import { insertRun, insertMetric, insertError, copyAgentLogs, findRecentSuggestionsRun } from "@/lib/ftDatabase";
import { invokeFTGraph, invokeGenerateAndValidateGraph } from "./ftGraph";
import { FT_CONFIG, cloneRepo, createWorkDir, cleanupWorkDir, getUserRepoPath } from "./ftSetup";
import { generateTests, regenerateForCompliance, type GenerateRequest } from "./ftGenerator";
import { validateCompliance } from "./ftComplianceValidator";
import { getGitHubCredentials, getLLMCredentials } from "@/config/env";

// ============= Types =============

export interface RunEvent {
  type: string;
  timestamp: number;
  [key: string]: any;
}

// ============= FT Runner Manager (Singleton) =============

interface ActiveRun {
  config: FTRunConfig;
  startedAt: Date;
  status: string;
  steps: FTRunStep[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generationResult?: any;
}

class FTRunnerManager {
  private activeRuns = new Map<string, ActiveRun>();
  private events = new EventEmitter();

  constructor() {
    this.events.setMaxListeners(50);
  }

  async startRun(runId: string, config: FTRunConfig): Promise<string> {
    // Auto-expire stale active runs (older than 30 minutes)
    const STALE_RUN_MS = 30 * 60 * 1000;
    for (const [id, run] of this.activeRuns) {
      if (Date.now() - run.startedAt.getTime() > STALE_RUN_MS) {
        console.log(`[FT Runner] Auto-expiring stale run: ${id} (started ${Math.round((Date.now() - run.startedAt.getTime()) / 60000)}min ago)`);
        this.activeRuns.delete(id);
      }
    }

    if (this.activeRuns.size >= FT_CONFIG.maxConcurrentRuns) {
      throw new Error(`Max concurrent runs (${FT_CONFIG.maxConcurrentRuns}) reached. Try again later.`);
    }

    // Insert initial record into SQLite
    insertRun({
      run_id: runId,
      owner: config.owner,
      repo: config.repo,
      branch: config.branch,
      spec_pattern: config.specPattern,
      browser: config.browser || "electron",
      retries: config.retries || 1,
      run_mode: config.runMode || "headless",
      triggered_by: config.triggeredBy || "unknown",
    });

    // Auto-link recent suggestion logs to this run
    const userId = config.triggeredBy || config.userId;
    if (userId) {
      try {
        const sugRunId = findRecentSuggestionsRun(userId);
        if (sugRunId) {
          const copied = copyAgentLogs(sugRunId, runId);
          if (copied > 0) console.log(`[FT Runner] Linked ${copied} suggestion log(s) from ${sugRunId} → ${runId}`);
        }
      } catch { /* non-blocking */ }
    }

    const activeRun: ActiveRun = {
      config,
      startedAt: new Date(),
      status: "queued",
      steps: [],
    };

    this.activeRuns.set(runId, activeRun);

    // Stream all events to a log file for debugging
    const logDir = path.join(process.cwd(), "data", "ft-logs");
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, `${runId}.log`);
    const logStream = fs.createWriteStream(logFile, { flags: "w" });
    logStream.write(`=== FT Run ${runId} started at ${new Date().toISOString()} ===\n`);
    logStream.write(`Config: ${JSON.stringify({ owner: config.owner, repo: config.repo, branch: config.branch, fixMode: config.fixMode, workerCount: config.workerCount })}\n\n`);
    console.log(`[ft-runner] Log file: ${logFile}`);

    // Event callback — bridges LangGraph node emissions to SSE + log file
    const stepTimestamps = new Map<string, number>();
    let logStreamOpen = true;
    const emit = (event: RunEvent) => {
      // Write every event to log file (guard against writes after stream is closed)
      if (logStreamOpen) {
        const ts = new Date(event.timestamp).toISOString();
        const msg = event.message || event.error || JSON.stringify(event);
        logStream.write(`[${ts}] [${event.type}] ${msg}\n`);
      }

      // Track steps
      if (event.type === "step:start" && event.step) {
        activeRun.status = event.step;
        activeRun.steps.push({ name: event.step, status: "running" });
        stepTimestamps.set(event.step, Date.now());
      }
      if (event.type === "step:complete" && event.step) {
        const step = activeRun.steps.find((s) => s.name === event.step);
        if (step) {
          step.status = "completed";
          step.duration = event.duration;
        }
        // Log step metric
        const startedAt = stepTimestamps.get(event.step);
        try {
          insertMetric({
            run_id: runId,
            step_name: event.step,
            started_at: startedAt ? new Date(startedAt).toISOString() : undefined,
            completed_at: new Date().toISOString(),
            duration_ms: event.duration || (startedAt ? Date.now() - startedAt : 0),
          });
        } catch { /* ignore metric logging errors */ }
      }
      if (event.type === "step:error" && event.step) {
        const step = activeRun.steps.find((s) => s.name === event.step);
        if (step) {
          step.status = "failed";
          step.error = event.error;
        }
      }
      if (event.type === "run:complete" || event.type === "run:error") {
        activeRun.status = event.type === "run:error" ? "failed" : "completed";
        if (logStreamOpen) {
          logStream.write(`\n=== FT Run ${runId} ended at ${new Date().toISOString()} (${event.type}) ===\n`);
          logStreamOpen = false;
          logStream.end();
        }
        // Clean up after 10 seconds (reduced from 30s)
        setTimeout(() => this.activeRuns.delete(runId), 10000);
      }

      // Forward to SSE subscribers
      this.events.emit(`run:${runId}`, event);
    };

    // Resolve spec paths — find actual file locations in the repo
    const pathMod = await import("path");
    const fsMod = await import("fs");
    const userRepoDir = config.userId
      ? getUserRepoPath(config.userId, config.repo || "sparkxnodeweb", {
          owner: config.owner,
          branch: config.branch,
          source: "FTRunner",
        })
      : null;
    const repoDir = config.existingWorkDir || userRepoDir || pathMod.join(process.cwd(), "repos", "sparkxnodeweb");

    const resolveSpecPath = (f: string): string => {
      // Already a full path — trust it (worker handles __tests__/ → cypress/e2e/_generated/ copy)
      if (f.startsWith("__tests__/")) return f;
      if (f.startsWith("cypress/")) {
        if (fsMod.existsSync(pathMod.join(repoDir, f))) return f;
      }
      // Try common locations
      const candidates = [
        f,
        `cypress/e2e/${f}`,
        `__tests__/${f}`,
      ];
      // Also search recursively in __tests__ and cypress/e2e
      const searchDirs = ["__tests__", "cypress/e2e"];
      for (const dir of searchDirs) {
        const dirPath = pathMod.join(repoDir, dir);
        if (fsMod.existsSync(dirPath)) {
          const findFile = (d: string): string | null => {
            try {
              const entries = fsMod.readdirSync(d, { withFileTypes: true });
              for (const entry of entries) {
                const full = pathMod.join(d, entry.name);
                if (entry.isDirectory()) {
                  const found = findFile(full);
                  if (found) return found;
                } else if (entry.name === pathMod.basename(f)) {
                  return pathMod.relative(repoDir, full);
                }
              }
            } catch { /* skip */ }
            return null;
          };
          const found = findFile(dirPath);
          if (found) return found;
        }
      }
      // Fallback to candidate paths
      for (const c of candidates) {
        if (fsMod.existsSync(pathMod.join(repoDir, c))) return c;
      }
      // Last resort — keep __tests__/ paths as-is, add cypress/e2e/ to others
      return f.startsWith("cypress/") || f.startsWith("__tests__/") ? f : `cypress/e2e/${f}`;
    };

    const specs = config.testFiles.length > 0
      ? config.testFiles.map(resolveSpecPath)
      : [config.specPattern];

    console.log(`[FT Runner] Resolved specs:`, specs);

    const workerCount = config.workerCount || Math.min(specs.length, 4);

    // Start the LangGraph execution in background (don't await)
    invokeFTGraph({
      runId,
      config,
      specs,
      workerCount,
      emit,
    }).catch((err) => {
      console.error(`Run ${runId} graph failed:`, err);
      try {
        const { updateRun } = require("@/lib/ftDatabase");
        updateRun(runId, { status: "failed", error_message: err?.message || "Graph execution failed" });
      } catch { /* best effort */ }
      try { insertError({ run_id: runId, error_type: "system", error_category: "runner_crash", error_message: err?.message || "Graph execution failed", stack_trace: err?.stack, step: "graph_invocation" }); } catch { /* non-blocking */ }
      emit({ type: "run:error", timestamp: Date.now(), runId, error: err?.message || "Graph execution failed" });
      emit({ type: "run:complete", timestamp: Date.now(), runId });
    }).finally(() => {
      // Failsafe: ensure run is cleaned up even if events didn't fire
      setTimeout(() => {
        if (this.activeRuns.has(runId)) {
          console.log(`[FT Runner] Failsafe cleanup for ${runId}`);
          this.activeRuns.delete(runId);
        }
      }, 5000);
    });

    // Absolute failsafe: auto-expire this run after 30 minutes no matter what
    setTimeout(() => {
      if (this.activeRuns.has(runId)) {
        console.log(`[FT Runner] 30-min failsafe: force-expiring run ${runId}`);
        this.activeRuns.delete(runId);
      }
    }, 30 * 60 * 1000);

    return runId;
  }

  /**
   * Start an async test generation job. Returns genId immediately.
   * Stream events via /api/ft-runner/stream?runId={genId}
   */
  async startGeneration(genId: string, params: Record<string, unknown>): Promise<string> {
    const activeRun: ActiveRun = {
      config: {} as FTRunConfig,
      startedAt: new Date(),
      status: "queued",
      steps: [],
    };
    this.activeRuns.set(genId, activeRun);

    const emit = (event: RunEvent) => {
      if (event.type === "step:start" && event.step) {
        activeRun.status = event.step;
        activeRun.steps.push({ name: event.step, status: "running" });
      }
      if (event.type === "step:complete" && event.step) {
        const step = activeRun.steps.find((s) => s.name === event.step);
        if (step) { step.status = "completed"; step.duration = event.duration; }
      }
      if (event.type === "step:error" && event.step) {
        const step = activeRun.steps.find((s) => s.name === event.step);
        if (step) { step.status = "failed"; step.error = event.error; }
      }
      if (event.type === "run:complete" || event.type === "run:error") {
        activeRun.status = event.type === "run:error" ? "failed" : "completed";
        setTimeout(() => this.activeRuns.delete(genId), 60000);
      }
      this.events.emit(`run:${genId}`, event);
    };

    // Run generation in background
    (async () => {
      try {
        const llm = getLLMCredentials(params);
        const gh = getGitHubCredentials(params);

        if (!llm.isConfigured) {
          emit({ type: "run:error", timestamp: Date.now(), error: "LLM API key not configured" });
          emit({ type: "run:complete", timestamp: Date.now(), genId });
          return;
        }

        // Use per-user repo, fall back to shared, fall back to clone
        const pathMod = await import("path");
        const fsMod = await import("fs");

        const userId = (params.triggeredBy as string) || "ft-generator";
        const userRepo = getUserRepoPath(userId, gh.repo || "sparkxnodeweb");
        const legacyRepo = pathMod.join(process.cwd(), "repos", "sparkxnodeweb");

        let repoPath: string;
        let tempWorkDir: string | null = null;

        if (userRepo) {
          repoPath = userRepo;
        } else if (fsMod.existsSync(legacyRepo)) {
          repoPath = legacyRepo;
        } else if (gh.isConfigured) {
          // Only clone if local repo doesn't exist
          emit({ type: "step:start", timestamp: Date.now(), step: "clone" });
          tempWorkDir = createWorkDir(genId);
          const config: FTRunConfig = {
            owner: gh.owner, repo: gh.repo, branch: gh.branch, githubToken: gh.token,
            specPattern: "", testFiles: [], browser: "electron",
            retries: 0, runMode: "headless", workerCount: 1, triggeredBy: "ft-generator",
          };
          await cloneRepo(config, tempWorkDir, emit);
          emit({ type: "step:complete", timestamp: Date.now(), step: "clone" });
          repoPath = tempWorkDir;
        } else {
          emit({ type: "run:error", timestamp: Date.now(), error: "No repo available at repos/sparkxnodeweb" });
          emit({ type: "run:complete", timestamp: Date.now(), genId });
          return;
        }

        // Generate tests
        emit({ type: "step:start", timestamp: Date.now(), step: "generate" });

        const req: GenerateRequest = {
          selectedFolders: (params.selectedFolders as string[]) || [],
          manualPaths: (params.manualPaths as string[]) || [],
          templateType: (params.templateType as "basic" | "comprehensive") || "comprehensive",
          includeFixtures: (params.includeFixtures as boolean) || false,
          overwriteExisting: (params.overwriteExisting as boolean) || false,
          repoPath,
          llmApiKey: llm.apiKey,
          llmBaseUrl: llm.baseUrl,
          llmModel: llm.model,
          targetUseCases: (params.targetUseCases as Array<{ title: string; description: string; priority: string; sourceFile: string }>) || undefined,
          customPrompt: (params.customPrompt as string) || undefined,
        };

        const result = await generateTests(req, (msg, index, total) => {
          emit({
            type: "log",
            timestamp: Date.now(),
            message: `(${index + 1}/${total}) ${msg}`,
          });
        });

        emit({ type: "step:complete", timestamp: Date.now(), step: "generate" });

        // Supervisor review: validate generated tests against existing patterns before saving
        emit({ type: "step:start", timestamp: Date.now(), step: "supervisor-review" });
        emit({ type: "log", timestamp: Date.now(), message: "[Supervisor] Reviewing generated tests against existing patterns..." });

        try {
          const { readWorkflowExistingFTs, regenerateTest } = require("./ftGenerator");
          const { createLLMClient } = require("./langgraph/llm");
          const selectedFolder = ((params.selectedFolders as string[]) || [])[0]?.replace(/^workflows\//, "") || "";
          const existingFTs = selectedFolder ? readWorkflowExistingFTs(repoPath, selectedFolder) : [];

          if (existingFTs.length > 0 && result.generatedFiles.some((f: any) => f.status === "created")) {
            const reviewLlm = createLLMClient({ llmApiKey: llm.apiKey, llmBaseUrl: llm.baseUrl, llmModel: llm.model });

            for (const file of result.generatedFiles) {
              if (file.status !== "created") continue;
              const filePath = pathMod.join(repoPath, file.testPath);
              if (!fsMod.existsSync(filePath)) continue;

              const testContent = fsMod.readFileSync(filePath, "utf-8");

              // Quick pattern check: does the test use navigateToWorkflow? correct imports? TIMEOUTS?
              const issues: string[] = [];
              if (!testContent.includes("navigateToWorkflow")) issues.push("Missing cy.navigateToWorkflow()");
              if (!testContent.includes("TIMEOUTS")) issues.push("Not using TIMEOUTS constants");
              if (!testContent.includes("closeWorkflowAndProvideFeedback")) issues.push("Missing closeWorkflowAndProvideFeedback()");
              if (testContent.includes("cy.visit(")) issues.push("Uses cy.visit() instead of navigateToWorkflow");
              if (/timeout:\s*\d{4}\b/.test(testContent) && !testContent.includes("TIMEOUTS")) issues.push("Hardcoded timeout values");

              if (issues.length > 0) {
                emit({ type: "log", timestamp: Date.now(), message: `[Supervisor] Issues in ${pathMod.basename(file.testPath)}: ${issues.join(", ")}` });
                emit({ type: "log", timestamp: Date.now(), message: `[Supervisor] Asking Generator to fix before saving...` });

                // Ask Generator to fix the issues
                const fixedCode = await regenerateTest({
                  llm: reviewLlm,
                  specPath: file.testPath,
                  failingTestContent: testContent,
                  errorOutput: `Pre-run review found these issues:\n${issues.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}\n\nFix these issues. The test has not been run yet — these are pattern violations caught during review.`,
                  templateType: "comprehensive",
                  attemptNumber: 0,
                  existingWorkflowFTs: existingFTs,
                });

                if (fixedCode && fixedCode.length > 100) {
                  fsMod.writeFileSync(filePath, fixedCode, "utf-8");
                  emit({ type: "log", timestamp: Date.now(), message: `[Supervisor] Fixed ${pathMod.basename(file.testPath)} — ${issues.length} issue(s) resolved` });
                }
              } else {
                emit({ type: "log", timestamp: Date.now(), message: `[Supervisor] ${pathMod.basename(file.testPath)} — patterns OK` });
              }
            }
          } else {
            emit({ type: "log", timestamp: Date.now(), message: "[Supervisor] No existing FTs to compare against — skipping review" });
          }
        } catch (reviewErr) {
          emit({ type: "log", timestamp: Date.now(), message: `[Supervisor] Review failed (non-critical): ${reviewErr instanceof Error ? reviewErr.message : String(reviewErr)}` });
        }

        emit({ type: "step:complete", timestamp: Date.now(), step: "supervisor-review" });

        // Save generated files to data/generated-tests/ as backup
        try {
          const backupDir = pathMod.join(process.cwd(), "data", "generated-tests", genId);
          fsMod.mkdirSync(backupDir, { recursive: true });
          for (const f of result.generatedFiles) {
            if (f.status === "created") {
              const srcFile = pathMod.join(repoPath, f.testPath);
              if (fsMod.existsSync(srcFile)) {
                const destFile = pathMod.join(backupDir, f.testPath);
                fsMod.mkdirSync(pathMod.dirname(destFile), { recursive: true });
                fsMod.copyFileSync(srcFile, destFile);
              }
            }
          }
          emit({ type: "log", timestamp: Date.now(), message: `Backed up ${result.totalGenerated} generated file(s) to data/generated-tests/${genId}/` });
        } catch (backupErr) {
          console.warn("[FT Runner] Failed to backup generated files:", backupErr);
        }

        // Compliance validation + auto-fix loop
        const MAX_COMPLIANCE_FIXES = (params.maxComplianceFixes as number) || 5;
        let complianceResults: Awaited<ReturnType<typeof validateCompliance>> = [];

        for (let fixAttempt = 0; fixAttempt <= MAX_COMPLIANCE_FIXES; fixAttempt++) {
          const stepName = fixAttempt === 0 ? "compliance-check" : `compliance-fix-${fixAttempt}`;
          emit({ type: "step:start", timestamp: Date.now(), step: stepName });

          try {
            complianceResults = await validateCompliance({
              generatedFiles: result.generatedFiles,
              repoPath,
              llmApiKey: llm.apiKey,
              llmBaseUrl: llm.baseUrl,
              llmModel: llm.model,
              runId: genId,
            });
          } catch (compErr) {
            console.warn(`[FT Runner] Compliance check failed (attempt ${fixAttempt}):`, compErr);
            complianceResults = [];
            emit({ type: "step:complete", timestamp: Date.now(), step: stepName });
            break;
          }

          emit({ type: "step:complete", timestamp: Date.now(), step: stepName });

          // Check if all files pass compliance (score >= 90%)
          const allPassing = complianceResults.every((r) => r.score >= 90);
          if (allPassing || fixAttempt === MAX_COMPLIANCE_FIXES) {
            if (allPassing) {
              console.log(`[FT Runner] All files pass compliance (>= 90%)`);
            } else {
              console.log(`[FT Runner] Max compliance fix attempts reached (${MAX_COMPLIANCE_FIXES})`);
            }
            break;
          }

          // Fix files with low compliance scores
          const filesToFix = complianceResults.filter((r) => r.score < 90);
          console.log(`[FT Runner] Fixing ${filesToFix.length} file(s) with low compliance (attempt ${fixAttempt + 1}/${MAX_COMPLIANCE_FIXES})`);
          emit({ type: "log", timestamp: Date.now(), message: `Compliance fix attempt ${fixAttempt + 1}: fixing ${filesToFix.length} file(s)` });

          const fsMod = await import("fs");
          const pathMod = await import("path");

          for (const fileResult of filesToFix) {
            const violations = fileResult.checks
              .filter((c) => !c.passed)
              .map((c) => ({ rule: c.rule, message: c.message, severity: c.severity }));

            const fullPath = pathMod.join(repoPath, fileResult.testPath);
            let testContent: string;
            try {
              testContent = fsMod.readFileSync(fullPath, "utf-8");
            } catch {
              continue;
            }

            try {
              await regenerateForCompliance({
                testPath: fileResult.testPath,
                testContent,
                violations,
                repoPath,
                llmApiKey: llm.apiKey,
                llmBaseUrl: llm.baseUrl,
                llmModel: llm.model,
              });
            } catch (fixErr) {
              console.warn(`[FT Runner] Failed to fix ${fileResult.testPath}:`, fixErr);
            }
          }
        }

        // Store results on activeRun for polling
        const activeRunRef = this.activeRuns.get(genId);
        if (activeRunRef) {
          activeRunRef.generationResult = { ...result, complianceResults };
        }

        // Emit results with compliance data
        emit({
          type: "gen:complete",
          timestamp: Date.now(),
          ...result,
          complianceResults,
        });

        // Cleanup temp dir (but NOT if using local repo)
        if (tempWorkDir) cleanupWorkDir(tempWorkDir);

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        emit({ type: "run:error", timestamp: Date.now(), error: errorMsg });
      } finally {
        emit({ type: "run:complete", timestamp: Date.now(), genId });
      }
    })();

    return genId;
  }

  /**
   * Start a combined Generate → Validate → Fix pipeline.
   * The Generator Agent creates tests, then the Supervisor Agent runs them
   * and asks the Generator to fix any failures in a loop.
   */
  async startGenerateAndValidate(genId: string, params: Record<string, unknown>): Promise<string> {
    if (this.activeRuns.size >= FT_CONFIG.maxConcurrentRuns) {
      throw new Error(`Max concurrent runs (${FT_CONFIG.maxConcurrentRuns}) reached. Try again later.`);
    }

    const activeRun: ActiveRun = {
      config: {} as FTRunConfig,
      startedAt: new Date(),
      status: "queued",
      steps: [],
    };
    this.activeRuns.set(genId, activeRun);

    const emit = (event: RunEvent) => {
      if (event.type === "step:start" && event.step) {
        activeRun.status = event.step;
        activeRun.steps.push({ name: event.step, status: "running" });
      }
      if (event.type === "step:complete" && event.step) {
        const step = activeRun.steps.find((s) => s.name === event.step);
        if (step) { step.status = "completed"; step.duration = event.duration; }
      }
      if (event.type === "step:error" && event.step) {
        const step = activeRun.steps.find((s) => s.name === event.step);
        if (step) { step.status = "failed"; step.error = event.error; }
      }
      if (event.type === "run:complete" || event.type === "run:error") {
        activeRun.status = event.type === "run:error" ? "failed" : "completed";
        setTimeout(() => this.activeRuns.delete(genId), 60000);
      }
      this.events.emit(`run:${genId}`, event);
    };

    const llm = getLLMCredentials(params);
    const gh = getGitHubCredentials(params);

    if (!llm.isConfigured) {
      emit({ type: "run:error", timestamp: Date.now(), error: "LLM API key not configured" });
      emit({ type: "run:complete", timestamp: Date.now(), genId });
      return genId;
    }

    if (!gh.isConfigured) {
      emit({ type: "run:error", timestamp: Date.now(), error: "GitHub credentials not configured" });
      emit({ type: "run:complete", timestamp: Date.now(), genId });
      return genId;
    }

    // Insert run record
    insertRun({
      run_id: genId,
      owner: gh.owner,
      repo: gh.repo,
      branch: gh.branch,
      spec_pattern: "generated",
      browser: (params.browser as string) || "electron",
      retries: (params.retries as number) || 1,
      run_mode: (params.runMode as string) || "headless",
      triggered_by: "ft-generator-validate",
    });

    // Link suggestion agent logs to this run so they appear in the pipeline
    if (params.suggestionsRunId) {
      try {
        const copied = copyAgentLogs(params.suggestionsRunId as string, genId);
        if (copied > 0) console.log(`[Generate] Linked ${copied} suggestion log(s) from ${params.suggestionsRunId} → ${genId}`);
      } catch { /* non-blocking */ }
    }

    const config: FTRunConfig = {
      owner: gh.owner,
      repo: gh.repo,
      branch: gh.branch,
      githubToken: gh.token,
      specPattern: "generated",
      testFiles: [],
      browser: (params.browser as string) || "electron",
      retries: (params.retries as number) || 1,
      runMode: ((params.runMode as string) || "headless") as "headless" | "headed",
      workerCount: (params.workerCount as number) || 2,
      triggeredBy: (params.triggeredBy as string) || "ft-generator-validate",
      maxFixAttempts: (params.maxFixAttempts as number) || undefined,
      maxComplianceFixes: (params.maxComplianceFixes as number) || undefined,
      userId: (params.triggeredBy as string) || undefined,
      llmApiKey: llm.apiKey,
      llmBaseUrl: llm.baseUrl,
      llmModel: llm.model,
    };

    // Run the combined graph in background
    invokeGenerateAndValidateGraph({
      runId: genId,
      config,
      selectedFolders: (params.selectedFolders as string[]) || [],
      manualPaths: (params.manualPaths as string[]) || [],
      templateType: ((params.templateType as string) || "comprehensive") as "basic" | "comprehensive",
      overwriteExisting: (params.overwriteExisting as boolean) ?? true,
      workerCount: config.workerCount,
      maxFixAttempts: (params.maxFixAttempts as number) || 10,
      emit,
    }).catch((err) => {
      console.error(`Generate & Validate ${genId} failed:`, err);
    });

    return genId;
  }

  /**
   * Multi-agent parallel run using LangGraph: one worker per spec file.
   * Uses the full LangGraph pipeline: setup → split → workers → aggregate → fix loop.
   * Supervisor + Generator agents handle LLM-powered failure analysis and code fixes.
   */
  async startMultiAgentRun(
    runId: string,
    params: {
      testFiles: string[];
      browser: string;
      runMode: "headless" | "headed";
      triggeredBy?: string;
      llmApiKey?: string;
      llmBaseUrl?: string;
      llmModel?: string;
      userId?: string;
      owner?: string;
      repo?: string;
      branch?: string;
      githubToken?: string;
    }
  ): Promise<string> {
    const gh = getGitHubCredentials(params);
    const llm = getLLMCredentials(params);

    // Use the actual user's repo clone
    const pathMod = await import("path");
    const fsMod = await import("fs");
    const repoName = params.repo || gh.repo || "sparkxnodeweb";
    const userId = params.userId || params.triggeredBy || "ft-builder";

    // Search for any user's clone that exists
    let localRepo: string | null = getUserRepoPath(userId, repoName);
    if (!localRepo) {
      // Try to find any user's clone in repos/
      const reposDir = pathMod.join(process.cwd(), "repos");
      if (fsMod.existsSync(reposDir)) {
        for (const entry of fsMod.readdirSync(reposDir)) {
          const candidate = pathMod.join(reposDir, entry, gh.repo || "sparkxnodeweb");
          if (fsMod.existsSync(pathMod.join(candidate, ".git"))) {
            localRepo = candidate;
            break;
          }
        }
      }
    }
    // Last fallback to legacy shared path
    if (!localRepo) {
      localRepo = pathMod.join(process.cwd(), "repos", "sparkxnodeweb");
    }

    console.log(`[MultiAgent] userId=${userId}, repo=${repoName}, localRepo=${localRepo}`);
    console.log(`[MultiAgent] LLM creds: apiKey=${!!llm.apiKey} (${(llm.apiKey || "").length}), model=${llm.model}`);

    // Resolve bare filenames to full paths by searching in the repo
    const resolvedFiles: string[] = [];
    for (const file of params.testFiles) {
      if (file.includes("/")) {
        resolvedFiles.push(file);
      } else {
        const { execSync } = await import("child_process");
        try {
          const found = execSync(`find . -name "${file}" -type f | head -1`, {
            cwd: localRepo, encoding: "utf-8", timeout: 5000,
          }).trim();
          if (found) {
            resolvedFiles.push(found.replace(/^\.\//, ""));
            console.log(`[MultiAgent] Resolved: ${file} → ${found}`);
          } else {
            resolvedFiles.push(file);
          }
        } catch {
          resolvedFiles.push(file);
        }
      }
    }

    const config: FTRunConfig = {
      owner: params.owner || gh.owner,
      repo: params.repo || gh.repo,
      branch: params.branch || gh.branch,
      specPattern: resolvedFiles.join(","),
      testFiles: resolvedFiles,
      browser: params.browser || "chrome",
      retries: 0,
      runMode: params.runMode || "headless",
      workerCount: 1, // Sequential execution — parallel Chrome instances cause browser timeout on local machines
      triggeredBy: userId,
      githubToken: gh.token,
      skipSetup: true,
      existingWorkDir: localRepo,
      fixMode: "auto-fix",
      maxFixAttempts: 5,
      llmApiKey: llm.apiKey,
      llmBaseUrl: llm.baseUrl,
      llmModel: llm.model,
    };

    // Delegate to startRun which uses the full LangGraph pipeline
    return this.startRun(runId, config);
  }

  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    const handler = (event: RunEvent) => listener(event);
    this.events.on(`run:${runId}`, handler);
    return () => this.events.off(`run:${runId}`, handler);
  }

  getActiveRun(runId: string): (ActiveRun & { runner: { getSteps: () => FTRunStep[]; getElapsed: () => number } }) | undefined {
    const run = this.activeRuns.get(runId);
    if (!run) return undefined;
    return {
      ...run,
      runner: {
        getSteps: () => run.steps,
        getElapsed: () => Date.now() - run.startedAt.getTime(),
      },
    };
  }

  getActiveRuns(): Map<string, ActiveRun> {
    return this.activeRuns;
  }

  cancelRun(runId: string): boolean {
    const run = this.activeRuns.get(runId);
    if (run) {
      run.status = "failed";
      this.activeRuns.delete(runId);
      this.events.emit(`run:${runId}`, {
        type: "run:error",
        timestamp: Date.now(),
        runId,
        error: "Run cancelled by user",
      });
      this.events.emit(`run:${runId}`, {
        type: "run:complete",
        timestamp: Date.now(),
        runId,
      });
      // Kill the server process via side channel
      try {
        const { sideChannels } = require("./ftGraph");
        const channel = sideChannels?.get(runId);
        if (channel?.serverProcess) {
          const { stopProcess } = require("./ftSetup");
          stopProcess(channel.serverProcess);
          sideChannels.delete(runId);
        }
      } catch { /* best effort */ }
      // Update DB
      try {
        const { updateRun } = require("@/lib/ftDatabase");
        updateRun(runId, { status: "failed", error_message: "Run cancelled by user" });
      } catch { /* best effort */ }
      return true;
    }
    return false;
  }
}

// Singleton pattern for Next.js (survives hot reloads in dev)
const globalForFTRunner = globalThis as unknown as { ftRunnerManager: FTRunnerManager };

export const runnerManager = globalForFTRunner.ftRunnerManager ?? new FTRunnerManager();

if (process.env.NODE_ENV !== "production") {
  globalForFTRunner.ftRunnerManager = runnerManager;
}
