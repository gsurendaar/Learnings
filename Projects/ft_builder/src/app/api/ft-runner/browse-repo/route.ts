import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * GET /api/ft-runner/browse-repo?path=...
 *
 * Browse local repos directory. Returns cloned repos, their folders, files, and file content.
 * Used by Activities dashboard to show cloned repos and browse their structure.
 *
 * Query params:
 *   - path: relative path within repos/ (optional, defaults to root)
 *   - content: if "true" and path points to a file, returns file content
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const relativePath = searchParams.get("path") || "";
    const wantContent = searchParams.get("content") === "true";

    const reposDir = path.join(process.cwd(), "repos");
    const fullPath = path.resolve(reposDir, relativePath);

    // Path traversal protection
    if (!fullPath.startsWith(path.resolve(reposDir))) {
      return NextResponse.json({ success: false, error: "Invalid path" }, { status: 403 });
    }

    if (!fs.existsSync(fullPath)) {
      // Fallback: search in data/generated-tests/ for the file
      if (wantContent && relativePath) {
        const fileName = path.basename(relativePath);
        const genTestsDir = path.join(process.cwd(), "data", "generated-tests");
        if (fs.existsSync(genTestsDir)) {
          // Recursively find the file in generated-tests
          const findFile = (dir: string): string | null => {
            try {
              for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                  const found = findFile(full);
                  if (found) return found;
                } else if (entry.name === fileName) {
                  return full;
                }
              }
            } catch { /* skip */ }
            return null;
          };
          const found = findFile(genTestsDir);
          if (found) {
            const content = fs.readFileSync(found, "utf-8");
            return NextResponse.json({
              success: true,
              type: "file",
              name: fileName,
              path: relativePath,
              content: content.slice(0, 50000),
              size: fs.statSync(found).size,
              language: path.extname(found).replace(".", ""),
              source: "generated-tests-backup",
            });
          }
        }
      }
      return NextResponse.json({ success: true, entries: [], exists: false });
    }

    const stat = fs.statSync(fullPath);

    // If it's a file, return content or metadata
    if (stat.isFile()) {
      const ext = path.extname(fullPath).toLowerCase();
      const isImage = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"].includes(ext);
      const isText = [".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".txt", ".css", ".html", ".yml", ".yaml", ".cy.ts", ".cy.js"].includes(ext)
        || fullPath.endsWith(".cy.ts") || fullPath.endsWith(".cy.js");

      if (wantContent && isText) {
        const content = fs.readFileSync(fullPath, "utf-8");
        return NextResponse.json({
          success: true,
          type: "file",
          name: path.basename(fullPath),
          path: relativePath,
          content: content.slice(0, 50000), // cap at 50KB
          size: stat.size,
          language: ext.replace(".", ""),
        });
      }

      if (wantContent && isImage) {
        // Return as base64 for image preview
        const buffer = fs.readFileSync(fullPath);
        const base64 = buffer.toString("base64");
        const mimeTypes: Record<string, string> = {
          ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
          ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
        };
        return NextResponse.json({
          success: true,
          type: "image",
          name: path.basename(fullPath),
          path: relativePath,
          dataUrl: `data:${mimeTypes[ext] || "image/png"};base64,${base64}`,
          size: stat.size,
        });
      }

      return NextResponse.json({
        success: true,
        type: "file",
        name: path.basename(fullPath),
        path: relativePath,
        size: stat.size,
        isImage,
        isText,
      });
    }

    // It's a directory -- list entries
    const entries = fs.readdirSync(fullPath, { withFileTypes: true })
      .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
      .map((e) => {
        const entryPath = path.join(relativePath, e.name);
        const entryFull = path.join(fullPath, e.name);
        const entryStat = fs.statSync(entryFull);

        let childCount = 0;
        if (e.isDirectory()) {
          try {
            childCount = fs.readdirSync(entryFull).filter((c) => !c.startsWith(".") && c !== "node_modules").length;
          } catch { /* skip */ }
        }

        // Check git info for repo roots
        let gitBranch: string | undefined;
        let gitRemote: string | undefined;
        if (e.isDirectory() && fs.existsSync(path.join(entryFull, ".git"))) {
          try {
            const { execSync } = require("child_process");
            gitBranch = execSync("git branch --show-current", { cwd: entryFull, encoding: "utf-8" }).trim();
            gitRemote = execSync("git remote get-url origin", { cwd: entryFull, encoding: "utf-8" }).trim()
              .replace(/https?:\/\/[^@]*@/, "https://"); // strip token
          } catch { /* skip */ }
        }

        return {
          name: e.name,
          path: entryPath,
          isDirectory: e.isDirectory(),
          isFile: e.isFile(),
          size: entryStat.size,
          modified: entryStat.mtime.toISOString(),
          childCount,
          gitBranch,
          gitRemote,
        };
      })
      .sort((a, b) => {
        // Directories first, then files
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

    return NextResponse.json({
      success: true,
      type: "directory",
      path: relativePath,
      entries,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to browse repo" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/ft-runner/browse-repo?path=...
 *
 * Deletes a directory (e.g., old screenshots before a new run).
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const relativePath = searchParams.get("path") || "";

    if (!relativePath) {
      return NextResponse.json({ success: false, error: "path is required" }, { status: 400 });
    }

    const reposDir = path.join(process.cwd(), "repos");
    const fullPath = path.resolve(reposDir, relativePath);

    // Path traversal protection
    if (!fullPath.startsWith(path.resolve(reposDir))) {
      return NextResponse.json({ success: false, error: "Invalid path" }, { status: 403 });
    }

    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      return NextResponse.json({ success: true, message: `Deleted: ${relativePath}` });
    }

    return NextResponse.json({ success: true, message: "Path does not exist" });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to delete" },
      { status: 500 }
    );
  }
}
