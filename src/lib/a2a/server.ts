import { runAgent } from "@/lib/agents/runtime";
import type { NextRequest } from "next/server";
import type { BackendTool, JsonObject } from "@/lib/konect4ai-client";

export const A2A_PROTOCOL_VERSION = "v1.0";
export const A2A_AGENT_CARD_PATH = "/.well-known/agent-card.json";
export const A2A_ENDPOINT_PATH = "/a2a";
export const A2A_SEND_MESSAGE_METHOD = "SendMessage";
export const A2A_GET_TASK_METHOD = "GetTask";
// Subset only: this adapter intentionally exposes a narrow A2A v1.0 surface.
export const A2A_SUBSET_NOTE =
  "This repository implements the A2A v1.0 adapter subset only: SendMessage, GetTask, and an Agent Card at /.well-known/agent-card.json. It does not implement SendStreamingMessage, ListTasks, CancelTask, SubscribeToTask, push notifications, or GetExtendedAgentCard.";

type RpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: RpcId;
  method?: string;
  params?: JsonObject;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: RpcId;
  result?: unknown;
  error?: JsonRpcError;
}

export interface A2ASkill {
  id: string;
  name: string;
  description: string;
  inputModes: string[];
  outputModes: string[];
  tags?: string[];
  examples?: string[];
}

export interface AgentCard {
  name: string;
  description: string;
  version: string;
  url: string;
  provider: {
    name: string;
  };
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
  };
  skills: A2ASkill[];
  methods: string[];
  protocolVersion: string;
  wellKnown: string;
  source: string;
  capabilityMetadata: {
    name: string;
    label?: string;
    description?: string;
  }[];
  discovery: {
    status: "connected" | "degraded";
    message: string;
  };
}

export interface A2ATaskRecord {
  id: string;
  state: "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  agentId: string;
  agentName: string;
  input: Record<string, unknown>;
  result: unknown;
  runResult: unknown;
  message: string;
  capabilities: string[];
}

export interface A2ATaskResponse {
  task: A2ATaskRecord;
}

const TASKS = new Map<string, A2ATaskRecord>();

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

function parseMessageText(message: unknown): string {
  const value = asObject(message);
  const direct = asString(value.text || value.content || value.body);
  if (direct) return direct;

  const parts = Array.isArray(value.parts) ? value.parts : [];
  for (const part of parts) {
    const item = asObject(part);
    const text = asString(item.text || item.content || item.body);
    if (text) return text;
  }

  const nested = asObject(value.message);
  const nestedText = asString(nested.text || nested.content || nested.body);
  if (nestedText) return nestedText;

  return "";
}

async function fetchJson(
  origin: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(new URL(path, origin), {
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers || {}),
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
    throw new Error(
      typeof error.error === "string"
        ? error.error
        : `Request failed with status ${response.status}.`,
    );
  }

  return payload;
}

async function fetchKonect4aiTools(
  origin: string,
  signal?: AbortSignal,
): Promise<BackendTool[]> {
  const payload = (await fetchJson(origin, "/api/konect4ai/tools", {
    signal,
  })) as {
    tools?: BackendTool[];
  };
  return Array.isArray(payload.tools) ? payload.tools : [];
}

async function executeCapability(
  origin: string,
  toolName: string,
  args: JsonObject,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(new URL("/api/konect4ai/call", origin), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: toolName, arguments: args }),
    cache: "no-store",
    signal,
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
    throw new Error(
      typeof error.error === "string"
        ? error.error
        : `Konect4AI tools/call failed with status ${response.status}.`,
    );
  }

  const result = asObject(payload);
  return result.result;
}

