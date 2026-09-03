import { NextResponse } from "next/server";
import { resolveJobIdFromToolName as resolveJobIdFromToolNameInJobs } from "@/lib/konect4ai-job-resolution";
import {
  registerKnownSourceJob,
  linkToolNameToJobId,
  resolveJobIdForToolName,
} from "@/lib/konect4ai-source-registry";

export const dynamic = "force-dynamic";

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpListResponse {
  result?: {
    tools?: McpTool[];
  };
  error?: {
    code?: number;
    message?: string;
  };
}

interface ScrapingJob {
  id?: string;
  url?: string;
  description?: string;
  status?: string;
  [key: string]: unknown;
}

interface ScrapingJobsResponse {
  jobs?: ScrapingJob[];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function sanitizeDescription(description: string): string {
  const withoutSourceSuffix = description
    .replace(/\s*[（(]\s*來源\s*[:：].*?[）)]\s*$/gi, "")
    .replace(/\s*[（(]\s*source\s*[:：].*?[）)]\s*$/gi, "");

  return withoutSourceSuffix
    .replace(/https?:\/\/[^\s)）]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractToolFragment(toolName: string): string {
  const match = toolName.match(/([0-9a-f]+)$/i);
  return match?.[1]?.toLowerCase() || "";
}

function scoreJobMatch(tool: McpTool, job: ScrapingJob): number {
  const toolDescription = normalize(tool.description || "");
  const jobDescription = normalize(asString(job.description));
  const jobUrl = normalize(asString(job.url));
  const fragment = extractToolFragment(tool.name);

  let score = 0;

  if (fragment) {
    const jobId = normalize(asString(job.id));
    if (jobId.startsWith(fragment)) {
      score += 100;
    }
    if (normalize(tool.name).includes(fragment)) {
      score += 25;
    }
  }

  if (toolDescription && jobDescription) {
    if (toolDescription === jobDescription) {
      score += 80;
    } else if (
      toolDescription.includes(jobDescription) ||
      jobDescription.includes(toolDescription)
    ) {
      score += 50;
    } else {
      const toolTokens = new Set(toolDescription.split(/[^a-z0-9]+/i).filter(Boolean));
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

  if (toolDescription && jobUrl) {
    const urlTokens = jobUrl.split(/[^a-z0-9]+/i).filter(Boolean);
    if (urlTokens.some((token) => token && toolDescription.includes(token))) {
      score += 10;
    }
  }

  return score;
}

function resolveJobIdFromJobs(tool: McpTool, jobs: ScrapingJob[]): string | undefined {
  const candidates = jobs
    .map((job) => ({
      job,
      score: scoreJobMatch(tool, job),
    }))
    .filter((candidate) => candidate.score > 0 && asString(candidate.job.id).length > 0)
    .sort((left, right) => right.score - left.score);

  if (candidates.length === 0) {
    return undefined;
  }

  const best = candidates[0];
  const tied = candidates.filter((candidate) => candidate.score === best.score);
  if (tied.length !== 1) {
    return undefined;
  }

  return asString(best.job.id) || undefined;
}

function env() {
  const apiBase = process.env.KONECT4AI_API_BASE?.replace(/\/+$/, "");
  const licenseKey = process.env.KONECT4AI_DEMO_LICENSE_KEY;
  const userToken = process.env.KONECT4AI_USER_TOKEN;

  if (!apiBase || !licenseKey) {
    return {
      error:
        "Server is missing KONECT4AI_API_BASE or KONECT4AI_DEMO_LICENSE_KEY.",
    };
  }

  return { apiBase, licenseKey, userToken };
}

async function fetchScrapingJobs(
  apiBase: string,
  userToken: string,
): Promise<ScrapingJob[]> {
  const response = await fetch(`${apiBase}/api/v1/scraping/jobs`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `scraping/jobs returned ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json().catch(() => null)) as
    | ScrapingJobsResponse
    | null;

  return Array.isArray(payload?.jobs) ? payload.jobs : [];
}

export async function GET() {
  const config = env();
  if ("error" in config) {
    return NextResponse.json({ error: config.error }, { status: 500 });
  }

  const response = await fetch(
    `${config.apiBase}/mcp/${encodeURIComponent(config.licenseKey)}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "webmcp-tools",
        method: "tools/list",
      }),
      cache: "no-store",
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | McpListResponse
    | null;

  if (!response.ok) {
    return NextResponse.json(
      {
        error:
          payload?.error?.message ||
          `Konect4AI tools/list failed with status ${response.status}.`,
      },
      { status: response.status },
    );
  }

  if (payload?.error) {
    return NextResponse.json(
      {
        error: payload.error.message || "Konect4AI tools/list returned an error.",
        code: payload.error.code,
      },
      { status: 502 },
    );
  }

  let jobs: ScrapingJob[] = [];
  if (config.userToken) {
    try {
      jobs = await fetchScrapingJobs(config.apiBase, config.userToken);
    } catch (error) {
      console.warn(
        "Konect4AI scraping/jobs lookup failed; falling back to cached job mapping.",
        error instanceof Error ? error.message : String(error),
      );
    }
  } else {
    console.warn(
      "Konect4AI scraping/jobs lookup skipped because KONECT4AI_USER_TOKEN is missing.",
    );
  }

  const tools = (payload?.result?.tools || []).map((tool) => ({
    name: tool.name,
    description: sanitizeDescription(tool.description || ""),
    inputSchema: tool.inputSchema,
    jobId:
      resolveJobIdForToolName(tool.name) ||
      resolveJobIdFromToolNameInJobs(tool.name, jobs, tool.description || ""),
  }));

  for (const tool of tools) {
    if (tool.jobId) {
      linkToolNameToJobId(tool.name, tool.jobId);
      registerKnownSourceJob(tool.jobId, {
        sourceDescription: tool.description,
        toolName: tool.name,
      });
    }
  }

  return NextResponse.json({ tools });
}
