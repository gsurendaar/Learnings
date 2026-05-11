import { NextRequest, NextResponse } from "next/server";
import { runnerManager } from "@/services/ftRunner";
import { FTRunConfig } from "@/types/ft";
import { APP_CONFIG } from "@/config/app";
import { insertUserInput, insertError } from "@/lib/ftDatabase";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { owner, repo, branch, specPattern, testFiles, browser, retries, runMode, workerCount, githubToken, triggeredBy, skipSetup, existingWorkDir, fixMode, llmApiKey, agentMode, maxFixAttempts, maxComplianceFixes, keepServerAlive } = body;

    // Multi-agent parallel mode: one agent per file, no GitHub clone needed
    if (agentMode && testFiles?.length > 0) {
      const runId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      console.log(`\n[Trigger] Multi-agent mode: ${testFiles.length} file(s)`);
      console.log(`  Run ID: ${runId}`);
      console.log(`  Files: ${testFiles.join(", ")}`);

      await runnerManager.startMultiAgentRun(runId, {
        testFiles,
        browser: browser || "electron",
        runMode: runMode || "headless",
        triggeredBy: triggeredBy || "ft-builder",
        llmApiKey: llmApiKey || undefined,
        llmBaseUrl: body.llmBaseUrl || APP_CONFIG.llm.baseUrl,
        llmModel: body.llmModel || undefined,
        userId: triggeredBy || body.userId || undefined,
        owner: owner || undefined,
        repo: repo || undefined,
        branch: branch || undefined,
        githubToken: githubToken || undefined,
      });

      return NextResponse.json({
        success: true,
        runId,
        message: `Multi-agent run started: ${testFiles.length} agent(s)`,
        streamUrl: `/api/ft-runner/stream?runId=${runId}`,
      });
    }

    // owner/repo/branch are optional in local mode when existingWorkDir is provided
    if (!existingWorkDir && (!owner || !repo || !branch)) {
      return NextResponse.json(
        { success: false, message: "owner, repo, and branch are required (or provide existingWorkDir for local mode)" },
        { status: 400 }
      );
    }

    if (!specPattern && (!testFiles || testFiles.length === 0)) {
      return NextResponse.json(
        { success: false, message: "specPattern or testFiles are required" },
        { status: 400 }
      );
    }

    // githubToken not required in local mode (no cloning needed)
    if (!githubToken && !existingWorkDir) {
      return NextResponse.json(
        { success: false, message: "githubToken is required" },
        { status: 401 }
      );
    }

    // Build spec pattern from selected files if not provided directly
    const resolvedSpecPattern = specPattern || testFiles.map((f: string) => `cypress/e2e/${f}`).join(",");

    const runId = `ft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const config: FTRunConfig = {
      owner,
      repo,
      branch,
      specPattern: resolvedSpecPattern,
      testFiles: testFiles || [],
      browser: browser || "electron",
      retries: retries ?? 1,
      runMode: runMode || "headless",
      workerCount: workerCount ?? 1,
      triggeredBy: triggeredBy || "unknown",
      githubToken,
      skipSetup: skipSetup || false,
      existingWorkDir: existingWorkDir || undefined,
      fixMode: fixMode || "execute-only",
      maxFixAttempts: maxFixAttempts || undefined,
      maxComplianceFixes: maxComplianceFixes || undefined,
      userId: triggeredBy || undefined,
      keepServerAlive: keepServerAlive || false,
      llmApiKey: llmApiKey || undefined,
      llmBaseUrl: APP_CONFIG.llm.baseUrl,
    };

    // Log user input
    try {
      insertUserInput({
        run_id: runId,
        user_id: triggeredBy || undefined,
        owner,
        repo,
        branch,
        selected_files: testFiles ? JSON.stringify(testFiles) : specPattern,
        browser: config.browser,
        retries: config.retries,
        run_mode: config.runMode,
        worker_count: config.workerCount,
        fix_mode: config.fixMode,
        skip_setup: config.skipSetup,
      });
    } catch (e) {
      console.warn("[Trigger] Failed to log user input:", e);
    }

    await runnerManager.startRun(runId, config);

    return NextResponse.json({
      success: true,
      runId,
      message: `Test run started on branch ${branch}`,
    });
  } catch (error: any) {
    console.error("Error triggering FT run:", error);
    return NextResponse.json(
      { success: false, message: error?.message || "Failed to start test run" },
      { status: 500 }
    );
  }
}
