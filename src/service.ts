import { renderBadge, formatCount } from "./badge";
import { fetchGitHubDownloads } from "./github";
import { fetchCNBDownloads } from "./cnb";
import type { KVStore, StatsConfig, StatsSnapshot } from "./types";

export const SNAPSHOT_KEY = "release-download-stats:v1";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function syncStats(kv: KVStore, config: StatsConfig): Promise<StatsSnapshot> {
  const [githubResult, cnbResult] = await Promise.allSettled([
    fetchGitHubDownloads(config.repository, config.githubToken),
    config.cnbReleasesUrl
      ? fetchCNBDownloads(config.cnbReleasesUrl, config.cnbToken)
      : Promise.reject(new Error("CNB_RELEASES_URL is not configured")),
  ]);

  const previousText = await kv.get(SNAPSHOT_KEY);
  const previous = previousText ? JSON.parse(previousText) as StatsSnapshot : null;
  const github = githubResult.status === "fulfilled" ? githubResult.value : previous?.github ?? null;
  const cnb = cnbResult.status === "fulfilled" ? cnbResult.value : previous?.cnb ?? null;
  const warnings: string[] = [];
  if (githubResult.status === "rejected") warnings.push(`github: ${String(githubResult.reason)}`);
  if (cnbResult.status === "rejected") warnings.push(`cnb: ${String(cnbResult.reason)}`);

  if (!github && !cnb) {
    throw new Error(`Unable to collect any provider stats: ${warnings.join("; ")}`);
  }

  const snapshot: StatsSnapshot = {
    schemaVersion: 1,
    repository: config.repository,
    github,
    cnb,
    total: (github?.downloads ?? 0) + (cnb?.downloads ?? 0),
    updatedAt: new Date().toISOString(),
    warnings,
  };
  await kv.put(SNAPSHOT_KEY, JSON.stringify(snapshot), {
    expirationTtl: config.cacheTtlSeconds ?? 60 * 60 * 24 * 30,
  });
  return snapshot;
}

export async function handleRequest(request: Request, kv: KVStore, config: StatsConfig): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") return json({ ok: true });
  if (url.pathname === "/sync") {
    const secret = (config as StatsConfig & { syncSecret?: string }).syncSecret;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return json({ error: "Unauthorized" }, 401);
    }
    try { return json(await syncStats(kv, config)); }
    catch (error) { return json({ error: String(error) }, 502); }
  }

  const stored = await kv.get(SNAPSHOT_KEY);
  if (!stored) {
    return new Response("Statistics have not been synchronized yet. Trigger the scheduled sync or call /sync.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  let snapshot: StatsSnapshot;
  try { snapshot = JSON.parse(stored) as StatsSnapshot; }
  catch { return json({ error: "Invalid cached statistics" }, 500); }

  const kind = url.pathname.replace(/^\/+|\/+$/g, "") || "total";
  let count: number;
  let label: string;
  if (kind === "total") { count = snapshot.total; label = "downloads"; }
  else if (kind === "github") { count = snapshot.github?.downloads ?? 0; label = "GitHub"; }
  else if (kind === "cnb") { count = snapshot.cnb?.downloads ?? 0; label = "CNB"; }
  else if (kind === "stats.json") return json(snapshot);
  else return new Response("Not found. Use /total, /github, /cnb, or /stats.json.", { status: 404 });

  const svg = renderBadge(label, formatCount(count), kind === "cnb" ? "green" : "blue");
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
      "access-control-allow-origin": "*",
    },
  });
}