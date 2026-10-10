import { getStore } from "@edgeone/pages-blob";
import { formatCount, renderBadge } from "../src/badge";
import { renderHomePage } from "../src/homepage";

const blob = getStore("release-download-stats");
const ALLOWED_HOSTS = new Set([
  "cnb.cool",
  "github.com",
  "gitea.com",
  "gitlab.com",
  "gitee.com",
  "gitcode.com",
]);

type Counter = {
  platform: string;
  repository: string;
  downloads: number;
  firstRequestedAt: string;
  lastRequestedAt: string;
};

async function readCounter(key: string): Promise<Counter | null> {
  const value = await blob.get(key, { type: "text", consistency: "strong" });
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as Counter;
    return typeof parsed.downloads === "number" ? parsed : null;
  } catch {
    return null;
  }
}

async function increment(key: string, platform: string, repository: string): Promise<void> {
  const now = new Date().toISOString();
  const previous = await readCounter(key);
  const next: Counter = {
    platform,
    repository,
    downloads: (previous?.downloads ?? 0) + 1,
    firstRequestedAt: previous?.firstRequestedAt ?? now,
    lastRequestedAt: now,
  };
  await blob.set(key, JSON.stringify(next));
}

function parseTarget(url: URL): URL | null {
  if (!url.pathname.startsWith("/https://")) return null;
  let target: URL;
  try {
    target = new URL(url.pathname.slice(1) + url.search);
  } catch {
    return null;
  }
  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname.toLowerCase())) return null;
  if (target.username || target.password || target.port || target.pathname === "/") return null;
  return target;
}

function repositoryPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  try {
    return "/" + segments.slice(0, 2).map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function badge(svg: string, method: string): Response {
  return new Response(method === "HEAD" ? null : svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=60",
      "access-control-allow-origin": "*",
    },
  });
}

function parseBadgePath(pathname: string): { platform: string; repository: string; isJson: boolean } | null {
  const match = pathname.match(/^\/(badge|stats)\/(github\.com|cnb\.cool|gitea\.com|gitlab\.com|gitee\.com|gitcode\.com)\/([^/]+)\/([^/]+?)(\.json)?\/?$/);
  if (!match) return null;
  try {
    const owner = decodeURIComponent(match[3]);
    const name = decodeURIComponent(match[4]);
    if (!owner || !name || owner === "." || owner === ".." || name === "." || name === "..") return null;
    return {
      platform: match[2].toLowerCase(),
      repository: `/${owner}/${name}`,
      isJson: match[1] === "stats" || Boolean(match[5]),
    };
  } catch {
    return null;
  }
}

export async function onRequest(context: { request: Request }): Promise<Response> {
  const request = context.request;
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    try {
      await blob.get("stats:total", { type: "text", consistency: "strong" });
      return json({ ok: true, storage: "EdgeOne Blob", status: "healthy" });
    } catch (error) {
      console.error("Health check failed", error);
      return json({ ok: false, storage: "EdgeOne Blob", status: "unavailable" }, 503);
    }
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  if (url.pathname === "/shields.json") {
    try {
      const platform = (url.searchParams.get("platform") ?? "").trim().toLowerCase();
      const repositoryParam = (url.searchParams.get("repository") ?? "").trim();
      let downloads: number;
      if (platform || repositoryParam) {
        const match = repositoryParam.match(/^\/?([^/]+)\/([^/]+)\/?$/);
        if (!ALLOWED_HOSTS.has(platform) || !match || [match[1], match[2]].some(part => part === "." || part === "..")) {
          return json({ error: "Invalid repository; provide platform and repository, e.g. platform=github.com&repository=/owner/repo" }, 400);
        }
        const repository = `/${match[1]}/${match[2]}`;
        const value = await readCounter(`stats:repo:${platform}:${repository}`);
        downloads = value?.downloads ?? 0;
      } else {
        const total = await readCounter("stats:total");
        downloads = total?.downloads ?? 0;
      }
      const label = (url.searchParams.get("label") ?? "下载请求数").trim().slice(0, 80) || "下载请求数";
      const requestedColor = (url.searchParams.get("color") ?? "blue").trim();
      const color = /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|[a-zA-Z][a-zA-Z0-9-]{0,31})$/.test(requestedColor)
        ? requestedColor
        : "blue";
      return json({ schemaVersion: 1, label, message: formatCount(downloads), color });
    } catch (error) {
      console.error("Shields JSON query failed", error);
      return json({ error: "Stats query failed" }, 500);
    }
  }

  if (url.pathname === "/" || url.pathname === "/total") {
    // The total is updated alongside each successful GET proxy request.
    let totalDownloads = 0;
    let storageOk = true;
    try {
      const total = await readCounter("stats:total");
      totalDownloads = total?.downloads ?? 0;
    } catch (error) {
      storageOk = false;
      console.error("Homepage stats query failed", error);
    }
    if (url.pathname === "/total") {
      if (!storageOk) return json({ error: "Stats storage unavailable" }, 503);
      return badge(renderBadge("proxy downloads", formatCount(totalDownloads), "blue"), request.method);
    }
    return new Response(renderHomePage({
      baseUrl: url.origin,
      platform: "EdgeOne Pages + Blob",
      storageOk,
      totalDownloads,
    }), {
      status: storageOk ? 200 : 503,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const badgeTarget = parseBadgePath(url.pathname);
  if (badgeTarget) {
    const key = `stats:repo:${badgeTarget.platform}:${badgeTarget.repository}`;
    const value = await readCounter(key);
    const snapshot = {
      platform: badgeTarget.platform,
      repository: badgeTarget.repository,
      downloads: value?.downloads ?? 0,
      source: "First-party download proxy (EdgeOne Blob)",
      firstRequestedAt: value?.firstRequestedAt ?? null,
      lastRequestedAt: value?.lastRequestedAt ?? null,
    };
    if (badgeTarget.isJson) return json(snapshot);
    return badge(renderBadge("proxy downloads", formatCount(snapshot.downloads), badgeTarget.platform === "cnb.cool" ? "green" : "blue"), request.method);
  }

  const target = parseTarget(url);
  if (!target) return json({ error: "Not found or invalid target URL", allowed_hosts: [...ALLOWED_HOSTS] }, 404);
  const repository = repositoryPath(target.pathname);
  if (!repository) return json({ error: "Invalid repository path" }, 400);

  if (request.method === "GET") {
    try {
      await increment(`stats:repo:${target.hostname.toLowerCase()}:${repository}`, target.hostname.toLowerCase(), repository);
      await increment("stats:total", "all", "/");
      // File-level counts are maintained separately from repository totals.
      await increment(`stats:file:${target.hostname.toLowerCase()}:${target.pathname}`, target.hostname.toLowerCase(), target.pathname);
    } catch (error) {
      // Keep downloads working if statistics storage temporarily fails.
      console.error("Download stats write failed", error);
    }
  }
  return Response.redirect(target.toString(), 302);
}
