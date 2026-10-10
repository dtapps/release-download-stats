import type { FetchLike, ProviderStats } from "./types";

const CNB_API_BASE = "https://api.cnb.cool";
type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findReleaseArray(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!isObject(payload)) return null;
  for (const key of ["releases", "items", "results", "data"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
    if (isObject(value)) {
      const nested = findReleaseArray(value);
      if (nested) return nested;
    }
  }
  return null;
}

function sumReleaseAssets(release: unknown): number {
  if (!isObject(release) || !Array.isArray(release.assets)) return 0;
  let total = 0;
  for (const asset of release.assets) {
    if (!isObject(asset)) continue;
    const count = asset.download_count;
    if (typeof count === "number" && Number.isFinite(count) && count >= 0) total += Math.trunc(count);
  }
  return total;
}

function getTotalCount(headers: Headers): number | undefined {
  // CNB's list APIs return pagination metadata in response headers. Support
  // common header names; if none is present, use page length to find the end.
  for (const name of ["X-Total-Count", "X-Total", "Total-Count", "X-Total-Elements"]) {
    const raw = headers.get(name);
    if (raw && /^\d+$/.test(raw.trim())) return Number(raw);
  }
  return undefined;
}

function nextLink(headers: Headers): string | null {
  const link = headers.get("Link") ?? headers.get("link");
  if (!link) return null;
  const match = link.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
  return match?.[1] ?? null;
}

/**
 * CNB API base is fixed at https://api.cnb.cool.
 * ListReleases is GET /{repo}/-/releases with page/page_size pagination.
 */
export async function fetchCNBDownloads(
  repository: string,
  token: string | undefined,
  fetcher: FetchLike = fetch,
): Promise<ProviderStats> {
  const parts = repository.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length < 2 || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("CNB repository must use namespace/repository path format");
  }

  const headers = new Headers({ Accept: "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const encodedPath = parts.map(encodeURIComponent).join("/");
  let url = new URL(`/${encodedPath}/-/releases`, CNB_API_BASE);
  url.searchParams.set("page", "1");
  url.searchParams.set("page_size", "100");

  let page = 1;
  let totalDownloads = 0;
  let expectedTotal: number | undefined;
  while (true) {
    const response = await fetcher(url, { headers });
    if (!response.ok) throw new Error(`CNB ListReleases returned HTTP ${response.status} on page ${page}`);

    const releases = findReleaseArray(await response.json());
    if (!releases) throw new Error("Unexpected CNB ListReleases response: expected a release array");
    if (expectedTotal === undefined) expectedTotal = getTotalCount(response.headers);

    for (const release of releases) totalDownloads += sumReleaseAssets(release);

    const next = nextLink(response.headers);
    if (next) {
      const nextUrl = new URL(next, CNB_API_BASE);
      if (nextUrl.origin !== CNB_API_BASE) throw new Error("CNB pagination link points outside api.cnb.cool");
      url = nextUrl;
    } else if (expectedTotal !== undefined) {
      const seen = page * 100;
      if (seen >= expectedTotal || releases.length === 0) break;
      page += 1;
      url = new URL(`/${encodedPath}/-/releases`, CNB_API_BASE);
      url.searchParams.set("page", String(page));
      url.searchParams.set("page_size", "100");
    } else if (releases.length >= 100) {
      page += 1;
      if (page > 100) throw new Error("CNB release pagination exceeded 100 pages; refusing a potentially incomplete total");
      url = new URL(`/${encodedPath}/-/releases`, CNB_API_BASE);
      url.searchParams.set("page", String(page));
      url.searchParams.set("page_size", "100");
    } else {
      break;
    }
    if (page > 100) throw new Error("CNB release pagination exceeded 100 pages; refusing a potentially incomplete total");
  }

  return {
    downloads: totalDownloads,
    updatedAt: new Date().toISOString(),
    source: "CNB ListReleases API",
  };
}