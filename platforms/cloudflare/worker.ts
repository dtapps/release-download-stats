import { formatCount, renderBadge } from "../../src/badge";
import { renderHomePage } from "../../src/homepage";
import { ensureStatsSchema } from "../../src/cloudflare-schema";
import downloadProxy from "./download-proxy/worker";

interface Env {
  DB: D1Database;
  STATS_TOKEN?: string;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
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

function parseRepositoryBadge(pathname: string): { platform: string; repository: string; json: boolean } | null {
  const match = pathname.match(/^\/(?:badge|stats)\/(github\.com|cnb\.cool|gitea\.com|gitlab\.com|gitee\.com|gitcode\.com)\/([^/]+)\/([^/]+?)(\.json)?\/?$/);
  if (!match) return null;
  const platform = match[1].toLowerCase();
  let owner: string;
  let name: string;
  try {
    owner = decodeURIComponent(match[2]);
    name = decodeURIComponent(match[3]);
  } catch {
    return null;
  }
  if (!owner || !name || owner === "." || owner === ".." || name === "." || name === "..") return null;
  return { platform, repository: `/${owner}/${name}`, json: pathname.startsWith("/stats/") || Boolean(match[4]) };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const isProxyRequest = url.pathname.startsWith("/https://");
    const isStatsRequest = url.pathname.startsWith("/_stats/") || url.pathname === "/leaderboard" || url.pathname === "/history";

    if (isProxyRequest || isStatsRequest) {
      return downloadProxy.fetch(request, env);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }

    if (url.pathname === "/health") {
      try {
        await ensureStatsSchema(env.DB);
        await env.DB.prepare("SELECT 1 AS ok").first();
        return json({ ok: true, storage: "D1", status: "healthy" });
      } catch (error) {
        console.error("Health check failed", error);
        return json({ ok: false, storage: "D1", status: "unavailable" }, 503);
      }
    }

    if (url.pathname === "/") {
      try {
        await ensureStatsSchema(env.DB);
        const result = await env.DB.prepare(
          "SELECT COALESCE(SUM(request_count), 0) AS total_downloads FROM repository_stats",
        ).first<{ total_downloads: number }>();
        return new Response(renderHomePage({
          baseUrl: url.origin,
          platform: "Cloudflare Workers + D1",
          storageOk: true,
          totalDownloads: Number(result?.total_downloads ?? 0),
          requestExplorer: true,
        }), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      } catch (error) {
        console.error("Homepage stats query failed", error);
        return new Response(renderHomePage({
          baseUrl: url.origin,
          platform: "Cloudflare Workers + D1",
          storageOk: false,
          totalDownloads: 0,
        }), {
          status: 503,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }
    }

    if (url.pathname === "/shields.json") {
      try {
        await ensureStatsSchema(env.DB);
        const platformParam = (url.searchParams.get("platform") ?? "").trim().toLowerCase();
        const repositoryParam = (url.searchParams.get("repository") ?? "").trim();
        let downloads: number;
        if (platformParam || repositoryParam) {
          const allowedPlatforms = new Set(["github.com", "cnb.cool", "gitea.com", "gitlab.com", "gitee.com", "gitcode.com"]);
          const match = repositoryParam.match(/^\/?([^/]+)\/([^/]+)\/?$/);
          if (!allowedPlatforms.has(platformParam) || !match || [match[1], match[2]].some(part => part === "." || part === "..")) {
            return json({ error: "Invalid repository; provide platform and repository, e.g. platform=github.com&repository=/owner/repo" }, 400);
          }
          const result = await env.DB.prepare(
            "SELECT request_count FROM repository_stats WHERE platform = ? AND repository = ?",
          ).bind(platformParam, `/${match[1]}/${match[2]}`).first<{ request_count: number }>();
          downloads = Number(result?.request_count ?? 0);
        } else {
          const result = await env.DB.prepare(
            "SELECT COALESCE(SUM(request_count), 0) AS total_downloads FROM repository_stats",
          ).first<{ total_downloads: number }>();
          downloads = Number(result?.total_downloads ?? 0);
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

    if (url.pathname === "/total") {
      try {
        await ensureStatsSchema(env.DB);
        const result = await env.DB.prepare(
          "SELECT COALESCE(SUM(request_count), 0) AS total_downloads FROM repository_stats",
        ).first<{ total_downloads: number }>();
        const total = Number(result?.total_downloads ?? 0);
        return badge(renderBadge("total downloads", formatCount(total), "blue"), request.method);
      } catch (error) {
        console.error("Total badge query failed", error);
        return json({ error: "Stats query failed" }, 500);
      }
    }

    const target = parseRepositoryBadge(url.pathname);
    if (target) {
      try {
        await ensureStatsSchema(env.DB);
        const result = await env.DB.prepare(
          "SELECT request_count, first_requested_at, last_requested_at FROM repository_stats WHERE platform = ? AND repository = ?",
        ).bind(target.platform, target.repository).first<{
          request_count: number;
          first_requested_at: string;
          last_requested_at: string;
        }>();
        const downloads = Number(result?.request_count ?? 0);
        const snapshot = {
          platform: target.platform,
          repository: target.repository,
          downloads,
          source: "First-party download proxy (D1)",
          firstRequestedAt: result?.first_requested_at ?? null,
          lastRequestedAt: result?.last_requested_at ?? null,
        };
        if (target.json) return json(snapshot);
        const color = target.platform === "cnb.cool" ? "green" : "blue";
        return badge(renderBadge("proxy downloads", formatCount(downloads), color), request.method);
      } catch (error) {
        console.error("Repository badge query failed", error);
        return json({ error: "Stats query failed" }, 500);
      }
    }

    return new Response(
      "Not found. Use /badge/<platform>/<owner>/<repo>, /stats/<platform>/<owner>/<repo>.json, /leaderboard, /history, /total, /health, or /_stats/*.",
      { status: 404 },
    );
  },
};
