import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const REPOS_DIR = path.join(process.cwd(), "repos");

function isValidWorkDir(workDir: string): boolean {
  // Temp clone dirs: {tmpdir}/ft-clones/.../ft-run-{id}
  if (workDir.includes("ft-run")) return true;
  // FTRunner persistent workspaces: {cwd}/repos/{userId}/{owner}/{repo}/{branch}
  if (workDir.startsWith(REPOS_DIR)) return true;
  // Local mode: user's own repo at an arbitrary absolute path — must exist on disk
  if (path.isAbsolute(workDir) && fs.existsSync(workDir)) return true;
  return false;
}

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
  } catch { /* skip */ }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workDir = searchParams.get("workDir");
    const filePath = searchParams.get("filePath");

    if (!workDir || !filePath) {
      return NextResponse.json(
        { success: false, message: "workDir and filePath are required" },
        { status: 400 }
      );
    }

    if (!isValidWorkDir(workDir)) {
      return NextResponse.json(
        { success: false, message: "Invalid workDir" },
        { status: 400 }
      );
    }

    const search = searchParams.get("search") === "true";

    let fullPath = path.join(workDir, filePath);
    let resolvedFilePath = filePath;

    if (!fs.existsSync(fullPath) && search) {
      // Recursively search for the file by name
      const found = findFileRecursive(workDir, path.basename(filePath));
      if (found) {
        fullPath = found;
        resolvedFilePath = path.relative(workDir, found);
      }
    }

    if (!fs.existsSync(fullPath)) {
      return NextResponse.json(
        { success: false, message: `File not found: ${filePath}` },
        { status: 404 }
      );
    }

    const content = fs.readFileSync(fullPath, "utf-8");
    const ext = path.extname(resolvedFilePath);
    const langMap: Record<string, string> = {
      ".ts": "typescript",
      ".tsx": "typescriptreact",
      ".js": "javascript",
      ".jsx": "javascriptreact",
      ".json": "json",
      ".css": "css",
      ".html": "html",
    };

    return NextResponse.json({
      success: true,
      content,
      language: langMap[ext] || "plaintext",
      filePath: resolvedFilePath,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Failed to read file" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workDir, filePath, content } = body;

    if (!workDir || !filePath || content === undefined) {
      return NextResponse.json(
        { success: false, message: "workDir, filePath, and content are required" },
        { status: 400 }
      );
    }

    if (!isValidWorkDir(workDir)) {
      return NextResponse.json(
        { success: false, message: "Invalid workDir" },
        { status: 400 }
      );
    }

    const fullPath = path.join(workDir, filePath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");

    return NextResponse.json({ success: true, message: `File saved: ${filePath}` });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Failed to write file" },
      { status: 500 }
    );
  }
}
