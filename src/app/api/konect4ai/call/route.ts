import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface CallBody {
  name?: unknown;
  arguments?: unknown;
}

interface McpCallResponse {
  result?: unknown;
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

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  const config = env();
  if ("error" in config) {
    return NextResponse.json({ error: config.error }, { status: 500 });
  }

  let body: CallBody;
  try {
    body = (await request.json()) as CallBody;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "Tool name is required." }, { status: 400 });
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
        id: `webmcp-call-${Date.now()}`,
        method: "tools/call",
        params: {
          name: body.name,
          arguments: asObject(body.arguments),
        },
      }),
      cache: "no-store",
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | McpCallResponse
    | null;

  if (!response.ok) {
    return NextResponse.json(
      {
        error:
          payload?.error?.message ||
          `Konect4AI tools/call failed with status ${response.status}.`,
      },
      { status: response.status },
    );
  }

  if (payload?.error) {
    return NextResponse.json(
      {
        error: payload.error.message || "Konect4AI tools/call returned an error.",
        code: payload.error.code,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    name: body.name,
    result: payload?.result,
  });
}
