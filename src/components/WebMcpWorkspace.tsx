"use client";

import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DATAGOV_TOOL,
  DATAGOV_TOOL_NAME,
  type BackendTool,
  type JsonObject,
  fetchKonect4aiTools,
  formatJson,
} from "@/lib/konect4ai-client";
import {
  getAgentDefinitions,
  getAgentToolName,
  getAgentWebMcpTools,
  isAgentToolName,
} from "@/lib/agents/registry";
import { runAgent } from "@/lib/agents/runtime";
import type {
  ApprovalMode,
  WorkspaceLanguage,
} from "@/lib/agents/types";
import { executeCapability } from "@/lib/workspace/execution";
import {
  getWorkspaceCopy,
  resolveWorkspaceLanguage,
} from "@/lib/workspace/copy";
import {
  isWebMcpAvailable,
  registerKonect4aiTools,
} from "@/lib/webmcp/register-tools";

type WebMcpState = "checking" | "available" | "unavailable";
type BackendState = "checking" | "connected" | "error";
type InvocationStatus =
  | "idle"
  | "planning"
  | "running"
  | "waiting"
  | "success"
  | "error"
  | "capability_unavailable"
  | "approval_required";
type InvocationSource = "manual" | "webmcp";
type InvocationKind = "capability" | "agent";
type ManualMode = "agent" | "capability";

interface InvocationRecord {
  id: string;
  kind: InvocationKind;
  agentId?: string;
  agentName?: string;
  toolName: string;
  title: string;
  args: JsonObject;
  source: InvocationSource;
  status: InvocationStatus;
  phase: "planning" | "running" | "waiting" | "success" | "error";
  currentStep?: string;
  usedCapabilities: string[];
  startedAt: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
}

interface AgentManualState {
  goal: string;
  sources: string[];
  target: string;
  source: string;
  name: string;
  allowedTools: string[];
  language: WorkspaceLanguage;
  approvalMode: ApprovalMode;
  limit: string;
  maxSources: string;
}

