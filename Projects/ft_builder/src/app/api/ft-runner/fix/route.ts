import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { gitCommitAndPush, EventCallback } from "@/services/ftSetup";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workDir, filePath, action } = body;

    if (!workDir || !filePath) {
      return NextResponse.json(
        { success: false, message: "workDir and filePath are required" },
        { status: 400 }
      );
    }

    if (!workDir.includes("ft-run")) {
      return NextResponse.json(
        { success: false, message: "Invalid workDir" },
        { status: 400 }
      );
    }

    // Push-only mode: commit and push changes to remote branch
    if (action === "push-only") {
      const logs: string[] = [];
      const emit: EventCallback = (event) => {
        const msg = `[fix-push] ${event.message || event.type}`;
        console.log(msg);
        logs.push(msg);
      };

      try {
        await gitCommitAndPush(
          workDir,
          `fix(ft): manual fix for ${path.basename(filePath)}`,
          emit
        );
        return NextResponse.json({
          success: true,
          message: "Fix committed and pushed to remote branch",
          logs,
        });
      } catch (error: any) {
        return NextResponse.json(
          { success: false, message: `Push failed: ${error.message}`, logs },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      { success: false, message: "Invalid action. Use action: 'push-only'" },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Fix failed" },
      { status: 500 }
    );
  }
}
