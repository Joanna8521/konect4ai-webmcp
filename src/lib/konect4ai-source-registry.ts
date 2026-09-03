interface KnownSourceJob {
  jobId: string;
  sourceName?: string;
  sourceUrl?: string;
  sourceDescription?: string;
  toolName?: string;
}

const knownJobsById = new Map<string, KnownSourceJob>();
const knownJobIdByToolName = new Map<string, string>();

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function isUuidPrefixMatch(toolName: string, jobId: string): boolean {
  const prefix = normalize(jobId).slice(0, 8);
  return prefix.length > 0 && normalize(toolName).includes(prefix);
}

export function registerKnownSourceJob(
  jobId: string,
  metadata?: {
    sourceName?: string;
    sourceUrl?: string;
    sourceDescription?: string;
    toolName?: string;
  },
): void {
  const trimmedJobId = jobId.trim();
  if (!trimmedJobId) return;

  const existing = knownJobsById.get(trimmedJobId) || { jobId: trimmedJobId };
  knownJobsById.set(trimmedJobId, {
    ...existing,
    ...metadata,
    jobId: trimmedJobId,
  });
}

export function linkToolNameToJobId(toolName: string, jobId: string): void {
  const trimmedToolName = toolName.trim();
  const trimmedJobId = jobId.trim();
  if (!trimmedToolName || !trimmedJobId) return;

  knownJobIdByToolName.set(trimmedToolName, trimmedJobId);
  registerKnownSourceJob(trimmedJobId, { toolName: trimmedToolName });
}

export function resolveJobIdForToolName(toolName: string): string | undefined {
  const trimmedToolName = toolName.trim();
  if (!trimmedToolName) return undefined;

  const known = knownJobIdByToolName.get(trimmedToolName);
  if (known) return known;

  for (const [jobId, record] of knownJobsById.entries()) {
    if (record.toolName === trimmedToolName || isUuidPrefixMatch(trimmedToolName, jobId)) {
      knownJobIdByToolName.set(trimmedToolName, jobId);
      return jobId;
    }
  }

  return undefined;
}

export function listKnownSourceJobs(): KnownSourceJob[] {
  return [...knownJobsById.values()].sort((left, right) =>
    left.sourceName && right.sourceName
      ? left.sourceName.localeCompare(right.sourceName)
      : left.jobId.localeCompare(right.jobId),
  );
}
