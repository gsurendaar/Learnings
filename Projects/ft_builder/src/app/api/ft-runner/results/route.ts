import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/ftDatabase";
import fs from "fs";
import path from "path";

export async function GET(request: NextRequest) {
  const runId = request.nextUrl.searchParams.get("runId");

  if (!runId) {
    return NextResponse.json(
      { success: false, message: "runId query parameter is required" },
      { status: 400 }
    );
  }

  try {
    const run = getRun(runId);

    if (!run) {
      return NextResponse.json(
        { success: false, message: "Run not found" },
        { status: 404 }
      );
    }

    let results = [];

    // Try to parse results from DB JSON field
    if (run.results_json) {
      try {
        results = JSON.parse(run.results_json);
      } catch {
        // Fall back to reading from artifact files
      }
    }

    // If no results in DB, try reading from artifact directory
    if (results.length === 0 && run.artifacts_dir) {
      const resultsDir = path.join(run.artifacts_dir, "results");
      if (fs.existsSync(resultsDir)) {
        const files = fs.readdirSync(resultsDir).filter((f: string) => f.endsWith(".json"));
        for (const file of files) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(resultsDir, file), "utf-8"));
            for (const spec of data.results || []) {
              for (const suite of spec.suites || []) {
                for (const test of suite.tests || []) {
                  results.push({
                    file: spec.file || spec.fullFile || "",
                    testName: test.fullTitle || test.title || "",
                    status: test.pass ? "passed" : test.fail ? "failed" : "pending",
                    duration: test.duration || 0,
                    error: test.err?.message,
                  });
                }
              }
            }
          } catch {
            // Skip unparseable files
          }
        }
      }
    }

    // Check for screenshots in all possible locations
    const screenshots: string[] = [];
    if (run.artifacts_dir && fs.existsSync(run.artifacts_dir)) {
      const screenshotDirs = [
        "screenshots",
        "cypress/reports/screenshots",
        "cypress/screenshots",
      ];
      const walkDir = (dir: string, base: string): void => {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = path.join(base, entry.name);
          if (entry.isDirectory()) {
            walkDir(fullPath, relPath);
          } else if (/\.(png|jpg|jpeg|gif)$/i.test(entry.name)) {
            screenshots.push(relPath);
          }
        }
      };
      for (const ssDir of screenshotDirs) {
        walkDir(path.join(run.artifacts_dir, ssDir), ssDir);
      }
    }

    let complianceResults = [];
    if (run.compliance_json) {
      try { complianceResults = JSON.parse(run.compliance_json); } catch { /* ignore */ }
    }

    return NextResponse.json({
      success: true,
      runId: run.run_id,
      branch: run.branch,
      conclusion: run.conclusion,
      summary: {
        total: run.total_specs,
        passed: run.passed_specs,
        failed: run.failed_specs,
        duration: run.duration_ms,
      },
      results,
      screenshots,
      browser: run.browser,
      runMode: run.run_mode,
      createdAt: run.created_at,
      errorMessage: run.error_message || null,
      complianceResults,
    });
  } catch (error: any) {
    console.error("Error fetching results:", error);
    return NextResponse.json(
      { success: false, message: error?.message || "Failed to fetch results" },
      { status: 500 }
    );
  }
}
