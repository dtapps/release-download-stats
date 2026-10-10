interface Env {
  DB: D1Database;
  STATS_TOKEN: string;
}

const ALLOWED_HOSTS = new Set([
  "cnb.cool",
  "github.com",
  "gitea.com",
  "gitlab.com",
  "gitee.com",
  "gitcode.com",
]);

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: JSON_HEADERS,
  });
}

/**
 * URL format: https://download.example.com/https://github.com/owner/repo/path
 *
 * The original URL's query string is also the proxy request's query string,
 * so it is appended back to the target. Fragments are never sent by browsers.
 */
function parseTarget(proxyUrl: URL): URL | null {
  const pathname = proxyUrl.pathname;
  if (!pathname.startsWith("/https://")) return null;

  let target: URL;
  try {
    target = new URL(pathname.slice(1) + proxyUrl.search);
  } catch {
    return null;
  }

  if (target.protocol !== "https:") return null;
  if (!ALLOWED_HOSTS.has(target.hostname.toLowerCase())) return null;
  if (target.username || target.password || target.port) return null;
  if (target.pathname === "/" || target.pathname.length < 2) return null;

  return target;
}

/**
 * These six supported providers use owner/repository paths in this project.
 * CNB release URLs also begin with /namespace/repository.
 */
function getRepository(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  // Decode only the repository identity segments; keep the resource path
  // encoded as received so distinct encoded paths are not accidentally merged.
  try {
    return "/" + segments.slice(0, 2).map((part) => decodeURIComponent(part)).join("/");
  } catch {
    return null;
  }
}

function bearerAuthorized(request: Request, env: Env): boolean {
  const expected = env.STATS_TOKEN;
  return Boolean(expected) &&
    request.headers.get("authorization") === `Bearer ${expected}`;
}

async function incrementStats(
  env: Env,
  platform: string,
  repository: string,
  resourcePath: string,
): Promise<void> {
  // A single D1 batch keeps the repository and file counters in one operation.
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO repository_stats (platform, repository, request_count)
      VALUES (?, ?, 1)
      ON CONFLICT(platform, repository) DO UPDATE SET
        request_count = repository_stats.request_count + 1,
        last_requested_at = datetime('now')
    `).bind(platform, repository),

    env.DB.prepare(`
      INSERT INTO file_stats (platform, repository, resource_path, request_count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(platform, repository, resource_path) DO UPDATE SET
        request_count = file_stats.request_count + 1,
        last_requested_at = datetime('now')
    `).bind(platform, repository, resourcePath),
  ]);
}

async function handleStats(request: Request, url: URL, env: Env): Promise<Response> {
  if (!bearerAuthorized(request, env)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const rawLimit = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(1000, Math.trunc(rawLimit)))
    : 100;

  if (url.pathname === "/_stats/repositories") {
    const result = await env.DB.prepare(`
      SELECT platform, repository, request_count, first_requested_at, last_requested_at
      FROM repository_stats
      ORDER BY request_count DESC
      LIMIT ?
    `).bind(limit).all();
    return json(result.results);
  }

  if (url.pathname === "/_stats/files") {
    const platform = url.searchParams.get("platform");
    const repository = url.searchParams.get("repository");
    const conditions: string[] = [];
    const values: string[] = [];

    if (platform) {
      conditions.push("platform = ?");
      values.push(platform);
    }
    if (repository) {
      conditions.push("repository = ?");
      values.push(repository);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await env.DB.prepare(`
      SELECT platform, repository, resource_path, request_count,
             first_requested_at, last_requested_at
      FROM file_stats
      ${where}
      ORDER BY request_count DESC
      LIMIT ?
    `).bind(...values, limit).all();

    return json(result.results);
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/_stats/")) {
      if (request.method !== "GET") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { allow: "GET, HEAD" },
        });
      }

      try {
        return await handleStats(request, url, env);
      } catch (error) {
        console.error("Stats query failed", error);
        return json({ error: "Stats query failed" }, 500);
      }
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }

    const target = parseTarget(url);
    if (!target) {
      return json({
        error: "Invalid target URL",
        allowed_hosts: [...ALLOWED_HOSTS],
      }, 400);
    }

    const repository = getRepository(target.pathname);
    if (!repository) {
      return json({ error: "Invalid repository path" }, 400);
    }

    // File identity is exactly hostname + pathname. Query and fragment do not
    // participate in the key; query parameters are preserved for redirection.
    if (request.method === "GET") {
      try {
        await incrementStats(env, target.hostname.toLowerCase(), repository, target.pathname);
      } catch (error) {
        // A stats outage must not prevent the user's download.
        console.error("Download stats write failed", error);
      }
    }

    return Response.redirect(target.toString(), 302);
  },
};
