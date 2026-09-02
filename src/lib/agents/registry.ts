import type { BackendTool, JsonObject } from "@/lib/konect4ai-client";
import type {
  AgentDefinition,
  ApprovalMode,
  WorkspaceLanguage,
} from "@/lib/agents/types";

function schema(properties: Record<string, JsonObject>, required: string[] = []): JsonObject {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

const LANGUAGE_ENUM: WorkspaceLanguage[] = ["auto", "zh-TW", "en"];
const APPROVAL_ENUM: ApprovalMode[] = ["none", "sensitive-actions", "always"];

export const AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    id: "research_agent",
    name: "Research Agent",
    description:
      "Research a topic across multiple available web data sources, compare relevant findings, and produce a structured synthesis.",
    instructions:
      "Research a topic across multiple available Konect4AI capabilities. Prefer read-only capabilities, use at most the requested sources, and return a concise structured synthesis with evidence from each source.",
    allowedCapabilities: ["read-only", "multi-source", "structured-results"],
    sourcePolicy: "multiple",
    language: "auto",
    approvalMode: "none",
    inputSchema: schema(
      {
        goal: { type: "string", description: "Research goal or topic to explore." },
        sources: {
          type: "array",
          items: { type: "string" },
          description: "Optional capability names to prioritize.",
        },
        language: {
          type: "string",
          enum: LANGUAGE_ENUM,
          description: "Preferred response language.",
          default: "auto",
        },
        maxSources: {
          type: "integer",
          minimum: 1,
          maximum: 3,
          default: 3,
          description: "Maximum number of source capabilities to use.",
        },
      },
      ["goal"],
    ),
  },
  {
    id: "browser_agent",
    name: "Browser Agent",
    description:
      "Perform a browser-oriented task using available browser/web capabilities while keeping progress visible in the shared workspace.",
    instructions:
      "Represent browser-oriented tasks. Never pretend unsupported browser automation exists. If no browser execution backend is available, return a capability_unavailable result with a clear explanation.",
    allowedCapabilities: ["browser", "visible-progress"],
    sourcePolicy: "browser",
    language: "auto",
    approvalMode: "none",
    inputSchema: schema(
      {
        goal: { type: "string", description: "Task goal for the browser agent." },
        target: {
          type: "string",
          description: "Optional target page, site, or context hint.",
        },
        language: {
          type: "string",
          enum: LANGUAGE_ENUM,
          description: "Preferred response language.",
          default: "auto",
        },
      },
      ["goal"],
    ),
  },
  {
    id: "monitor_agent",
    name: "Monitor Agent",
    description:
      "Check available data sources for recent changes, freshness, or meaningful updates and summarize what changed.",
    instructions:
      "Inspect read-only capabilities for changes, freshness, and notable updates. Run one bounded monitoring pass only. Do not schedule or persist monitoring.",
    allowedCapabilities: ["read-only", "freshness", "refresh"],
    sourcePolicy: "monitor",
    language: "auto",
    approvalMode: "none",
    inputSchema: schema(
      {
        goal: { type: "string", description: "Monitoring goal or question." },
        sources: {
          type: "array",
          items: { type: "string" },
          description: "Optional capability names to monitor.",
        },
        language: {
          type: "string",
          enum: LANGUAGE_ENUM,
          description: "Preferred response language.",
          default: "auto",
        },
      },
      ["goal"],
    ),
  },
  {
    id: "data_analyst_agent",
    name: "Data Analyst Agent",
    description:
      "Analyze structured data returned by an available capability, compare records, identify patterns, and return a concise structured analysis.",
    instructions:
      "Analyze structured results from one available Konect4AI capability. Prefer deterministic summaries, return normalized data, and avoid pretending to perform deeper model synthesis locally.",
    allowedCapabilities: ["structured-data", "single-source"],
    sourcePolicy: "single",
    language: "auto",
    approvalMode: "none",
    inputSchema: schema(
      {
        goal: { type: "string", description: "Analysis goal." },
        source: { type: "string", description: "Capability name to analyze." },
        language: {
          type: "string",
          enum: LANGUAGE_ENUM,
          description: "Preferred response language.",
          default: "auto",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          default: 5,
          description: "Optional result limit for downstream capability calls.",
        },
      },
      ["goal", "source"],
    ),
  },
  {
    id: "custom_agent",
    name: "Custom Agent",
    description:
      "Run a custom bounded agent task using selected Konect4AI capabilities and explicit execution rules.",
    instructions:
      "Run a bounded custom task using only registered capabilities. Reject unknown tools, validate requested tools against the current registry, and never imply unrestricted execution.",
    allowedCapabilities: ["registered-capabilities", "bounded-execution"],
    sourcePolicy: "custom",
    language: "auto",
    approvalMode: "sensitive-actions",
    inputSchema: schema(
      {
        name: { type: "string", description: "Optional custom agent label." },
        goal: { type: "string", description: "Task goal." },
        sources: {
          type: "array",
          items: { type: "string" },
          description: "Optional source capabilities to permit.",
        },
        allowedTools: {
          type: "array",
          items: { type: "string" },
          description: "Optional explicit allow-list of capability names.",
        },
        language: {
          type: "string",
          enum: LANGUAGE_ENUM,
          description: "Preferred response language.",
          default: "auto",
        },
        approvalMode: {
          type: "string",
          enum: APPROVAL_ENUM,
          description: "Execution policy for the custom task.",
          default: "sensitive-actions",
        },
      },
      ["goal"],
    ),
  },
];

export function getAgentDefinitions(): AgentDefinition[] {
  return AGENT_DEFINITIONS;
}

export function getAgentDefinition(agentId: string): AgentDefinition | undefined {
  return AGENT_DEFINITIONS.find((agent) => agent.id === agentId);
}

export function isAgentToolName(toolName: string): boolean {
  return AGENT_DEFINITIONS.some((agent) => `run_${agent.id}` === toolName);
}

export function getAgentToolName(agentId: string): string {
  return `run_${agentId}`;
}

export function getAgentWebMcpTools(): BackendTool[] {
  return AGENT_DEFINITIONS.map((agent) => ({
    name: getAgentToolName(agent.id),
    description: agent.description,
    inputSchema: agent.inputSchema,
    label: agent.name,
  }));
}

