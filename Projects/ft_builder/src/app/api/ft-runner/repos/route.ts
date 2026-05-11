import { NextRequest, NextResponse } from "next/server";
import GitHubService from "@/services/github";
import { env } from "@/config/env";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { githubToken } = body;

    if (!githubToken) {
      return NextResponse.json(
        { success: false, message: "githubToken is required" },
        { status: 401 }
      );
    }

    const github = new GitHubService(githubToken, env.github.baseUrl);

    // Get authenticated user's login (NTID)
    const userResponse = await github.validateTokenAndGetUser();
    const username = userResponse.login;

    // Fetch all repos accessible to the authenticated user (includes org repos)
    const repos = await github.getAuthenticatedUserRepos();

    return NextResponse.json({
      success: true,
      user: username,
      repos: repos.map((r) => ({
        name: r.name,
        full_name: r.full_name,
        description: r.description,
        updated_at: r.updated_at,
        owner: r.owner.login,
      })),
    });
  } catch (error: any) {
    console.error("Error fetching repos:", error);
    return NextResponse.json(
      { success: false, message: error?.message || "Failed to fetch repositories" },
      { status: 500 }
    );
  }
}
