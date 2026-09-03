export type JsonObject = Record<string, unknown>;

export interface BackendTool {
  name: string;
  description: string;
  inputSchema?: JsonObject;
  label?: string;
  jobId?: string;
}

export interface ToolsResponse {
  tools: BackendTool[];
}

export interface CallRequest {
  name: string;
  arguments?: JsonObject;
}

export interface CallResponse {
  name: string;
  result: unknown;
}

export const PROPOSE_DATA_SOURCE_TOOL_NAME = "propose_data_source";

export const PROPOSE_DATA_SOURCE_TOOL: BackendTool = {
  name: PROPOSE_DATA_SOURCE_TOOL_NAME,
  label: "Approval step",
  description:
    "Propose a new data source. This only proposes; a human must approve before anything runs.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Target website or data source URL.",
      },
      description: {
        type: "string",
        description: "Short description of what the new source should extract.",
      },
    },
    required: ["url", "description"],
    additionalProperties: false,
  },
};

export const ASK_DATA_SOURCE_TOOL_NAME = "ask_data_source";

export const ASK_DATA_SOURCE_TOOL: BackendTool = {
  name: ASK_DATA_SOURCE_TOOL_NAME,
  label: "BYOK Q&A",
  description:
    "Ask a natural-language question about a connected data source.\n The page owner's configured model computes the answer.\n The WebMCP tool returns the answer only and does not return the\n underlying dataset.",
  inputSchema: {
    type: "object",
    properties: {
      jobId: {
        type: "string",
        description: "Connected Konect4AI job identifier.",
      },
      question: {
        type: "string",
        description: "Natural-language question to ask about the data source.",
      },
    },
    required: ["jobId", "question"],
    additionalProperties: false,
  },
};

export const DATAGOV_TOOL_NAME = "search_us_government_datasets";

export const DATAGOV_TOOL: BackendTool = {
  name: DATAGOV_TOOL_NAME,
  label: "U.S. Government Open Data",
  description:
    "Search the U.S. Data.gov catalog for public government datasets by topic. Returns structured dataset metadata including title, description, publisher, organization, last modified date, landing page, and available distributions.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Topic or keywords to search for, for example: electric vehicle charging infrastructure",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 20,
        default: 5,
        description: "Maximum number of datasets to return",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

export class Konect4aiClientError extends Error {
  status?: number;
  payload?: unknown;

  constructor(message: string, status?: number, payload?: unknown) {
    super(message);
    this.name = "Konect4aiClientError";
    this.status = status;
    this.payload = payload;
  }
}

async function parseJson<T>(response: Response): Promise<T> {
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
    const message =
      typeof payload === "object" && payload && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed with status ${response.status}.`;
    throw new Konect4aiClientError(message, response.status, payload);
  }

  return payload as T;
}

export async function fetchKonect4aiTools(): Promise<BackendTool[]> {
  const response = await fetch("/api/konect4ai/tools", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const payload = await parseJson<ToolsResponse>(response);
  return payload.tools;
}

export async function callKonect4aiTool(
  name: string,
  args: JsonObject = {},
  signal?: AbortSignal,
): Promise<CallResponse> {
  const response = await fetch("/api/konect4ai/call", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, arguments: args } satisfies CallRequest),
    signal,
  });
  return parseJson<CallResponse>(response);
}

export async function callDataGovSearch(
  args: JsonObject = {},
  signal?: AbortSignal,
): Promise<CallResponse> {
  const response = await fetch("/api/datagov/search", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    signal,
  });
  const result = await parseJson<unknown>(response);
  return {
    name: DATAGOV_TOOL_NAME,
    result,
  };
}

export interface SourceCreateResponse {
  jobId: string;
  status?: string;
  message?: string;
  raw?: unknown;
  job?: Record<string, unknown>;
}

export interface SourceStatusResponse {
  jobId: string;
  status: string;
  ready: boolean;
  job?: Record<string, unknown>;
  message?: string;
}

export interface AskDataSourceReceipt {
  capability: string;
  sourceName: string;
  sourceUrl?: string;
  sourceDescription?: string;
  extractedAt: string;
  verifiedByBackend: boolean;
  rawRowsReturnedThroughWebMCP: boolean;
  recordsConsulted?: number;
  modelBoundary?: string;
}

export interface AskDataSourceResponse {
  answer: string;
  receipt: AskDataSourceReceipt;
  rawRows?: unknown[];
  metadata?: Record<string, unknown>;
}

export async function createKonect4aiSource(
  args: { url: string; description: string },
  signal?: AbortSignal,
): Promise<SourceCreateResponse> {
  const response = await fetch("/api/konect4ai/sources", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    signal,
  });
  return parseJson<SourceCreateResponse>(response);
}

export async function fetchKonect4aiSourceStatus(
  jobId: string,
  signal?: AbortSignal,
): Promise<SourceStatusResponse> {
  const response = await fetch(
    `/api/konect4ai/sources?jobId=${encodeURIComponent(jobId)}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal,
    },
  );
  return parseJson<SourceStatusResponse>(response);
}

export async function fetchKonect4aiSourceOpenApi(
  jobId: string,
  signal?: AbortSignal,
): Promise<JsonObject> {
  const response = await fetch(
    `/api/konect4ai/sources?jobId=${encodeURIComponent(jobId)}&view=openapi`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal,
    },
  );
  return parseJson<JsonObject>(response);
}

export async function askKonect4aiApi(
  jobId: string,
  question: string,
  signal?: AbortSignal,
): Promise<AskDataSourceResponse> {
  const response = await fetch("/api/konect4ai/ask", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jobId, question }),
    signal,
  });

  const payload = await parseJson<unknown>(response);
  const data = payload as Record<string, unknown>;
  const answer =
    typeof data.answer === "string"
      ? data.answer
      : typeof data.text === "string"
        ? data.text
        : typeof data.content === "string"
          ? data.content
          : "";

  return {
    answer,
    receipt: (data.receipt as AskDataSourceReceipt) || {
      capability: ASK_DATA_SOURCE_TOOL_NAME,
      sourceName: jobId,
      extractedAt: new Date().toISOString(),
      verifiedByBackend: false,
      rawRowsReturnedThroughWebMCP: false,
    },
    rawRows: Array.isArray(data.rawRows) ? data.rawRows : undefined,
    metadata: (data.metadata as Record<string, unknown>) || undefined,
  };
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
