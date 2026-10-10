const ALLOWED_HOSTS = new Set([
  "cnb.cool",
  "github.com",
  "gitea.com",
  "gitlab.com",
  "gitee.com",
  "gitcode.com",
]);

export interface DownloadProxyEnv {
  DOWNLOAD_STATS_DB?: D1Database;
  DOWNLOAD_STATS_TOKEN?: string;
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: JSON_HEADERS,
  });
}

function parseTarget(requestUrl: URL): URL | null {
  const prefix = "/https://";
  if (!requestUrl.pathname.startsWith(prefix)) return null;

  // Query parameters belong to the original resource URL in this URL format.
  const rawTarget = requestUrl.pathname.slice(1) + requestUrl.search;
  let target: URL;

  try {
    target = new URL(rawTarget);
  } catch {
    return null;
  }

  if (
    target.protocol !== "https:" ||
    !ALLOWED_HOSTS.has(target.hostname.toLowerCase()) ||
    target.username ||
    target.password ||
    target.port ||
    target.pathname === "/"
  ) {
    return null;
  }

  return target;
}

function repositoryPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return `/${parts[0]}/${parts[1]}`;
}

async function recordDownload(
  db: D1Database,
  platform: string,
  repository: string,
  resourcePath: string,
): Promise<void> {
  await db.batch([
    db.prepare(`
      INSERT INTO repository_download_stats
        (platform, repository, request_count)
      VALUES (?, ?, 1)
      ON CONFLICT(platform, repository) DO UPDATE SET
        request_count = request_count + 1,
        last_requested_at = datetime('now')
    `).bind(platform, repository),
    db.prepare(`
      INSERT INTO file_download_stats
        (platform, repository, resource_path, request_count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(platform, repository, resource_path) DO UPDATE SET
        request_count = request_count + 1,
        last_requested_at = datetime('now')
    `).bind(platform, repository, resourcePath),
  ]);
}

function authorized(request: Request, env: DownloadProxyEnv): boolean {
  const token = env.DOWNLOAD_STATS_TOKEN;
  return Boolean(token && request.headers.get("Authorization") === `Bearer ${token}`);
}

async function statsResponse(
  request: Request,
  url: URL,
  env: DownloadProxyEnv,
): Promise<Response> {
  if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);
  if (!env.DOWNLOAD_STATS_DB) return json({ error: "D1 binding DOWNLOAD_STATS_DB is missing" }, 503);

  const rawLimit = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(1000, Math.floor(rawLimit))) : 100;

  if (url.pathname === "/_download-stats/repositories") {
    const result = await env.DOWNLOAD_STATS_DB.prepare(`
      SELECT platform, repository, request_count, first_requested_at, last_requested_at
      FROM repository_download_stats
      ORDER BY request_count DESC LIMIT ?
    `).bind(limit).all();
    return json(result.results);
  }

  if (url.pathname === "/_download-stats/files") {
    const conditions: string[] = [];
    const values: string[] = [];
    const platform = url.searchParams.get("platform");
    const repository = url.searchParams.get("repository");
    if (platform) { conditions.push("platform = ?"); values.push(platform); }
    if (repository) { conditions.push("repository = ?"); values.push(repository); }

    let sql = `
      SELECT platform, repository, resource_path, request_count, first_requested_at, last_requested_at
      FROM file_download_stats
    `;
    if (conditions.length) sql += ` WHERE ${conditions.join(" AND ")}`;
    sql += " ORDER BY request_count DESC LIMIT ?";

    const result = await env.DOWNLOAD_STATS_DB.prepare(sql).bind(...values, limit).all();
    return json(result.results);
  }

  return json({ error: "Not found" }, 404);
}

/**
 * Returns null when this is not a download-proxy or proxy-stats route,
 * allowing the existing release badge API to handle the request.
 */
export async function handleDownloadProxy(
  request: Request,
  env: DownloadProxyEnv,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/_download-stats/")) {
    if (request.method !== "GET") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET" },
      });
    }
    try {
      return await statsResponse(request, url, env);
    } catch (error) {
      console.error("Download stats query failed:", error);
      return json({ error: "Download stats query failed" }, 500);
    }
  }

  if (!url.pathname.startsWith("/https://")) return null;

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  const target = parseTarget(url);
  if (!target) {
    return json({ error: "Invalid target URL", allowed_hosts: [...ALLOWED_HOSTS] }, 400);
  }

  const repository = repositoryPath(target.pathname);
  if (!repository) return json({ error: "Invalid repository path" }, 400);

  if (request.method === "GET") {
    if (!env.DOWNLOAD_STATS_DB) {
      return json({ error: "D1 binding DOWNLOAD_STATS_DB is missing" }, 503);
    }
    try {
      // File identity is exactly hostname + pathname; query and fragment are excluded.
      await recordDownload(
        env.DOWNLOAD_STATS_DB,
        target.hostname.toLowerCase(),
        repository,
        target.pathname,
      );
    } catch (error) {
      console.error("Failed to record download request:", error);
      // Fail open: do not block a user's download because stats storage failed.
    }
  }

  return Response.redirect(target.toString(), 302);
}
