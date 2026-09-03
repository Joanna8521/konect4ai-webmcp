import { NextRequest, NextResponse } from "next/server";
import {
  handleA2AMethod,
  resolveA2AOrigin,
  resolveA2ARequestOrigin,
  type JsonRpcRequest,
} from "@/lib/a2a/server";

export const dynamic = "force-dynamic";

function parseRequest(body: unknown): JsonRpcRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  return body as JsonRpcRequest;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: "Request body must be valid JSON.",
        },
      },
      { status: 400 },
    );
  }

  const rpc = parseRequest(body);
  if (!rpc || typeof rpc.method !== "string") {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: rpc?.id ?? null,
        error: {
          code: -32600,
          message: "Invalid JSON-RPC request.",
        },
      },
      { status: 400 },
    );
  }

  const response = await handleA2AMethod(
    resolveA2ARequestOrigin(request),
    rpc,
    request.signal,
  );

  return NextResponse.json(response, {
    status: response.error?.code === -32700 || response.error?.code === -32600 ? 400 : 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
