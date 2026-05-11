import { NextRequest } from "next/server";
import { runnerManager } from "@/services/ftRunner";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const runId = request.nextUrl.searchParams.get("runId");

  if (!runId) {
    return new Response(JSON.stringify({ error: "runId query parameter is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "connected", runId })}\n\n`)
      );

      // Check if run exists
      const activeRun = runnerManager.getActiveRun(runId);
      if (!activeRun) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "run:not_found", runId })}\n\n`)
        );
        controller.close();
        return;
      }

      // Subscribe to events
      const unsubscribe = runnerManager.subscribe(runId, (event) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );

          // Close stream when run completes
          if (event.type === "run:complete" || event.type === "run:error") {
            setTimeout(() => {
              try {
                controller.close();
              } catch {
                // Stream may already be closed
              }
            }, 1000);
          }
        } catch {
          // Client disconnected
          unsubscribe();
        }
      });

      // Cleanup on abort
      request.signal.addEventListener("abort", () => {
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Stream may already be closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
