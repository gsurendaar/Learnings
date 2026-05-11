import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

// Directories to reject even if the client sends them
const EXCLUDED_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage"]);

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const userId = (formData.get("userId") as string) || "anonymous";

    const uploadBase = path.join(os.tmpdir(), "ft-uploads", userId, Date.now().toString());

    const files = formData.getAll("files") as File[];
    const relativePaths = formData.getAll("paths") as string[];

    if (files.length === 0) {
      return NextResponse.json({ success: false, message: "No files received" }, { status: 400 });
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relativePath = relativePaths[i];
      if (!relativePath) continue;

      // Drop any path segment that matches an excluded directory
      const parts = relativePath.split("/");
      if (parts.some((p) => EXCLUDED_DIRS.has(p))) continue;

      const targetPath = path.join(uploadBase, relativePath);

      // Prevent path traversal
      if (!targetPath.startsWith(uploadBase + path.sep) && targetPath !== uploadBase) continue;

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(targetPath, buffer);
    }

    // The project root is uploadBase/<folderName> (first path segment)
    const folderName = relativePaths[0]?.split("/")[0] || "";
    const projectRoot = folderName ? path.join(uploadBase, folderName) : uploadBase;

    return NextResponse.json({ success: true, path: projectRoot });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Upload failed" },
      { status: 500 }
    );
  }
}
