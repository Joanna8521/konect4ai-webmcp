import {
  DATAGOV_TOOL_NAME,
  type BackendTool,
  type JsonObject,
} from "@/lib/konect4ai-client";
import type {
  ApprovalMode,
  AgentDefinition,
  BuiltInAgentInput,
  BrowserAgentInput,
  CustomAgentInput,
  DataAnalystAgentInput,
} from "@/lib/agents/types";
import { getAgentDefinition, isAgentToolName } from "@/lib/agents/registry";

type AgentPhase = "planning" | "running" | "waiting" | "success" | "error";

export interface AgentProgressEvent {
  phase: AgentPhase;
  message: string;
  currentStep?: string;
  usedCapabilities?: string[];
  arguments?: JsonObject;
  result?: unknown;
  error?: string;
}

export interface AgentStep {
  toolName?: string;
  status: AgentPhase | "skipped";
  startedAt: string;
  completedAt?: string;
  arguments?: JsonObject;
  result?: unknown;
  error?: string;
}

export interface AgentRunResult {
  agentId: string;
  agentName: string;
  status: AgentPhase | "capability_unavailable" | "approval_required";
  message: string;
  goal: string;
  language: string;
  sourcePolicy: string;
  approvalMode: ApprovalMode;
  requestedSources: string[];
  usedCapabilities: string[];
  steps: AgentStep[];
  result?: unknown;
  summary?: string;
  details?: Record<string, unknown>;
}

export interface AgentRuntimeContext {
  availableTools: BackendTool[];
  executeCapability: (
    toolName: string,
    args?: JsonObject,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  signal?: AbortSignal;
  invocationSource: "manual" | "webmcp" | "human";
  onProgress?: (event: AgentProgressEvent) => void;
}

function nowStamp(): string {
  return new Date().toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function toObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as JsonObject;
}

function emit(
  context: AgentRuntimeContext,
  event: AgentProgressEvent,
): void {
  context.onProgress?.(event);
}

function resolveToolNames(
  availableTools: BackendTool[],
  requested: string[],
  limit: number,
): BackendTool[] {
  const wanted = requested.length
    ? new Set(requested)
    : null;
  const selected: BackendTool[] = [];

  for (const tool of availableTools) {
    if (isAgentToolName(tool.name)) continue;
    if (wanted && !wanted.has(tool.name)) continue;
    selected.push(tool);
    if (selected.length >= limit) break;
  }

  return selected;
}

function preferredReadableTools(
  availableTools: BackendTool[],
  requested: string[],
  limit: number,
): BackendTool[] {
  const selected = resolveToolNames(availableTools, requested, limit);
  if (selected.length > 0) {
    return selected.sort((left, right) => {
      const leftIsDataGov = left.name === DATAGOV_TOOL_NAME;
      const rightIsDataGov = right.name === DATAGOV_TOOL_NAME;
      if (leftIsDataGov === rightIsDataGov) return 0;
      return leftIsDataGov ? 1 : -1;
    });
  }

  return availableTools
    .filter((tool) => !isAgentToolName(tool.name))
    .sort((left, right) => {
      const leftIsDataGov = left.name === DATAGOV_TOOL_NAME;
      const rightIsDataGov = right.name === DATAGOV_TOOL_NAME;
      if (leftIsDataGov === rightIsDataGov) return 0;
      return leftIsDataGov ? 1 : -1;
    })
    .slice(0, limit);
}

function getSchemaProperties(tool: BackendTool): Record<string, unknown> {
  const schema = toObject(tool.inputSchema);
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return {};
  }
  return properties as Record<string, unknown>;
}

