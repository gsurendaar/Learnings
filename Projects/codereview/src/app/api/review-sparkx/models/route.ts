import { NextRequest, NextResponse } from "next/server";
import * as https from "https";
import * as http from "http";

export async function GET(request: NextRequest) {
  try {
    const baseUrl = request.nextUrl.searchParams.get("baseUrl");
    const apiKey = request.nextUrl.searchParams.get("apiKey");

    if (!baseUrl) {
      return NextResponse.json(
        { success: false, message: "LLM API base URL is required" },
        { status: 400 }
      );
    }

    if (!apiKey) {
      return NextResponse.json(
        { success: false, message: "LLM API key is required" },
        { status: 400 }
      );
    }

    // Fetch models from the LLM API
    const models = await fetchModels(baseUrl, apiKey);

    return NextResponse.json({
      success: true,
      models: models,
    });
  } catch (error) {
    console.error("Error fetching models:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json(
      { success: false, message: errorMessage },
      { status: 500 }
    );
  }
}

function fetchModels(baseUrl: string, apiKey: string): Promise<Array<{ id: string; object: string }>> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/models`);

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    };

    const protocol = url.protocol === "https:" ? https : http;

    const req = protocol.request(options, (res: any) => {
      let data = "";

      res.on("data", (chunk: string) => {
        data += chunk;
      });

      res.on("end", () => {
        const statusCode = res.statusCode || 0;
        if (statusCode >= 200 && statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            // The API returns { data: [...models] }
            const models = parsed.data || parsed.models || [];
            resolve(models);
          } catch (error) {
            reject(new Error("Failed to parse models response"));
          }
        } else {
          reject(new Error(`Failed to fetch models: status ${statusCode}`));
        }
      });
    });

    req.on("error", (error: Error) => {
      reject(error);
    });

    req.end();
  });
}
