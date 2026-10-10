export interface HomePageOptions {
  baseUrl: string;
  platform: "Cloudflare Workers + D1" | "EdgeOne Pages + Blob" | "Alibaba Cloud ESA + EdgeKV";
  storageOk: boolean;
  totalDownloads: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderHomePage(options: HomePageOptions): string {
  const rawBase = options.baseUrl.replace(/\/$/, "");
  const base = escapeHtml(rawBase);
  const shieldsJsonUrl = `${rawBase}/shields.json`;
  const shieldsBadgeUrl = `https://img.shields.io/endpoint?url=${encodeURIComponent(shieldsJsonUrl)}`;
  const total = new Intl.NumberFormat("en-US").format(options.totalDownloads);
  const statusText = options.storageOk ? "统计存储连接正常" : "统计存储连接异常";
  const statusClass = options.storageOk ? "ok" : "error";
  const platform = escapeHtml(options.platform);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Release Download Stats</title>
  <style>
    :root{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#172033;background:#f4f7fb}
    *{box-sizing:border-box}body{margin:0;padding:36px 18px 56px}.wrap{max-width:960px;margin:auto}
    .hero{padding:34px;border-radius:22px;background:linear-gradient(135deg,#172554,#1d4ed8);color:white;box-shadow:0 18px 48px #17255420}
    .eyebrow{font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#bfdbfe}
    h1{font-size:clamp(28px,5vw,42px);margin:12px 0}.hero p{line-height:1.8;color:#dbeafe;max-width:720px;margin-bottom:0}
    .status-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}.pill{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:8px 12px;font-size:13px;background:#ffffff18;border:1px solid #ffffff30}
    .dot{width:8px;height:8px;border-radius:50%;background:#34d399}.pill.error .dot{background:#f87171}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:18px}.card{background:white;border:1px solid #e3e9f2;border-radius:16px;padding:22px;box-shadow:0 5px 18px #17255408}
    h2{font-size:18px;margin:0 0 12px}p,li{line-height:1.75;color:#536178;font-size:14px}.metric{font-size:32px;font-weight:750;letter-spacing:-.04em;color:#1d4ed8}.muted{font-size:12px;color:#7a879b}
    code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}code{background:#f0f4fa;padding:2px 5px;border-radius:5px;color:#244a8f;overflow-wrap:anywhere}
    pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#101827;color:#e5edf9;border-radius:10px;padding:14px;font-size:12px;line-height:1.65}
    a{color:#1d4ed8;text-decoration:none}a:hover{text-decoration:underline}.links{display:flex;flex-wrap:wrap;gap:12px;margin-top:14px}
    .wide{grid-column:1/-1}.foot{text-align:center;color:#8a95a8;font-size:12px;padding-top:24px}
    @media(max-width:680px){body{padding:18px 12px 36px}.hero{padding:24px 20px}.grid{grid-template-columns:1fr}.wide{grid-column:auto}.card{padding:18px}}
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <div class="eyebrow">Release Download Stats</div>
      <h1>下载请求自统计服务</h1>
      <p>通过下载中转地址统计 GET 请求次数，并提供徽章和 JSON 数据接口。这里显示的是本服务自己的统计结果，不是 GitHub 或 CNB 官方下载量。</p>
      <div class="status-row">
        <span class="pill ${statusClass}"><span class="dot"></span>${statusText}</span>
        <span class="pill">运行平台：${platform}</span>
        <span class="pill">当前累计：${total} 次请求</span>
      </div>
    </section>

    <section class="grid">
      <article class="card">
        <h2>服务状态</h2>
        <div class="metric">${total}</div>
        <p>已记录的中转 GET 请求总数。新部署且尚未有下载请求时显示 0 是正常的。</p>
        <div class="links">
          <a href="${base}/health">健康检查 JSON ↗</a>
          <a href="${base}/total">总计徽章 ↗</a>
        </div>
      </article>
      <article class="card">
        <h2>1. 接入下载中转</h2>
        <p>把原始 HTTPS 下载链接放到服务域名后面，并在中间加一个斜杠：</p>
        <pre>${base}/https://github.com/owner/repo/releases/download/v1.0.0/file.zip</pre>
        <p>支持 GitHub、CNB、Gitea、GitLab、Gitee、GitCode。GET 请求会计数并跳转源站；HEAD 和直接访问源站不计数。</p>
      </article>
      <article class="card">
        <h2>2. 在 README 中显示徽章</h2>
        <p>将示例中的仓库路径替换为你的真实仓库：</p>
        <pre>![下载请求数](${base}/badge/github.com/owner/repo)</pre>
        <p>徽章显示经过此服务的中转请求数，不代表文件已完整下载。</p>
      </article>
      <article class="card">
        <h2>3. 使用 Shields.io 徽章</h2>
        <p>如果不想让 README 直接引用自己的统计域名作为图片，可以使用 Shields.io 的 endpoint 徽章。它会读取本服务提供的 <code>/shields.json</code>。</p>
        <p>徽章预览：</p>
        <p><a href="${escapeHtml(shieldsBadgeUrl)}"><img src="${escapeHtml(shieldsBadgeUrl)}" alt="下载请求数"></a></p>
        <p>复制到 README：</p>
        <pre>![下载请求数](${shieldsBadgeUrl})</pre>
        <p>JSON 接口：<a href="${escapeHtml(shieldsJsonUrl)}">${escapeHtml(shieldsJsonUrl)} ↗</a></p>
        <p>标签和颜色可通过 JSON 地址参数自定义，例如 <code>?label=Downloads&amp;color=brightgreen</code>；也支持中文标签和 <code>#409EFF</code> 颜色。</p>
      </article>
      <article class="card">
        <h2>4. 查看单仓库数据</h2>
        <p>JSON 接口可供脚本、仪表盘或其他程序读取：</p>
        <pre>${base}/stats/github.com/owner/repo.json</pre>
        <div class="links">
          <a href="${base}/stats/github.com/owner/repo.json">查看示例接口 ↗</a>
        </div>
        <p class="muted">示例路径中的 owner/repo 需要替换成实际仓库；未出现过的仓库会返回 0。</p>
      </article>
      <article class="card wide">
        <h2>统计规则与存储状态</h2>
        <ul>
          <li>只统计经过本服务中转地址的 GET 请求，每次请求计数一次。</li>
          <li>HEAD 请求不会累计；直接访问 GitHub/CNB 等源站不会计入。</li>
          <li>计数是请求次数，不等于下载成功次数；重复请求、重试和机器人请求也会累计。</li>
          <li>存储连接状态：<strong>${statusText}</strong>。若显示异常，请打开 <a href="${base}/health">健康检查</a> 查看状态，再检查平台绑定和运行日志。</li>
          <li>存储实现：${platform}。</li>
        </ul>
      </article>
    </section>
    <footer class="foot">Release Download Stats · 自统计下载中转服务</footer>
  </main>
</body>
</html>`;
}
