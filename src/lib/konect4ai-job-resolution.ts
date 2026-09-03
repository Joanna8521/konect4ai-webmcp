export interface ScrapingJob {
  id?: string;
  url?: string;
  description?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ToolLike {
  name: string;
  description?: string;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

export function extractToolFragment(toolName: string): string {
  const match = toolName.match(/([0-9a-f]+)$/i);
  return match?.[1]?.toLowerCase() || "";
}

function scoreJobMatch(
  toolName: string,
  toolDescription: string,
  job: ScrapingJob,
): number {
  const normalizedToolDescription = normalize(toolDescription || "");
  const jobDescription = normalize(asString(job.description));
  const jobUrl = normalize(asString(job.url));
  const fragment = extractToolFragment(toolName);

  let score = 0;

  if (fragment) {
    const jobId = normalize(asString(job.id));
    if (jobId.startsWith(fragment)) {
      score += 100;
    }
    if (normalize(toolName).includes(fragment)) {
      score += 25;
    }
  }

  if (normalizedToolDescription && jobDescription) {
    if (normalizedToolDescription === jobDescription) {
      score += 80;
    } else if (
      normalizedToolDescription.includes(jobDescription) ||
      jobDescription.includes(normalizedToolDescription)
    ) {
      score += 50;
    } else {
      const toolTokens = new Set(
        normalizedToolDescription.split(/[^a-z0-9]+/i).filter(Boolean),
      );
      const jobTokens = new Set(jobDescription.split(/[^a-z0-9]+/i).filter(Boolean));
      let overlap = 0;
      for (const token of toolTokens) {
        if (jobTokens.has(token)) {
          overlap += 1;
        }
      }
      score += overlap * 5;
    }
  }

  if (normalizedToolDescription && jobUrl) {
    const urlTokens = jobUrl.split(/[^a-z0-9]+/i).filter(Boolean);
    if (urlTokens.some((token) => token && normalizedToolDescription.includes(token))) {
      score += 10;
    }
  }

  return score;
}

export function resolveJobIdFromToolName(
  toolNameOrJobId: string,
  jobs: ScrapingJob[],
  toolDescription = "",
): string | undefined {
  const trimmed = toolNameOrJobId.trim();
  if (!trimmed) return undefined;
  if (isUuid(trimmed)) return trimmed;

  const fragment = extractToolFragment(trimmed);
  if (fragment) {
    const fragmentMatches = jobs.filter((job) =>
      normalize(asString(job.id)).startsWith(fragment),
    );
    if (fragmentMatches.length === 1) {
      return asString(fragmentMatches[0].id) || undefined;
    }
    if (fragmentMatches.length > 1) {
      const bestFragmentMatches = fragmentMatches
        .map((job) => ({
          job,
          score: scoreJobMatch(trimmed, toolDescription, job) + 100,
        }))
        .sort((left, right) => right.score - left.score);
      if (bestFragmentMatches.length > 0) {
        const best = bestFragmentMatches[0];
        const tied = bestFragmentMatches.filter(
          (candidate) => candidate.score === best.score,
        );
        if (tied.length === 1) {
          return asString(best.job.id) || undefined;
        }
      }
    }
  }

  const scored = jobs
    .map((job) => ({
      job,
      score: scoreJobMatch(trimmed, toolDescription, job),
    }))
    .filter((candidate) => candidate.score > 0 && asString(candidate.job.id).length > 0)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) {
    return undefined;
  }

  const best = scored[0];
  const tied = scored.filter((candidate) => candidate.score === best.score);
  if (tied.length !== 1) {
    return undefined;
  }

  return asString(best.job.id) || undefined;
}

export function describeJob(job: ScrapingJob): string {
  const id = asString(job.id) || "unavailable";
  const label = asString(job.description) || asString(job.url) || id;
  return `${id} — ${label}`;
}

export function listJobDescriptions(jobs: ScrapingJob[]): string[] {
  return jobs
    .map((job) => describeJob(job))
    .filter((entry) => entry.length > 0);
}
