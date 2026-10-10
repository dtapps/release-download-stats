import type { FetchLike, ProviderStats } from "./types";

/**
 * CNB documents release assets with download_count, but endpoint paths and
 * response envelopes can vary by API operation. Configure the exact Releases
 * API URL copied from CNB's current OpenAPI docs instead of guessing a route.
 *
 * This parser accepts either an array or a paginated object with a common
 * data/items/releases/results array. Nested release assets are summed.
 */
type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findArray(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!isObject(payload)) return null;
  for (const key of ["releases", "items", "results", "data"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
    if (isObject(value)) {
      const nested = findArray(value);
      if (nested) return nested;
    }
  }
  return null;
}

function sumAssets(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + sumAssets(item), 0);
  if (!isObject(value)) return 0;

  let sum = 0;
  const assets = value.assets;
  if (Array.isArray(assets)) {
    for (const asset of assets) {
      if (!isObject(asset)) continue;
      const count = asset.download_count;
      if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
        sum += Math.trunc(count);
      }
    }
  }
  // Also tolerate API envelopes whose release list is nested.
  for (const key of ["releases", "items", "results", "data"]) {
    const nested = value[key];
    if (Array.isArray(nested) || isObject(nested)) sum += sumAssets(nested);
  }
  return sum;
}

export async function fetchCNBDownloads(
  releasesUrl: string,
  token: string | undefined,
  fetcher: FetchLike = fetch,
): Promise<ProviderStats> {
  if (!releasesUrl) throw new Error("CNB_RELEASES_URL must be set to the verified CNB Releases API endpoint");
  const url = new URL(releasesUrl);
  if (url.protocol !== "https:") throw new Error("CNB_RELEASES_URL must use HTTPS");

  const headers = new Headers({ Accept: "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetcher(url, { headers });
  if (!response.ok) throw new Error(`CNB API returned HTTP ${response.status}`);

  const payload: unknown = await response.json();
  if (!findArray(payload)) {
    throw new Error("Unexpected CNB response: configure the Releases API endpoint whose response contains a release array");
  }

  return {
    downloads: sumAssets(payload),
    updatedAt: new Date().toISOString(),
    source: "CNB Releases API",
  };
}