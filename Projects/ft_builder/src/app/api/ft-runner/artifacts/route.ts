import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getRun } from "@/lib/ftDatabase";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".json": "application/json",
  ".html": "text/html",
};

/**
 * GET /api/ft-runner/artifacts?runId=...&filePath=...
 *
 * Serves screenshot/video files from run artifacts.
 * Path traversal protection: resolved path must stay within the artifacts directory.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId");
  const filePath = searchParams.get("filePath");

  if (!runId || !filePath) {
    return NextResponse.json({ error: "runId and filePath are required" }, { status: 400 });
  }

  // Determine artifacts directory from DB, or search common locations
  const run = getRun(runId);
  let artifactsDir = run?.artifacts_dir;

  if (!artifactsDir || !fs.existsSync(artifactsDir)) {
    // Search in per-user artifact dirs and legacy locations
    const searchPaths = [
      run?.artifacts_dir,
      path.join(process.cwd(), "data", "artifacts"), // scan per-user dirs
      path.join(process.cwd(), "data", "generated-tests", runId),
      path.join(process.cwd(), "data", "ft-artifacts", runId),
    ].filter(Boolean) as string[];

    // Try to find the runId in per-user artifact dirs
    const artifactsBase = path.join(process.cwd(), "data", "artifacts");
    if (fs.existsSync(artifactsBase)) {
      for (const userDir of fs.readdirSync(artifactsBase)) {
        const candidate = path.join(artifactsBase, userDir, runId);
        if (fs.existsSync(candidate)) {
          artifactsDir = candidate;
          break;
        }
      }
    }

    // Fall back to legacy paths
    if (!artifactsDir || !fs.existsSync(artifactsDir)) {
      for (const p of searchPaths) {
        if (fs.existsSync(p)) {
          artifactsDir = p;
          break;
        }
      }
    }
  }

  if (!artifactsDir) {
    return NextResponse.json({ error: "Artifacts directory not found" }, { status: 404 });
  }

  // Resolve and validate the path (prevent path traversal)
  const resolvedBase = path.resolve(artifactsDir);
  const resolvedPath = path.resolve(artifactsDir, filePath);

  if (!resolvedPath.startsWith(resolvedBase)) {
    return NextResponse.json({ error: "Invalid file path" }, { status: 403 });
  }

  if (!fs.existsSync(resolvedPath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  const fileBuffer = fs.readFileSync(resolvedPath);

  return new NextResponse(fileBuffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(fileBuffer.length),
      "Cache-Control": "public, max-age=3600",
    },
  });
}
