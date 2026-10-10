import { formatCount, renderBadge } from "../../src/badge";
import downloadProxy from "./download-proxy/worker";

interface Env {
  DB: D1Database;
  STATS_TOKEN: string;
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
    const isStatsRequest = url.pathname.startsWith("/_stats/");

    if (isProxyRequest || isStatsRequest) {
      return downloadProxy.fetch(request, env);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }

    if (url.pathname === "/health") return json({ ok: true });

    if (url.pathname === "/" || url.pathname === "/total") {
      try {
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
      "Not found. Use /badge/<platform>/<owner>/<repo>, /stats/<platform>/<owner>/<repo>.json, /total, /health, or /_stats/*.",
      { status: 404 },
    );
  },
};
