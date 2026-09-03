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
  ASK_DATA_SOURCE_TOOL,
  ASK_DATA_SOURCE_TOOL_NAME,
  DATAGOV_TOOL,
  DATAGOV_TOOL_NAME,
  PROPOSE_DATA_SOURCE_TOOL,
  PROPOSE_DATA_SOURCE_TOOL_NAME,
  createKonect4aiSource,
  Konect4aiClientError,
  type BackendTool,
  type JsonObject,
  fetchKonect4aiTools,
  fetchKonect4aiSourceOpenApi,
  fetchKonect4aiSourceStatus,
  formatJson,
  type SourceStatusResponse,
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
  | "rejected"
  | "capability_unavailable"
  | "approval_required";
type InvocationSource = "manual" | "webmcp" | "human";
type InvocationKind = "capability" | "agent";
type ManualMode = "agent" | "capability";
type AccessMode = "ask-only" | "direct";

type VerificationState = "backend_verified" | "unverified";

interface ProvenanceReceipt {
  capability: string;
  sourceName: string;
  sourceUrl?: string;
  sourceDescription?: string;
  extractedAt: string;
  verifiedByBackend: boolean;
  rawRowsReturnedThroughWebMCP: boolean;
  recordsConsulted?: number;
  modelBoundary?: string;
}

interface BoundaryDetails {
  label: string;
  note: string;
  sourceName?: string;
  sourceUrl?: string;
  recordsConsulted?: number;
  verifiedByBackend: boolean;
  rawRowsReturnedThroughWebMCP: boolean;
  computedByOwnerConfiguredModel: boolean;
  rawRows?: unknown[];
}

interface ProposalRecord {
  id: string;
  invocationId: string;
  url: string;
  description: string;
  proposedBy: string;
  createdAt: string;
  status: "pending" | "approving" | "ready" | "failed" | "rejected";
  jobId?: string;
  message?: string;
  error?: string;
  toolCountBefore?: number;
  toolCountAfter?: number;
  toolRefreshDelayMs?: number;
  sourceJob?: Record<string, unknown>;
  openApi?: JsonObject;
}

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
  provenanceReceipt?: ProvenanceReceipt;
  boundaryDetails?: BoundaryDetails;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDisplayScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function scalarToText(value: string | number | boolean): string {
  if (typeof value === "string") return value.trim();
  return String(value);
}

function flattenDisplayRow(row: unknown): Record<string, string> {
  if (!isPlainObject(row)) return {};

  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(row)) {
    if (Array.isArray(value) || value === null || value === undefined) {
      continue;
    }

    if (isDisplayScalar(value)) {
      const text = scalarToText(value);
      if (text) {
        result[key] = text;
      }
      continue;
    }

    if (isPlainObject(value)) {
      for (const [childKey, childValue] of Object.entries(value)) {
        if (!isDisplayScalar(childValue)) continue;
        const text = scalarToText(childValue);
        if (text) {
          result[childKey] = text;
        }
      }
    }
  }

  return result;
}

interface RawRowsTableColumn {
  key: string;
  label: string;
  fullLabel: string;
}

interface RawRowsTableCell {
  cells: Record<string, string>;
  extra: Array<[string, string]>;
}

interface RawRowsTableData {
  columns: RawRowsTableColumn[];
  rows: RawRowsTableCell[];
  overflowCount: number;
}

const PREFERRED_TABLE_KEYS = [
  "title",
  "name",
  "mag",
  "place",
  "time",
  "author",
  "published",
  "url",
  "link",
  "summary",
];

const DEEMPHASIZED_KEY_PATTERNS = [
  /(^|_)(id|uuid|guid|gid|cid|fid|rid|sid)(_|$)/i,
  /(hash|digest|token|checksum|fingerprint|internal|code)$/i,
  /(^|_)(internal|system|source|record|row|item)(_|$)/i,
];

function normalizeTableKey(key: string): string {
  return key.trim().toLowerCase();
}

function trimTableKeyLabel(key: string): string {
  return key
    .replace(/^properties\./i, "")
    .replace(/^geometry\./i, "");
}

