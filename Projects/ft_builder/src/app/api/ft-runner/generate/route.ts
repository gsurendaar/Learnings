import { NextRequest, NextResponse } from "next/server";
import { runnerManager } from "@/services/ftRunner";
import { insertUserInput } from "@/lib/ftDatabase";

/**
 * POST /api/ft-runner/generate
 *
 * Starts async test generation. Returns a genId immediately.
 * Stream real-time events via: GET /api/ft-runner/stream?runId={genId}
 * Poll final results via:      GET /api/ft-runner/generate/status?genId={genId}
 *
 * Set `validateAfterGenerate: true` to run the combined flow:
 *   Generator creates tests → Supervisor runs them → failures get fixed → loop
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const selectedFolders: string[] = body.selectedFolders || [];
    const manualPaths: string[] = body.manualPaths || [];
    // Default: always generate → run → validate → fix. Pass false to skip running.
    const validateAfterGenerate: boolean = body.validateAfterGenerate !== false;

    if (selectedFolders.length === 0 && manualPaths.length === 0) {
      return NextResponse.json(
        { error: "At least one folder or manual path is required" },
        { status: 400 }
      );
    }

    const genId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    console.log("\n╔══════════════════════════════════════════╗");
    console.log(`║  /api/ft-runner/generate — ${validateAfterGenerate ? "GENERATE & VALIDATE" : "ASYNC started"}  ║`);
    console.log("╚══════════════════════════════════════════╝");
    console.log(`  Gen ID:       ${genId}`);
    console.log(`  Folders:      ${selectedFolders.join(", ") || "(none)"}`);
    console.log(`  Manual paths: ${manualPaths.length > 0 ? manualPaths.join(", ") : "(none)"}`);
    console.log(`  Template:     ${body.templateType || "comprehensive"}`);
    console.log(`  Validate:     ${validateAfterGenerate}`);
    if (validateAfterGenerate) {
      console.log(`  Browser:      ${body.browser || "electron"}`);
      console.log(`  Max fixes:    ${body.maxFixAttempts || 10}`);
    }
    console.log(`  Stream at:    /api/ft-runner/stream?runId=${genId}`);

    // Merge selectedSuggestions + manualUseCases into targetUseCases
    const selectedSuggestions = body.selectedSuggestions || [];
    const manualUseCases = body.manualUseCases || [];
    if (selectedSuggestions.length > 0 || manualUseCases.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const targetUseCases = [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...selectedSuggestions.map((s: any) => ({
          title: s.title,
          description: s.description,
          priority: s.priority,
          sourceFile: s.sourceFile || "",
          specFileName: s.specFileName || "",
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...manualUseCases.map((m: any) => ({
          title: m.description,
          description: m.description,
          priority: "P1",
          sourceFile: "",
        })),
      ];
      body.targetUseCases = targetUseCases;
      console.log(`  Use cases:    ${targetUseCases.length} (${selectedSuggestions.length} suggested + ${manualUseCases.length} manual)`);
    }

    // Log user input
    try {
      insertUserInput({
        run_id: genId,
        user_id: body.triggeredBy || undefined,
        selected_files: JSON.stringify(selectedFolders),
        browser: body.browser || "electron",
        retries: body.retries || 1,
        fix_mode: validateAfterGenerate ? "auto-fix" : "generate-only",
      });
    } catch (e) {
      console.warn("[Generate] Failed to log user input:", e);
    }

    if (validateAfterGenerate) {
      // Combined flow: Generate → Run → Fix → Loop
      await runnerManager.startGenerateAndValidate(genId, body);
    } else {
      // Standalone generation (existing behavior)
      await runnerManager.startGeneration(genId, body);
    }

    return NextResponse.json({
      success: true,
      genId,
      message: validateAfterGenerate
        ? "Generate & Validate started. Supervisor will run tests and fix failures. Stream events at /api/ft-runner/stream?runId=" + genId
        : "Generation started. Stream events at /api/ft-runner/stream?runId=" + genId,
      streamUrl: `/api/ft-runner/stream?runId=${genId}`,
      statusUrl: `/api/ft-runner/generate/status?genId=${genId}`,
      mode: validateAfterGenerate ? "generate-and-validate" : "generate-only",
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to start generation: ${errorMsg}` },
      { status: 500 }
    );
  }
}
