import { NextRequest, NextResponse } from "next/server";
import Database from "@/lib/database";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, pr_number, commit_id, model_name, review_score, files_scanned, report_location } = body;

    if (!username || !model_name) {
      return NextResponse.json(
        { success: false, message: "username and model_name are required" },
        { status: 400 }
      );
    }

    await Database.query(
      `INSERT INTO review_tracking (username, pr_number, commit_id, model_name, review_score, files_scanned, report_location)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [username, pr_number || null, commit_id || null, model_name, review_score || null, files_scanned || null, report_location || null]
    );

    return NextResponse.json({ success: true, message: "Tracking entry saved" });
  } catch (error) {
    console.error("Error saving tracking entry:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, message: errorMessage },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get("username");
    const limitParam = Math.min(Math.max(parseInt(searchParams.get("limit") || "100", 10), 1), 1000);

    let query = "SELECT * FROM review_tracking";
    const params: any[] = [];

    if (username) {
      query += " WHERE username = ?";
      params.push(username);
    }

    query += ` ORDER BY submission_date DESC LIMIT ${limitParam}`;

    const rows = await Database.query(query, params);

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error("Error fetching tracking entries:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, message: errorMessage },
      { status: 500 }
    );
  }
}
