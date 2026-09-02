import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpListResponse {
  result?: {
    tools?: McpTool[];
  };
  error?: {
    code?: number;
    message?: string;
  };
}

function env() {
  const apiBase = process.env.KONECT4AI_API_BASE?.replace(/\/+$/, "");
  const licenseKey = process.env.KONECT4AI_DEMO_LICENSE_KEY;

  if (!apiBase || !licenseKey) {
    return {
      error:
        "Server is missing KONECT4AI_API_BASE or KONECT4AI_DEMO_LICENSE_KEY.",
    };
  }

  return { apiBase, licenseKey };
}

export async function GET() {
  const config = env();
  if ("error" in config) {
    return NextResponse.json({ error: config.error }, { status: 500 });
  }

  const response = await fetch(
    `${config.apiBase}/mcp/${encodeURIComponent(config.licenseKey)}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "webmcp-tools",
        method: "tools/list",
      }),
      cache: "no-store",
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | McpListResponse
    | null;

  if (!response.ok) {
    return NextResponse.json(
      {
        error:
          payload?.error?.message ||
          `Konect4AI tools/list failed with status ${response.status}.`,
      },
      { status: response.status },
    );
  }

  if (payload?.error) {
    return NextResponse.json(
      {
        error: payload.error.message || "Konect4AI tools/list returned an error.",
        code: payload.error.code,
      },
      { status: 502 },
    );
  }

  const tools = (payload?.result?.tools || []).map((tool) => ({
    name: tool.name,
    description: tool.description || "",
    inputSchema: tool.inputSchema,
  }));

  return NextResponse.json({ tools });
}
