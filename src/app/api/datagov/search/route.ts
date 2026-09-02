import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface SearchBody {
  query?: unknown;
  limit?: unknown;
}

interface Distribution {
  format: string | null;
  mediaType: string | null;
  accessURL: string | null;
  downloadURL: string | null;
}

interface NormalizedDataset {
  title: string | null;
  description: string | null;
  publisher: string | null;
  organization: string | null;
  organizationType: string | null;
  modified: string | null;
  lastHarvested: string | null;
  landingPage: string | null;
  hasDownload: boolean;
  distributions: Distribution[];
  keywords: string[];
  theme: string[];
}

function clampLimit(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 5;
  return Math.min(20, Math.max(1, Math.trunc(numeric)));
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function stripHtml(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;

  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => text(item))
      .filter((item): item is string => Boolean(item));
  }
  const single = text(value);
  return single ? [single] : [];
}

function extrasMap(dataset: Record<string, unknown>): Record<string, unknown> {
  const extras = asArray(dataset.extras);
  const out: Record<string, unknown> = {};

  for (const entry of extras) {
    const item = asObject(entry);
    const key = text(item.key);
    if (key) out[key] = item.value;
  }

  return out;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return null;
}

function normalizeDistribution(resource: unknown): Distribution | null {
  const item = asObject(resource);
  const accessURL = firstText(
    item.accessURL,
    item.access_url,
    item.accessUrl,
    item.url,
  );
  const downloadURL = firstText(
    item.downloadURL,
    item.download_url,
    item.downloadUrl,
  );

  if (!accessURL && !downloadURL) return null;

  return {
    format: firstText(item.format, item.format_label),
    mediaType: firstText(item.mediaType, item.media_type, item.mimetype),
    accessURL,
    downloadURL,
  };
}

function normalizeDataset(value: unknown): NormalizedDataset {
  const dataset = asObject(value);
  const dcat = asObject(dataset.dcat);
  const extras = extrasMap(dataset);
  const org = asObject(dataset.organization);
  const publisherObj = asObject(dcat.publisher || dataset.publisher);
  const resources = asArray(
    dcat.distribution ||
      dataset.distribution ||
      dataset.distributions ||
      dataset.resources,
  )
    .map(normalizeDistribution)
    .filter((item): item is Distribution => Boolean(item))
    .slice(0, 8);

  const keywords = [
    ...stringArray(dcat.keyword),
    ...stringArray(dataset.keyword),
    ...stringArray(dataset.keywords),
    ...stringArray(dataset.tags).map((tag) => tag),
    ...asArray(dataset.tags)
      .map((tag) => text(asObject(tag).name))
      .filter((tag): tag is string => Boolean(tag)),
  ];

  return {
    title: firstText(dcat.title, dataset.title, dataset.name),
    description: stripHtml(
      dcat.description || dataset.description || dataset.notes || extras.description,
    ),
    publisher: firstText(
      publisherObj.name,
      publisherObj.title,
      dcat.publisher,
      dataset.publisher,
      extras.publisher,
      extras.publisher_name,
    ),
    organization: firstText(
      org.title,
      org.name,
      dataset.organization,
      extras.organization,
    ),
    organizationType: firstText(
      org.type,
      org.organization_type,
      dataset.organizationType,
      dataset.organization_type,
      extras.organization_type,
      extras.organizationType,
    ),
    modified: firstText(
      dcat.modified,
      dataset.modified,
      dataset.metadata_modified,
      extras.modified,
      extras.metadata_modified,
    ),
    lastHarvested: firstText(
      dataset.lastHarvested,
      dataset.last_harvested,
      dataset.last_harvested_date,
      extras.last_harvested,
    ),
    landingPage: firstText(
      dcat.landingPage,
      dataset.landingPage,
      dataset.landing_page,
      dataset.url,
      extras.landingPage,
      extras.landing_page,
    ),
    hasDownload:
      dataset.has_download === true ||
      resources.some((resource) => Boolean(resource.downloadURL)),
    distributions: resources,
    keywords: Array.from(new Set(keywords)).slice(0, 20),
    theme: stringArray(dcat.theme || dataset.theme || extras.theme).slice(0, 12),
  };
}

function extractResults(payload: unknown): unknown[] {
  const root = asObject(payload);
  const result = asObject(root.result);

  return asArray(
    root.results ||
      root.datasets ||
      root.data ||
      result.results ||
      result.datasets ||
      result.data,
  );
}

export async function POST(request: NextRequest) {
  let body: SearchBody;
  try {
    body = (await request.json()) as SearchBody;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const query = text(body.query);
  if (!query) {
    return NextResponse.json({ error: "query is required." }, { status: 400 });
  }

  const limit = clampLimit(body.limit);
  const apiKey = process.env.DATAGOV_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "DATAGOV_API_KEY is required.",
        code: "DATAGOV_API_KEY_MISSING",
      },
      { status: 503 },
    );
  }

  const url = new URL("https://api.gsa.gov/technology/datagov/v4/search");
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", String(limit));

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Api-Key": apiKey,
    },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return NextResponse.json(
      {
        error: `Data.gov search failed with status ${response.status}.`,
        details: stripHtml(asObject(payload).message),
      },
      { status: response.status },
    );
  }

  const datasets = extractResults(payload).slice(0, limit).map(normalizeDataset);

  return NextResponse.json({
    query,
    limit,
    count: datasets.length,
    datasets,
  });
}
