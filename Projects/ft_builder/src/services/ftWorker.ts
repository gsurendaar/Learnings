import fs from "fs";
import path from "path";
import { TestResult, RetryAttempt } from "@/types/ft";
import { execCapture, EventCallback, buildCleanEnv } from "./ftSetup";

// ============= Worker Result =============

export interface WorkerResult {
  workerId: number;
  specs: string[];
  passed: number;
  failed: number;
  total: number;
  duration: number;
  results: TestResult[];
  error?: string;
  cypressOutput?: string;
}

// ============= Cypress Worker =============

/**
 * Runs a chunk of Cypress specs against a running dev server.
 * Multiple workers can run in parallel against the same workDir and port.
 */
export async function runCypressWorker(params: {
  workerId: number;
  workDir: string;
  port: number;
  specs: string[];
  browser: string;
  retries: number;
  runMode: "headless" | "headed";
  emit: EventCallback;
}): Promise<WorkerResult> {
  const { workerId, workDir, port, specs, browser, retries, runMode, emit } = params;

  // Clean up stale DOM snapshots from previous iterations
  const snapshotCleanupDir = path.join(workDir, "cypress", "screenshots");
  if (fs.existsSync(snapshotCleanupDir)) {
    for (const f of fs.readdirSync(snapshotCleanupDir)) {
      if (f.startsWith("dom-snapshot-") && f.endsWith(".json")) {
        try { fs.rmSync(path.join(snapshotCleanupDir, f), { force: true }); } catch { /* ignore */ }
      }
    }
  }

  // Copy specs from __tests__/ to cypress/e2e/ so Cypress can find them
  // (Cypress specPattern in project config only matches cypress/e2e/**)
  // Also copy sibling files (utils.ts, helpers.ts, etc.) and fix import paths
  const resolvedSpecs: string[] = [];
  const copiedDirs = new Set<string>();

  for (const spec of specs) {
    if (spec.startsWith("__tests__/")) {
      const fileName = path.basename(spec);
      const srcDir = path.dirname(path.join(workDir, spec));
      const destDir = path.join(workDir, "cypress", "e2e", "_generated");
      fs.mkdirSync(destDir, { recursive: true });

      // Copy all sibling .ts/.tsx files from the same directory (utils, helpers, etc.)
      if (!copiedDirs.has(srcDir) && fs.existsSync(srcDir)) {
        copiedDirs.add(srcDir);
        for (const entry of fs.readdirSync(srcDir)) {
          if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
            const sibSrc = path.join(srcDir, entry);
            const sibDest = path.join(destDir, entry);
            if (!fs.existsSync(sibDest)) {
              let content = fs.readFileSync(sibSrc, "utf-8");
              content = content.replace(/(from\s+['"])(?:\.\.\/){2,}(support\/)/g, '$1../../$2');
              fs.writeFileSync(sibDest, content, "utf-8");
            }
          }
        }
      }

      // Also copy utils.ts/helpers from cypress/e2e/workflows/{workflow}/ if not already present
      // Generated tests in __tests__/ reference ./utils but utils.ts often lives in cypress/e2e/workflows/
      const workflowDir = srcDir.replace(/__tests__\/components\/console\//, "cypress/e2e/");
      if (workflowDir !== srcDir && fs.existsSync(workflowDir)) {
        for (const entry of fs.readdirSync(workflowDir)) {
          if ((entry === "utils.ts" || entry.includes("helpers.ts")) && !fs.existsSync(path.join(destDir, entry))) {
            let content = fs.readFileSync(path.join(workflowDir, entry), "utf-8");
            content = content.replace(/(from\s+['"])(?:\.\.\/){2,}(support\/)/g, '$1../../$2');
            fs.writeFileSync(path.join(destDir, entry), content, "utf-8");
          }
        }
      }

      const srcPath = path.join(workDir, spec);
      const destPath = path.join(destDir, fileName);
      if (fs.existsSync(srcPath)) {
        let content = fs.readFileSync(srcPath, "utf-8");
        content = content.replace(/(from\s+['"])(?:\.\.\/){2,}(support\/)/g, '$1../../$2');
        fs.writeFileSync(destPath, content, "utf-8");
        resolvedSpecs.push(`cypress/e2e/_generated/${fileName}`);
      } else {
        resolvedSpecs.push(spec);
      }
    } else {
      resolvedSpecs.push(spec);
    }
  }

  const specPattern = resolvedSpecs.join(",");

  const baseUrl = `http://localhost:${port}/sparkx`;
  console.log(`\n[Worker ${workerId}] Starting Cypress:`);
  console.log(`  CYPRESS_BASE_URL: ${baseUrl}`);
  console.log(`  Specs: ${resolvedSpecs.join(", ")}`);
  console.log(`  Browser: ${browser || "electron"}`);
  console.log(`  WorkDir: ${workDir}`);

  emit({
    type: "worker:start",
    timestamp: Date.now(),
    workerId,
    specs: resolvedSpecs,
    message: `Worker ${workerId} starting: ${resolvedSpecs.length} spec(s) | baseUrl: ${baseUrl}`,
  });

  // Override test-level retries by patching spec files in the clone.
  // Also inject an afterEach hook to capture DOM state on failure — this gives
  // the generator visibility into what elements are actually on the page.
  const patchedFiles: Array<{ path: string; original: string }> = [];
  const makeDomCaptureHook = (specBaseName: string) => `
afterEach(function () {
  if (this.currentTest?.state === 'failed') {
    cy.document({ log: false }).then((doc) => {
      const allEls = [...doc.querySelectorAll('[data-automation-id]')]
        .map((el) => ({
          id: el.getAttribute('data-automation-id'),
          tag: el.tagName.toLowerCase(),
          visible: el.offsetParent !== null,
          text: el.textContent?.trim().substring(0, 50) || '',
        }))
        .filter((el) => el.id);

      // Separate workflow elements from console shell elements
      const shellPrefixes = ['console-', 'account-search', 'account-overview', 'newCase', 'lla-'];
      const workflowEls = allEls.filter((el) =>
        !shellPrefixes.some((p) => el.id.startsWith(p))
      );
      const shellEls = allEls.filter((el) =>
        shellPrefixes.some((p) => el.id.startsWith(p))
      );

      const spinners = doc.querySelectorAll('.slds-spinner, .ant-spin-spinning, .slds-spinner_container').length;
      const snapshot = {
        automationIds: workflowEls.length > 0 ? workflowEls : allEls,
        shellElementCount: shellEls.length,
        workflowDetected: workflowEls.length > 0,
        spinners: spinners,
        pageState: spinners > 0 ? 'loading' : (workflowEls.length > 0 ? 'workflow_rendered' : 'no_workflow_content'),
        buttons: [...doc.querySelectorAll('button')]
          .filter((b) => b.offsetParent !== null)
          .map((b) => b.textContent?.trim().substring(0, 60))
          .filter(Boolean)
          .slice(0, 30),
        headings: [...doc.querySelectorAll('h1,h2,h3,h4')]
          .map((h) => h.textContent?.trim().substring(0, 80))
          .filter(Boolean),
        url: doc.location?.href || '',
      };
      cy.writeFile(
        'cypress/screenshots/dom-snapshot-${specBaseName}.json',
        JSON.stringify(snapshot, null, 2),
        { log: false },
      );
    });
  }
});
`;

  for (const spec of resolvedSpecs) {
    const specPath = path.join(workDir, spec);
    if (fs.existsSync(specPath)) {
      const original = fs.readFileSync(specPath, "utf-8");
      // Replace retries config in describe/it blocks: { retries: { runMode: N, ... } }
      let patched = original.replace(
        /retries:\s*\{[^}]*runMode:\s*\d+[^}]*\}/g,
        `retries: { runMode: ${retries}, openMode: 0 }`
      );
      // Append DOM capture hook (only if not already present)
      if (!patched.includes("dom-snapshot-")) {
        const specBaseName = path.basename(spec, ".cy.ts").replace(/[^a-zA-Z0-9_-]/g, "_");
        patched += makeDomCaptureHook(specBaseName);
      }
      if (patched !== original) {
        fs.writeFileSync(specPath, patched, "utf-8");
        patchedFiles.push({ path: specPath, original });
        emit({ type: "log", timestamp: Date.now(), message: `[worker-${workerId}] Patched spec: retries=${retries}, DOM capture enabled — ${spec}` });
      }
    }
  }

  // Use the project's default support file — don't override it
  const args = [
    "cypress", "run",
    "--headless",
    "--browser", browser || "electron",
    "--spec", specPattern,
    "--config", `retries=${retries}`,
  ];

  if (runMode === "headed") {
    const headlessIdx = args.indexOf("--headless");
    if (headlessIdx !== -1) args.splice(headlessIdx, 1);
    args.push("--headed");
  }

  // Each worker gets isolated report/screenshot directories
  const workerReportDir = path.join(workDir, `cypress/reports/worker-${workerId}`);
  const workerJsonDir = path.join(workerReportDir, ".jsons");
  const workerScreenshotDir = path.join(workDir, `cypress/screenshots/worker-${workerId}`);
  const workerVideoDir = path.join(workDir, `cypress/videos/worker-${workerId}`);

  const reportsDirs = [
    workerReportDir,
    workerJsonDir,
    path.join(workDir, "cypress/results"),
    workerScreenshotDir,
    workerVideoDir,
  ];
  for (const dir of reportsDirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const env = buildCleanEnv({
    // IMPORTANT: Cypress env var mapping is case-sensitive
    // CYPRESS_baseUrl → overrides config.baseUrl at runtime (correct Cypress convention)
    // Do NOT set CYPRESS_BASE_URL — it causes double-processing conflicts in Cypress
    CYPRESS_baseUrl: baseUrl,
    CYPRESS_screenshotsFolder: workerScreenshotDir,
    CYPRESS_videosFolder: workerVideoDir,
    // Isolate mochawesome report output per worker
    MOCHAWESOME_REPORTDIR: workerReportDir,
    MOCHAWESOME_REPORTFILENAME: `mochawesome-worker-${workerId}`,
  });

  const startTime = Date.now();

  // Capture full output — both stdout and stderr combined
  const allLogs: string[] = [];

  try {
    let output: string;
    let stderrOutput = "";

    try {
      output = await execCypressWithStderr(
        args,
        { cwd: workDir, env },
        (stdout) => {
          allLogs.push(stdout);
          emit({ type: "log", timestamp: Date.now(), workerId, message: `[worker-${workerId}] ${stdout}` });
        },
        (stderr) => {
          stderrOutput += stderr + "\n";
          allLogs.push(`[stderr] ${stderr}`);
          emit({ type: "log", timestamp: Date.now(), workerId, message: `[worker-${workerId}] ${stderr}` });
        }
      );
    } catch (error: any) {
      // Cypress exits non-zero on test failures — that's expected
      output = error.output || "";
      stderrOutput = error.stderr || "";
      // Log stderr lines
      if (stderrOutput) {
        for (const line of stderrOutput.split("\n").filter(Boolean).slice(-10)) {
          allLogs.push(`[stderr] ${line}`);
        }
      }
    }

    const fullOutput = output + "\n" + stderrOutput;
    const result = parseCypressOutput(fullOutput, specs, workerId);
    result.duration = Date.now() - startTime;

    // Combine all available output for error context
    const fullCypressOutput = fullOutput + "\n" + allLogs.join("\n");
    const allOutputLines = fullCypressOutput.split("\n").filter(Boolean);
    const lastLines = allOutputLines.slice(-50).join("\n");

    // Extract MEANINGFUL error lines (assertion errors, timeouts, etc.)
    // Filter out TDP reporting noise, DevTools messages, etc.
    const errorPatterns = /AssertionError|Timed out|CypressError|Error:|expected.*to|should.*but|not\.exist|not\.be\.visible|cy\.\w+\(\).*failed|Cannot find|ECONNREFUSED|\.should\(/i;
    const noisePatterns = /tdp|testRunID|testframeworkclient|node_bindings|DevTools|getaddrinfo|getCypressTestDuration|postTDPCySuiteData|postEachCypressTest|getCypressSuiteData|generate report|Read and merge|Enhance report|Create HTML|HTML report|git data from dr|jobName|UQDN|Err \(lookup\)/i;

    const meaningfulErrors = allOutputLines
      .filter((line) => errorPatterns.test(line) && !noisePatterns.test(line))
      .slice(0, 20)
      .join("\n");

    // Also grab the lines around "failing" keyword for context
    const failingContext: string[] = [];
    for (let i = 0; i < allOutputLines.length; i++) {
      if (/failing|AssertionError|Timed out|CypressError/.test(allOutputLines[i]) && !noisePatterns.test(allOutputLines[i])) {
        // Grab 3 lines before and after
        for (let j = Math.max(0, i - 3); j <= Math.min(allOutputLines.length - 1, i + 3); j++) {
          if (!noisePatterns.test(allOutputLines[j])) {
            failingContext.push(allOutputLines[j]);
          }
        }
      }
    }
    const contextStr = [...new Set(failingContext)].join("\n");

    // Best error output: meaningful errors first, then context, then fallback to last lines
    const bestErrorOutput = meaningfulErrors || contextStr || lastLines;

    // If parser found 0 results but Cypress ran, store the full log as error context
    if (result.total === 0 && result.passed === 0 && result.failed === 0) {
      result.failed = 1;
      result.total = 1;
      result.error = bestErrorOutput;
      result.results = specs.map((spec) => ({
        file: spec,
        testName: spec.split("/").pop() || spec,
        status: "failed" as const,
        duration: result.duration,
        error: `Spec file crashed or failed to compile:\n${bestErrorOutput}`,
      }));
    }

    // Ensure all failed results have error details — if missing, attach meaningful errors
    for (const r of result.results) {
      if (r.status === "failed" && (!r.error || r.error === "Unknown error")) {
        r.error = bestErrorOutput || `No specific error captured. Full output tail:\n${lastLines.slice(-500)}`;
      }
    }

    // Log failed test details to console for debugging
    if (result.failed > 0) {
      console.log(`\n[Worker ${workerId}] FAILED — Cypress output (last 30 lines):`);
      console.log(lastLines.split("\n").slice(-30).join("\n"));
      console.log(`[Worker ${workerId}] END Cypress output\n`);
    }

    emit({
      type: "worker:complete",
      timestamp: Date.now(),
      workerId,
      passed: result.passed,
      failed: result.failed,
      total: result.total,
      duration: result.duration,
      message: `Worker ${workerId} done: ${result.passed} passed, ${result.failed} failed`,
    });

    result.cypressOutput = bestErrorOutput || lastLines;
    return result;
  } catch (error: any) {
    const errorMsg = error?.message || "Worker failed";
    const fullError = `${errorMsg}\n\nLast logs:\n${allLogs.slice(-20).join("\n")}`;

    emit({
      type: "worker:error",
      timestamp: Date.now(),
      workerId,
      error: fullError,
      message: `Worker ${workerId} error: ${errorMsg}`,
    });

    return {
      workerId,
      specs,
      passed: 0,
      failed: specs.length,
      total: specs.length,
      duration: Date.now() - startTime,
      results: specs.map((spec) => ({
        file: spec,
        testName: spec.split("/").pop() || spec,
        status: "failed" as const,
        duration: 0,
        error: fullError,
      })),
      error: fullError,
    };
  } finally {
    // Cleanup: remove generated spec copies
    const generatedDir = path.join(workDir, "cypress", "e2e", "_generated");
    try { fs.rmSync(generatedDir, { recursive: true, force: true }); } catch { /* best effort */ }

    // Restore patched spec files to their original content
    for (const { path: filePath, original } of patchedFiles) {
      try {
        fs.writeFileSync(filePath, original, "utf-8");
      } catch {
        // Best effort restore
      }
    }

    // Cleanup _generated specs
    try {
      const generatedDir = path.join(workDir, "cypress", "e2e", "_generated");
      if (fs.existsSync(generatedDir)) {
        fs.rmSync(generatedDir, { recursive: true });
      }
    } catch { /* best effort cleanup */ }
  }
}

// ============= Cypress Execution with Stderr Capture =============

import { spawn } from "child_process";

function execCypressWithStderr(
  args: string[],
  opts: any,
  onStdout: (line: string) => void,
  onStderr: (line: string) => void,
  timeoutMs: number = 600000 // 10 minute timeout
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", args, { ...opts, stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    let killed = false;

    // Kill Cypress if it hangs beyond the timeout
    const timer = setTimeout(() => {
      killed = true;
      console.log(`[Cypress] TIMEOUT after ${timeoutMs / 1000}s — killing process`);
      proc.kill("SIGKILL");
    }, timeoutMs);

    proc.stdout?.on("data", (d) => {
      const text = d.toString();
      stdout += text;
      for (const line of text.split("\n").filter(Boolean)) {
        onStdout(line.trim());
      }
    });

    proc.stderr?.on("data", (d) => {
      const text = d.toString();
      stderr += text;
      for (const line of text.split("\n").filter(Boolean)) {
        onStderr(line.trim());
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (killed) {
        const error: any = new Error(`Cypress timed out after ${timeoutMs / 1000}s and was killed`);
        error.output = stdout;
        error.stderr = stderr;
        reject(error);
      } else if (code === 0) {
        resolve(stdout);
      } else {
        const error: any = new Error(`Cypress exited with code ${code}`);
        error.output = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start Cypress: ${err.message}`));
    });
  });
}

// ============= Parse Cypress Output =============

function parseCypressOutput(output: string, specs: string[], workerId: number): WorkerResult {
  // Log the last 80 lines of Cypress output for debugging (stripped of ANSI codes)
  const cleanLines = output.split("\n").map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trim()).filter(Boolean);
  const tailLines = cleanLines.slice(-80);
  console.log(`[ft-worker-${workerId}] === Cypress output tail (${tailLines.length} lines) ===`);
  for (const line of tailLines) {
    console.log(`[ft-worker-${workerId}]   ${line}`);
  }
  console.log(`[ft-worker-${workerId}] === End Cypress output ===`);

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;
  let pending = 0;
  let totalTests = 0;

  const lines = output.split("\n");
  let currentSpec = specs[0] || "";
  let inFailureSection = false;
  let inSummaryTable = false;
  // Buffer for multi-line table rows (long spec names wrap to next line)
  let pendingTableRow: { symbol: string; partialName: string; numbers: string } | null = null;
  const failureErrors: Map<string, string> = new Map();
  let currentFailureTitle = "";
  let currentFailureError = "";

  for (const line of lines) {
    const trimmed = line.trim();
    // Strip ANSI escape codes for clean matching
    const clean = trimmed.replace(/\x1b\[[0-9;]*m/g, "").trim();

    // --- Detect summary table boundaries ---
    // Table starts with ┌ and ends with └
    if (clean.match(/^┌─/)) {
      inSummaryTable = true;
      continue;
    }
    if (clean.match(/^└─/)) {
      inSummaryTable = false;
      // Flush any pending table row
      pendingTableRow = null;
      continue;
    }

    // --- Handle multi-line table rows ---
    if (inSummaryTable) {
      if (clean.match(/^├─/)) {
        pendingTableRow = null;
        continue;
      }

      const tableRowFull = clean.match(/^[│]?\s*([✖✓✔])\s+(.+\.cy\.\w+)\s+([\d:]+\s+\d+\s+[\d-]+\s+[\d-]+\s+[\d-]+\s+[\d-]+)/);
      if (tableRowFull) {
        pendingTableRow = null;
        const specName = tableRowFull[2].trim();
        const numbersPart = tableRowFull[3];
        const nums = numbersPart.match(/[\d:]+\s+(\d+)\s+([\d-]+)\s+([\d-]+)\s+([\d-]+)\s+([\d-]+)/);
        const specFailed = nums ? (nums[3] === "-" ? 0 : parseInt(nums[3]) || 0) : 0;
        const alreadyHasResults = results.some((r) =>
          r.file === specName || r.file.endsWith(`/${specName}`) || r.file.endsWith(specName)
        );
        if (!alreadyHasResults) {
          results.push({ file: specName, testName: specName, status: specFailed > 0 ? "failed" : "passed", duration: 0 });
        }
        continue;
      }

      const tableRowPartial = clean.match(/^[│]?\s*([✖✓✔])\s+(\S+)\s+([\d:]+\s+\d+\s+[\d-]+\s+[\d-]+\s+[\d-]+\s+[\d-]+)/);
      if (tableRowPartial) {
        pendingTableRow = { symbol: tableRowPartial[1], partialName: tableRowPartial[2].trim(), numbers: tableRowPartial[3] };
        continue;
      }

      if (pendingTableRow) {
        const continuation = clean.match(/^[│]?\s+([\w.-]*cy\.\w+)/);
        if (continuation) {
          const fullName = pendingTableRow.partialName + continuation[1].trim();
          const nums = pendingTableRow.numbers.match(/[\d:]+\s+(\d+)\s+([\d-]+)\s+([\d-]+)\s+([\d-]+)\s+([\d-]+)/);
          const specFailed = nums ? (nums[3] === "-" ? 0 : parseInt(nums[3]) || 0) : 0;
          const alreadyHasResults = results.some((r) =>
            r.file === fullName || r.file.endsWith(`/${fullName}`) || r.file.endsWith(fullName)
          );
          if (!alreadyHasResults) {
            results.push({ file: fullName, testName: fullName, status: specFailed > 0 ? "failed" : "passed", duration: 0 });
          }
          pendingTableRow = null;
          continue;
        }
        pendingTableRow = null;
      }
      continue;
    }

    // --- Cypress totals line ---
    // Format: ✖  1 of 1 failed (100%)    00:23    1    -    1    -    -
    // or:     ✓  All specs passed!        00:15    3    3    -    -    -
    const totalsLine = clean.match(/(\d+)\s+of\s+(\d+)\s+(failed|passed)/);
    if (totalsLine) {
      // Already captured per-spec, skip
      continue;
    }

    // --- Standard text format: "X passing" / "X failing" ---
    const passMatch = clean.match(/(\d+)\s+passing/);
    if (passMatch) passed += parseInt(passMatch[1]);

    const failMatch = clean.match(/(\d+)\s+failing/);
    if (failMatch) failed += parseInt(failMatch[1]);

    const pendMatch = clean.match(/(\d+)\s+pending/);
    if (pendMatch) pending += parseInt(pendMatch[1]);

    // --- Detect spec file header: "Running: path/to/spec.cy.ts" ---
    const specHeader = clean.match(/Running:\s+(.+\.cy\.\w+)/);
    if (specHeader) {
      const headerSpec = specHeader[1].trim();
      // Resolve to full path from specs array
      currentSpec = specs.find((s) => s.endsWith(headerSpec) || headerSpec.endsWith(s)) || headerSpec;
      inFailureSection = false;
      continue;
    }

    // --- Passing test: ✓ test name (1234ms) ---
    // Skip if line looks like a table row (contains │ or column numbers pattern)
    const passLine = clean.match(/[✓✔]\s+(.+?)(?:\s+\((\d+)ms\))?$/);
    if (passLine && !clean.includes("│") && !clean.match(/\d+\s+[\d-]+\s+[\d-]+\s+[\d-]+\s+[\d-]+/)) {
      results.push({
        file: currentSpec,
        testName: passLine[1].trim(),
        status: "passed",
        duration: passLine[2] ? parseInt(passLine[2]) : 0,
      });
      continue;
    }

    // --- Failing test in failures section ---
    // Standard format: "1) Suite Name Test Name"
    // Retry format:    "(Attempt 1 of 2) Suite Name Test Name"
    const failLine = clean.match(/^\d+\)\s+(.+)/) || clean.match(/^\(Attempt\s+\d+\s+of\s+\d+\)\s+(.+)/);
    if (failLine) {
      // Save previous failure error if any
      if (currentFailureTitle && currentFailureError) {
        failureErrors.set(currentFailureTitle, currentFailureError.trim());
      }
      currentFailureTitle = failLine[1].trim();
      currentFailureError = "";
      inFailureSection = true;
      continue;
    }

    // --- Capture error details in failure section ---
    if (inFailureSection && clean) {
      // Match any JS error type: ReferenceError, TypeError, SyntaxError, RangeError, etc.
      if (clean.match(/^(\w*Error|CypressError|Timed out|expected|assert|ESOCKETTIMEDOUT|ECONNREFUSED|ETIMEDOUT|Cannot read prop)/i)) {
        currentFailureError += clean + "\n";
      } else if (clean.startsWith("at ") || clean.startsWith("Because this error") || clean.startsWith("Error:")) {
        // Stack trace or Cypress explanation — only include if we already have the error message
        if (currentFailureError) {
          // Don't append stack traces — they clutter the error message
          // Only keep the first "at" line for context
          if (clean.startsWith("at ") && !currentFailureError.includes("\n  at ")) {
            currentFailureError += "  " + clean + "\n";
          }
        } else {
          currentFailureError = clean + "\n";
        }
      } else if (currentFailureError && clean && !clean.startsWith("at ") && !clean.match(/^\d+\s+(passing|failing|pending)/) && !clean.match(/^[│┌└├┤]/) && !clean.match(/^\(Results\)/) && !clean.match(/^\(Screenshots\)/)) {
        // Continue capturing multi-line error content (but stop at summary/table/stack lines)
        currentFailureError += clean + "\n";
      }
    }
  }

  // Save last failure error
  if (currentFailureTitle && currentFailureError) {
    failureErrors.set(currentFailureTitle, currentFailureError.trim());
  }

  // Apply collected failure errors to matching results
  for (const result of results) {
    if (result.status === "failed" && !result.error) {
      // Try exact match, then partial match
      const err = failureErrors.get(result.testName) ||
        [...failureErrors.entries()].find(([k]) => result.testName.includes(k) || k.includes(result.testName))?.[1];
      if (err) result.error = err;
    }
  }

  // If no per-spec results from table parsing, create from summary + specs list
  if (results.length === 0 && (passed > 0 || failed > 0)) {
    for (const spec of specs) {
      const specName = spec.split("/").pop() || spec;
      // Collect ALL errors for this spec (from retry attempts)
      const allErrors = [...failureErrors.values()];
      // Prefer the meaningful (non-noise) error
      const isNoise = (err: string) =>
        /ESOCKETTIMEDOUT|ECONNREFUSED|ECONNRESET|ETIMEDOUT|cy\.visit\(\).*failed trying to load/i.test(err);
      const meaningfulErr = allErrors.find((e) => !isNoise(e));
      const bestError = meaningfulErr || allErrors[0] || undefined;

      results.push({
        file: spec,
        testName: specName,
        status: failed > 0 ? "failed" : "passed",
        duration: 0,
        error: bestError,
        // If there were multiple errors (from retries), record them as attempts
        retryAttempts: allErrors.length > 1 ? allErrors.map((err, i) => ({
          attempt: i + 1,
          status: (isNoise(err) || err !== meaningfulErr) && failed > 0 ? "failed" as const : "failed" as const,
          error: err,
          duration: 0,
        })) : undefined,
        attempts: allErrors.length > 1 ? allErrors.length : undefined,
      });
    }
  }

  // Deduplicate results — Cypress retries produce multiple entries per test.
  // Step 1: Collapse retries for the SAME test (same file::testName) — keep last status, first meaningful error.
  // Step 2: Keep SEPARATE entries for DIFFERENT tests in the same file.
  const isNoiseError = (err: string) =>
    /ESOCKETTIMEDOUT|ECONNREFUSED|ECONNRESET|ETIMEDOUT|cy\.visit\(\).*failed trying to load/i.test(err);

  console.log(`[ft-worker-${workerId}] Pre-dedup results: ${results.length} entries — ${results.map((r) => `${r.file}:${r.testName}:${r.status}`).join(", ")}`);

  // Pass 1: Collapse retries by file::testName
  const byTestKey = new Map<string, TestResult[]>();
  for (const r of results) {
    const key = `${r.file}::${r.testName}`;
    const existing = byTestKey.get(key) || [];
    existing.push(r);
    byTestKey.set(key, existing);
  }

  const dedupedByTest: TestResult[] = [];
  for (const [key, entries] of byTestKey) {
    // Build retry history for this test
    const retryAttempts: RetryAttempt[] = entries.map((e, i) => ({
      attempt: i + 1,
      status: e.status,
      error: e.error,
      duration: e.duration,
    }));

    const meaningfulEntry = entries.find((e) => e.error && !isNoiseError(e.error));
    const finalEntry = meaningfulEntry || entries[entries.length - 1];
    const meaningfulError = entries.find((e) => e.error && !isNoiseError(e.error))?.error;

    dedupedByTest.push({
      ...finalEntry,
      error: meaningfulError || finalEntry.error,
      attempts: entries.length,
      retryAttempts: entries.length > 1 ? retryAttempts : undefined,
    });

    if (entries.length > 1) {
      console.log(`[ft-worker-${workerId}] Retry dedup: ${key} — ${entries.length} attempts`);
    }
  }

  // Pass 2: For entries that share the same file but have noise-only testNames
  // (e.g., fallback parsing produced file-level entries alongside test-level entries),
  // merge noise entries into meaningful ones. But keep genuinely different test cases separate.
  const byFile = new Map<string, TestResult[]>();
  for (const r of dedupedByTest) {
    const existing = byFile.get(r.file) || [];
    existing.push(r);
    byFile.set(r.file, existing);
  }

  const finalResults: TestResult[] = [];
  for (const [file, entries] of byFile) {
    if (entries.length <= 1) {
      finalResults.push(entries[0]);
      continue;
    }

    // Check if some entries are just noise duplicates of others (same file, no real test name)
    const meaningful = entries.filter((e) => e.error && !isNoiseError(e.error));
    const noiseOnly = entries.filter((e) => !e.error || isNoiseError(e.error));

    if (meaningful.length > 0 && noiseOnly.length > 0) {
      // Keep meaningful entries, drop noise-only duplicates
      finalResults.push(...meaningful);
      console.log(`[ft-worker-${workerId}] File dedup: ${file} — kept ${meaningful.length} meaningful, dropped ${noiseOnly.length} noise entries`);
    } else {
      // All meaningful or all noise — keep all distinct test entries
      finalResults.push(...entries);
    }
  }

  results.length = 0;
  results.push(...finalResults);

  // Always recalculate totals from deduplicated results
  // (raw Cypress counts include retries, so they overcount)
  totalTests = results.length;
  passed = results.filter((r) => r.status === "passed").length;
  failed = results.filter((r) => r.status === "failed").length;
  console.log(`[ft-worker-${workerId}] Post-dedup: ${totalTests} results, ${passed} passed, ${failed} failed`);

  // Use the first meaningful error from results, fallback to output tail
  let errorContext: string | undefined;
  if (failed > 0) {
    const firstFailedResult = results.find((r) => r.status === "failed" && r.error);
    errorContext = firstFailedResult?.error || lines.slice(-40).join("\n").trim();
  }

  return {
    workerId,
    specs,
    passed,
    failed,
    total: totalTests || passed + failed + pending,
    duration: 0,
    results,
    error: errorContext,
  };
}