export async function loadAgentCard(
  publicOrigin: string,
  internalOrigin: string,
): Promise<AgentCard> {
  let tools: BackendTool[] = [];
  let discovery: AgentCard["discovery"] = {
    status: "connected" as const,
    message: "Connected to /api/konect4ai/tools.",
  };

  try {
    tools = await fetchKonect4aiTools(internalOrigin);
  } catch (error) {
    console.warn(
      "A2A capability metadata discovery failed; continuing with empty tool metadata.",
      error instanceof Error ? error.message : String(error),
    );
    discovery = {
      status: "degraded",
      message:
        error instanceof Error
          ? error.message
          : "Unable to load current Konect4AI MCP capabilities.",
    };
  }

  const skills: A2ASkill[] = [
    {
      id: "research_connected_sources",
      name: "Research connected sources",
      description:
        "Research a topic across multiple connected data sources and keep the evidence traceable.",
      inputModes: ["application/json"],
      outputModes: ["application/json"],
      tags: ["research"],
    },
    {
      id: "compare_source_findings",
      name: "Compare source findings",
      description:
        "Compare results from multiple sources and surface agreement, disagreement, and gaps.",
      inputModes: ["application/json"],
      outputModes: ["application/json"],
      tags: ["compare"],
    },
    {
      id: "summarize_web_data",
      name: "Summarize web data",
      description:
        "Turn connected web data into a concise structured summary for review.",
      inputModes: ["application/json"],
      outputModes: ["application/json"],
      tags: ["summary"],
    },
    {
      id: "analyze_structured_results",
      name: "Analyze structured results",
      description:
        "Analyze structured results returned by a connected capability and extract patterns.",
      inputModes: ["application/json"],
      outputModes: ["application/json"],
      tags: ["analysis"],
    },
  ];

  const capabilityMetadata = tools.map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
  }));

  return {
    name: "Konect4AI Research Agent",
    description:
      "A subset A2A adapter that exposes the Konect4AI Research Agent with live MCP-backed metadata sourced from /api/konect4ai/tools.",
    version: "0.1.0",
    url: new URL(A2A_ENDPOINT_PATH, publicOrigin).toString(),
    provider: {
      name: "Konect4AI",
    },
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    skills,
    methods: [A2A_SEND_MESSAGE_METHOD, A2A_GET_TASK_METHOD],
    protocolVersion: A2A_PROTOCOL_VERSION,
    wellKnown: A2A_AGENT_CARD_PATH,
    source: "/api/konect4ai/tools",
    capabilityMetadata,
    discovery,
  };
}

export function resolveA2AOrigin(request: NextRequest): string {
  return process.env.APP_ORIGIN?.replace(/\/+$/, "") ?? request.nextUrl.origin;
}

export function resolveA2ARequestOrigin(request: NextRequest): string {
  return request.nextUrl.origin;
}

export function jsonRpcError(
  id: RpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      data,
    },
  };
}

export async function handleSendMessage(
  origin: string,
  id: RpcId,
  params: JsonObject | undefined,
  signal?: AbortSignal,
): Promise<JsonRpcResponse> {
  try {
    const messageText = parseMessageText(params?.message);
    if (!messageText) {
      return jsonRpcError(id, -32602, "SendMessage requires params.message.text.");
    }

    const taskId = asString(params?.taskId) || asString(params?.id) || newId();
    const language = asString(params?.language) || "auto";
    const sources = asStringArray(params?.sources);
    const maxSourcesRaw = Number(params?.maxSources);
    const maxSources = Number.isFinite(maxSourcesRaw)
      ? Math.min(3, Math.max(1, Math.trunc(maxSourcesRaw)))
      : 3;

    const tools = await fetchKonect4aiTools(origin, signal);
    const runResult = await runAgent(
      "research_agent",
      {
        goal: messageText,
        sources,
        language,
        maxSources,
      },
      {
        availableTools: tools,
        invocationSource: "webmcp",
        signal,
        executeCapability: (toolName, args, childSignal) =>
          executeCapability(origin, toolName, args ?? {}, childSignal),
        onProgress: undefined,
      },
    );

    const now = nowIso();
    const task: A2ATaskRecord = {
      id: taskId,
      state: runResult.status === "success" ? "completed" : "failed",
      createdAt: now,
      updatedAt: now,
      agentId: runResult.agentId,
      agentName: runResult.agentName,
      input: {
        goal: messageText,
        language,
        sources,
        maxSources,
      },
      result: runResult.result ?? {
        message: runResult.message,
        summary: runResult.summary ?? runResult.message,
      },
      runResult,
      message: runResult.message,
      capabilities: runResult.usedCapabilities,
    };

    TASKS.set(taskId, task);

    return {
      jsonrpc: "2.0",
      id,
      result: {
        taskId,
        task,
        result: runResult,
      },
    };
  } catch (error) {
    return jsonRpcError(
      id,
      -32000,
      error instanceof Error ? error.message : "A2A SendMessage failed.",
    );
  }
}

export function handleGetTask(id: RpcId, params: JsonObject | undefined): JsonRpcResponse {
  const taskId = asString(params?.taskId) || asString(params?.id);
  if (!taskId) {
    return jsonRpcError(id, -32602, "GetTask requires params.taskId.");
  }

  const task = TASKS.get(taskId);
  if (!task) {
    return jsonRpcError(id, 404, `Task ${taskId} was not found.`);
  }

  return {
    jsonrpc: "2.0",
    id,
    result: {
      task,
    },
  };
}

export function handleA2AMethod(
  origin: string,
  request: JsonRpcRequest,
  signal?: AbortSignal,
): Promise<JsonRpcResponse> | JsonRpcResponse {
  switch (request.method) {
    case A2A_SEND_MESSAGE_METHOD:
      return handleSendMessage(origin, request.id ?? null, request.params, signal);
    case A2A_GET_TASK_METHOD:
      return handleGetTask(request.id ?? null, request.params);
    default:
      return jsonRpcError(
        request.id ?? null,
        -32601,
        `Method ${request.method || "(missing)"} is not implemented in this adapter.`,
      );
  }
}