function isDeemphasizedKey(key: string): boolean {
  const normalized = normalizeTableKey(key);
  return (
    /^\d+$/.test(normalized) ||
    DEEMPHASIZED_KEY_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

function preferredKeyRank(key: string): number {
  const normalized = normalizeTableKey(key);
  const exact = PREFERRED_TABLE_KEYS.indexOf(normalized);
  if (exact >= 0) return exact;

  for (let index = 0; index < PREFERRED_TABLE_KEYS.length; index += 1) {
    const preferred = PREFERRED_TABLE_KEYS[index];
    if (normalized === preferred || normalized.endsWith(`.${preferred}`) || normalized.endsWith(`_${preferred}`)) {
      return index;
    }
  }

  return PREFERRED_TABLE_KEYS.length + 1;
}

function buildTableLabelMap(keys: string[]): Map<string, string> {
  const trimmedCounts = new Map<string, number>();
  const trimmedByKey = new Map<string, string>();

  for (const key of keys) {
    const trimmed = trimTableKeyLabel(key);
    trimmedByKey.set(key, trimmed);
    trimmedCounts.set(trimmed, (trimmedCounts.get(trimmed) || 0) + 1);
  }

  const labels = new Map<string, string>();
  for (const key of keys) {
    const trimmed = trimmedByKey.get(key) || key;
    labels.set(key, trimmedCounts.get(trimmed) === 1 ? trimmed : key);
  }
  return labels;
}

function buildRawRowsTableData(rows: unknown[]): RawRowsTableData {
  const flattened = rows.map((row) => flattenDisplayRow(row));
  const frequency = new Map<string, number>();
  const uniqueValues = new Map<string, Set<string>>();

  for (const row of flattened) {
    for (const key of new Set(Object.keys(row))) {
      frequency.set(key, (frequency.get(key) || 0) + 1);
      if (!uniqueValues.has(key)) {
        uniqueValues.set(key, new Set());
      }
      const value = row[key];
      if (value) {
        uniqueValues.get(key)?.add(value);
      }
    }
  }

  const sortedColumns = [...frequency.entries()]
    .sort((left, right) => {
      const leftKey = left[0];
      const rightKey = right[0];

      const leftPreferred = preferredKeyRank(leftKey);
      const rightPreferred = preferredKeyRank(rightKey);
      if (leftPreferred !== rightPreferred) {
        return leftPreferred - rightPreferred;
      }

      const leftDeemphasized = isDeemphasizedKey(leftKey);
      const rightDeemphasized = isDeemphasizedKey(rightKey);
      if (leftDeemphasized !== rightDeemphasized) {
        return leftDeemphasized ? 1 : -1;
      }

      const leftFrequency = left[1];
      const rightFrequency = right[1];
      if (rightFrequency !== leftFrequency) return rightFrequency - leftFrequency;

      const leftUnique = uniqueValues.get(leftKey)?.size || 0;
      const rightUnique = uniqueValues.get(rightKey)?.size || 0;
      if (rightUnique !== leftUnique) return rightUnique - leftUnique;

      return leftKey.localeCompare(rightKey);
    })
    .map(([key]) => key);

  const primaryKeys = sortedColumns.slice(0, 5);
  const overflowKeys = sortedColumns.slice(5);
  const labelMap = buildTableLabelMap(sortedColumns);

  const columns: RawRowsTableColumn[] = primaryKeys.map((key) => ({
    key,
    label: labelMap.get(key) || key,
    fullLabel: key,
  }));

  if (overflowKeys.length > 0) {
    columns.push({
      key: "__more__",
      label: `+${overflowKeys.length} more`,
      fullLabel: `+${overflowKeys.length} more`,
    });
  }

  const tableRows = flattened.map((row) => {
    const cells = primaryKeys.reduce<Record<string, string>>((acc, key) => {
      acc[key] = row[key] || "";
      return acc;
    }, {});
    const extra = overflowKeys
      .map((key) => [key, row[key]] as [string, string])
      .filter(([, value]) => Boolean(value));

    return {
      cells,
      extra,
    };
  });

  return {
    columns,
    rows: tableRows,
    overflowCount: overflowKeys.length,
  };
}

function formatErrorDetails(error: unknown): string {
  if (error instanceof Konect4aiClientError && error.payload !== undefined) {
    if (typeof error.payload === "object" && error.payload !== null) {
      return formatJson(error.payload);
    }
    return String(error.payload);
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function extractAnswerText(result: unknown): string {
  if (typeof result === "string") return result;
  const value = asObject(result);
  return (
    asString(value.answer) ||
    asString(value.text) ||
    asString(value.content) ||
    asString(value.message) ||
    asString(asObject(value.receipt).answer) ||
    ""
  );
}

function formatProposalFailureMessage(error: unknown): string {
  if (error instanceof Konect4aiClientError) {
    const payload = error.payload;
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const data = payload as Record<string, unknown>;
      const code = asString(data.error) || asString(data.code);
      const message =
        asString(data.message) ||
        asString(data.message_zh) ||
        error.message;
      return code ? `${code}: ${message}` : message;
    }

    if (typeof payload === "string" && payload.trim()) {
      return `${payload.trim()}: ${error.message}`;
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function extractRows(result: unknown): unknown[] {
  const value = asObject(result);
  const candidates = [
    value.rawRows,
    value.rows,
    value.sample_data,
    asObject(value.metadata).rows,
    asObject(value.source).rawRows,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

function receiptFromResult(
  toolName: string,
  result: unknown,
  sourceNameFallback: string,
): ProvenanceReceipt {
  const value = asObject(result);
  const receipt = asObject(value.receipt);
  const source = asObject(value.source);
  const extractedAt = asString(receipt.extractedAt) || nowStamp();
  const sourceName =
    asString(receipt.sourceName) ||
    asString(source.name) ||
    sourceNameFallback ||
    toolName;

  return {
    capability: asString(receipt.capability) || toolName,
    sourceName,
    sourceUrl: asString(receipt.sourceUrl) || asString(source.url) || undefined,
    extractedAt,
    verifiedByBackend:
      receipt.verifiedByBackend === true ||
      asObject(value.metadata).verifiedByBackend === true,
    rawRowsReturnedThroughWebMCP:
      receipt.rawRowsReturnedThroughWebMCP === true ||
      false,
    recordsConsulted:
      Number(receipt.recordsConsulted) > 0
        ? Number(receipt.recordsConsulted)
        : Number(asObject(value.metadata).recordsConsulted) > 0
          ? Number(asObject(value.metadata).recordsConsulted)
          : undefined,
    modelBoundary:
      asString(receipt.modelBoundary) ||
      "The page owner's configured model computes the answer.",
  };
}

function boundaryFromResult(
  toolName: string,
  result: unknown,
): BoundaryDetails {
  const value = asObject(result);
  const receipt = asObject(value.receipt);
  const rows = extractRows(result);
  const sourceName =
    asString(receipt.sourceName) ||
    asString(asObject(value.source).name) ||
    asString(asObject(value.metadata).sourceName) ||
    toolName;

  return {
    label: "NOT RETURNED THROUGH WEBMCP",
    note: "This is the tool's return boundary, not browser-level isolation.",
    sourceName,
    sourceUrl:
      asString(receipt.sourceUrl) ||
      asString(asObject(value.source).url) ||
      asString(asObject(value.metadata).sourceUrl) ||
      undefined,
    recordsConsulted:
      typeof receipt.recordsConsulted === "number"
        ? receipt.recordsConsulted
        : rows.length > 0
          ? rows.length
          : undefined,
    verifiedByBackend:
      receipt.verifiedByBackend === true ||
      asObject(value.metadata).verifiedByBackend === true,
    rawRowsReturnedThroughWebMCP: receipt.rawRowsReturnedThroughWebMCP === true,
    computedByOwnerConfiguredModel: true,
    rawRows: rows,
  };
}

export default function WebMcpWorkspace() {
  const [uiLanguage, setUiLanguage] = useState<WorkspaceLanguage>("auto");
  const [webMcpState, setWebMcpState] = useState<WebMcpState>("checking");
  const [backendState, setBackendState] = useState<BackendState>("checking");
  const [backendError, setBackendError] = useState("");
  const [capabilityTools, setCapabilityTools] = useState<BackendTool[]>([
    ASK_DATA_SOURCE_TOOL,
    PROPOSE_DATA_SOURCE_TOOL,
    DATAGOV_TOOL,
  ]);
  const [sourceAccessModes, setSourceAccessModes] = useState<
    Record<string, AccessMode>
  >({});
  const [registeredCount, setRegisteredCount] = useState(0);
  const [registrationErrors, setRegistrationErrors] = useState<string[]>([]);
  const [currentInvocation, setCurrentInvocation] =
    useState<InvocationRecord | null>(null);
  const [history, setHistory] = useState<InvocationRecord[]>([]);
  const [proposals, setProposals] = useState<ProposalRecord[]>([]);
  const [manualMode, setManualMode] = useState<ManualMode>("agent");
  const [selectedCapability, setSelectedCapability] = useState(
    DATAGOV_TOOL_NAME,
  );
  const [selectedAgentId, setSelectedAgentId] = useState("research_agent");
  const [humanAskSourceId, setHumanAskSourceId] = useState("");
  const [humanAskQuestion, setHumanAskQuestion] = useState("");
  const [humanAskLoading, setHumanAskLoading] = useState(false);
  const [humanAskError, setHumanAskError] = useState("");
  const [manualWorkbenchOpen, setManualWorkbenchOpen] = useState(false);
  const [manualArgs, setManualArgs] = useState(
    '{\n  "query": "electric vehicle charging",\n  "limit": 5\n}',
  );
  const [manualError, setManualError] = useState("");
  const [agentDraft, setAgentDraft] = useState<AgentManualState>(() =>
    createEmptyAgentDraft(),
  );

  const cleanupRef = useRef<(() => void) | null>(null);
  const registrationControllerRef = useRef<AbortController | null>(null);
  const agentDefinitions = useMemo(() => getAgentDefinitions(), []);
  const agentTools = useMemo(() => getAgentWebMcpTools(), []);
  const copy = useMemo(() => getWorkspaceCopy(uiLanguage), [uiLanguage]);
  const resolvedUiLanguage = useMemo(
    () => resolveWorkspaceLanguage(uiLanguage),
    [uiLanguage],
  );

  const sourceCapabilityTools = useMemo(
    () =>
      capabilityTools.filter(
        (tool) =>
          tool.name !== ASK_DATA_SOURCE_TOOL_NAME &&
          tool.name !== PROPOSE_DATA_SOURCE_TOOL_NAME &&
          tool.name !== DATAGOV_TOOL_NAME,
      ),
    [capabilityTools],
  );

  const sourceCapabilityNames = useMemo(
    () => sourceCapabilityTools.map((tool) => tool.name),
    [sourceCapabilityTools],
  );

  const directSourceTools = useMemo(
    () =>
      sourceCapabilityTools.filter(
        (tool) => sourceAccessModes[tool.name] === "direct",
      ),
    [sourceAccessModes, sourceCapabilityTools],
  );

  const directSourceNames = useMemo(
    () => directSourceTools.map((tool) => tool.name),
    [directSourceTools],
  );

  const askOnlySourceEntries = useMemo(
    () =>
      sourceCapabilityTools
        .filter((tool) => sourceAccessModes[tool.name] !== "direct")
        .filter((tool) => typeof tool.jobId === "string" && tool.jobId.trim().length > 0)
        .map((tool) => ({
          jobId: String(tool.jobId).trim(),
          label: tool.label || shortDescription(tool.description || tool.name, 60),
          name: tool.name,
        })),
    [sourceAccessModes, sourceCapabilityTools],
  );

  const askDataSourceTool = useMemo(() => {
      const enumValues =
      askOnlySourceEntries.length > 0
        ? askOnlySourceEntries.map((entry) => entry.jobId)
        : undefined;
    const availableSummary =
      askOnlySourceEntries.length > 0
        ? askOnlySourceEntries
            .map((entry) => `- ${entry.jobId} — ${entry.label}`)
            .join("\n")
        : copy.noAskOnlySourcesEnabledLabel;
    const jobIdDescription =
      askOnlySourceEntries.length > 0
        ? `Choose one of the ask-only source jobIds:\n${askOnlySourceEntries
            .map((entry) => `${entry.jobId} — ${entry.label}`)
            .join("\n")}`
        : copy.noAskOnlySourceJobIdsLabel;

    return {
      ...ASK_DATA_SOURCE_TOOL,
      description:
        `${ASK_DATA_SOURCE_TOOL.description}\n\n` +
        `Available ask-only source jobIds:\n${availableSummary}`,
      inputSchema: {
        ...(ASK_DATA_SOURCE_TOOL.inputSchema || {}),
        properties: {
          ...(asObject(ASK_DATA_SOURCE_TOOL.inputSchema).properties || {}),
          jobId: {
            type: "string",
            description: jobIdDescription,
            ...(enumValues ? { enum: enumValues } : {}),
          },
        },
      },
    } satisfies BackendTool;
  }, [askOnlySourceEntries]);

  const registeredCapabilityTools = useMemo(
    () => [
      ...agentTools,
      askDataSourceTool,
      PROPOSE_DATA_SOURCE_TOOL,
      DATAGOV_TOOL,
      ...directSourceTools,
    ],
    [agentTools, askDataSourceTool, directSourceTools],
  );

  const visibleAgentDefinitions = useMemo(
    () => agentDefinitions.filter((agent) => agent.id !== "browser_agent"),
    [agentDefinitions],
  );

  const selectedAgentDef = useMemo(
    () =>
      visibleAgentDefinitions.find((agent) => agent.id === selectedAgentId) ||
      null,
    [selectedAgentId, visibleAgentDefinitions],
  );

  const registeredTools = useMemo(
    () => registeredCapabilityTools,
    [registeredCapabilityTools],
  );

  const capabilityOptions = useMemo(
    () =>
      [askDataSourceTool, PROPOSE_DATA_SOURCE_TOOL, DATAGOV_TOOL, ...directSourceTools].map((tool) => ({
        ...tool,
        description: tool.description || copy.noDescriptionLabel,
      })),
    [askDataSourceTool, copy.noDescriptionLabel, directSourceTools],
  );

  const selectedCapabilityDef = useMemo(
    () =>
      capabilityOptions.find((tool) => tool.name === selectedCapability) || null,
    [capabilityOptions, selectedCapability],
  );

  const setSourceMode = useCallback((name: string, mode: AccessMode) => {
    setSourceAccessModes((current) => {
      if (current[name] === mode) return current;
      return {
        ...current,
        [name]: mode,
      };
    });
  }, []);

  useEffect(() => {
    setSourceAccessModes((current) => {
      const next = { ...current };
      let changed = false;

      for (const tool of sourceCapabilityTools) {
        if (!(tool.name in next)) {
          next[tool.name] = "ask-only";
          changed = true;
        }
      }

      for (const key of Object.keys(next)) {
        if (!sourceCapabilityTools.some((tool) => tool.name === key)) {
          delete next[key];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [sourceCapabilityTools]);

  useEffect(() => {
    setHumanAskSourceId((current) => {
      if (
        current &&
        askOnlySourceEntries.some((entry) => entry.jobId === current)
      ) {
        return current;
      }
      return askOnlySourceEntries[0]?.jobId || "";
    });
  }, [askOnlySourceEntries]);

  useEffect(() => {
    if (registrationErrors.length > 0) {
      console.error("WebMCP registration issues:", registrationErrors);
    }
  }, [registrationErrors]);

  useEffect(() => {
    if (
      manualMode === "capability" &&
      selectedCapability &&
      !capabilityOptions.some((tool) => tool.name === selectedCapability)
    ) {
      setSelectedCapability(DATAGOV_TOOL_NAME);
    }
  }, [capabilityOptions, manualMode, selectedCapability]);

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
      signal?: AbortSignal,
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
        if (
          target.kind === "capability" &&
          target.toolName === PROPOSE_DATA_SOURCE_TOOL_NAME
        ) {
          const url = asString(target.args.url);
          const description = asString(target.args.description);
          if (!url || !description) {
            throw new Error("propose_data_source requires url and description.");
          }

          const proposalId = newInvocationId();
          const proposal: ProposalRecord = {
            id: proposalId,
            invocationId: baseRecord.id,
            url,
            description,
            proposedBy:
              source === "webmcp"
                ? baseRecord.agentName || baseRecord.title
                : "Manual",
            createdAt: nowStamp(),
            status: "pending",
          };

          setProposals((items) => [proposal, ...items]);

          const resultMessage = `${copy.proposalSubmittedLabel} ${copy.awaitingOwnerApprovalLabel}`;
          patchInvocationRecord(baseRecord.id, {
            status: "waiting",
            phase: "waiting",
            completedAt: nowStamp(),
            result: {
              proposalId,
              status: "pending",
              message: resultMessage,
            },
            provenanceReceipt: {
              capability: PROPOSE_DATA_SOURCE_TOOL_NAME,
              sourceName: proposal.proposedBy,
              extractedAt: proposal.createdAt,
              verifiedByBackend: false,
              rawRowsReturnedThroughWebMCP: false,
              modelBoundary: copy.awaitingOwnerApprovalLabel,
            },
            boundaryDetails: {
              label: "NOT RETURNED THROUGH WEBMCP",
              note: "This is the tool's return boundary, not browser-level isolation.",
              sourceName: proposal.proposedBy,
              verifiedByBackend: false,
              rawRowsReturnedThroughWebMCP: false,
              computedByOwnerConfiguredModel: false,
            },
          });
          return {
            proposalId,
            status: "pending",
            message: resultMessage,
          };
        }

        if (target.kind === "agent") {
          const result = await runAgent(target.agentId, target.args, {
            availableTools: registeredCapabilityTools,
            executeCapability,
            invocationSource: source,
            signal,
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
            provenanceReceipt: receiptFromResult(
              baseRecord.toolName,
              result,
              baseRecord.agentName || baseRecord.title,
            ),
            boundaryDetails: boundaryFromResult(
              baseRecord.toolName,
              result,
            ),
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
          signal,
        );
        const completed: InvocationRecord = {
          ...baseRecord,
          status: "success",
          phase: "success",
          completedAt: nowStamp(),
          result,
          provenanceReceipt: receiptFromResult(
            target.toolName,
            result,
            target.toolName,
          ),
          boundaryDetails: boundaryFromResult(target.toolName, result),
        };
        setCurrentInvocation(completed);
        upsertHistory(completed);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const errorDetails = formatErrorDetails(error);
        const completed: InvocationRecord = {
          ...baseRecord,
          status: "error",
          phase: "error",
          completedAt: nowStamp(),
          error: errorDetails,
          result: {
            isError: true,
            message,
            details: errorDetails,
            content: [{ type: "text", text: message }],
          },
          provenanceReceipt: {
            capability: target.kind === "agent" ? getAgentToolName(target.agentId) : target.toolName,
            sourceName:
              target.kind === "agent"
                ? target.agentId
                : target.toolName,
            extractedAt: nowStamp(),
            verifiedByBackend: false,
            rawRowsReturnedThroughWebMCP: false,
            modelBoundary: "unverified",
          },
          boundaryDetails: {
            label: "NOT RETURNED THROUGH WEBMCP",
            note: "This is the tool's return boundary, not browser-level isolation.",
            sourceName:
              target.kind === "agent"
                ? target.agentId
                : target.toolName,
            verifiedByBackend: false,
            rawRowsReturnedThroughWebMCP: false,
            computedByOwnerConfiguredModel: false,
          },
        };
        setCurrentInvocation(completed);
        upsertHistory(completed);
        return completed.result;
      }
    },
    [agentDefinitions, patchCurrentInvocation, registeredCapabilityTools, upsertHistory],
  );

  const loadCapabilities = useCallback(async (): Promise<BackendTool[]> => {
    setBackendState("checking");
    setBackendError("");

    try {
      const loaded = await fetchKonect4aiTools();
      const nextTools = [ASK_DATA_SOURCE_TOOL, PROPOSE_DATA_SOURCE_TOOL, DATAGOV_TOOL, ...loaded];
      setCapabilityTools(nextTools);
      setSelectedCapability((current) => {
        if (current && nextTools.some((tool) => tool.name === current)) {
          return current;
        }
        return DATAGOV_TOOL_NAME;
      });
      setBackendState("connected");
      return nextTools;
    } catch (error) {
      setBackendState("error");
      setBackendError(error instanceof Error ? error.message : String(error));
      const fallback = [ASK_DATA_SOURCE_TOOL, PROPOSE_DATA_SOURCE_TOOL, DATAGOV_TOOL];
      setCapabilityTools(fallback);
      setSelectedCapability(DATAGOV_TOOL_NAME);
      return fallback;
    }
  }, []);

  const updateProposal = useCallback(
    (proposalId: string, patch: Partial<ProposalRecord>) => {
      setProposals((items) =>
        items.map((item) =>
          item.id === proposalId ? { ...item, ...patch } : item,
        ),
      );
    },
    [],
  );

  const patchInvocationRecord = useCallback(
    (invocationId: string, patch: Partial<InvocationRecord>) => {
      setCurrentInvocation((current) =>
        current && current.id === invocationId
          ? { ...current, ...patch }
          : current,
      );
      setHistory((items) =>
        items.map((item) =>
          item.id === invocationId ? { ...item, ...patch } : item,
        ),
      );
    },
    [],
  );

  const rejectProposal = useCallback(
    (proposalId: string) => {
      const proposal = proposals.find((item) => item.id === proposalId);
      if (!proposal) {
        return;
      }

      updateProposal(proposalId, {
        status: "rejected",
        message: copy.proposalRejectedNoBackendLabel,
      });

      patchInvocationRecord(proposal.invocationId, {
        status: "rejected",
        phase: "waiting",
        completedAt: nowStamp(),
        result: {
          message: copy.proposalRejectedNoBackendLabel,
          approvedBy: "human",
          backendActionTaken: false,
        },
        provenanceReceipt: {
          capability: PROPOSE_DATA_SOURCE_TOOL_NAME,
          sourceName: proposal.proposedBy,
          extractedAt: proposal.createdAt,
          verifiedByBackend: false,
          rawRowsReturnedThroughWebMCP: false,
          modelBoundary: copy.proposalRejectedNoBackendLabel,
        },
        boundaryDetails: {
          label: "NOT RETURNED THROUGH WEBMCP",
          note: "This is the tool's return boundary, not browser-level isolation.",
          sourceName: proposal.proposedBy,
          verifiedByBackend: false,
          rawRowsReturnedThroughWebMCP: false,
          computedByOwnerConfiguredModel: false,
        },
      });
    },
    [copy.proposalRejectedNoBackendLabel, patchInvocationRecord, proposals, updateProposal],
  );

  const delay = useCallback((ms: number) => {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }, []);

  const approveProposal = useCallback(
    async (proposalId: string) => {
      const proposal = proposals.find((item) => item.id === proposalId);
      if (!proposal) {
        return;
      }

      updateProposal(proposalId, {
        status: "approving",
        message: copy.approvedCreatingSourceLabel,
      });

      patchInvocationRecord(proposal.invocationId, {
        status: "running",
        phase: "running",
        completedAt: nowStamp(),
        result: {
          proposalId,
          status: "approving",
          message: copy.approvedCreatingSourceLabel,
        },
        provenanceReceipt: {
          capability: PROPOSE_DATA_SOURCE_TOOL_NAME,
          sourceName: proposal.proposedBy,
          extractedAt: proposal.createdAt,
          verifiedByBackend: false,
          rawRowsReturnedThroughWebMCP: false,
          modelBoundary: copy.approvedCreatingSourceLabel,
        },
        boundaryDetails: {
          label: "NOT RETURNED THROUGH WEBMCP",
          note: "This is the tool's return boundary, not browser-level isolation.",
          sourceName: proposal.proposedBy,
          verifiedByBackend: false,
          rawRowsReturnedThroughWebMCP: false,
          computedByOwnerConfiguredModel: false,
        },
      });

      try {
        const creation = await createKonect4aiSource(
          { url: proposal.url, description: proposal.description },
          undefined,
        );
        const jobId = creation.jobId || proposal.jobId || "";
        if (!jobId) {
          throw new Error("Konect4AI did not return a job id.");
        }

        updateProposal(proposalId, {
          jobId,
          sourceJob: creation.job as Record<string, unknown>,
          message: creation.message || copy.sourceProposalCreatedLabel,
        });

        const pollStart = Date.now();
        let latest: SourceStatusResponse | null = null;
        for (let elapsed = 0; elapsed <= 15000; elapsed += 500) {
          latest = await fetchKonect4aiSourceStatus(jobId);
          updateProposal(proposalId, {
            status: latest.status === "failed" ? "failed" : latest.ready ? "ready" : "approving",
            message:
              latest.message ||
              (latest.ready
                ? copy.sourceReadyLabel
                : latest.status === "failed"
                  ? copy.sourceCreationFailedLabel
                  : copy.sourceStillProcessingLabel),
            sourceJob: latest.job,
          });

          if (latest.status === "failed" || latest.ready) {
            break;
          }

          await delay(500);
        }

        if (!latest) {
          throw new Error(copy.unableToReadSourceStatusLabel);
        }

        if (latest.status === "failed") {
          const failureMessage = latest.message || copy.sourceCreationFailedLabel;
          patchInvocationRecord(proposal.invocationId, {
            status: "error",
            phase: "error",
            completedAt: nowStamp(),
            error: failureMessage,
            result: {
              proposalId,
              status: "failed",
              jobId,
              message: failureMessage,
            },
            provenanceReceipt: {
              capability: PROPOSE_DATA_SOURCE_TOOL_NAME,
              sourceName: proposal.proposedBy,
              extractedAt: proposal.createdAt,
              verifiedByBackend: false,
              rawRowsReturnedThroughWebMCP: false,
              modelBoundary: failureMessage,
            },
            boundaryDetails: {
              label: "NOT RETURNED THROUGH WEBMCP",
              note: "This is the tool's return boundary, not browser-level isolation.",
              sourceName: proposal.proposedBy,
              verifiedByBackend: false,
              rawRowsReturnedThroughWebMCP: false,
              computedByOwnerConfiguredModel: false,
            },
          });
          updateProposal(proposalId, {
            status: "failed",
            error: failureMessage,
          });
          return;
        }

        if (!latest.ready) {
          const openApi = await fetchKonect4aiSourceOpenApi(jobId);
          patchInvocationRecord(proposal.invocationId, {
            status: "error",
            phase: "error",
            completedAt: nowStamp(),
            error: copy.sourceTooSlowLabel,
            result: {
              proposalId,
              status: "failed",
              jobId,
              message: copy.sourceTooSlowLabel,
            },
            provenanceReceipt: {
              capability: PROPOSE_DATA_SOURCE_TOOL_NAME,
              sourceName: proposal.proposedBy,
              extractedAt: proposal.createdAt,
              verifiedByBackend: false,
              rawRowsReturnedThroughWebMCP: false,
              modelBoundary: copy.sourceTooSlowLabel,
            },
            boundaryDetails: {
              label: "NOT RETURNED THROUGH WEBMCP",
              note: "This is the tool's return boundary, not browser-level isolation.",
              sourceName: proposal.proposedBy,
              verifiedByBackend: false,
              rawRowsReturnedThroughWebMCP: false,
              computedByOwnerConfiguredModel: false,
            },
          });
          updateProposal(proposalId, {
            status: "failed",
            error: copy.sourceTooSlowLabel,
            openApi,
          });
          return;
        }

        const beforeCount = capabilityTools.length;
        let refreshedTools = capabilityTools;
        let registeredDelay = 0;
        const refreshStart = Date.now();

        while (Date.now() - refreshStart <= 15000) {
          refreshedTools = await loadCapabilities();
          if (refreshedTools.length > beforeCount) {
            registeredDelay = Date.now() - refreshStart;
            break;
          }
          await delay(500);
        }

        if (refreshedTools.length <= beforeCount) {
          const openApi = await fetchKonect4aiSourceOpenApi(jobId);
          patchInvocationRecord(proposal.invocationId, {
            status: "error",
            phase: "error",
            completedAt: nowStamp(),
            error: copy.jobReadyButNotAppearedLabel,
            result: {
              proposalId,
              status: "failed",
              jobId,
              message: copy.jobReadyButNotAppearedLabel,
            },
            provenanceReceipt: {
              capability: PROPOSE_DATA_SOURCE_TOOL_NAME,
              sourceName: proposal.proposedBy,
              extractedAt: proposal.createdAt,
              verifiedByBackend: false,
              rawRowsReturnedThroughWebMCP: false,
              modelBoundary: copy.jobReadyButNotAppearedLabel,
            },
            boundaryDetails: {
              label: "NOT RETURNED THROUGH WEBMCP",
              note: "This is the tool's return boundary, not browser-level isolation.",
              sourceName: proposal.proposedBy,
              verifiedByBackend: false,
              rawRowsReturnedThroughWebMCP: false,
              computedByOwnerConfiguredModel: false,
            },
          });
          updateProposal(proposalId, {
            status: "failed",
            error: copy.jobReadyButNotAppearedLabel,
            openApi,
          });
          return;
        }

        updateProposal(proposalId, {
          status: "ready",
          message: copy.newToolAddedLabel,
          toolCountBefore: beforeCount,
          toolCountAfter: refreshedTools.length,
          toolRefreshDelayMs: registeredDelay,
        });
        patchInvocationRecord(proposal.invocationId, {
          status: "success",
          phase: "success",
          completedAt: nowStamp(),
          result: {
            proposalId,
            status: "ready",
            jobId,
            message: `${copy.newToolAddedLabel} ${
              proposal.description || proposal.url
            } · jobId: ${jobId}`,
            sourceName: proposal.description || proposal.url,
          },
          provenanceReceipt: {
            capability: PROPOSE_DATA_SOURCE_TOOL_NAME,
            sourceName: proposal.description || proposal.url,
            sourceUrl: proposal.url,
            sourceDescription: proposal.description,
            extractedAt: proposal.createdAt,
            verifiedByBackend: true,
            rawRowsReturnedThroughWebMCP: false,
            recordsConsulted: 20,
            modelBoundary: copy.sourceCreatedAfterHumanApprovalLabel,
          },
          boundaryDetails: {
            label: "NOT RETURNED THROUGH WEBMCP",
            note: "This is the tool's return boundary, not browser-level isolation.",
            sourceName: proposal.description || proposal.url,
            sourceUrl: proposal.url,
            recordsConsulted: 20,
            verifiedByBackend: true,
            rawRowsReturnedThroughWebMCP: false,
            computedByOwnerConfiguredModel: true,
            rawRows: [],
          },
        });
      } catch (error) {
        const failureMessage = formatProposalFailureMessage(error);
        patchInvocationRecord(proposal.invocationId, {
          status: "error",
          phase: "error",
          completedAt: nowStamp(),
          error: failureMessage,
          result: {
            proposalId,
            status: "failed",
            message: failureMessage,
          },
          provenanceReceipt: {
            capability: PROPOSE_DATA_SOURCE_TOOL_NAME,
            sourceName: proposal.proposedBy,
            extractedAt: proposal.createdAt,
            verifiedByBackend: false,
            rawRowsReturnedThroughWebMCP: false,
            modelBoundary: failureMessage,
          },
          boundaryDetails: {
            label: "NOT RETURNED THROUGH WEBMCP",
            note: "This is the tool's return boundary, not browser-level isolation.",
            sourceName: proposal.proposedBy,
            verifiedByBackend: false,
            rawRowsReturnedThroughWebMCP: false,
            computedByOwnerConfiguredModel: false,
          },
        });
        updateProposal(proposalId, {
          status: "failed",
          error: failureMessage,
        });
      }
    },
    [capabilityTools, copy, delay, loadCapabilities, patchInvocationRecord, proposals, updateProposal],
  );

  useEffect(() => {
    setWebMcpState(isWebMcpAvailable() ? "available" : "unavailable");
    void loadCapabilities();
  }, [loadCapabilities]);

  useEffect(() => {
    const previousCleanup = cleanupRef.current;
    const previousController = registrationControllerRef.current;
    const nextController = new AbortController();
    registrationControllerRef.current = nextController;
    let cancelled = false;

    if (registeredTools.length === 0) {
      previousController?.abort();
      previousCleanup?.();
      cleanupRef.current = null;
      setRegisteredCount(0);
      setRegistrationErrors([]);
      return () => {
        cancelled = true;
        nextController.abort();
      };
    }

    void registerKonect4aiTools(
      registeredTools,
      async (toolName, args, source, signal) => {
        if (isAgentToolName(toolName)) {
          const agentId = toolName.replace(/^run_/, "");
          return invokeCurrentTarget(
            { kind: "agent", agentId, args },
            source,
            signal,
          );
        }

        return invokeCurrentTarget(
          { kind: "capability", toolName, args },
          source,
          signal,
        );
      },
      {
        controller: nextController,
      },
    ).then((result) => {
      if (cancelled) {
        result.cleanup();
        return;
      }

      if (result.registered.length > 0) {
        previousController?.abort();
        previousCleanup?.();
        cleanupRef.current = result.cleanup;
        setRegisteredCount(result.registered.length);
      } else {
        result.cleanup();
      }
      setWebMcpState(result.available ? "available" : "unavailable");
      setRegistrationErrors(result.errors);
    });

    return () => {
      cancelled = true;
      nextController.abort();
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
          source: current.source || sourceCapabilityTools[0]?.name || "",
          limit: current.limit || "5",
        };
      }
      return {
        ...current,
        language: current.language || "auto",
        approvalMode: current.approvalMode || "sensitive-actions",
      };
    });
  }, [selectedAgentId, sourceCapabilityTools]);

  const runCapabilityInvocation = async () => {
    setManualError("");
    if (!selectedCapability) {
      setManualError(copy.selectCapabilityFirstError);
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

  const runHumanAsk = useCallback(async () => {
    setHumanAskError("");

    const question = humanAskQuestion.trim();
    if (!humanAskSourceId) {
      setHumanAskError(copy.selectSourceFirstError);
      return;
    }

    if (!question) {
      setHumanAskError(copy.enterQuestionError);
      return;
    }

    setHumanAskLoading(true);
    try {
      const result = await invokeCurrentTarget(
        {
          kind: "capability",
          toolName: ASK_DATA_SOURCE_TOOL_NAME,
          args: { jobId: humanAskSourceId, question },
        },
        "human",
      );

      if (
        isPlainObject(result) &&
        (result as Record<string, unknown>).isError === true
      ) {
        setHumanAskError(
          asString((result as Record<string, unknown>).details) ||
            asString((result as Record<string, unknown>).message) ||
            copy.unableToComputeAnswerError,
        );
      } else {
        setHumanAskQuestion("");
      }
    } catch (error) {
      setHumanAskError(error instanceof Error ? error.message : String(error));
    } finally {
      setHumanAskLoading(false);
    }
  }, [humanAskQuestion, humanAskSourceId, invokeCurrentTarget]);

  const runAgentInvocation = async () => {
    setManualError("");
    if (!selectedAgentDef) {
      setManualError(copy.selectAgentFirstError);
      return;
    }

    const goal = agentDraft.goal.trim();
    if (!goal) {
      setManualError(copy.goalRequiredError);
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
      const source =
        agentDraft.source.trim() || sourceCapabilityTools[0]?.name || "";
      if (!source) {
        setManualError(copy.noDataAnalystSourcesError);
        return;
      }
      draft.source = source;
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
    return copy.agentDescriptions[agentId] || copy.noDescriptionLabel;
  };

  const boundaryHeading =
    "NOT RETURNED THROUGH WEBMCP";
  const sentToAgentHeading = "SENT TO AGENT";
  const boundaryNote = copy.boundaryNote;
  const proposalsHeading = copy.proposalsHeading;
  const approveLabel = copy.approveLabel;
  const rejectLabel = copy.rejectLabel;
  const sourceProposalLabel = copy.sourceProposalLabel;
  const rawRowsLabel = copy.rawRowsLabel;
  const recordsLabel = copy.recordsConsultedLabel;
  const modelBoundaryLabel = copy.modelBoundaryLabel;
  const verifiedLabel = copy.backendVerifiedLabel;
  const unverifiedLabel = copy.unverifiedLabel;
  const currentBoundary = currentInvocation?.boundaryDetails;
  const currentReceipt = currentInvocation?.provenanceReceipt;
  const currentBoundaryRows = currentBoundary?.rawRows ?? [];
  const hasBoundaryData = currentBoundaryRows.length > 0;
  const currentBoundaryRowCount =
    currentBoundary?.recordsConsulted ?? currentBoundaryRows.length;
  const currentBoundaryTable = useMemo(
    () => buildRawRowsTableData(currentBoundaryRows),
    [currentBoundaryRows],
  );
  const activeProposal = useMemo(
    () =>
      proposals.find(
        (proposal) =>
          proposal.status === "pending" || proposal.status === "approving",
      ) || null,
    [proposals],
  );

  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-copy">
          <h1>{copy.heroTitle}</h1>
          <p className="workspace-tagline">{copy.workspaceTagline}</p>
        </div>
        <div className="hero-controls">
          <section className="status-bar" aria-label={copy.connectionStatusLabel}>
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
              {copy.webMcpLabel}{" "}
              {webMcpState === "checking"
                ? copy.checkingLabel
                : webMcpState === "available"
                  ? copy.availableLabel
                  : copy.unavailableMessage}
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
              {copy.backendLabel}{" "}
              {backendState === "checking"
                ? copy.checkingLabel
                : backendState === "connected"
                  ? copy.connectedLabel
                  : copy.errorLabel || "error"}
            </span>
            <span className="status-pill">
              <span className="status-dot" />
              {registeredCount} {copy.agentToolsRegisteredLabel}
            </span>
          </section>
          <label className="ui-select-label">
            {copy.uiLanguageLabel}
            <select
              value={uiLanguage}
              onChange={(event) =>
                setUiLanguage(event.target.value as WorkspaceLanguage)
              }
            >
              <option value="auto">{copy.autoLabel}</option>
              <option value="en">{copy.englishLabel}</option>
              <option value="zh-TW">{copy.traditionalChineseLabel}</option>
            </select>
          </label>
        </div>
      </section>

      {webMcpState === "unavailable" && (
        <p className="notice">{copy.unavailableMessage}</p>
      )}

      <section className="workspace-grid">
        <aside className="panel agent-panel">
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
              <span className="section-badge">
                {visibleAgentDefinitions.length}
              </span>
            </div>
            <div className="agent-list">
                {visibleAgentDefinitions.map((agent) => (
                  <button
                    key={agent.id}
                    className={`capability agent-card ${
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
              <span className="section-badge">{sourceCapabilityTools.length}</span>
            </div>
            {sourceCapabilityTools.length === 0 ? (
              <div className="empty-state">
                <p>{copy.noCapabilities}</p>
              </div>
            ) : (
              <div className="capability-list">
                {sourceCapabilityTools.map((tool) => (
                  <button
                    key={tool.name}
                    className={`capability source-capability-card ${
                      tool.name === selectedCapability ? "selected" : ""
                    }`}
                    onClick={() => {
                      setSelectedCapability(tool.name);
                      setManualMode("capability");
                    }}
                    type="button"
                  >
                    <div className="capability-head">
                      <div className="capability-head-copy">
                        <p
                          className="capability-name"
                          title={tool.label || tool.description || tool.name}
                        >
                          {tool.label ||
                            shortDescription(tool.description || tool.name, 60)}
                        </p>
                        <span className="capability-tech-name" title={tool.name}>
                          {tool.name}
                        </span>
                      </div>
                      <div
                        className="mode-segmented"
                        role="group"
                        aria-label={`Access mode for ${tool.name}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          className={`mode-segment ${
                            sourceAccessModes[tool.name] !== "direct" ? "active ask" : ""
                          }`}
                          aria-pressed={sourceAccessModes[tool.name] !== "direct"}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSourceMode(tool.name, "ask-only");
                          }}
                        >
                          ASK-ONLY
                        </button>
                        <button
                          type="button"
                          className={`mode-segment ${
                            sourceAccessModes[tool.name] === "direct" ? "active direct" : ""
                          }`}
                          aria-pressed={sourceAccessModes[tool.name] === "direct"}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSourceMode(tool.name, "direct");
                          }}
                        >
                          DIRECT
                        </button>
                      </div>
                    </div>
                    <p className="mode-help">
                      {sourceAccessModes[tool.name] === "direct"
                        ? copy.sourceModeDirectHelp
                        : copy.sourceModeAskOnlyHelp}
                    </p>
                    <p className="capability-desc">
                      {shortDescription(tool.description || copy.noDescriptionLabel)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="panel workspace-panel">
          <div className="panel-header">
            <h2 className="panel-title">{copy.liveWorkspace}</h2>
          </div>
          <div className="panel-body">
            {activeProposal && (
              <section className="proposal-banner" aria-live="polite">
                <div className="proposal-banner-copy">
                  <p className="run-label">{proposalsHeading}</p>
                  <h3 className="proposal-banner-title">{activeProposal.url}</h3>
                  <p className="proposal-banner-description">
                    {activeProposal.description}
                  </p>
                  <div className="proposal-banner-meta">
                    <span>
                      {sourceProposalLabel}: {activeProposal.proposedBy}
                    </span>
                    <span>{activeProposal.createdAt}</span>
                  </div>
                  {activeProposal.message && (
                    <p className="proposal-banner-message">
                      {activeProposal.message}
                    </p>
                  )}
                  {activeProposal.error && (
                    <p className="proposal-banner-error">{activeProposal.error}</p>
                  )}
                </div>
                <div className="proposal-banner-actions">
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => void approveProposal(activeProposal.id)}
                    disabled={activeProposal.status === "approving"}
                  >
                    {approveLabel}
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => rejectProposal(activeProposal.id)}
                  >
                    {rejectLabel}
                  </button>
                </div>
              </section>
            )}
            <div className="live-grid">
              <div className="run-card sent-card">
                {!currentInvocation ? (
                  <div className="empty-state">
                    <p className="empty-state-title">{copy.sentIdleTitle}</p>
                    <p className="empty-state-copy">{copy.sentIdleMessage}</p>
                  </div>
                ) : (
                  <>
                    <p className="run-label">{sentToAgentHeading}</p>
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
                        <strong>{copy.usedCapabilitiesLabel}</strong>
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
                      {currentInvocation.toolName ===
                      PROPOSE_DATA_SOURCE_TOOL_NAME
                        ? currentInvocation.status === "error"
                          ? currentInvocation.error ||
                            extractAnswerText(currentInvocation.result) ||
                            copy.waitingForBackendLabel
                          : extractAnswerText(currentInvocation.result) ||
                            currentInvocation.error ||
                            copy.waitingForBackendLabel
                        : currentInvocation.status === "running" ||
                            currentInvocation.status === "planning" ||
                            currentInvocation.status === "waiting"
                          ? copy.waitingForBackendLabel
                          : currentInvocation.toolName ===
                              ASK_DATA_SOURCE_TOOL_NAME
                            ? currentInvocation.status === "error"
                              ? currentInvocation.error ||
                                extractAnswerText(currentInvocation.result) ||
                                "—"
                              : extractAnswerText(currentInvocation.result) ||
                                currentInvocation.error ||
                                "—"
                            : formatJson(
                                currentInvocation.error ||
                                  currentInvocation.result ||
                                  null,
                              )}
                    </pre>
                    <p className="run-label" style={{ marginTop: 12 }}>
                      {copy.provenanceReceiptLabel}
                    </p>
                    <div className="kv">
                      <div className="kv-row">
                        <strong>{copy.sourceLabel}</strong>
                        <span>
                          {currentReceipt?.sourceName || copy.unverifiedLabel}
                        </span>
                      </div>
                      {currentReceipt?.sourceDescription && (
                        <div className="kv-row">
                          <strong>{copy.sourceDescriptionLabel}</strong>
                          <span>{currentReceipt.sourceDescription}</span>
                        </div>
                      )}
                      <div className="kv-row">
                        <strong>{modelBoundaryLabel}</strong>
                        <span>
                          {currentReceipt?.modelBoundary || copy.unverifiedLabel}
                        </span>
                      </div>
                      <div className="kv-row">
                        <strong>{recordsLabel}</strong>
                        <span>
                          {currentReceipt?.recordsConsulted ??
                            copy.unverifiedLabel}
                        </span>
                      </div>
                      <div className="kv-row">
                        <strong>{copy.verificationLabel}</strong>
                        <span>
                          {currentReceipt?.verifiedByBackend
                            ? verifiedLabel
                            : unverifiedLabel}
                          {currentReceipt?.extractedAt
                            ? ` · ${currentReceipt.extractedAt}`
                            : ""}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="run-card boundary-card">
                <p className="run-label">{boundaryHeading}</p>
                {hasBoundaryData ? (
                  <>
                    <p className="boundary-note">{boundaryNote}</p>
                    <p className="boundary-count">
                      {copy.recordsConsultedRowsLabel} {currentBoundaryRowCount} rows
                    </p>
                    <div className="kv">
                      <div className="kv-row">
                        <strong>{copy.sourceLabel}</strong>
                        <span>{currentBoundary?.sourceName || copy.unverifiedLabel}</span>
                      </div>
                      <div className="kv-row">
                        <strong>{copy.toolLabel}</strong>
                        <span>{currentInvocation?.toolName || "—"}</span>
                      </div>
                      <div className="kv-row">
                        <strong>{recordsLabel}</strong>
                        <span>
                          {currentBoundary?.recordsConsulted ??
                            currentReceipt?.recordsConsulted ??
                            copy.unverifiedLabel}
                        </span>
                      </div>
                      <div className="kv-row">
                        <strong>{modelBoundaryLabel}</strong>
                        <span>
                          {currentBoundary?.computedByOwnerConfiguredModel
                            ? copy.ownerConfiguredModelLabel
                            : copy.unverifiedLabel}
                        </span>
                      </div>
                      <div className="kv-row">
                        <strong>{copy.verificationLabel}</strong>
                        <span>
                          {currentBoundary?.verifiedByBackend
                            ? verifiedLabel
                            : unverifiedLabel}
                        </span>
                      </div>
                    </div>
                    <p className="run-label" style={{ marginTop: 14 }}>
                      {rawRowsLabel}
                    </p>
                    <div className="raw-rows-table-shell">
                      <table className="raw-rows-table">
                        <thead>
                          <tr>
                            {currentBoundaryTable.columns.map((column) => (
                              <th key={column.key} title={column.fullLabel}>
                                <span className="raw-rows-header-label">
                                  {column.label}
                                </span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {currentBoundaryTable.rows.map((row, rowIndex) => (
                            <tr key={`${rowIndex}-${row.extra.length}`}>
                              {currentBoundaryTable.columns.map((column) => (
                                <td key={column.key}>
                                  {column.key === "__more__" ? (
                                    row.extra.length > 0 ? (
                                      <span
                                        className="raw-rows-more"
                                        title={row.extra
                                          .map(([key, value]) => `${key}: ${value}`)
                                          .join(" · ")}
                                      >
                                        +{row.extra.length} more
                                        <span className="raw-rows-more-details">
                                          {row.extra
                                            .map(([key, value]) => `${key}: ${value}`)
                                            .join(" · ")}
                                        </span>
                                      </span>
                                    ) : (
                                      "—"
                                    )
                                  ) : (
                                    <span
                                      className="raw-rows-cell-value"
                                      title={row.cells[column.key] || "—"}
                                    >
                                      {row.cells[column.key] || "—"}
                                    </span>
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="empty-state boundary-empty-state">
                    <p className="empty-state-copy">{copy.boundaryIdleMessage}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="human-ask-bar">
              <label className="human-ask-field">
                <span className="human-ask-label">
                  {copy.humanAskSourceLabel}
                </span>
                <select
                  className="human-ask-select"
                  value={humanAskSourceId}
                  onChange={(event) => setHumanAskSourceId(event.target.value)}
                  disabled={askOnlySourceEntries.length === 0}
                >
                  <option value="">
                    {copy.selectSourcePlaceholder}
                  </option>
                  {askOnlySourceEntries.map((entry) => (
                    <option key={entry.jobId} value={entry.jobId}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="human-ask-field">
                <span className="human-ask-label">
                  {copy.humanAskQuestionLabel}
                </span>
                <input
                  className="human-ask-input"
                  value={humanAskQuestion}
                  onChange={(event) => setHumanAskQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                    }
                  }}
                  placeholder={copy.askInputPlaceholder}
                  disabled={humanAskLoading}
                />
              </label>
              <button
                className="btn primary human-ask-button"
                type="button"
                onClick={() => void runHumanAsk()}
                disabled={humanAskLoading || !humanAskSourceId || !humanAskQuestion.trim()}
              >
                {humanAskLoading
                  ? copy.workingLabel
                  : copy.humanAskButtonLabel}
              </button>
            </div>
            {humanAskError && <p className="error-text">{humanAskError}</p>}

            <div className="manual-workbench">
              <button
                className="manual-workbench-toggle"
                type="button"
                onClick={() => setManualWorkbenchOpen((current) => !current)}
                aria-expanded={manualWorkbenchOpen}
              >
                <span>{copy.manualInvocation}</span>
                <span className="manual-workbench-toggle-icon">
                  {manualWorkbenchOpen ? "▴" : "▾"}
                </span>
              </button>

              {manualWorkbenchOpen && (
                <div className="manual-workbench-content">
                  {proposals.length > 0 && (
                    <>
                      <p className="run-label" style={{ marginTop: 18 }}>
                        {proposalsHeading}
                      </p>
                      <div className="proposal-list">
                        {proposals.map((proposal) => (
                          <div key={proposal.id} className="proposal-card">
                            <div className="proposal-top">
                              <span className="proposal-url">{proposal.url}</span>
                              <span className={`history-status ${proposal.status}`}>
                                {proposal.status}
                              </span>
                            </div>
                            <p className="capability-desc">{proposal.description}</p>
                            <div className="capability-desc">
                              {sourceProposalLabel}: {proposal.proposedBy}
                            </div>
                            <div className="capability-desc">
                              {proposal.createdAt}
                              {proposal.toolRefreshDelayMs
                                ? ` · ${proposal.toolRefreshDelayMs}ms`
                                : ""}
                            </div>
                            {proposal.message && (
                              <div className="capability-desc">{proposal.message}</div>
                            )}
                            {proposal.error && (
                              <div className="error-text">{proposal.error}</div>
                            )}
                            {proposal.status === "pending" ||
                            proposal.status === "approving" ? (
                              <div className="actions" style={{ marginTop: 8 }}>
                                <button
                                  className="btn primary"
                                  type="button"
                                  onClick={() => void approveProposal(proposal.id)}
                                  disabled={proposal.status === "approving"}
                                >
                                  {approveLabel}
                                </button>
                                <button
                                  className="btn"
                                  type="button"
                                  onClick={() => rejectProposal(proposal.id)}
                                >
                                  {rejectLabel}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <p className="run-label" style={{ marginTop: 18 }}>
                    {copy.manualInvocation}
                  </p>
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
                      {copy.agentFormLabel}
                      <select
                        value={selectedAgentId}
                        onChange={(event) => setSelectedAgentId(event.target.value)}
                      >
                        {visibleAgentDefinitions.map((agent) => (
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
                          copy.describeTaskGoalPlaceholder
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
                        <option value="auto">{copy.autoLabel}</option>
                        <option value="en">{copy.englishLabel}</option>
                        <option value="zh-TW">{copy.traditionalChineseLabel}</option>
                      </select>
                    </label>

                    {selectedAgentId === "research_agent" ||
                    selectedAgentId === "monitor_agent" ||
                    selectedAgentId === "custom_agent" ? (
                      <label>
                        {copy.sourcesLabel}
                        <select
                          multiple
                          size={Math.min(6, Math.max(3, directSourceNames.length))}
                          value={agentDraft.sources}
                          onChange={(event) =>
                            setAgentDraft((current) => ({
                              ...current,
                              sources: readMultiSelect(event),
                            }))
                          }
                        >
                          {directSourceNames.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
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
                            <option value="">{copy.selectCapabilityPlaceholder}</option>
                            {sourceCapabilityTools.map((tool) => (
                              <option key={tool.name} value={tool.name}>
                              {tool.label || tool.name}
                            </option>
                          ))}
                          </select>
                        </label>
                        <label>
                          {copy.limitLabel}
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
                          {copy.nameLabel}
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
                            <option value="none">{copy.noneLabel}</option>
                            <option value="sensitive-actions">
                              {copy.sensitiveActionsLabel}
                            </option>
                            <option value="always">{copy.alwaysLabel}</option>
                          </select>
                        </label>
                      </>
                    ) : null}

                    {(selectedAgentId === "research_agent" ||
                      selectedAgentId === "monitor_agent") && (
                      <label>
                        {copy.maxSourcesLabel}
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
                      {copy.backendInputSchemaLabel}
                    </p>
                    <pre className="json-box">
                      {formatJson(selectedCapabilityDef.inputSchema || {})}
                    </pre>
                  </>
                )}

                {selectedAgentDef && manualMode === "agent" && (
                  <>
                    <p className="run-label" style={{ marginTop: 18 }}>
                      {copy.agentInstructionsLabel}
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
              )}
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
                      <div className="capability-desc">
                        {item.provenanceReceipt?.sourceName || copy.unverifiedLabel} ·{" "}
                        {item.provenanceReceipt?.verifiedByBackend
                          ? verifiedLabel
                          : unverifiedLabel}
                      </div>
                      {item.provenanceReceipt?.sourceDescription && (
                        <div className="capability-desc">
                          {item.provenanceReceipt.sourceDescription}
                        </div>
                      )}
                      {item.provenanceReceipt?.recordsConsulted !== undefined && (
                        <div className="capability-desc">
                          {recordsLabel} {item.provenanceReceipt.recordsConsulted}
                        </div>
                      )}
                      {item.toolName === PROPOSE_DATA_SOURCE_TOOL_NAME &&
                        item.provenanceReceipt?.modelBoundary && (
                          <div className="capability-desc">
                            {item.provenanceReceipt.modelBoundary}
                          </div>
                        )}
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
