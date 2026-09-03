import type { BackendTool, JsonObject } from "@/lib/konect4ai-client";
import {
  ASK_DATA_SOURCE_TOOL_NAME,
  PROPOSE_DATA_SOURCE_TOOL_NAME,
} from "@/lib/konect4ai-client";

type ToolExecuteOptions = {
  signal?: AbortSignal;
};

interface ToolContentBlock {
  type: "text";
  text: string;
}

interface CallToolResult {
  content: ToolContentBlock[];
  structuredContent?: unknown;
  isError?: boolean;
}

type ToolExecute = (
  args?: JsonObject,
  options?: ToolExecuteOptions,
) => Promise<CallToolResult> | CallToolResult;

interface ModelContextTool {
  name: string;
  description: string;
  inputSchema?: JsonObject;
  execute: ToolExecute;
}

interface RegisteredTool {
  name: string;
  description: string;
  inputSchema?: string | JsonObject;
  origin?: string;
  window?: Window;
}

interface ModelContext {
  registerTool(
    tool: ModelContextTool,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ): Promise<void>;
  getTools?(options?: { fromOrigins?: string[] }): Promise<RegisteredTool[]>;
  executeTool?(
    tool: RegisteredTool,
    inputObject?: JsonObject,
    options?: { signal?: AbortSignal },
  ): Promise<string>;
  addEventListener?(
    type: "toolchange",
    listener: EventListenerOrEventListenerObject,
  ): void;
  removeEventListener?(
    type: "toolchange",
    listener: EventListenerOrEventListenerObject,
  ): void;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }

  interface Navigator {
    modelContext?: ModelContext;
  }
}

export interface RegistrationResult {
  available: boolean;
  registered: string[];
  errors: string[];
  cleanup: () => void;
}

export interface RegistrationOptions {
  controller?: AbortController;
}

export type ExecuteRegisteredTool = (
  toolName: string,
  args: JsonObject,
  source: "webmcp",
  signal?: AbortSignal,
) => Promise<unknown>;

function getModelContext(): ModelContext | undefined {
  if (typeof document === "undefined" || typeof navigator === "undefined") {
    return undefined;
  }

  return document.modelContext ?? navigator.modelContext;
}

function cloneSchema(schema: unknown): JsonObject | undefined {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return undefined;
  }

  try {
    return JSON.parse(JSON.stringify(schema)) as JsonObject;
  } catch {
    return undefined;
  }
}

function normalizeArgs(args: unknown): JsonObject {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return {};
  }
  return args as JsonObject;
}

function wrapToolResult(rawResult: unknown): CallToolResult {
  const text = JSON.stringify(rawResult, null, 2);
  const content: ToolContentBlock[] = [
    {
      type: "text",
      text: text ?? String(rawResult ?? null),
    },
  ];
  return {
    content,
    structuredContent: rawResult,
  };
}

function wrapTextResult(
  text: string,
  structuredContent?: unknown,
): CallToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent,
  };
}

function wrapToolError(message: string): CallToolResult {
  const content: ToolContentBlock[] = [{ type: "text", text: message }];
  return {
    content,
    structuredContent: {
      isError: true,
      message,
    },
    isError: true,
  };
}

export function isWebMcpAvailable(): boolean {
  return Boolean(getModelContext());
}

export async function registerKonect4aiTools(
  tools: BackendTool[],
  executeTool: ExecuteRegisteredTool,
  options: RegistrationOptions = {},
): Promise<RegistrationResult> {
  const modelContext = getModelContext();

  if (!modelContext) {
    return {
      available: false,
      registered: [],
      errors: ["WebMCP is not available in this browser."],
      cleanup: () => {},
    };
  }

  const controller = options.controller ?? new AbortController();
  const registered: string[] = [];
  const errors: string[] = [];

  for (const tool of tools) {
    if (controller.signal.aborted) {
      break;
    }
    try {
      await modelContext.registerTool(
        {
          name: tool.name,
          description: tool.description || `Run ${tool.name}.`,
          inputSchema: cloneSchema(tool.inputSchema),
          execute: async (args?: JsonObject, options?: ToolExecuteOptions) => {
            try {
              const rawResult = await executeTool(
                tool.name,
                normalizeArgs(args),
                "webmcp",
                options?.signal,
              );
              if (tool.name === ASK_DATA_SOURCE_TOOL_NAME) {
                const value =
                  rawResult && typeof rawResult === "object"
                    ? (rawResult as Record<string, unknown>)
                    : {};
                const answer =
                  typeof value.answer === "string"
                    ? value.answer
                    : typeof rawResult === "string"
                      ? rawResult
                      : "";
                return wrapTextResult(answer, rawResult);
              }
              if (tool.name === PROPOSE_DATA_SOURCE_TOOL_NAME) {
                const value =
                  rawResult && typeof rawResult === "object"
                    ? (rawResult as Record<string, unknown>)
                    : {};
                const message =
                  typeof value.message === "string"
                    ? value.message
                    : "Proposal submitted. Waiting for the page owner to approve.";
                return wrapTextResult(message, { message });
              }
              return wrapToolResult(rawResult);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              return wrapToolError(message);
            }
          },
        },
        { signal: controller.signal },
      );
      registered.push(tool.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${tool.name}: ${message}`);
    }
  }

  return {
    available: true,
    registered,
    errors,
    cleanup: () => controller.abort(),
  };
}
