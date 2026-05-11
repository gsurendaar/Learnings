import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const requestedPath = searchParams.get("path") || os.homedir();

  try {
    const resolved = path.resolve(requestedPath);

    if (!fs.existsSync(resolved)) {
      return NextResponse.json({ success: false, message: "Path does not exist" }, { status: 400 });
    }

    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return NextResponse.json({ success: false, message: "Path is not a directory" }, { status: 400 });
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true });

    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({
        name: e.name,
        path: path.join(resolved, e.name),
        hasCypress: fs.existsSync(path.join(resolved, e.name, "cypress", "e2e")),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      success: true,
      current: resolved,
      parent: resolved !== path.parse(resolved).root ? path.dirname(resolved) : null,
      dirs,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error?.message || "Failed to browse folder" }, { status: 500 });
  }
}
