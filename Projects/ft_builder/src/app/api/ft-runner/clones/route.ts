import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { listClones } from "@/services/ftSetup";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId") || undefined;
    const clones = listClones(userId);
    return NextResponse.json({ success: true, clones });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Failed to list clones" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: clonePath } = body;

    if (!clonePath || !clonePath.includes("ft-run-")) {
      return NextResponse.json(
        { success: false, message: "Invalid clone path" },
        { status: 400 }
      );
    }

    if (!fs.existsSync(clonePath)) {
      return NextResponse.json(
        { success: false, message: "Clone directory not found" },
        { status: 404 }
      );
    }

    fs.rmSync(clonePath, { recursive: true, force: true });

    return NextResponse.json({
      success: true,
      message: `Removed clone: ${clonePath}`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Failed to delete clone" },
      { status: 500 }
    );
  }
}
