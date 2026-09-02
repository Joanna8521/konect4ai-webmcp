export type JsonObject = Record<string, unknown>;

export interface BackendTool {
  name: string;
  description: string;
  inputSchema?: JsonObject;
  label?: string;
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

  constructor(message: string, status?: number) {
    super(message);
    this.name = "Konect4aiClientError";
    this.status = status;
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
    throw new Konect4aiClientError(message, response.status);
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

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
