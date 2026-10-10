import { renderBadge, formatCount } from "./badge";
import { fetchGitHubDownloads } from "./github";
import { fetchCNBDownloads } from "./cnb";
import type { KVStore, RepositorySnapshot, StatsConfig, StatsSnapshot, RepositoryTarget } from "./types";

export const SNAPSHOT_KEY = "release-download-stats:v2";
const REPOSITORY_KEY_PREFIX = "release-download-stats:v2:repo:";

type ServiceConfig = StatsConfig & { syncSecret?: string };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function repositoryKey(id: string): string {
  return REPOSITORY_KEY_PREFIX + id;
}

async function syncOne(kv: KVStore, config: StatsConfig, target: RepositoryTarget): Promise<RepositorySnapshot> {
  const key = repositoryKey(target.id);
  let previous: RepositorySnapshot | null = null;
  const cached = await kv.get(key);
  if (cached) {
    try { previous = JSON.parse(cached) as RepositorySnapshot; } catch { /* overwrite invalid cache on success */ }
  }

  try {
    // When configured, the first-party counter is authoritative. Provider APIs
    // are only a fallback for deployments that do not supply their own counter.
    const stats = config.getOwnDownloadCount
      ? {
          downloads: await config.getOwnDownloadCount(target),
          updatedAt: new Date().toISOString(),
          source: "First-party download proxy (D1)",
        }
      : target.provider === "github"
        ? await fetchGitHubDownloads(target.repository, config.githubToken, fetch, config.githubApiBase)
        : await fetchCNBDownloads(target.repository, config.cnbToken);
    const snapshot: RepositorySnapshot = {
      schemaVersion: 1,
      id: target.id,
      provider: target.provider,
      repository: target.repository,
      downloads: stats.downloads,
      updatedAt: stats.updatedAt,
      source: stats.source,
    };
    await kv.put(key, JSON.stringify(snapshot), { expirationTtl: config.cacheTtlSeconds ?? 60 * 60 * 24 * 30 });
    return snapshot;
  } catch (error) {
    if (previous && typeof previous.downloads === "number" &&
      (!config.getOwnDownloadCount || previous.source === "First-party download proxy (D1)")) {
      return { ...previous, warning: String(error) };
    }
    throw new Error(`${target.id} (${target.provider}:${target.repository}): ${String(error)}`);
  }
}

export async function syncStats(kv: KVStore, config: StatsConfig): Promise<StatsSnapshot> {
  const results: RepositorySnapshot[] = await Promise.all(config.repositories.map(async (target) => {
    try {
      return await syncOne(kv, config, target);
    } catch (error) {
      return {
        schemaVersion: 1,
        id: target.id,
        provider: target.provider,
        repository: target.repository,
        downloads: null,
        updatedAt: "",
        source: target.provider === "github" ? "GitHub Releases API" : "CNB Releases API",
        warning: String(error),
      };
    }
  }));

  const warnings = results.filter((item) => item.warning).map((item) => `${item.id}: ${item.warning}`);
  const snapshot: StatsSnapshot = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    repositories: results,
    totalDownloads: results.reduce((sum, item) => sum + (typeof item.downloads === "number" ? item.downloads : 0), 0),
    warnings,
  };
  await kv.put(SNAPSHOT_KEY, JSON.stringify(snapshot), { expirationTtl: config.cacheTtlSeconds ?? 60 * 60 * 24 * 30 });
  return snapshot;
}

export async function handleRequest(request: Request, kv: KVStore, config: ServiceConfig): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") return json({ ok: true });

  if (url.pathname === "/sync") {
    if (!config.syncSecret || request.headers.get("authorization") !== `Bearer ${config.syncSecret}`) {
      return json({ error: "Unauthorized" }, 401);
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
    }
    try { return json(await syncStats(kv, config)); }
    catch (error) { return json({ error: String(error) }, 502); }
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  const path = url.pathname.replace(/^\/+|\/+$/g, "");
  if (path === "repositories.json") {
    const values = await Promise.all(config.repositories.map(async (target) => {
      const value = await kv.get(repositoryKey(target.id));
      if (!value) return { id: target.id, provider: target.provider, repository: target.repository, downloads: null };
      try { return JSON.parse(value) as RepositorySnapshot; }
      catch { return { id: target.id, provider: target.provider, repository: target.repository, downloads: null }; }
    }));
    return json({ repositories: values });
  }
  if (path === "stats.json") {
    const stored = await kv.get(SNAPSHOT_KEY);
    if (!stored) return json({ error: "尚未同步统计数据，请调用 POST /sync" }, 503);
    return json(JSON.parse(stored));
  }

  if (path === "" || path === "total") {
    const snapshots = await Promise.all(config.repositories.map(async (target) => {
      const value = await kv.get(repositoryKey(target.id));
      if (!value) return null;
      try { return JSON.parse(value) as RepositorySnapshot; } catch { return null; }
    }));
    const ready = snapshots.filter((item): item is RepositorySnapshot => item !== null && typeof item.downloads === "number");
    if (ready.length === 0) return json({ error: "尚未同步统计数据，请调用 POST /sync" }, 503);
    const total = ready.reduce((sum, item) => sum + item.downloads!, 0);
    const svg = renderBadge("total downloads", formatCount(total), "blue");
    return new Response(request.method === "HEAD" ? null : svg, { headers: badgeHeaders() });
  }

  const badgeMatch = path.match(/^badge\/([A-Za-z0-9][A-Za-z0-9._-]{0,79})$/);
  const statsMatch = path.match(/^stats\/([A-Za-z0-9][A-Za-z0-9._-]{0,79})\.json$/);
  const id = badgeMatch?.[1] ?? statsMatch?.[1];
  if (id) {
    const target = config.repositories.find((item) => item.id === id);
    if (!target) return new Response("未配置此仓库 ID。请查看 /repositories.json。", { status: 404 });
    const value = await kv.get(repositoryKey(id));
    if (!value) return json({ error: `仓库 ${id} 尚未成功同步` }, 503);
    let snapshot: RepositorySnapshot;
    try { snapshot = JSON.parse(value) as RepositorySnapshot; }
    catch { return json({ error: "缓存数据损坏" }, 500); }
    if (statsMatch) return json(snapshot);
    if (typeof snapshot.downloads !== "number") return json({ error: `仓库 ${id} 尚未成功同步` }, 503);
    const label = target.provider === "github" ? "GitHub downloads" : "CNB downloads";
    const svg = renderBadge(label, formatCount(snapshot.downloads), target.provider === "cnb" ? "green" : "blue");
    return new Response(request.method === "HEAD" ? null : svg, { headers: badgeHeaders() });
  }

  return new Response("路径不存在。使用 /badge/:id、/stats/:id.json、/repositories.json、/total 或 /sync。", { status: 404 });
}

function badgeHeaders(): HeadersInit {
  return {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": "public, max-age=300, s-maxage=300",
    "access-control-allow-origin": "*",
  };
}