export interface HomePageOptions {
  baseUrl: string;
  platform: "Cloudflare Workers + D1" | "EdgeOne Pages + Blob" | "Alibaba Cloud ESA + EdgeKV";
  storageOk: boolean;
  totalDownloads: number;
  requestExplorer?: boolean;
  captcha?: { ruleId: string; sceneId: string; identity: string; region: "cn" | "sgp" };
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
  const captchaEnabled = Boolean(options.captcha?.ruleId.trim() && options.captcha?.sceneId.trim() && options.captcha?.identity.trim());
  const captchaMarkup = captchaEnabled ? `
      <article class="card wide" id="esa-captcha-card">
        <h2>人机验证</h2>
        <p>此验证仅用于当前 ESA 首页。完成验证后，页面会向 ESA 当前首页发起验签请求。</p>
        <div id="captcha-element"></div>
        <div class="controls"><button type="button" id="captcha-button">开始人机验证</button></div>
        <p id="captcha-status" class="muted" role="status" aria-live="polite">验证码正在初始化…</p>
      </article>` : "";
  const captchaScripts = captchaEnabled && options.captcha ? `
  <script>
    window.AliyunCaptchaConfig = {
      region: ${JSON.stringify(options.captcha.region)},
      prefix: ${JSON.stringify(options.captcha.identity)}
    };
    (function () {
      const status = document.getElementById("captcha-status");
      const button = document.getElementById("captcha-button");
      let captchaInstance = null;
      let initialized = false;
      function setStatus(message) { if (status) status.textContent = message; }
      function initCaptcha() {
        if (initialized || typeof window.initAliyunCaptcha !== "function") return;
        initialized = true;
        window.initAliyunCaptcha({
          SceneId: ${JSON.stringify(options.captcha.sceneId)},
          mode: "popup",
          element: "#captcha-element",
          button: "#captcha-button",
          server: ["captcha-esa-open.aliyuncs.com", "captcha-esa-open-b.aliyuncs.com"],
          success: async function (captchaVerifyParam) {
            setStatus("验证码已通过交互，正在向 ESA 验签…");
            try {
              const verifyUrl = "/captcha-verify";
              const response = await fetch(verifyUrl, {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "captcha-verify-param": captchaVerifyParam
                },
                body: JSON.stringify({}),
                credentials: "include",
                cache: "no-store"
              });
              const code = response.headers.get("X-Captcha-Verify-Code");
              if (code === "T001" || code === "T005" || code === "T006") {
                const gate = document.getElementById("esa-captcha-gate");
                const content = document.getElementById("homepage-content");
                const template = document.getElementById("homepage-template");
                if (!content || !template) {
                  setStatus("首页内容初始化失败，请刷新页面重试。");
                  return;
                }
                content.replaceChildren(template.content.cloneNode(true));
                content.hidden = false;
                if (gate) gate.hidden = true;
                document.dispatchEvent(new Event("homepage-unlocked"));
                setStatus("验证通过，正在进入首页…");
              } else {
                setStatus("ESA 验签未通过：" + (code || "响应中没有 X-Captcha-Verify-Code") + "。首页内容仍被锁定。");
              }
            } catch (error) {
              setStatus("验签请求失败：" + (error && error.message ? error.message : String(error)));
            }
            if (captchaInstance && typeof captchaInstance.refresh === "function") captchaInstance.refresh();
          },
          fail: function (result) {
            setStatus("验证码未通过，请重试。" + (result && result.code ? "（" + result.code + "）" : ""));
          },
          getInstance: function (instance) { captchaInstance = instance; },
          onError: function (error) {
            setStatus("验证码初始化失败：" + (error && error.msg ? error.msg : "请检查 ESA 配置和网络"));
          },
          slideStyle: { width: 360, height: 40 }
        });
        setStatus("验证码已就绪，点击按钮开始验证。");
      }
      const script = document.createElement("script");
      script.src = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
      script.async = true;
      script.onload = initCaptcha;
      script.onerror = function () { setStatus("验证码脚本加载失败，请检查网络或浏览器拦截设置。"); };
      document.head.appendChild(script);
    })();
  </script>` : "";
  const requestExplorer = options.requestExplorer ? `      <article class="card wide">
        <h2>5. 请求排行榜与最近记录</h2>
        <p>排行榜根据已记录的中转请求统计；最近记录用于排查请求时间、仓库和文件路径。302 表示本服务已发起跳转，不代表源站下载成功。</p>
        <div class="controls">
          <label>排行榜时间范围
            <select id="leaderboard-period"><option value="all">累计</option><option value="today">近 24 小时</option><option value="7d">近 7 天</option><option value="30d">近 30 天</option></select>
          </label>
          <button type="button" id="refresh-stats">刷新数据</button>
        </div>
        <h3>请求排行榜 Top 10</h3>
        <div class="table-wrap"><table><thead><tr><th>#</th><th>平台</th><th>仓库</th><th>请求数</th><th>最近请求</th></tr></thead><tbody id="leaderboard-body"><tr><td colspan="5">正在加载…</td></tr></tbody></table></div>
        <h3>最近 50 条请求</h3>
        <div class="table-wrap"><table><thead><tr><th>时间</th><th>平台</th><th>仓库</th><th>文件路径</th><th>方法</th><th>状态</th></tr></thead><tbody id="history-body"><tr><td colspan="6">正在加载…</td></tr></tbody></table></div>
        <p class="muted">历史记录当前仅记录 GET 中转请求；不保存 IP、Cookie 或请求头。数据由新版本开始累积，旧的累计数据不会补生成历史记录。</p>
        <p>JSON 接口：<a href="${base}/leaderboard?period=all&limit=10">/leaderboard</a> · <a href="${base}/history?limit=50">/history</a></p>
      </article>` : "";

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
    .table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:9px 8px;border-bottom:1px solid #e8edf5;white-space:nowrap}th{color:#69778d;font-weight:650}.controls{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.controls select,.controls button{border:1px solid #d5deeb;border-radius:8px;background:#fff;padding:8px 10px;color:#172033}.controls button{cursor:pointer}.empty{color:#7a879b;padding:16px 0}
    @media(max-width:680px){body{padding:18px 12px 36px}.hero{padding:24px 20px}.grid{grid-template-columns:1fr}.wide{grid-column:auto}.card{padding:18px}}
  </style>
</head>
<body>
  <main class="wrap">
    ${captchaEnabled ? '<section class="card wide" id="esa-captcha-gate"><h2>请先完成人机验证</h2><p>每次打开首页都需要重新验证；验签成功后才会显示首页内容。</p>' + captchaMarkup + '</section><div id="homepage-content" hidden></div><template id="homepage-template">' : '<div id="homepage-content">'}
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
        <h2>3. 本服务原生徽章预览</h2>
        <p>下面对比同名的 GitHub 与 CNB 仓库。徽章由本服务直接生成，不依赖 Shields.io。</p>
        <h3>GitHub：dtapps/certflow</h3>
        <p><a href="${base}/badge/github.com/dtapps/certflow"><img src="${base}/badge/github.com/dtapps/certflow" alt="GitHub certflow 下载请求数"></a></p>
        <p>复制到 README：</p>
        <pre>![GitHub certflow 下载请求数](${rawBase}/badge/github.com/dtapps/certflow)</pre>
        <h3>CNB：dtapp/certflow</h3>
        <p><a href="${base}/badge/cnb.cool/dtapp/certflow"><img src="${base}/badge/cnb.cool/dtapp/certflow" alt="CNB certflow 下载请求数"></a></p>
        <p>复制到 README：</p>
        <pre>![CNB certflow 下载请求数](${rawBase}/badge/cnb.cool/dtapp/certflow)</pre>
        <p class="muted">两边分别统计经过当前服务中转的请求数，互不合并；没有中转请求时显示 0 属于正常情况。</p>
      </article>
      <article class="card">
        <h2>4. 使用 Shields.io 徽章</h2>
        <p>如果想使用 Shields.io 的样式，可以使用 endpoint 徽章读取本服务的 <code>/shields.json</code>。</p>
        <p>全站徽章预览：</p>
        <p><a href="${escapeHtml(shieldsBadgeUrl)}"><img src="${escapeHtml(shieldsBadgeUrl)}" alt="全站下载请求数"></a></p>
        <p>复制到 README：</p>
        <pre>![下载请求数](${shieldsBadgeUrl})</pre>
        <p>JSON 接口：<a href="${escapeHtml(shieldsJsonUrl)}">${escapeHtml(shieldsJsonUrl)} ↗</a></p>
        <p>标签和颜色可通过 JSON 地址参数自定义，例如 <code>?label=Downloads&amp;color=brightgreen</code>；也支持中文标签和 <code>#409EFF</code> 颜色。</p>
        <p>单仓库 Shields.io 徽章预览，对比 GitHub 与 CNB 的 <code>certflow</code> 仓库：</p>
        <h3>GitHub：dtapps/certflow</h3>
        <p><a href="https://img.shields.io/endpoint?url=${encodeURIComponent(rawBase + "/shields.json?platform=github.com&repository=/dtapps/certflow")}"><img src="https://img.shields.io/endpoint?url=${encodeURIComponent(rawBase + "/shields.json?platform=github.com&repository=/dtapps/certflow")}" alt="GitHub certflow Shields.io 下载请求数"></a></p>
        <pre>![GitHub certflow 下载请求数](https://img.shields.io/endpoint?url=${encodeURIComponent(rawBase + "/shields.json?platform=github.com&repository=/dtapps/certflow")})</pre>
        <p>JSON：<a href="${escapeHtml(rawBase + "/shields.json?platform=github.com&repository=%2Fdtapps%2Fcertflow")}">${escapeHtml(rawBase + "/shields.json?platform=github.com&repository=%2Fdtapps%2Fcertflow")} ↗</a></p>
        <h3>CNB：dtapp/certflow</h3>
        <p><a href="https://img.shields.io/endpoint?url=${encodeURIComponent(rawBase + "/shields.json?platform=cnb.cool&repository=/dtapp/certflow")}"><img src="https://img.shields.io/endpoint?url=${encodeURIComponent(rawBase + "/shields.json?platform=cnb.cool&repository=/dtapp/certflow")}" alt="CNB certflow Shields.io 下载请求数"></a></p>
        <pre>![CNB certflow 下载请求数](https://img.shields.io/endpoint?url=${encodeURIComponent(rawBase + "/shields.json?platform=cnb.cool&repository=/dtapp/certflow")})</pre>
        <p>JSON：<a href="${escapeHtml(rawBase + "/shields.json?platform=cnb.cool&repository=%2Fdtapp%2Fcertflow")}">${escapeHtml(rawBase + "/shields.json?platform=cnb.cool&repository=%2Fdtapp%2Fcertflow")} ↗</a></p>
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
      ${requestExplorer}

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
    ${captchaEnabled ? '</template>' : '</div>'}
  </main>
  <script>
    const escapeCell = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    const formatTime = (value) => value ? new Date(value).toLocaleString() : "—";
    async function loadLeaderboard() {
      const body = document.getElementById("leaderboard-body");
      body.innerHTML = '<tr><td colspan="5">正在加载…</td></tr>';
      try {
        const period = document.getElementById("leaderboard-period").value;
        const response = await fetch("/leaderboard?period=" + encodeURIComponent(period) + "&limit=10", {cache:"no-store"});
        if (!response.ok) throw new Error("HTTP " + response.status);
        const data = await response.json();
        body.innerHTML = data.items.length ? data.items.map((item, i) => '<tr><td>'+(i+1)+'</td><td>'+escapeCell(item.platform)+'</td><td>'+escapeCell(item.repository)+'</td><td>'+escapeCell(item.request_count)+'</td><td>'+escapeCell(formatTime(item.last_requested_at))+'</td></tr>').join("") : '<tr><td colspan="5" class="empty">暂无请求数据</td></tr>';
      } catch (error) { body.innerHTML = '<tr><td colspan="5">加载失败：'+escapeCell(error.message)+'</td></tr>'; }
    }
    async function loadHistory() {
      const body = document.getElementById("history-body");
      body.innerHTML = '<tr><td colspan="6">正在加载…</td></tr>';
      try {
        const response = await fetch("/history?limit=50", {cache:"no-store"});
        if (!response.ok) throw new Error("HTTP " + response.status);
        const data = await response.json();
        body.innerHTML = data.items.length ? data.items.map(item => '<tr><td>'+escapeCell(formatTime(item.time))+'</td><td>'+escapeCell(item.platform)+'</td><td>'+escapeCell(item.repository)+'</td><td title="'+escapeCell(item.file)+'">'+escapeCell(item.file)+'</td><td>'+escapeCell(item.method)+'</td><td>'+escapeCell(item.status)+'</td></tr>').join("") : '<tr><td colspan="6" class="empty">暂无请求记录（新版本部署后才开始记录）</td></tr>';
      } catch (error) { body.innerHTML = '<tr><td colspan="6">加载失败：'+escapeCell(error.message)+'</td></tr>'; }
    }
    async function refreshStats() { await Promise.all([loadLeaderboard(), loadHistory()]); }
    function initStats() {
      if (!document.getElementById("leaderboard-period")) return;
      document.getElementById("leaderboard-period").addEventListener("change", loadLeaderboard);
      document.getElementById("refresh-stats").addEventListener("click", refreshStats);
      refreshStats();
    }
    document.addEventListener("homepage-unlocked", initStats);
    initStats();
  </script>
  ${captchaScripts}
</body>
</html>`;
}
