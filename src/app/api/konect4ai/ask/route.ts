import { NextRequest, NextResponse } from "next/server";
import {
  listJobDescriptions,
  resolveJobIdFromToolName,
  type ScrapingJob,
} from "@/lib/konect4ai-job-resolution";
import { listKnownSourceJobs, resolveJobIdForToolName } from "@/lib/konect4ai-source-registry";

export const dynamic = "force-dynamic";

interface AskBody {
  jobId?: unknown;
  question?: unknown;
}

interface Konect4aiAskPayload {
  answer?: unknown;
  text?: unknown;
  content?: unknown;
  rawRows?: unknown;
  rows?: unknown;
  sample_data?: unknown;
  records_consulted?: unknown;
  recordsConsulted?: unknown;
  source_name?: unknown;
  sourceName?: unknown;
  source_url?: unknown;
  sourceUrl?: unknown;
  verified?: unknown;
  backend_verified?: unknown;
  metadata?: unknown;
}

interface Konect4aiGeneratedPayload {
  data?: unknown;
  items?: unknown;
}

class Konect4aiRequestError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    super(
      typeof payload.error === "string"
        ? payload.error
        : `Konect4AI request failed with status ${status}.`,
    );
    this.name = "Konect4aiRequestError";
    this.status = status;
    this.payload = payload;
  }
}

