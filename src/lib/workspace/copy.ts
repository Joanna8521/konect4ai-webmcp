import type { WorkspaceLanguage } from "@/lib/agents/types";

export interface WorkspaceCopy {
  heroEyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  workspaceTagline: string;
  builtInAgents: string;
  sourceCapabilities: string;
  liveWorkspace: string;
  manualInvocation: string;
  invocationHistory: string;
  currentInvocation: string;
  currentStep: string;
  argumentsLabel: string;
  resultLabel: string;
  startedLabel: string;
  completedLabel: string;
  statusLabel: string;
  sourceLabel: string;
  agentLabel: string;
  toolLabel: string;
  goalLabel: string;
  languageLabel: string;
  targetLabel: string;
  sourcesLabel: string;
  selectedSourceLabel: string;
  allowedToolsLabel: string;
  approvalModeLabel: string;
  capabilityLabel: string;
  capabilityArgsLabel: string;
  invocationModeLabel: string;
  invokeButton: string;
  refreshButton: string;
  idleMessage: string;
  unavailableMessage: string;
  backendErrorPrefix: string;
  registrationIssueSuffix: string;
  noCapabilities: string;
  noInvocations: string;
  browserUnavailable: string;
  agentUnavailable: string;
  capabilityUnavailable: string;
  agentDescriptions: Record<string, string>;
  statusValues: Record<string, string>;
}

const EN: WorkspaceCopy = {
  heroEyebrow: "Konect4AI x WebMCP",
  heroTitle: "Konect4AI × WebMCP",
  heroSubtitle: "Turn web data into agent-native tools.",
  workspaceTagline: "One web workspace. For humans and agents.",
  builtInAgents: "Built-in Agents",
  sourceCapabilities: "Source Capabilities",
  liveWorkspace: "Live Agent Workspace",
  manualInvocation: "Manual Invocation",
  invocationHistory: "Invocation history",
  currentInvocation: "Current invocation",
  currentStep: "Current step",
  argumentsLabel: "Arguments",
  resultLabel: "Result",
  startedLabel: "Started",
  completedLabel: "Completed",
  statusLabel: "Status",
  sourceLabel: "Source",
  agentLabel: "Agent",
  toolLabel: "Tool",
  goalLabel: "Goal",
  languageLabel: "Language",
  targetLabel: "Target",
  sourcesLabel: "Sources",
  selectedSourceLabel: "Selected source",
  allowedToolsLabel: "Allowed tools",
  approvalModeLabel: "Approval mode",
  capabilityLabel: "Capability",
  capabilityArgsLabel: "JSON arguments",
  invocationModeLabel: "Invocation mode",
  invokeButton: "Invoke",
  refreshButton: "Refresh",
  idleMessage:
    "Idle. When an agent invokes a WebMCP tool, the active tool, arguments, status, result, and timestamps appear here.",
  unavailableMessage: "WebMCP is not available in this browser.",
  backendErrorPrefix: "Konect4AI backend tools could not be loaded:",
  registrationIssueSuffix: "tool registration issue",
  noCapabilities: "No backend MCP tools are available yet.",
  noInvocations: "No invocations yet.",
  browserUnavailable:
    "No browser execution backend is available in this challenge app.",
  agentUnavailable: "agent is unavailable",
  capabilityUnavailable: "capability unavailable",
  agentDescriptions: {
    research_agent:
      "Research a topic across multiple available web data sources, compare relevant findings, and produce a structured synthesis.",
    browser_agent:
      "Perform a browser-oriented task using available browser/web capabilities while keeping progress visible in the shared workspace.",
    monitor_agent:
      "Check available data sources for recent changes, freshness, or meaningful updates and summarize what changed.",
    data_analyst_agent:
      "Analyze structured data returned by an available capability, compare records, identify patterns, and return a concise structured analysis.",
    custom_agent:
      "Run a custom bounded agent task using selected Konect4AI capabilities and explicit execution rules.",
  },
  statusValues: {
    idle: "idle",
    running: "running",
    success: "success",
    error: "error",
    planning: "planning",
    waiting: "waiting",
    capability_unavailable: "capability unavailable",
    approval_required: "approval required",
  },
};

const ZH: WorkspaceCopy = {
  heroEyebrow: "Konect4AI x WebMCP",
  heroTitle: "Konect4AI × WebMCP",
  heroSubtitle: "把網頁資料變成代理可直接使用的工具。",
  workspaceTagline: "單一網頁工作區，給人類，也給代理。",
  builtInAgents: "內建代理",
  sourceCapabilities: "來源能力",
  liveWorkspace: "即時代理工作區",
  manualInvocation: "手動執行",
  invocationHistory: "執行歷史",
  currentInvocation: "目前執行",
  currentStep: "目前步驟",
  argumentsLabel: "參數",
  resultLabel: "結果",
  startedLabel: "開始",
  completedLabel: "完成",
  statusLabel: "狀態",
  sourceLabel: "來源",
  agentLabel: "代理",
  toolLabel: "工具",
  goalLabel: "目標",
  languageLabel: "語言",
  targetLabel: "目標頁面",
  sourcesLabel: "來源清單",
  selectedSourceLabel: "已選來源",
  allowedToolsLabel: "允許工具",
  approvalModeLabel: "核准模式",
  capabilityLabel: "能力",
  capabilityArgsLabel: "JSON 參數",
  invocationModeLabel: "執行模式",
  invokeButton: "執行",
  refreshButton: "重新載入",
  idleMessage:
    "目前閒置。當代理呼叫 WebMCP 工具時，這裡會即時顯示工具名稱、參數、狀態、結果與時間戳。",
  unavailableMessage: "此瀏覽器不支援 WebMCP。",
  backendErrorPrefix: "Konect4AI 後端工具無法載入：",
  registrationIssueSuffix: "個工具註冊問題",
  noCapabilities: "目前沒有可用的後端 MCP 工具。",
  noInvocations: "尚未有任何執行。",
  browserUnavailable: "此 Challenge App 沒有可用的瀏覽器執行後端。",
  agentUnavailable: "代理不可用",
  capabilityUnavailable: "能力不可用",
  agentDescriptions: {
    research_agent:
      "跨多個可用網頁資料來源研究主題，比較相關發現，並輸出結構化摘要。",
    browser_agent:
      "使用可用的瀏覽器 / Web 能力執行瀏覽任務，並在共享工作區中保持過程可見。",
    monitor_agent:
      "檢查可用資料來源的近期變化、新鮮度或重要更新並整理結果。",
    data_analyst_agent:
      "分析可用能力回傳的結構化資料，比較記錄、辨識模式，並輸出簡潔分析。",
    custom_agent:
      "使用選定的 Konect4AI 能力與明確執行規則，執行自訂且受限的代理任務。",
  },
  statusValues: {
    idle: "閒置",
    running: "執行中",
    success: "成功",
    error: "錯誤",
    planning: "規劃中",
    waiting: "等待中",
    capability_unavailable: "能力不可用",
    approval_required: "需要核准",
  },
};

export function resolveWorkspaceLanguage(
  language: WorkspaceLanguage,
): "en" | "zh-TW" {
  if (language === "en" || language === "zh-TW") return language;
  if (typeof navigator === "undefined") return "en";
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-TW" : "en";
}

export function getWorkspaceCopy(language: WorkspaceLanguage): WorkspaceCopy {
  return resolveWorkspaceLanguage(language) === "zh-TW" ? ZH : EN;
}

