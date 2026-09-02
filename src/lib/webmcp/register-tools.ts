import type { BackendTool, JsonObject } from "@/lib/konect4ai-client";

type ToolExecute = (args?: JsonObject) => Promise<unknown> | unknown;

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
}

export interface RegistrationResult {
  available: boolean;
  registered: string[];
  errors: string[];
  cleanup: () => void;
}

export type ExecuteRegisteredTool = (
  toolName: string,
  args: JsonObject,
  source: "webmcp",
) => Promise<unknown>;

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

export function isWebMcpAvailable(): boolean {
  return typeof document !== "undefined" && Boolean(document.modelContext);
}

export async function registerKonect4aiTools(
  tools: BackendTool[],
  executeTool: ExecuteRegisteredTool,
): Promise<RegistrationResult> {
  if (typeof document === "undefined" || !document.modelContext) {
    return {
      available: false,
      registered: [],
      errors: ["WebMCP is not available in this browser."],
      cleanup: () => {},
    };
  }

  const controller = new AbortController();
  const registered: string[] = [];
  const errors: string[] = [];

  for (const tool of tools) {
    try {
      await document.modelContext.registerTool(
        {
          name: tool.name,
          description: tool.description || `Run ${tool.name}.`,
          inputSchema: cloneSchema(tool.inputSchema),
          execute: async (args?: JsonObject) => {
            return executeTool(tool.name, normalizeArgs(args), "webmcp");
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