function env() {
  const apiBase = process.env.KONECT4AI_API_BASE?.replace(/\/+$/, "");
  const userToken = process.env.KONECT4AI_USER_TOKEN?.trim();

  if (!apiBase || !userToken) {
    return {
      error: "Ask bridge is not configured on the server.",
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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asString(item))
    .filter((item) => item.length > 0);
}

function pickFirstString(...values: unknown[]): string {
  for (const value of values) {
    const text = asString(value);
    if (text) return text;
  }
  return "";
}

function truncateText(value: string, length = 60): string {
  const text = value.trim();
  if (text.length <= length) return text;
  return `${text.slice(0, length - 1).trimEnd()}…`;
}

function deriveSourceName(jobUrl: string, jobDescription: string, jobId: string): string {
  if (jobUrl) {
    try {
      const url = new URL(jobUrl);
      const path = url.pathname.replace(/\/+$/, "");
      return `${url.hostname}${path}` || jobUrl;
    } catch {
      return truncateText(jobUrl, 60);
    }
  }

  if (jobDescription) {
    return truncateText(jobDescription, 60);
  }

  return jobId;
}

async function fetchJson(
  apiBase: string,
  path: string,
  token: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(new URL(path, apiBase), {
    method: "GET",
    cache: "no-store",
    signal,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
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

  if (!response.ok) {
    const error = asObject(payload);
    throw new Konect4aiRequestError(response.status, error);
  }

  return payload;
}

async function fetchScrapingJobs(
  apiBase: string,
  token: string,
  signal?: AbortSignal,
): Promise<ScrapingJob[]> {
  try {
    const payload = (await fetchJson(
      apiBase,
      "/api/v1/scraping/jobs",
      token,
      signal,
    )) as { jobs?: ScrapingJob[] };
    return Array.isArray(payload.jobs) ? payload.jobs : [];
  } catch {
    return [];
  }
}

async function postJson(
  apiBase: string,
  path: string,
  token: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(new URL(path, apiBase), {
    method: "POST",
    cache: "no-store",
    signal,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
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

  if (!response.ok) {
    const error = asObject(payload);
    throw new Konect4aiRequestError(response.status, error);
  }

  return payload;
}

async function fetchGeneratedRows(
  apiBase: string,
  jobId: string,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const licenseKey = process.env.KONECT4AI_DEMO_LICENSE_KEY?.trim();
  if (!licenseKey) {
    return [];
  }

  try {
    const response = await fetch(
      new URL(`/generated/${encodeURIComponent(jobId)}`, apiBase),
      {
        method: "GET",
        cache: "no-store",
        signal,
        headers: {
          Accept: "application/json",
          "X-License-Key": licenseKey,
        },
      },
    );

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text };
      }
    }

    if (!response.ok) {
      return [];
    }

    const data = asObject(payload);
    const candidate =
      (data.data as Konect4aiGeneratedPayload | undefined)?.items ??
      data.items ??
      asObject(data.data).items;

    return Array.isArray(candidate) ? candidate : [];
  } catch {
    return [];
  }
}

function extractAnswer(payload: Konect4aiAskPayload | Record<string, unknown>): string {
  return pickFirstString(
    payload.answer,
    payload.text,
    payload.content,
    asObject(payload.metadata).answer,
    asObject(payload.metadata).text,
  );
}

function extractRecordsConsulted(
  payload: Konect4aiAskPayload | Record<string, unknown>,
  rows: unknown[],
): number | undefined {
  const raw = payload.records_consulted ?? payload.recordsConsulted;
  const count = Number(raw);
  if (Number.isFinite(count) && count >= 0) {
    return Math.trunc(count);
  }
  return rows.length > 0 ? rows.length : undefined;
}

export async function POST(request: NextRequest) {
  const config = env();
  if ("error" in config) {
    return NextResponse.json(
      {
        error: config.error,
        code: "ASK_BRIDGE_UNAVAILABLE",
      },
      { status: 503 },
    );
  }

  let body: AskBody;
  try {
    body = (await request.json()) as AskBody;
  } catch {
    return NextResponse.json(
      {
        error: "Request body must be JSON.",
      },
      { status: 400 },
    );
  }

  const jobId = asString(body.jobId);
  const question = asString(body.question);
  if (!jobId || !question) {
    return NextResponse.json(
      {
        error: "jobId and question are required.",
      },
      { status: 400 },
    );
  }

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let resolvedJobId = uuidPattern.test(jobId) ? jobId : "";
  let availableJobs: ScrapingJob[] = [];

  if (!resolvedJobId) {
    const cachedJobId = resolveJobIdForToolName(jobId);
    if (cachedJobId) {
      resolvedJobId = cachedJobId;
    }
  }

  if (!resolvedJobId) {
    availableJobs = await fetchScrapingJobs(
      config.apiBase,
      config.userToken,
      request.signal,
    );
    const fetchedJobId = resolveJobIdFromToolName(jobId, availableJobs);
    if (fetchedJobId) {
      resolvedJobId = fetchedJobId;
    }
  }

  if (!resolvedJobId) {
    const availableJobDescriptions = [
      ...listJobDescriptions(availableJobs.length > 0 ? availableJobs : []),
      ...listKnownSourceJobs().map(
        (job) => `${job.jobId} — ${job.sourceDescription || job.sourceName || job.toolName || "unknown source"}`,
      ),
    ].filter((value, index, list) => list.indexOf(value) === index);
    return NextResponse.json(
      {
        error:
          availableJobDescriptions.length > 0
            ? `Unable to resolve jobId "${jobId}". Available jobId choices: ${availableJobDescriptions.join(
                "; ",
              )}`
            : `Unable to resolve jobId "${jobId}". No matching job id is available.`,
        code: "job_id_invalid",
        availableJobIds: availableJobDescriptions,
      },
      { status: 422 },
    );
  }

  let jobInfo: Record<string, unknown> | null = null;
  try {
    jobInfo = (await fetchJson(
      config.apiBase,
      `/api/v1/scraping/jobs/${encodeURIComponent(resolvedJobId)}`,
      config.userToken,
      request.signal,
    )) as Record<string, unknown>;
  } catch {
    jobInfo = null;
  }

  let askPayload: Konect4aiAskPayload | Record<string, unknown>;
  try {
    askPayload = (await postJson(
      config.apiBase,
      "/api/byok/ask",
      config.userToken,
      {
        job_id: resolvedJobId,
        question,
        locale: "en",
      },
      request.signal,
    )) as Konect4aiAskPayload | Record<string, unknown>;
  } catch (error) {
    if (error instanceof Konect4aiRequestError) {
      return NextResponse.json(
        {
          ...error.payload,
          status: error.status,
        },
        {
          status: error.status,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        code: "ASK_REQUEST_FAILED",
      },
      { status: 502 },
    );
  }

  const answer = extractAnswer(askPayload);
  if (!answer) {
    return NextResponse.json(
      {
        error: "Konect4AI did not return an answer.",
        code: "ASK_ANSWER_MISSING",
      },
      { status: 502 },
    );
  }
  const jobUrl = pickFirstString(jobInfo?.url, asObject(jobInfo?.job).url);
  const jobDescription = pickFirstString(
    jobInfo?.description,
    asObject(jobInfo?.job).description,
  );
  const sourceName = deriveSourceName(jobUrl, jobDescription, jobId);
  const sourceDescription = jobDescription || jobUrl || jobId;
  const generatedRows = await fetchGeneratedRows(
    config.apiBase,
    resolvedJobId,
    request.signal,
  );
  const recordsConsulted =
    generatedRows.length > 0
      ? generatedRows.length
      : extractRecordsConsulted(askPayload, []);
  const verifiedByBackend =
    askPayload.verified === true ||
    askPayload.backend_verified === true ||
    Boolean(jobInfo);

  return NextResponse.json(
    {
      answer,
      receipt: {
        capability: "ask_data_source",
        sourceName,
        sourceUrl: jobUrl || undefined,
        sourceDescription: sourceDescription || undefined,
        extractedAt:
          pickFirstString(
            asObject(askPayload.metadata).extracted_at,
            asObject(askPayload.metadata).timestamp,
            asObject(askPayload.metadata).updated_at,
          ) || new Date().toISOString(),
        verifiedByBackend,
        rawRowsReturnedThroughWebMCP: false,
        recordsConsulted,
        modelBoundary: "The page owner's configured BYOK model computes the answer.",
      },
      rawRows: generatedRows,
      metadata: {
        jobId,
        resolvedJobId,
        jobStatus: jobInfo?.status,
        jobMessage: jobInfo?.message,
        jobUrl: jobUrl || undefined,
        sourceDescription: sourceDescription || undefined,
        rawRowsSource: generatedRows.length > 0 ? "/generated/{jobId}" : undefined,
        responseKeys: Object.keys(asObject(askPayload)),
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
