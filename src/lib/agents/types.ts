import type { JsonObject } from "@/lib/konect4ai-client";

export type WorkspaceLanguage = "auto" | "zh-TW" | "en";
export type ApprovalMode = "none" | "sensitive-actions" | "always";
export type AgentSourcePolicy = "single" | "multiple" | "browser" | "monitor" | "custom";

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  instructions: string;
  allowedCapabilities: string[];
  sourcePolicy: AgentSourcePolicy;
  language: WorkspaceLanguage;
  approvalMode: ApprovalMode;
  inputSchema: JsonObject;
}

export interface BuiltInAgentInput {
  goal: string;
  sources?: string[];
  language?: WorkspaceLanguage;
}

export interface BrowserAgentInput {
  goal: string;
  target?: string;
  language?: WorkspaceLanguage;
}

export interface DataAnalystAgentInput {
  goal: string;
  source: string;
  language?: WorkspaceLanguage;
  limit?: number;
}

export interface CustomAgentInput {
  name?: string;
  goal: string;
  sources?: string[];
  allowedTools?: string[];
  language?: WorkspaceLanguage;
  approvalMode?: ApprovalMode;
}

export type AgentInput =
  | BuiltInAgentInput
  | BrowserAgentInput
  | DataAnalystAgentInput
  | CustomAgentInput;

