import { NextRequest, NextResponse } from "next/server";
import GitHubService from "@/services/github";

// Transform flat GitHub tree items into nested TreeDataNode format for Ant Design Tree
function buildTreeNodes(items: Array<{ path: string; type: string; sha: string }>, basePath: string) {
  const root: any[] = [];
  const map = new Map<string, any>();

  // Sort items so directories come before files
  const sorted = [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === "tree" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  for (const item of sorted) {
    // Get relative path from basePath
    const relativePath = item.path.startsWith(basePath)
      ? item.path.slice(basePath.length)
      : item.path;

    if (!relativePath) continue;

    const parts = relativePath.split("/");
    const fileName = parts[parts.length - 1];
    const isFolder = item.type === "tree";

    // Only include .cy.ts files and their parent directories
    if (!isFolder && !fileName.endsWith(".cy.ts") && !fileName.endsWith(".cy.js")) {
      continue;
    }

    const node: any = {
      title: fileName,
      key: relativePath,
      isLeaf: !isFolder,
    };

    map.set(relativePath, node);

    // Find parent
    const parentPath = parts.slice(0, -1).join("/");
    if (parentPath && map.has(parentPath)) {
      const parent = map.get(parentPath);
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    } else {
      root.push(node);
    }
  }

  // Remove empty folders (no test file children)
  function pruneEmpty(nodes: any[]): any[] {
    return nodes.filter((node) => {
      if (node.isLeaf) return true;
      if (node.children) {
        node.children = pruneEmpty(node.children);
        return node.children.length > 0;
      }
      return false;
    });
  }

  return pruneEmpty(root);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { owner, repo, branch, githubToken } = body;

    if (!owner || !repo || !branch) {
      return NextResponse.json(
        { success: false, message: "owner, repo, and branch are required" },
        { status: 400 }
      );
    }

    if (!githubToken) {
      return NextResponse.json(
        { success: false, message: "githubToken is required" },
        { status: 401 }
      );
    }

    const github = new GitHubService(githubToken);
    const basePath = "cypress/e2e/";
    const items = await github.getTree(owner, repo, branch, basePath);

    const tree = buildTreeNodes(items, basePath);

    // Count total test files
    function countFiles(nodes: any[]): number {
      let count = 0;
      for (const node of nodes) {
        if (node.isLeaf) count++;
        if (node.children) count += countFiles(node.children);
      }
      return count;
    }

    return NextResponse.json({
      success: true,
      tree,
      totalTests: countFiles(tree),
      basePath,
    });
  } catch (error: any) {
    console.error("Error fetching tree:", error);
    return NextResponse.json(
      { success: false, message: error?.message || "Failed to fetch test tree" },
      { status: 500 }
    );
  }
}