function nowStamp(): string {
  return new Date().toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function newInvocationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function shortDescription(text: string, limit = 124): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 3)}...`;
}

function parseJsonArgs(value: string): JsonObject {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Arguments must be a JSON object.");
  }
  return parsed as JsonObject;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function readMultiSelect(event: ChangeEvent<HTMLSelectElement>): string[] {
  return Array.from(event.target.selectedOptions).map((option) => option.value);
}

function createEmptyAgentDraft(): AgentManualState {
  return {
    goal: "",
    sources: [],
    target: "",
    source: "",
    name: "",
    allowedTools: [],
    language: "auto",
    approvalMode: "sensitive-actions",
    limit: "5",
    maxSources: "3",
  };
}

export default function WebMcpWorkspace() {
  const [uiLanguage, setUiLanguage] = useState<WorkspaceLanguage>("auto");
  const [webMcpState, setWebMcpState] = useState<WebMcpState>("checking");
  const [backendState, setBackendState] = useState<BackendState>("checking");
  const [backendError, setBackendError] = useState("");
  const [capabilityTools, setCapabilityTools] = useState<BackendTool[]>([DATAGOV_TOOL]);
  const [registeredCount, setRegisteredCount] = useState(0);
  const [registrationErrors, setRegistrationErrors] = useState<string[]>([]);
  const [currentInvocation, setCurrentInvocation] =
    useState<InvocationRecord | null>(null);
  const [history, setHistory] = useState<InvocationRecord[]>([]);
  const [manualMode, setManualMode] = useState<ManualMode>("agent");
  const [selectedCapability, setSelectedCapability] = useState(DATAGOV_TOOL_NAME);
  const [selectedAgentId, setSelectedAgentId] = useState("research_agent");
  const [manualArgs, setManualArgs] = useState(
    '{\n  "query": "electric vehicle charging",\n  "limit": 5\n}',
  );
  const [manualError, setManualError] = useState("");
  const [agentDraft, setAgentDraft] = useState<AgentManualState>(() =>
    createEmptyAgentDraft(),
  );

  const cleanupRef = useRef<(() => void) | null>(null);

  const agentDefinitions = useMemo(() => getAgentDefinitions(), []);
  const agentTools = useMemo(() => getAgentWebMcpTools(), []);
  const copy = useMemo(() => getWorkspaceCopy(uiLanguage), [uiLanguage]);
  const resolvedUiLanguage = useMemo(
    () => resolveWorkspaceLanguage(uiLanguage),
    [uiLanguage],
  );

  const selectedCapabilityDef = useMemo(
    () => capabilityTools.find((tool) => tool.name === selectedCapability) || null,
    [capabilityTools, selectedCapability],
  );

  const selectedAgentDef = useMemo(
    () => agentDefinitions.find((agent) => agent.id === selectedAgentId) || null,
    [agentDefinitions, selectedAgentId],
  );

  const registeredTools = useMemo(
    () => [...agentTools, ...capabilityTools],
    [agentTools, capabilityTools],
  );

  const sourceCapabilityNames = useMemo(
    () =>
      capabilityTools
        .map((tool) => tool.name)
        .filter((name) => !isAgentToolName(name)),
    [capabilityTools],
  );

  const capabilityOptions = useMemo(
    () =>
      capabilityTools.map((tool) => ({
        ...tool,
        description: tool.description || "No description.",
      })),
    [capabilityTools],
  );

  const upsertHistory = useCallback((record: InvocationRecord) => {
    setHistory((items) => {
      const next = items.filter((item) => item.id !== record.id);
      return [record, ...next].slice(0, 10);
    });
  }, []);

  const patchCurrentInvocation = useCallback(
    (id: string, patch: Partial<InvocationRecord>) => {
      setCurrentInvocation((current) => {
        if (!current || current.id !== id) return current;
        const next = { ...current, ...patch };
        upsertHistory(next);
        return next;
      });
    },
    [upsertHistory],
  );

  const invokeCurrentTarget = useCallback(
    async (
      target:
        | { kind: "capability"; toolName: string; args: JsonObject }
        | { kind: "agent"; agentId: string; args: JsonObject },
      source: InvocationSource,
    ): Promise<unknown> => {
      const targetAgent =
        target.kind === "agent"
          ? agentDefinitions.find((agent) => agent.id === target.agentId) || null
          : null;
      const baseRecord: InvocationRecord = {
        id: newInvocationId(),
        kind: target.kind,
        toolName:
          target.kind === "agent"
            ? getAgentToolName(target.agentId)
            : target.toolName,
        title:
          target.kind === "agent" ? targetAgent?.name || target.agentId : target.toolName,
        agentId: target.kind === "agent" ? target.agentId : undefined,
        agentName:
          target.kind === "agent" ? targetAgent?.name || target.agentId : undefined,
        args: target.args,
        source,
        status: "running",
        phase: "planning",
        usedCapabilities: [],
        startedAt: nowStamp(),
      };

      setCurrentInvocation(baseRecord);
      upsertHistory(baseRecord);

      try {
        if (target.kind === "agent") {
          const result = await runAgent(target.agentId, target.args, {
            availableTools: capabilityTools,
            executeCapability,
            invocationSource: source,
            onProgress: (event) => {
              patchCurrentInvocation(baseRecord.id, {
                phase: event.phase,
                status:
                  event.phase === "error"
                    ? "error"
                    : event.phase === "waiting"
                      ? "waiting"
                      : event.phase === "planning"
                        ? "planning"
                        : event.phase === "running"
                          ? "running"
                          : "success",
                currentStep: event.currentStep,
                usedCapabilities: event.usedCapabilities || [],
                result: event.result,
                error: event.error,
              });
            },
          });

          const completed: InvocationRecord = {
            ...baseRecord,
            status: result.status,
            phase:
              result.status === "capability_unavailable"
                ? "error"
                : result.status === "approval_required"
                  ? "waiting"
                  : "success",
            currentStep:
              result.steps[result.steps.length - 1]?.toolName ||
              baseRecord.currentStep,
            usedCapabilities: result.usedCapabilities,
            completedAt: nowStamp(),
            result,
            error:
              result.status === "success"
                ? undefined
                : result.message,
          };

          setCurrentInvocation(completed);
          upsertHistory(completed);
          return result;
        }

        const result = await executeCapability(
          target.toolName,
          target.args,
        );
        const completed: InvocationRecord = {
          ...baseRecord,
          status: "success",
          phase: "success",
          completedAt: nowStamp(),
          result,
        };
        setCurrentInvocation(completed);
        upsertHistory(completed);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const completed: InvocationRecord = {
          ...baseRecord,
          status: "error",
          phase: "error",
          completedAt: nowStamp(),
          error: message,
          result: {
            isError: true,
            content: [{ type: "text", text: message }],
          },
        };
        setCurrentInvocation(completed);
        upsertHistory(completed);
        return completed.result;
      }
    },
    [agentDefinitions, capabilityTools, patchCurrentInvocation, upsertHistory],
  );

  const loadCapabilities = useCallback(async () => {
    setBackendState("checking");
    setBackendError("");

    try {
      const loaded = await fetchKonect4aiTools();
      const nextTools = [DATAGOV_TOOL, ...loaded];
      setCapabilityTools(nextTools);
      setSelectedCapability((current) => {
        if (current && nextTools.some((tool) => tool.name === current)) {
          return current;
        }
        return DATAGOV_TOOL_NAME;
      });
      setBackendState("connected");
    } catch (error) {
      setBackendState("error");
      setBackendError(error instanceof Error ? error.message : String(error));
      setCapabilityTools([DATAGOV_TOOL]);
      setSelectedCapability(DATAGOV_TOOL_NAME);
    }
  }, []);

  useEffect(() => {
    setWebMcpState(isWebMcpAvailable() ? "available" : "unavailable");
    void loadCapabilities();
  }, [loadCapabilities]);

  useEffect(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setRegisteredCount(0);
    setRegistrationErrors([]);

    if (registeredTools.length === 0) {
      return;
    }

    let cancelled = false;

    void registerKonect4aiTools(registeredTools, async (toolName, args, source) => {
      if (isAgentToolName(toolName)) {
        const agentId = toolName.replace(/^run_/, "");
        return invokeCurrentTarget(
          { kind: "agent", agentId, args },
          source,
        );
      }

      return invokeCurrentTarget(
        { kind: "capability", toolName, args },
        source,
      );
    }).then((result) => {
      if (cancelled) {
        result.cleanup();
        return;
      }

      cleanupRef.current = result.cleanup;
      setWebMcpState(result.available ? "available" : "unavailable");
      setRegisteredCount(result.registered.length);
      setRegistrationErrors(result.errors);
    });

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [invokeCurrentTarget, registeredTools]);

  useEffect(() => {
    setAgentDraft((current) => {
      if (selectedAgentId === "research_agent") {
        return {
          ...current,
          language: current.language || "auto",
          maxSources: current.maxSources || "3",
          approvalMode: current.approvalMode || "sensitive-actions",
        };
      }
      if (selectedAgentId === "browser_agent") {
        return { ...current, language: current.language || "auto" };
      }
      if (selectedAgentId === "monitor_agent") {
        return {
          ...current,
          language: current.language || "auto",
          maxSources: current.maxSources || "3",
        };
      }
      if (selectedAgentId === "data_analyst_agent") {
        return {
          ...current,
          language: current.language || "auto",
          limit: current.limit || "5",
        };
      }
      return {
        ...current,
        language: current.language || "auto",
        approvalMode: current.approvalMode || "sensitive-actions",
      };
    });
  }, [selectedAgentId]);

  const runCapabilityInvocation = async () => {
    setManualError("");
    if (!selectedCapability) {
      setManualError("Select a capability first.");
      return;
    }

    try {
      const args = parseJsonArgs(manualArgs);
      await invokeCurrentTarget(
        { kind: "capability", toolName: selectedCapability, args },
        "manual",
      );
    } catch (error) {
      setManualError(error instanceof Error ? error.message : String(error));
    }
  };

  const runAgentInvocation = async () => {
    setManualError("");
    if (!selectedAgentDef) {
      setManualError("Select an agent first.");
      return;
    }

    const goal = agentDraft.goal.trim();
    if (!goal) {
      setManualError("Goal is required.");
      return;
    }

    const draft: Record<string, unknown> = {
      goal,
      language: agentDraft.language,
    };

    if (selectedAgentId === "research_agent" || selectedAgentId === "monitor_agent") {
      draft.sources = agentDraft.sources;
      draft.maxSources = Number(agentDraft.maxSources) || 3;
    }

    if (selectedAgentId === "browser_agent") {
      if (agentDraft.target.trim()) {
        draft.target = agentDraft.target.trim();
      }
    }

    if (selectedAgentId === "data_analyst_agent") {
      if (!agentDraft.source.trim()) {
        setManualError("Select a source for the Data Analyst Agent.");
        return;
      }
      draft.source = agentDraft.source.trim();
      draft.limit = Number(agentDraft.limit) || 5;
    }

    if (selectedAgentId === "custom_agent") {
      if (agentDraft.name.trim()) {
        draft.name = agentDraft.name.trim();
      }
      draft.sources = agentDraft.sources;
      draft.allowedTools = agentDraft.allowedTools;
      draft.approvalMode = agentDraft.approvalMode;
    }

    await invokeCurrentTarget(
      { kind: "agent", agentId: selectedAgentId, args: draft },
      "manual",
    );
  };

  const renderInvocationStatus = (status: InvocationStatus): string => {
    if (status in copy.statusValues) {
      return copy.statusValues[status];
    }
    return status;
  };

  const visibleAgentDescriptions = (agentId: string): string => {
    return copy.agentDescriptions[agentId] || "No description.";
  };

  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">{copy.heroEyebrow}</p>
          <h1>{copy.heroTitle}</h1>
          <p className="subtitle">{copy.heroSubtitle}</p>
          <p className="workspace-tagline">{copy.workspaceTagline}</p>
        </div>
        <div className="hero-controls">
          <label className="ui-select-label">
            UI language
            <select
              value={uiLanguage}
              onChange={(event) =>
                setUiLanguage(event.target.value as WorkspaceLanguage)
              }
            >
              <option value="auto">Auto</option>
              <option value="en">English</option>
              <option value="zh-TW">繁體中文</option>
            </select>
          </label>
        </div>
      </section>

      {webMcpState === "unavailable" && (
        <p className="notice">{copy.unavailableMessage}</p>
      )}

      <section className="status-bar" aria-label="Connection status">
        <span
          className={`status-pill ${
            webMcpState === "available"
              ? "ok"
              : webMcpState === "unavailable"
                ? "error"
                : ""
          }`}
        >
          <span className="status-dot" />
          WebMCP{" "}
          {webMcpState === "checking"
            ? "checking"
            : webMcpState === "available"
              ? "available"
              : "unavailable"}
        </span>
        <span
          className={`status-pill ${
            backendState === "connected"
              ? "ok"
              : backendState === "error"
                ? "error"
                : ""
          }`}
        >
          <span className="status-dot" />
          Backend{" "}
          {backendState === "checking"
            ? "checking"
            : backendState === "connected"
              ? "connected"
              : "error"}
        </span>
        <span className="status-pill">
          <span className="status-dot" />
          {registeredCount} agent tools registered
        </span>
      </section>

      <section className="workspace-grid">
        <aside className="panel">
          <div className="panel-header">
            <h2 className="panel-title">{copy.builtInAgents}</h2>
            <button className="btn" onClick={loadCapabilities} type="button">
              {copy.refreshButton}
            </button>
          </div>
          <div className="panel-body">
            {backendError && (
              <p className="notice">
                {copy.backendErrorPrefix} {backendError}
              </p>
            )}
            {registrationErrors.length > 0 && (
              <p className="notice">
                {registrationErrors.length} {copy.registrationIssueSuffix}.
              </p>
            )}

            <div className="section-heading-row">
              <h3>{copy.builtInAgents}</h3>
              <span className="section-badge">5</span>
            </div>
            <div className="agent-list">
              {agentDefinitions.map((agent) => (
                <button
                  key={agent.id}
                  className={`capability ${
                    selectedAgentId === agent.id ? "selected" : ""
                  }`}
                  onClick={() => {
                    setSelectedAgentId(agent.id);
                    setManualMode("agent");
                  }}
                  type="button"
                >
                  <p className="capability-name">{agent.name}</p>
                  <span className="capability-label">{agent.id}</span>
                  <p className="capability-desc">
                    {shortDescription(visibleAgentDescriptions(agent.id))}
                  </p>
                </button>
              ))}
            </div>

            <div className="section-heading-row" style={{ marginTop: 18 }}>
              <h3>{copy.sourceCapabilities}</h3>
              <span className="section-badge">{capabilityOptions.length}</span>
            </div>
            {capabilityOptions.length === 0 ? (
              <div className="empty-state">
                <p>{copy.noCapabilities}</p>
              </div>
            ) : (
              <div className="capability-list">
                {capabilityOptions.map((tool) => (
                  <button
                    key={tool.name}
                    className={`capability ${
                      tool.name === selectedCapability ? "selected" : ""
                    }`}
                    onClick={() => {
                      setSelectedCapability(tool.name);
                      setManualMode("capability");
                    }}
                    type="button"
                  >
                    <p className="capability-name">{tool.name}</p>
                    {tool.label && (
                      <span className="capability-label">{tool.label}</span>
                    )}
                    <p className="capability-desc">
                      {shortDescription(tool.description || "No description.")}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">{copy.liveWorkspace}</h2>
          </div>
          <div className="panel-body">
            <div className="live-grid">
              <div className="run-card">
                {!currentInvocation ? (
                  <div className="empty-state">
                    <p>{copy.idleMessage}</p>
                  </div>
                ) : (
                  <>
                    <p className="run-label">{copy.currentInvocation}</p>
                    <h3 className="run-title">
                      {currentInvocation.kind === "agent"
                        ? currentInvocation.agentName || currentInvocation.title
                        : currentInvocation.toolName}
                    </h3>
                    <div className="kv">
                      <div className="kv-row">
                        <strong>{copy.agentLabel}</strong>
                        <span>{currentInvocation.agentName || "—"}</span>
                      </div>
                      <div className="kv-row">
                        <strong>{copy.toolLabel}</strong>
                        <span>{currentInvocation.toolName}</span>
                      </div>
                      <div className="kv-row">
                        <strong>{copy.goalLabel}</strong>
                        <span>{String(currentInvocation.args.goal || currentInvocation.args.query || currentInvocation.args.question || "—")}</span>
                      </div>
                      <div className="kv-row">
                        <strong>{copy.statusLabel}</strong>
                        <span>{renderInvocationStatus(currentInvocation.status)}</span>
                      </div>
                      <div className="kv-row">
                        <strong>{copy.sourceLabel}</strong>
                        <span>{currentInvocation.source}</span>
                      </div>
                      <div className="kv-row">
                        <strong>{copy.currentStep}</strong>
                        <span>{currentInvocation.currentStep || "—"}</span>
                      </div>
                      <div className="kv-row">
                        <strong>Used capabilities</strong>
                        <span>
                          {currentInvocation.usedCapabilities.length > 0
                            ? currentInvocation.usedCapabilities.join(", ")
                            : "—"}
                        </span>
                      </div>
                      <div className="kv-row">
                        <strong>{copy.startedLabel}</strong>
                        <span>{currentInvocation.startedAt}</span>
                      </div>
                      <div className="kv-row">
                        <strong>{copy.completedLabel}</strong>
                        <span>{currentInvocation.completedAt || "..."}</span>
                      </div>
                    </div>
                    <p className="run-label">{copy.argumentsLabel}</p>
                    <pre className="json-box">{formatJson(currentInvocation.args)}</pre>
                    <p className="run-label" style={{ marginTop: 12 }}>
                      {copy.resultLabel}
                    </p>
                    <pre
                      className={`json-box ${
                        currentInvocation.status === "error" ? "error-text" : ""
                      }`}
                    >
                      {currentInvocation.status === "running" ||
                      currentInvocation.status === "planning" ||
                      currentInvocation.status === "waiting"
                        ? "Waiting for Konect4AI backend..."
                        : formatJson(
                            currentInvocation.error ||
                              currentInvocation.result ||
                              null,
                          )}
                    </pre>
                  </>
                )}
              </div>

              <div className="run-card">
                <p className="run-label">{copy.manualInvocation}</p>
                <div className="manual-form">
                  <label>
                    {copy.invocationModeLabel}
                    <select
                      value={manualMode}
                      onChange={(event) =>
                        setManualMode(event.target.value as ManualMode)
                      }
                    >
                      <option value="agent">{copy.agentLabel}</option>
                      <option value="capability">{copy.capabilityLabel}</option>
                    </select>
                  </label>

                  {manualMode === "capability" ? (
                    <>
                      <label>
                        {copy.capabilityLabel}
                        <select
                          value={selectedCapability}
                          onChange={(event) =>
                            setSelectedCapability(event.target.value)
                          }
                          disabled={capabilityOptions.length === 0}
                        >
                          {capabilityOptions.map((tool) => (
                            <option key={tool.name} value={tool.name}>
                              {tool.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {copy.capabilityArgsLabel}
                        <textarea
                          value={manualArgs}
                          onChange={(event) => setManualArgs(event.target.value)}
                          spellCheck={false}
                        />
                      </label>
                      {manualError && <p className="error-text">{manualError}</p>}
                      <div className="actions">
                        <button
                          className="btn primary"
                          type="button"
                          onClick={runCapabilityInvocation}
                          disabled={!selectedCapability}
                        >
                          {copy.invokeButton}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <label>
                        Agent
                        <select
                          value={selectedAgentId}
                          onChange={(event) => setSelectedAgentId(event.target.value)}
                        >
                          {agentDefinitions.map((agent) => (
                            <option key={agent.id} value={agent.id}>
                              {agent.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {copy.goalLabel}
                        <textarea
                          value={agentDraft.goal}
                          onChange={(event) =>
                            setAgentDraft((current) => ({
                              ...current,
                              goal: event.target.value,
                            }))
                          }
                          placeholder={
                            selectedAgentDef?.description ||
                            "Describe the task goal."
                          }
                          spellCheck={false}
                        />
                      </label>
                      <label>
                        {copy.languageLabel}
                        <select
                          value={agentDraft.language}
                          onChange={(event) =>
                            setAgentDraft((current) => ({
                              ...current,
                              language: event.target.value as WorkspaceLanguage,
                            }))
                          }
                        >
                          <option value="auto">Auto</option>
                          <option value="en">English</option>
                          <option value="zh-TW">繁體中文</option>
                        </select>
                      </label>

                      {selectedAgentId === "research_agent" ||
                      selectedAgentId === "monitor_agent" ||
                      selectedAgentId === "custom_agent" ? (
                        <label>
                          {copy.sourcesLabel}
                          <select
                            multiple
                            size={Math.min(6, Math.max(3, sourceCapabilityNames.length))}
                            value={agentDraft.sources}
                            onChange={(event) =>
                              setAgentDraft((current) => ({
                                ...current,
                                sources: readMultiSelect(event),
                              }))
                            }
                          >
                            {sourceCapabilityNames.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}

                      {selectedAgentId === "browser_agent" ? (
                        <label>
                          {copy.targetLabel}
                          <input
                            value={agentDraft.target}
                            onChange={(event) =>
                              setAgentDraft((current) => ({
                                ...current,
                                target: event.target.value,
                              }))
                            }
                            placeholder="https://..."
                          />
                        </label>
                      ) : null}

                      {selectedAgentId === "data_analyst_agent" ? (
                        <>
                          <label>
                            {copy.selectedSourceLabel}
                            <select
                              value={agentDraft.source}
                              onChange={(event) =>
                                setAgentDraft((current) => ({
                                  ...current,
                                  source: event.target.value,
                                }))
                              }
                            >
                              <option value="">Select a capability</option>
                              {sourceCapabilityNames.map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Limit
                            <input
                              type="number"
                              min={1}
                              max={20}
                              value={agentDraft.limit}
                              onChange={(event) =>
                                setAgentDraft((current) => ({
                                  ...current,
                                  limit: event.target.value,
                                }))
                              }
                            />
                          </label>
                        </>
                      ) : null}

                      {selectedAgentId === "custom_agent" ? (
                        <>
                          <label>
                            Name
                            <input
                              value={agentDraft.name}
                              onChange={(event) =>
                                setAgentDraft((current) => ({
                                  ...current,
                                  name: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <label>
                            {copy.allowedToolsLabel}
                            <textarea
                              value={agentDraft.allowedTools.join(", ")}
                              onChange={(event) =>
                                setAgentDraft((current) => ({
                                  ...current,
                                  allowedTools: splitList(event.target.value),
                                }))
                              }
                              placeholder="search_us_government_datasets, ..."
                              spellCheck={false}
                            />
                          </label>
                          <label>
                            {copy.approvalModeLabel}
                            <select
                              value={agentDraft.approvalMode}
                              onChange={(event) =>
                                setAgentDraft((current) => ({
                                  ...current,
                                  approvalMode: event.target
                                    .value as ApprovalMode,
                                }))
                              }
                            >
                              <option value="none">none</option>
                              <option value="sensitive-actions">
                                sensitive-actions
                              </option>
                              <option value="always">always</option>
                            </select>
                          </label>
                        </>
                      ) : null}

                      {(selectedAgentId === "research_agent" ||
                        selectedAgentId === "monitor_agent") && (
                        <label>
                          Max sources
                          <input
                            type="number"
                            min={1}
                            max={3}
                            value={agentDraft.maxSources}
                            onChange={(event) =>
                              setAgentDraft((current) => ({
                                ...current,
                                maxSources: event.target.value,
                              }))
                            }
                          />
                        </label>
                      )}

                      {manualError && <p className="error-text">{manualError}</p>}
                      <div className="actions">
                        <button
                          className="btn primary"
                          type="button"
                          onClick={runAgentInvocation}
                          disabled={!selectedAgentId}
                        >
                          {copy.invokeButton}
                        </button>
                      </div>
                    </>
                  )}

                  {selectedCapabilityDef && manualMode === "capability" && (
                    <>
                      <p className="run-label" style={{ marginTop: 18 }}>
                        Backend inputSchema
                      </p>
                      <pre className="json-box">
                        {formatJson(selectedCapabilityDef.inputSchema || {})}
                      </pre>
                    </>
                  )}

                  {selectedAgentDef && manualMode === "agent" && (
                    <>
                      <p className="run-label" style={{ marginTop: 18 }}>
                        Agent instructions
                      </p>
                      <pre className="json-box">
                        {formatJson({
                          id: selectedAgentDef.id,
                          sourcePolicy: selectedAgentDef.sourcePolicy,
                          approvalMode: selectedAgentDef.approvalMode,
                          allowedCapabilities: selectedAgentDef.allowedCapabilities,
                          inputSchema: selectedAgentDef.inputSchema,
                        })}
                      </pre>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="run-card history-card">
              <p className="run-label">{copy.invocationHistory}</p>
              {history.length === 0 ? (
                <p className="capability-desc">{copy.noInvocations}</p>
              ) : (
                <div className="history-list">
                  {history.map((item) => (
                    <div key={item.id} className="history-item">
                      <div className="history-head">
                        <span className="history-name">{item.title}</span>
                        <span className={`history-status ${item.status}`}>
                          {renderInvocationStatus(item.status)}
                        </span>
                      </div>
                      <div className="capability-desc">
                        {item.source} · {item.startedAt}
                        {item.completedAt ? ` → ${item.completedAt}` : ""}
                      </div>
                      {item.currentStep && (
                        <div className="capability-desc">
                          {copy.currentStep}: {item.currentStep}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