function hasProperty(tool: BackendTool, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(getSchemaProperties(tool), name);
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function buildArgsForTool(
  tool: BackendTool,
  goal: string,
  input: Record<string, unknown>,
  language: string,
  defaultLimit: number,
): JsonObject {
  const args: JsonObject = {};
  const properties = getSchemaProperties(tool);
  const sourceHints = [
    input.target,
    input.source,
    input.question,
    input.query,
    goal,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);

  if (hasProperty(tool, "goal")) args.goal = goal;
  if (hasProperty(tool, "question")) args.question = goal;
  if (hasProperty(tool, "query")) args.query = goal;
  if (hasProperty(tool, "text")) args.text = goal;
  if (hasProperty(tool, "search")) args.search = goal;
  if (hasProperty(tool, "language")) args.language = language;
  if (hasProperty(tool, "locale")) args.locale = language === "auto" ? "en" : language;
  if (hasProperty(tool, "limit")) args.limit = input.limit ?? defaultLimit;
  if (hasProperty(tool, "maxSources")) args.maxSources = input.maxSources ?? defaultLimit;
  if (hasProperty(tool, "job_id") || hasProperty(tool, "jobId")) {
    const jobId = input.jobId || input.job_id || input.source || input.target || goal;
    if (hasProperty(tool, "job_id")) args.job_id = jobId;
    if (hasProperty(tool, "jobId")) args.jobId = jobId;
  }
  if (hasProperty(tool, "sources")) args.sources = toStringList(input.sources);
  if (hasProperty(tool, "allowedTools")) args.allowedTools = toStringList(input.allowedTools);
  if (hasProperty(tool, "target")) args.target = typeof input.target === "string" ? input.target : sourceHints[0] || goal;
  if (hasProperty(tool, "source")) args.source = typeof input.source === "string" ? input.source : sourceHints[0] || goal;
  if (hasProperty(tool, "name") && typeof input.name === "string") args.name = input.name;
  if (hasProperty(tool, "approvalMode") && typeof input.approvalMode === "string") {
    args.approvalMode = input.approvalMode;
  }

  if (Object.keys(args).length === 0) {
    args.goal = goal;
  }

  return args;
}

function summarizeResult(result: unknown): string {
  if (typeof result === "string") {
    return result.length > 220 ? `${result.slice(0, 217)}...` : result;
  }

  if (Array.isArray(result)) {
    return `Returned ${result.length} item${result.length === 1 ? "" : "s"}.`;
  }

  if (result && typeof result === "object") {
    const value = result as Record<string, unknown>;
    if (Array.isArray(value.datasets)) {
      return `Returned ${value.datasets.length} dataset${value.datasets.length === 1 ? "" : "s"}.`;
    }
    if (Array.isArray(value.items)) {
      return `Returned ${value.items.length} item${value.items.length === 1 ? "" : "s"}.`;
    }
    if (Array.isArray(value.results)) {
      return `Returned ${value.results.length} result${value.results.length === 1 ? "" : "s"}.`;
    }
    return `Returned structured data with ${Object.keys(value).length} top-level field${Object.keys(value).length === 1 ? "" : "s"}.`;
  }

  return "Returned a result.";
}

function buildAnalysis(result: unknown): Record<string, unknown> {
  if (Array.isArray(result)) {
    return {
      type: "array",
      count: result.length,
      sample: result.slice(0, 3),
    };
  }

  if (result && typeof result === "object") {
    const value = result as Record<string, unknown>;
    const candidateArrays = ["datasets", "items", "results"]
      .filter((key) => Array.isArray(value[key]))
      .map((key) => ({
        key,
        count: (value[key] as unknown[]).length,
        sample: (value[key] as unknown[]).slice(0, 3),
      }));

    return {
      type: "object",
      keys: Object.keys(value).slice(0, 12),
      collections: candidateArrays,
    };
  }

  return {
    type: typeof result,
    value: result,
  };
}

function defaultLanguage(input: Record<string, unknown>): string {
  const language = input.language;
  if (language === "zh-TW" || language === "en") return language;
  return "auto";
}

function defaultSources(input: Record<string, unknown>): string[] {
  return toStringList(input.sources);
}

function customAllowedTools(input: Record<string, unknown>): string[] {
  return toStringList(input.allowedTools);
}

function createStep(toolName: string, status: AgentStep["status"]): AgentStep {
  return {
    toolName,
    status,
    startedAt: nowStamp(),
  };
}

export async function runAgent(
  definitionOrId: AgentDefinition | string,
  input: Record<string, unknown>,
  context: AgentRuntimeContext,
): Promise<AgentRunResult> {
  const definition =
    typeof definitionOrId === "string"
      ? getAgentDefinition(definitionOrId)
      : definitionOrId;

  if (!definition) {
    return {
      agentId: typeof definitionOrId === "string" ? definitionOrId : "unknown",
      agentName: typeof definitionOrId === "string" ? definitionOrId : "Unknown agent",
      status: "error",
      message: "Unknown agent.",
      goal: typeof input.goal === "string" ? input.goal : "",
      language: defaultLanguage(input),
      sourcePolicy: "custom",
      approvalMode: "none",
      requestedSources: [],
      usedCapabilities: [],
      steps: [],
      details: { error: "Agent definition not found." },
    };
  }

  const goal = typeof input.goal === "string" ? input.goal.trim() : "";
  if (!goal) {
    return {
      agentId: definition.id,
      agentName: definition.name,
      status: "error",
      message: "goal is required.",
      goal: "",
      language: defaultLanguage(input),
      sourcePolicy: definition.sourcePolicy,
      approvalMode: definition.approvalMode,
      requestedSources: [],
      usedCapabilities: [],
      steps: [],
      details: { error: "Missing goal." },
    };
  }

  if (context.signal?.aborted) {
    return {
      agentId: definition.id,
      agentName: definition.name,
      status: "error",
      message: "Operation was aborted.",
      goal,
      language: defaultLanguage(input),
      sourcePolicy: definition.sourcePolicy,
      approvalMode: definition.approvalMode,
      requestedSources: [],
      usedCapabilities: [],
      steps: [],
      details: { error: "Aborted." },
    };
  }

  emit(context, {
    phase: "planning",
    message: `${definition.name} planning started.`,
    arguments: toObject(input),
  });

  const language = defaultLanguage(input);
  const requestedSources = defaultSources(input);
  const steps: AgentStep[] = [];
  const usedCapabilities: string[] = [];
  const baseInput = toObject(input);

  if (definition.id === "browser_agent") {
    const step = createStep("browser_backend", "skipped");
    step.completedAt = nowStamp();
    step.error = "No browser execution backend is available in this challenge app.";
    steps.push(step);
    emit(context, {
      phase: "error",
      message: step.error,
      currentStep: "browser_backend",
      error: step.error,
    });
    return {
      agentId: definition.id,
      agentName: definition.name,
      status: "capability_unavailable",
      message: step.error,
      goal,
      language,
      sourcePolicy: definition.sourcePolicy,
      approvalMode: definition.approvalMode,
      requestedSources,
      usedCapabilities,
      steps,
      details: {
        sourcePolicy: definition.sourcePolicy,
        browserAvailable: false,
      },
    };
  }

  if (definition.id === "custom_agent") {
    const approvalMode =
      typeof baseInput.approvalMode === "string" &&
      (baseInput.approvalMode === "none" ||
        baseInput.approvalMode === "sensitive-actions" ||
        baseInput.approvalMode === "always")
        ? baseInput.approvalMode
        : definition.approvalMode;
    const allowedTools = customAllowedTools(baseInput);
    const permitted = allowedTools.length
      ? availableToolSubset(context.availableTools, allowedTools)
      : [];

    if (approvalMode === "always" && context.invocationSource === "webmcp") {
      const message = "Custom Agent requires explicit human approval before execution.";
      emit(context, { phase: "waiting", message, currentStep: "approval" });
      return {
        agentId: definition.id,
        agentName: definition.name,
        status: "approval_required",
        message,
        goal,
        language,
        sourcePolicy: definition.sourcePolicy,
        approvalMode,
        requestedSources,
        usedCapabilities: [],
        steps,
        details: { approvalMode, allowedTools, reason: "Approval is required for this custom agent." },
      };
    }

    if (allowedTools.length > 0 && permitted.length === 0) {
      const message = "Custom Agent requested tools that are not available in the current registry.";
      emit(context, { phase: "error", message, currentStep: "validation", error: message });
      return {
        agentId: definition.id,
        agentName: definition.name,
        status: "error",
        message,
        goal,
        language,
        sourcePolicy: definition.sourcePolicy,
        approvalMode,
        requestedSources,
        usedCapabilities: [],
        steps,
        details: {
          allowedTools,
          availableTools: context.availableTools.map((tool) => tool.name),
        },
      };
    }

    const limit = Math.min(allowedTools.length || 3, 3);
    const selected = permitted.length > 0 ? permitted.slice(0, limit) : preferredReadableTools(context.availableTools, requestedSources, limit);
    if (selected.length === 0) {
      const message = "No registered capabilities are available for Custom Agent.";
      emit(context, { phase: "error", message, currentStep: "selection", error: message });
      return {
        agentId: definition.id,
        agentName: definition.name,
        status: "error",
        message,
        goal,
        language,
        sourcePolicy: definition.sourcePolicy,
        approvalMode,
        requestedSources,
        usedCapabilities: [],
        steps,
        details: { allowedTools },
      };
    }

    emit(context, {
      phase: "running",
      message: "Custom Agent execution started.",
      currentStep: selected[0].name,
      usedCapabilities: selected.map((tool) => tool.name),
    });

    const results: Array<{ toolName: string; arguments: JsonObject; result: unknown }> = [];
    for (const tool of selected) {
      if (context.signal?.aborted) {
        throw new Error("Operation was aborted.");
      }

      const args = buildArgsForTool(tool, goal, baseInput, language, 3);
      const step = createStep(tool.name, "running");
      step.arguments = args;
      steps.push(step);
      emit(context, {
        phase: "running",
        message: `Running ${tool.name}.`,
        currentStep: tool.name,
        usedCapabilities: usedCapabilities.concat(tool.name),
        arguments: args,
      });

      const result = await context.executeCapability(tool.name, args, context.signal);
      step.status = "success";
      step.completedAt = nowStamp();
      step.result = result;
      usedCapabilities.push(tool.name);
      results.push({ toolName: tool.name, arguments: args, result });
    }

    const summary = `Custom Agent ran ${results.length} capabilities.`;
    emit(context, {
      phase: "success",
      message: summary,
      currentStep: selected[selected.length - 1]?.name,
      usedCapabilities,
      result: { summary, results },
    });

    return {
      agentId: definition.id,
      agentName: definition.name,
      status: "success",
      message: summary,
      goal,
      language,
      sourcePolicy: definition.sourcePolicy,
      approvalMode,
      requestedSources,
      usedCapabilities,
      steps,
      summary,
      result: {
        customName: typeof baseInput.name === "string" ? baseInput.name : definition.name,
        approvalMode,
        results,
        analysis: buildAnalysis(results),
      },
      details: { allowedTools, sourcePolicy: definition.sourcePolicy },
    };
  }

  const maxSources = Math.min(
    Math.max(1, Number(baseInput.maxSources ?? baseInput.limit ?? 3) || 3),
    3,
  );

  const dataAnalystSource =
    typeof baseInput.source === "string" ? baseInput.source.trim() : "";
  const selectedTools =
    definition.id === "data_analyst_agent"
      ? preferredReadableTools(
          context.availableTools,
          dataAnalystSource ? [dataAnalystSource] : [],
          1,
        )
      : preferredReadableTools(context.availableTools, requestedSources, definition.id === "research_agent" ? maxSources : Math.min(maxSources, 2));

  if (definition.id === "data_analyst_agent" && selectedTools.length === 0) {
    const message = "Selected source capability is not available.";
    emit(context, { phase: "error", message, currentStep: "selection", error: message });
    return {
      agentId: definition.id,
      agentName: definition.name,
      status: "error",
      message,
      goal,
      language,
      sourcePolicy: definition.sourcePolicy,
      approvalMode: definition.approvalMode,
      requestedSources,
      usedCapabilities: [],
      steps,
        details: { source: dataAnalystSource },
      };
  }

  if (selectedTools.length === 0) {
    const message = "No registered capabilities are available for this agent.";
    emit(context, { phase: "error", message, currentStep: "selection", error: message });
    return {
      agentId: definition.id,
      agentName: definition.name,
      status: "error",
      message,
      goal,
      language,
      sourcePolicy: definition.sourcePolicy,
      approvalMode: definition.approvalMode,
      requestedSources,
      usedCapabilities: [],
      steps,
      details: {},
    };
  }

  emit(context, {
    phase: "running",
    message: `${definition.name} execution started.`,
    currentStep: selectedTools[0].name,
    usedCapabilities: selectedTools.map((tool) => tool.name),
  });

  const results: Array<{ toolName: string; arguments: JsonObject; result: unknown }> = [];
  for (const tool of selectedTools) {
    if (context.signal?.aborted) {
      throw new Error("Operation was aborted.");
    }

    const args = buildArgsForTool(tool, goal, baseInput, language, maxSources);
    const step = createStep(tool.name, "running");
    step.arguments = args;
    steps.push(step);
    emit(context, {
      phase: "running",
      message: `Running ${tool.name}.`,
      currentStep: tool.name,
      usedCapabilities: usedCapabilities.concat(tool.name),
      arguments: args,
    });

    const result = await context.executeCapability(tool.name, args, context.signal);
    step.status = "success";
    step.completedAt = nowStamp();
    step.result = result;
    usedCapabilities.push(tool.name);
    results.push({ toolName: tool.name, arguments: args, result });

    if (definition.id !== "research_agent" && definition.id !== "monitor_agent") {
      break;
    }
  }

  if (definition.id === "data_analyst_agent") {
    const [first] = results;
    const analysis = buildAnalysis(first?.result);
    const summary = summarizeResult(first?.result);
    emit(context, {
      phase: "success",
      message: summary,
      currentStep: selectedTools[0]?.name,
      usedCapabilities,
      result: { summary, analysis },
    });
    return {
      agentId: definition.id,
      agentName: definition.name,
      status: "success",
      message: summary,
      goal,
      language,
      sourcePolicy: definition.sourcePolicy,
      approvalMode: definition.approvalMode,
      requestedSources,
      usedCapabilities,
      steps,
      summary,
      result: {
        source: dataAnalystSource,
        analysis,
        result: first?.result,
      },
      details: {
        source: dataAnalystSource,
      },
    };
  }

  const summaryParts = results.map(
    (item) => `${item.toolName}: ${summarizeResult(item.result)}`,
  );
  const summary = summaryParts.join(" ");
  emit(context, {
    phase: "success",
    message: summary,
    currentStep: selectedTools[selectedTools.length - 1]?.name,
    usedCapabilities,
    result: { summary, results },
  });

  return {
    agentId: definition.id,
    agentName: definition.name,
    status: "success",
    message: summary,
    goal,
    language,
    sourcePolicy: definition.sourcePolicy,
    approvalMode: definition.approvalMode,
    requestedSources,
    usedCapabilities,
    steps,
    summary,
    result: {
      results,
      sourcePolicy: definition.sourcePolicy,
    },
    details: {
      requestedSources,
      selectedTools: selectedTools.map((tool) => tool.name),
    },
  };
}

function availableToolSubset(
  availableTools: BackendTool[],
  allowList: string[],
): BackendTool[] {
  const allowed = new Set(allowList);
  return availableTools.filter((tool) => allowed.has(tool.name) && !isAgentToolName(tool.name));
}
