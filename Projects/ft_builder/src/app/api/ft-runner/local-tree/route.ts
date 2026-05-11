import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

function buildTreeNodes(files: string[]): any[] {
  const root: any[] = [];
  const map = new Map<string, any>();

  const sorted = [...files].sort();

  for (const filePath of sorted) {
    const parts = filePath.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const partialPath = parts.slice(0, i).join("/");
      if (map.has(partialPath)) continue;

      const name = parts[i - 1];
      const isLeaf = i === parts.length;
      const node: any = { title: name, key: partialPath, isLeaf };
      map.set(partialPath, node);

      const parentPath = parts.slice(0, i - 1).join("/");
      if (parentPath && map.has(parentPath)) {
        const parent = map.get(parentPath);
        if (!parent.children) parent.children = [];
        parent.children.push(node);
      } else if (!parentPath) {
        root.push(node);
      }
    }
  }

  return root;
}

function scanCypressSpecs(dir: string, baseDir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    const relative = path.relative(baseDir, full);
    if (entry.isDirectory()) {
      results.push(...scanCypressSpecs(full, baseDir));
    } else if (entry.name.endsWith(".cy.ts") || entry.name.endsWith(".cy.js")) {
      results.push(relative);
    }
  }
  return results;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { localPath } = body;

    if (!localPath) {
      return NextResponse.json({ success: false, message: "localPath is required" }, { status: 400 });
    }

    if (!fs.existsSync(localPath)) {
      return NextResponse.json({ success: false, message: `Path not found: ${localPath}` }, { status: 400 });
    }

    const cypressE2eDir = path.join(localPath, "cypress", "e2e");
    const scanBase = fs.existsSync(cypressE2eDir) ? cypressE2eDir : localPath;
    const basePath = fs.existsSync(cypressE2eDir) ? "cypress/e2e/" : "";

    const specFiles = scanCypressSpecs(scanBase, scanBase);

    const tree = buildTreeNodes(specFiles);

    function countLeaves(nodes: any[]): number {
      return nodes.reduce((sum, n) => sum + (n.isLeaf ? 1 : countLeaves(n.children || [])), 0);
    }

    return NextResponse.json({ success: true, tree, totalTests: countLeaves(tree), basePath });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error?.message || "Failed to scan local folder" }, { status: 500 });
  }
}
