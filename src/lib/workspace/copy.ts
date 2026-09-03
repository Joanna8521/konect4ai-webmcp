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
  uiLanguageLabel: string;
  connectionStatusLabel: string;
  webMcpLabel: string;
  backendLabel: string;
  checkingLabel: string;
  availableLabel: string;
  connectedLabel: string;
  errorLabel: string;
  agentToolsRegisteredLabel: string;
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
  provenanceReceiptLabel: string;
  sourceDescriptionLabel: string;
  recordsConsultedLabel: string;
  verificationLabel: string;
  backendVerifiedLabel: string;
  unverifiedLabel: string;
  modelBoundaryLabel: string;
  usedCapabilitiesLabel: string;
  sourceModeAskOnlyHelp: string;
  sourceModeDirectHelp: string;
  noToolCallMessage: string;
  sentToAgentHeading: string;
  boundaryHeading: string;
  boundaryNote: string;
  rawRowsLabel: string;
  proposalsHeading: string;
  approveLabel: string;
  rejectLabel: string;
  sourceProposalLabel: string;
  humanAskSourceLabel: string;
  humanAskQuestionLabel: string;
  humanAskButtonLabel: string;
  selectSourcePlaceholder: string;
  askInputPlaceholder: string;
  sourceFirstError: string;
  noDescriptionLabel: string;
  workingLabel: string;
  backendInputSchemaLabel: string;
  agentFormLabel: string;
  agentInstructionsLabel: string;
  nameLabel: string;
  limitLabel: string;
  maxSourcesLabel: string;
  selectCapabilityPlaceholder: string;
  describeTaskGoalPlaceholder: string;
  autoLabel: string;
  englishLabel: string;
  traditionalChineseLabel: string;
  noneLabel: string;
  sensitiveActionsLabel: string;
  alwaysLabel: string;
  waitingForBackendLabel: string;
  proposalSubmittedLabel: string;
  awaitingOwnerApprovalLabel: string;
  approvedCreatingSourceLabel: string;
  sourceCreatedAfterHumanApprovalLabel: string;
  proposalRejectedNoBackendLabel: string;
  selectCapabilityFirstError: string;
  selectSourceFirstError: string;
  enterQuestionError: string;
  selectAgentFirstError: string;
  goalRequiredError: string;
  noDataAnalystSourcesError: string;
  unableToComputeAnswerError: string;
  ownerConfiguredModelLabel: string;
  recordsConsultedRowsLabel: string;
  noAskOnlySourcesEnabledLabel: string;
  noAskOnlySourceJobIdsLabel: string;
  awaitingSourceCreationLabel: string;
  sourceProposalCreatedLabel: string;
  sourceReadyLabel: string;
  sourceCreationFailedLabel: string;
  sourceStillProcessingLabel: string;
  unableToReadSourceStatusLabel: string;
  sourceTooSlowLabel: string;
  jobReadyButNotAppearedLabel: string;
  newToolAddedLabel: string;
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
  uiLanguageLabel: "UI language",
  connectionStatusLabel: "Connection status",
  webMcpLabel: "WebMCP",
  backendLabel: "Backend",
  checkingLabel: "checking",
  availableLabel: "available",
  connectedLabel: "connected",
  errorLabel: "error",
  agentToolsRegisteredLabel: "agent tools registered",
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
  provenanceReceiptLabel: "Provenance receipt",
  sourceDescriptionLabel: "Source description",
  recordsConsultedLabel: "records consulted",
  verificationLabel: "Verification",
  backendVerifiedLabel: "backend verified",
  unverifiedLabel: "unverified",
  modelBoundaryLabel: "Model/provider boundary",
  usedCapabilitiesLabel: "Used capabilities",
  sourceModeAskOnlyHelp: "Agent can ask questions. It cannot fetch the dataset.",
  sourceModeDirectHelp: "Agent can fetch the full dataset directly.",
  noToolCallMessage:
    "No tool call yet. Invoke ask_data_source to see what crosses the boundary.",
  sentToAgentHeading: "SENT TO AGENT",
  boundaryHeading: "NOT RETURNED THROUGH WEBMCP",
  boundaryNote: "This is the tool's return boundary, not browser-level isolation.",
  rawRowsLabel: "Raw rows",
  proposalsHeading: "Pending proposals",
  approveLabel: "Approve",
  rejectLabel: "Reject",
  sourceProposalLabel: "Proposed by",
  humanAskSourceLabel: "Source",
  humanAskQuestionLabel: "Question",
  humanAskButtonLabel: "Ask",
  selectSourcePlaceholder: "Select a source",
  askInputPlaceholder: "Ask a question about this source",
  sourceFirstError: "Select a source first.",
  noDescriptionLabel: "No description.",
  workingLabel: "Working...",
  backendInputSchemaLabel: "Backend inputSchema",
  agentFormLabel: "Agent",
  agentInstructionsLabel: "Agent instructions",
  nameLabel: "Name",
  limitLabel: "Limit",
  maxSourcesLabel: "Max sources",
  selectCapabilityPlaceholder: "Select a capability",
  describeTaskGoalPlaceholder: "Describe the task goal.",
  autoLabel: "Auto",
  englishLabel: "English",
  traditionalChineseLabel: "Traditional Chinese",
  noneLabel: "none",
  sensitiveActionsLabel: "sensitive-actions",
  alwaysLabel: "always",
  waitingForBackendLabel: "Waiting for Konect4AI backend...",
  proposalSubmittedLabel: "Proposal submitted.",
  awaitingOwnerApprovalLabel: "Waiting for the page owner to approve.",
  approvedCreatingSourceLabel: "Approved. Creating source...",
  sourceCreatedAfterHumanApprovalLabel: "Created after human approval",
  proposalRejectedNoBackendLabel: "Rejected. No backend action occurred.",
  selectCapabilityFirstError: "Select a capability first.",
  selectSourceFirstError: "Select a source first.",
  enterQuestionError: "Enter a question.",
  selectAgentFirstError: "Select an agent first.",
  goalRequiredError: "Goal is required.",
  noDataAnalystSourcesError:
    "No source capabilities are available for the Data Analyst Agent.",
  unableToComputeAnswerError: "Unable to compute the answer.",
  ownerConfiguredModelLabel: "owner-configured BYOK model",
  recordsConsultedRowsLabel: "records consulted:",
  noAskOnlySourcesEnabledLabel: "- No ask-only sources are enabled.",
  noAskOnlySourceJobIdsLabel: "No ask-only source jobIds are currently available.",
  awaitingSourceCreationLabel: "Awaiting Konect4AI source creation.",
  sourceProposalCreatedLabel: "Source proposal created.",
  sourceReadyLabel: "Source is ready.",
  sourceCreationFailedLabel: "Source creation failed.",
  sourceStillProcessingLabel: "Source is still processing.",
  unableToReadSourceStatusLabel: "Unable to read source status.",
  sourceTooSlowLabel: "Source became available too slowly to verify through tools/list.",
  jobReadyButNotAppearedLabel:
    "Konect4AI job is ready, but the new capability has not appeared in tools/list yet.",
  newToolAddedLabel: "New tool added to the agent toolbox.",
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
    running: "processing",
    success: "success",
    error: "error",
    planning: "planning",
    waiting: "waiting",
    rejected: "rejected",
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
  uiLanguageLabel: "介面語言",
  connectionStatusLabel: "連線狀態",
  webMcpLabel: "WebMCP",
  backendLabel: "後端",
  checkingLabel: "檢查中",
  availableLabel: "可用",
  connectedLabel: "已連線",
  errorLabel: "錯誤",
  agentToolsRegisteredLabel: "個代理工具已註冊",
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
  provenanceReceiptLabel: "證明收據",
  sourceDescriptionLabel: "來源描述",
  recordsConsultedLabel: "查閱筆數",
  verificationLabel: "驗證",
  backendVerifiedLabel: "後端已驗證",
  unverifiedLabel: "未驗證",
  modelBoundaryLabel: "模型 / 供應器邊界",
  usedCapabilitiesLabel: "已使用能力",
  sourceModeAskOnlyHelp: "代理可以提問，但不能直接抓取資料集。",
  sourceModeDirectHelp: "代理可以直接抓取完整資料集。",
  noToolCallMessage: "尚未執行工具呼叫。請呼叫 ask_data_source 以查看邊界外的內容。",
  sentToAgentHeading: "傳給 agent",
  boundaryHeading: "未透過 WebMCP 傳回",
  boundaryNote: "這是工具的回傳邊界，不是瀏覽器層級的隔離。",
  rawRowsLabel: "原始資料列",
  proposalsHeading: "待核准提案",
  approveLabel: "核准",
  rejectLabel: "拒絕",
  sourceProposalLabel: "提案來源",
  humanAskSourceLabel: "來源",
  humanAskQuestionLabel: "問題",
  humanAskButtonLabel: "提問",
  selectSourcePlaceholder: "選擇來源",
  askInputPlaceholder: "詢問這個來源的問題",
  sourceFirstError: "請先選擇來源。",
  noDescriptionLabel: "沒有描述。",
  workingLabel: "處理中...",
  backendInputSchemaLabel: "後端 inputSchema",
  agentFormLabel: "代理",
  agentInstructionsLabel: "代理指令",
  nameLabel: "名稱",
  limitLabel: "上限",
  maxSourcesLabel: "最多來源",
  selectCapabilityPlaceholder: "選擇能力",
  describeTaskGoalPlaceholder: "描述任務目標。",
  autoLabel: "自動",
  englishLabel: "英文",
  traditionalChineseLabel: "繁體中文",
  noneLabel: "無",
  sensitiveActionsLabel: "敏感動作",
  alwaysLabel: "永遠",
  waitingForBackendLabel: "等待 Konect4AI 後端...",
  proposalSubmittedLabel: "提案已送出。",
  awaitingOwnerApprovalLabel: "等待頁面擁有者核准。",
  approvedCreatingSourceLabel: "已核准。正在建立來源...",
  sourceCreatedAfterHumanApprovalLabel: "經人類核准後建立",
  proposalRejectedNoBackendLabel: "已拒絕。沒有任何後端動作發生。",
  selectCapabilityFirstError: "請先選擇能力。",
  selectSourceFirstError: "請先選擇來源。",
  enterQuestionError: "請輸入問題。",
  selectAgentFirstError: "請先選擇代理。",
  goalRequiredError: "目標為必填。",
  noDataAnalystSourcesError: "Data Analyst Agent 目前沒有可用來源能力。",
  unableToComputeAnswerError: "無法計算答案。",
  ownerConfiguredModelLabel: "擁有者設定的 BYOK 模型",
  recordsConsultedRowsLabel: "查閱筆數：",
  noAskOnlySourcesEnabledLabel: "- 目前沒有啟用 ask-only 來源。",
  noAskOnlySourceJobIdsLabel: "目前沒有可用的 ask-only 來源 jobId。",
  awaitingSourceCreationLabel: "等待 Konect4AI 來源建立。",
  sourceProposalCreatedLabel: "來源提案已建立。",
  sourceReadyLabel: "來源已就緒。",
  sourceCreationFailedLabel: "來源建立失敗。",
  sourceStillProcessingLabel: "來源仍在處理中。",
  unableToReadSourceStatusLabel: "無法讀取來源狀態。",
  sourceTooSlowLabel: "來源出現得太慢，無法透過 tools/list 驗證。",
  jobReadyButNotAppearedLabel:
    "Konect4AI job 已就緒，但新能力尚未出現在 tools/list。",
  newToolAddedLabel: "新工具已加入代理工具箱。",
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
    running: "處理中",
    success: "成功",
    error: "錯誤",
    planning: "規劃中",
    waiting: "等待中",
    rejected: "已拒絕",
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
