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

function renderHome(baseUrl, total, storageOk) {
  const base = escapeHtml(baseUrl.replace(/\/$/, ""));
  const status = storageOk ? "统计存储连接正常" : "统计存储连接异常";
  const statusClass = storageOk ? "ok" : "error";
  const count = formatCount(total);
  return [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light"><title>Release Download Stats</title>',
    '<style>',
    ':root{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#172033;background:#f4f7fb}',
    '*{box-sizing:border-box}body{margin:0;padding:32px 16px 48px}.wrap{max-width:900px;margin:auto}',
    '.hero{padding:32px;border-radius:20px;background:linear-gradient(135deg,#172554,#1d4ed8);color:#fff}',
    '.eyebrow{font-size:12px;letter-spacing:.14em;color:#bfdbfe}h1{font-size:clamp(28px,5vw,42px);margin:12px 0}',
    'p,li{line-height:1.8;color:#536178;font-size:14px}.hero p{color:#dbeafe}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:16px}',
    '.card{background:#fff;border:1px solid #e3e9f2;border-radius:16px;padding:22px}.wide{grid-column:1/-1}',
    '.metric{font-size:32px;font-weight:750;color:#1d4ed8}.pill{display:inline-block;border:1px solid #ffffff35;border-radius:999px;padding:7px 11px;font-size:13px;margin:4px 5px 0 0}',
    '.ok{color:#a7f3d0}.error{color:#fecaca}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#101827;color:#e5edf9;border-radius:10px;padding:14px;font-size:12px;line-height:1.6}',
    'a{color:#1d4ed8;text-decoration:none}a:hover{text-decoration:underline}.foot{text-align:center;color:#8a95a8;font-size:12px;padding-top:22px}',
    '@media(max-width:650px){body{padding:16px 10px 30px}.hero{padding:23px 18px}.grid{grid-template-columns:1fr}.wide{grid-column:auto}.card{padding:18px}}',
    '</style></head><body><main class="wrap"><section class="hero">',
    '<div class="eyebrow">RELEASE DOWNLOAD STATS</div><h1>下载请求自统计服务</h1>',
    '<p>通过下载中转地址统计 GET 请求次数，并提供徽章和 JSON 接口。统计的是本服务收到的请求，不是 GitHub 或其他源站公布的下载量。</p>',
    '<span class="pill ' + statusClass + '">' + status + '</span><span class="pill">运行平台：Alibaba Cloud ESA + EdgeKV</span><span class="pill">累计 ' + count + ' 次请求</span>',
    '</section><section class="grid"><article class="card"><h2>服务状态</h2><div class="metric">' + count + '</div>',
    '<p>每次经过本服务的 GET 中转请求计数一次。新部署且没有下载请求时显示 0 是正常的。</p>',
    '<p><a href="' + base + '/health">健康检查 JSON ↗</a>　<a href="' + base + '/total">总计徽章 ↗</a></p></article>',
    '<article class="card"><h2>1. 下载中转</h2><p>在原始 HTTPS 下载地址前加上服务域名和一个斜杠：</p>',
    '<pre>' + base + '/https://github.com/owner/repo/releases/download/v1.0.0/file.zip</pre>',
    '<p>支持 GitHub、CNB、Gitea、GitLab、Gitee、GitCode。GET 计数后 302 跳转；HEAD 不累计。</p></article>',
    '<article class="card"><h2>2. README 徽章</h2><pre>![下载请求数](' + base + '/badge/github.com/owner/repo)</pre>',
    '<p>徽章显示经过本服务的中转请求数，不代表文件已完整下载。</p></article>',
    '<article class="card"><h2>3. 仓库 JSON</h2><pre>' + base + '/stats/github.com/owner/repo.json</pre>',
    '<p>将 owner/repo 替换为真实仓库路径；未统计过的仓库返回 0。</p></article>',
    '<article class="card wide"><h2>统计规则与限制</h2><ul>',
    '<li>只统计本服务中转的 GET 请求；HEAD 和直接访问源站不计数。</li>',
    '<li>计数代表请求次数，不代表下载成功次数；重试和机器人请求也可能累计。</li>',
    '<li>查询参数会传递到源站，但不参与文件身份识别；片段标识符不会发送到服务器。</li>',
    '<li>ESA EdgeKV 是最终一致性存储，当前计数采用读取后写入，高并发请求可能发生计数覆盖。</li>',
    '</ul><p>存储状态：' + status + '</p></article></section>',
    '<footer class="foot">Release Download Stats · Alibaba Cloud ESA + EdgeKV</footer></main></body></html>',
  ].join("");
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
    return new Response(method === "HEAD" ? null : renderHome(url.origin, total, storageOk), {
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
