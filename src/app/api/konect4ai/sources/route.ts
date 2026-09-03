import { NextRequest, NextResponse } from "next/server";
import { registerKnownSourceJob } from "@/lib/konect4ai-source-registry";

export const dynamic = "force-dynamic";

// Best-effort in-process limit only. Serverless deployments track this per instance.
const MAX_SOURCE_CREATIONS = 5;
let sourceCreationCount = 0;

interface SourceBody {
  url?: unknown;
  description?: unknown;
}

interface Konect4aiJobResponse {
  id?: unknown;
  url?: unknown;
  description?: unknown;
  status?: unknown;
  progress?: unknown;
  message?: unknown;
  api_endpoint_path?: unknown;
  sample_data?: unknown;
  error_info?: unknown;
  analysis?: unknown;
}

function env() {
  const apiBase = process.env.KONECT4AI_API_BASE?.replace(/\/+$/, "");
  const userToken = process.env.KONECT4AI_USER_TOKEN?.trim();

  if (!apiBase || !userToken) {
    return {
      error: "Source bridge is not configured on the server.",
    };
  }

  return { apiBase, userToken };
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

async function fetchJson(
  apiBase: string,
  path: string,
  token: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<{ status: number; payload: unknown }> {
  const response = await fetch(new URL(path, apiBase), {
    cache: "no-store",
    signal,
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }

  return { status: response.status, payload };
}

async function authedGet(
  apiBase: string,
  token: string,
  path: string,
  signal?: AbortSignal,
): Promise<{ status: number; payload: unknown }> {
  return fetchJson(
    apiBase,
    path,
    token,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    signal,
  );
}

async function authedPost(
  apiBase: string,
  token: string,
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ status: number; payload: unknown }> {
  return fetchJson(
    apiBase,
    path,
    token,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
    signal,
  );
}

function sanitizeJobResponse(payload: unknown): Konect4aiJobResponse {
  const value = asObject(payload);
  return {
    id: value.id,
    url: value.url,
    description: value.description,
    status: value.status,
    progress: value.progress,
    message: value.message,
    api_endpoint_path: value.api_endpoint_path,
    sample_data: value.sample_data,
    error_info: value.error_info,
    analysis: value.analysis,
  };
}

export async function POST(request: NextRequest) {
  const config = env();
  if ("error" in config) {
    return NextResponse.json(
      {
        error: config.error,
        code: "SOURCE_BRIDGE_UNAVAILABLE",
      },
      { status: 503 },
    );
  }

  if (sourceCreationCount >= MAX_SOURCE_CREATIONS) {
    return NextResponse.json(
      {
        error: "Source creation limit reached for this deployment.",
        code: "SOURCE_CREATION_LIMIT_REACHED",
      },
      { status: 429 },
    );
  }

  let body: SourceBody;
  try {
    body = (await request.json()) as SourceBody;
  } catch {
    return NextResponse.json(
      {
        error: "Request body must be JSON.",
      },
      { status: 400 },
    );
  }

  const url = asString(body.url);
  const description = asString(body.description);
  if (!url || !description) {
    return NextResponse.json(
      {
        error: "url and description are required.",
      },
      { status: 400 },
    );
  }

  const response = await authedPost(
    config.apiBase,
    config.userToken,
    "/api/v1/scraping/requests",
    { url, description },
    request.signal,
  );

  if (response.status >= 400) {
    const error = asObject(response.payload);
    return NextResponse.json(
      {
        error:
          typeof error.error === "string"
            ? error.error
            : "Unable to create source proposal.",
        code: "SOURCE_CREATE_FAILED",
      },
      { status: response.status },
    );
  }

  sourceCreationCount += 1;
  const job = sanitizeJobResponse(response.payload);
  const jobId = asString(job.id) || "";
  if (jobId) {
    registerKnownSourceJob(jobId, {
      sourceUrl: url,
      sourceDescription: description,
    });
  }
  return NextResponse.json(
    {
      jobId,
      status: asString(job.status) || "pending",
      message: asString(job.message),
      job,
    },
    {
      status: 201,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function GET(request: NextRequest) {
  const config = env();
  if ("error" in config) {
    return NextResponse.json(
      {
        error: config.error,
        code: "SOURCE_BRIDGE_UNAVAILABLE",
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const jobId = asString(url.searchParams.get("jobId"));
  const view = asString(url.searchParams.get("view"));

  if (!jobId) {
    return NextResponse.json(
      {
        error: "jobId is required.",
      },
      { status: 400 },
    );
  }

  if (view === "openapi") {
    const openapi = await authedGet(
      config.apiBase,
      config.userToken,
      `/generated/${encodeURIComponent(jobId)}/openapi.json`,
      request.signal,
    );

    if (openapi.status >= 400) {
      const error = asObject(openapi.payload);
      return NextResponse.json(
        {
          error:
            typeof error.error === "string"
              ? error.error
              : "Unable to load generated OpenAPI.",
          code: "SOURCE_OPENAPI_FAILED",
        },
        { status: openapi.status },
      );
    }

    return NextResponse.json(openapi.payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  const response = await authedGet(
    config.apiBase,
    config.userToken,
    `/api/v1/scraping/jobs/${encodeURIComponent(jobId)}`,
    request.signal,
  );

  if (response.status >= 400) {
    const error = asObject(response.payload);
    return NextResponse.json(
      {
        error:
          typeof error.error === "string"
            ? error.error
            : "Unable to load source status.",
        code: "SOURCE_STATUS_FAILED",
      },
      { status: response.status },
    );
  }

  const job = sanitizeJobResponse(response.payload);
  const status = asString(job.status) || "pending";
  return NextResponse.json(
    {
      jobId,
      status,
      ready: status === "ready",
      job,
      message: asString(job.message),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
