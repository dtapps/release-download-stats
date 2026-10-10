import { renderHomePage } from "../src/homepage.js";

const NAMESPACE = "release-download-stats";
const ALLOWED_HOSTS = new Set([
  "github.com",
  "cnb.cool",
  "gitea.com",
  "gitlab.com",
  "gitee.com",
  "gitcode.com",
]);

function store() {
  // Create this namespace in ESA Console > Edge Computing and AI > KV Storage.
  return new EdgeKV({ namespace: NAMESPACE });
}

function json(data, status, method) {
  return new Response(method === "HEAD" ? null : JSON.stringify(data, null, 2), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function badgeResponse(svg, method) {
  return new Response(method === "HEAD" ? null : svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

function parseTarget(url) {
  if (!url.pathname.startsWith("/https://")) return null;
  let target;
  try {
    target = new URL(url.pathname.slice(1) + url.search);
  } catch {
    return null;
  }
  if (target.protocol !== "https:" ||
      !ALLOWED_HOSTS.has(target.hostname.toLowerCase()) ||
      target.username || target.password || target.port ||
      target.pathname === "/" || target.pathname.length < 2) {
    return null;
  }
  return target;
}

function decodedRepository(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  try {
    const owner = decodeURIComponent(segments[0]);
    const name = decodeURIComponent(segments[1]);
    if (!owner || !name || owner === "." || owner === ".." ||
        name === "." || name === ".." || /[\/\\\\]/.test(owner + name)) {
      return null;
    }
    return "/" + owner + "/" + name;
  } catch {
    return null;
  }
}

async function hashKey(prefix, value) {
  // ESA EdgeKV keys only allow letters, digits, "-" and "_".
  // Hashing also keeps long source paths under the 512-byte key limit.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = Array.from(new Uint8Array(digest), function (byte) {
    return byte.toString(16).padStart(2, "0");
  }).join("");
  return prefix + "-" + hex;
}

async function readCounter(kv, key) {
  const value = await kv.get(key, { type: "text" });
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed.downloads === "number" ? parsed : null;
  } catch {
    return null;
  }
}

async function increment(kv, key, platform, repository) {
  const now = new Date().toISOString();
  const previous = await readCounter(kv, key);
  const next = {
    platform: platform,
    repository: repository,
    downloads: (previous ? previous.downloads : 0) + 1,
    firstRequestedAt: previous && previous.firstRequestedAt ? previous.firstRequestedAt : now,
    lastRequestedAt: now,
  };
  await kv.put(key, JSON.stringify(next));
}


async function handleRequest(request) {
  const url = new URL(request.url);
  const method = request.method;
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  const kv = store();
  if (url.pathname === "/health") {
    try {
      await kv.get("total", { type: "text" });
      return json({ ok: true, storage: "ESA EdgeKV", status: "healthy" }, 200, method);
    } catch (error) {
      console.error("ESA EdgeKV health check failed", error);
      return json({ ok: false, storage: "ESA EdgeKV", status: "unavailable" }, 503, method);
    }
  }

  if (url.pathname === "/shields.json") {
    try {
      const platform = (url.searchParams.get("platform") || "").trim().toLowerCase();
      const repositoryParam = (url.searchParams.get("repository") || "").trim();
      let downloads;
      if (platform || repositoryParam) {
        const match = repositoryParam.match(/^\/?([^/]+)\/([^/]+)\/?$/);
        if (!ALLOWED_HOSTS.has(platform) || !match || [match[1], match[2]].some(function (part) { return part === "." || part === ".."; })) {
          return json({ error: "Invalid repository; provide platform and repository, e.g. platform=github.com&repository=/owner/repo" }, 400, method);
        }
        const repository = "/" + match[1] + "/" + match[2];
        const key = await hashKey("repo", platform + "\n" + repository);
        const value = await readCounter(kv, key);
        downloads = value ? value.downloads : 0;
      } else {
        const value = await readCounter(kv, "total");
        downloads = value ? value.downloads : 0;
      }
      const label = (url.searchParams.get("label") || "下载请求数").trim().slice(0, 80) || "下载请求数";
      const requestedColor = (url.searchParams.get("color") || "blue").trim();
      const color = /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|[a-zA-Z][a-zA-Z0-9-]{0,31})$/.test(requestedColor)
        ? requestedColor
        : "blue";
      return json({ schemaVersion: 1, label: label, message: formatCount(downloads), color: color }, 200, method);
    } catch (error) {
      console.error("ESA Shields JSON query failed", error);
      return json({ error: "Stats storage unavailable" }, 503, method);
    }
  }

  if (url.pathname === "/" || url.pathname === "/total") {
    let total = 0;
    let storageOk = true;
    try {
      const value = await readCounter(kv, "total");
      total = value ? value.downloads : 0;
    } catch (error) {
      storageOk = false;
      console.error("ESA EdgeKV total query failed", error);
    }
    if (url.pathname === "/total") {
      if (!storageOk) return json({ error: "Stats storage unavailable" }, 503, method);
      return badgeResponse(renderBadge("proxy requests", formatCount(total), "#1d4ed8"), method);
    }
    return new Response(method === "HEAD" ? null : renderHomePage({ baseUrl: url.origin, platform: "Alibaba Cloud ESA + EdgeKV", storageOk, totalDownloads: total }), {
      status: storageOk ? 200 : 503,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const badgeMatch = url.pathname.match(/^\/(badge|stats)\/(github\.com|cnb\.cool|gitea\.com|gitlab\.com|gitee\.com|gitcode\.com)\/([^/]+)\/([^/]+?)(\.json)?\/?$/);
  if (badgeMatch) {
    const kind = badgeMatch[1];
    const platform = badgeMatch[2].toLowerCase();
    const owner = decodeURIComponent(badgeMatch[3]);
    const name = decodeURIComponent(badgeMatch[4]);
    const isJson = kind === "stats" && Boolean(badgeMatch[5]);
    const isBadge = kind === "badge" && !badgeMatch[5];
    if (!owner || !name || owner === "." || owner === ".." || name === "." || name === ".." || (!isJson && !isBadge)) {
      return json({ error: "Invalid stats path" }, 400, method);
    }
    const repository = "/" + owner + "/" + name;
    const key = await hashKey("repo", platform + "\n" + repository);
    let counter;
    try {
      counter = await readCounter(kv, key);
    } catch (error) {
      console.error("ESA EdgeKV repository query failed", error);
      return json({ error: "Stats storage unavailable" }, 503, method);
    }
    const snapshot = {
      platform: platform,
      repository: repository,
      downloads: counter ? counter.downloads : 0,
      source: "First-party download proxy (ESA EdgeKV)",
      firstRequestedAt: counter ? counter.firstRequestedAt : null,
      lastRequestedAt: counter ? counter.lastRequestedAt : null,
    };
    if (isJson) return json(snapshot, 200, method);
    return badgeResponse(renderBadge("proxy requests", formatCount(snapshot.downloads), platform === "cnb.cool" ? "#16a34a" : "#1d4ed8"), method);
  }

  const target = parseTarget(url);
  if (!target) {
    return json({ error: "Not found or invalid target URL", allowed_hosts: Array.from(ALLOWED_HOSTS) }, 404, method);
  }
  const repository = decodedRepository(target.pathname);
  if (!repository) return json({ error: "Invalid repository path" }, 400, method);

  if (method === "GET") {
    const platform = target.hostname.toLowerCase();
    try {
      const repoKey = await hashKey("repo", platform + "\n" + repository);
      const fileKey = await hashKey("file", platform + "\n" + target.pathname);
      await increment(kv, repoKey, platform, repository);
      await increment(kv, fileKey, platform, target.pathname);
      await increment(kv, "total", "all", "/");
    } catch (error) {
      // Never block a release download just because optional stats storage failed.
      console.error("ESA EdgeKV download stats write failed", error);
    }
  }
  return Response.redirect(target.toString(), 302);
}

function renderBadge(label, value, color) {
  return renderBadgeSvg(label, value, color);
}

function renderBadgeSvg(label, value, color) {
  const safeLabel = escapeHtml(label);
  const safeValue = escapeHtml(value);
  const labelWidth = Math.max(70, safeLabel.length * 6.7 + 12);
  const valueWidth = Math.max(32, safeValue.length * 6.7 + 12);
  const valueX = labelWidth;
  const width = labelWidth + valueWidth;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width +
    '" height="20" role="img" aria-label="' + safeLabel + ': ' + safeValue + '">' +
    '<title>' + safeLabel + ': ' + safeValue + '</title>' +
    '<clipPath id="r"><rect width="' + width + '" height="20" rx="3"/></clipPath>' +
    '<g clip-path="url(#r)"><rect width="' + labelWidth + '" height="20" fill="#555"/>' +
    '<rect x="' + valueX + '" width="' + valueWidth + '" height="20" fill="' + color + '"/></g>' +
    '<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,sans-serif" font-size="11">' +
    '<text x="' + (labelWidth / 2) + '" y="14">' + safeLabel + '</text>' +
    '<text x="' + (valueX + valueWidth / 2) + '" y="14">' + safeValue + '</text></g></svg>';
}

export default {
  fetch(request) {
    return handleRequest(request);
  },
};
