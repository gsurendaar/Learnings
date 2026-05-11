import { NextRequest, NextResponse } from "next/server";
import GitHubService from "@/services/github";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { owner, repo, githubToken } = body;

    if (!owner || !repo) {
      return NextResponse.json(
        { success: false, message: "owner and repo are required" },
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
    const branches = await github.getBranches(owner, repo);

    return NextResponse.json({
      success: true,
      branches: branches.map((b) => ({
        name: b.name,
        sha: b.commit.sha,
        protected: b.protected,
      })),
    });
  } catch (error: any) {
    console.error("Error fetching branches:", error);
    return NextResponse.json(
      { success: false, message: error?.message || "Failed to fetch branches" },
      { status: 500 }
    );
  }
}
