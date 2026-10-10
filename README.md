# Release Download Stats

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/dtapps/release-download-stats)

一个基于 Cloudflare Workers + D1 的下载中转与自统计徽章服务。**无需预先配置仓库**：第一次访问中转 URL 时自动创建仓库记录并累计请求数，徽章直接读取自有数据库里的计数。

点击上方 **Deploy to Cloudflare** 按钮，可以将项目复制到自己的 GitHub 账户，并通过 Cloudflare 部署 Worker 和创建所需的 D1 数据库。`wrangler.toml` 使用不带 `database_id` 的 D1 绑定，由 Wrangler 自动创建资源；部署脚本先部署以确保数据库资源已创建，再应用 D1 migrations，最后重新部署。Worker 还会在统计查询和下载计数前幂等创建所需表和索引，避免部署平台跳过 migrations 时统计直接失效。

## 原理

- 下载中转请求格式：`https://你的域名/https://github.com/owner/repo/releases/download/v1.0.0/file.zip`
- 只允许配置在代码中的 HTTPS 来源主机：`github.com`、`cnb.cool`、`gitea.com`、`gitlab.com`、`gitee.com`、`gitcode.com`。
- 每次 GET 请求将仓库和文件计数写入 D1，然后 302 跳转到源站。
- HEAD 请求只跳转，不累计。
- 仓库计数以来源主机和仓库路径为键，首次访问时自动创建记录；无需 `REPOSITORIES`、GitHub Token 或 CNB Token。
- 徽章和 JSON 接口直接查询 D1，显示的是**经过此中转服务的 GET 请求数**，不是上游平台的下载量，也不能保证文件最终下载完成。
- 直接访问源站的下载不会计入统计。

## 徽章与统计接口

假设部署域名为 `download.example.com`：

| URL | 说明 |
| --- | --- |
| `/badge/github.com/owner/repo` | GitHub 仓库自统计徽章 |
| `/stats/github.com/owner/repo.json` | GitHub 仓库统计 JSON |
| `/badge/cnb.cool/namespace/repo` | CNB 仓库自统计徽章 |
| `/stats/cnb.cool/namespace/repo.json` | CNB 仓库统计 JSON |
| `/total` 或 `/` | D1 中所有仓库累计请求数之和 |
| `/health` | 健康检查 |
| `/_stats/repositories` | 私有仓库统计列表 |
| `/_stats/files` | 私有文件统计列表 |

README 徽章示例：

```md
![下载请求数](https://download.example.com/badge/github.com/dtapps/fnmusic-sync)
```

文件下载地址示例：

```text
https://download.example.com/https://github.com/dtapps/fnmusic-sync/releases/download/v1.0.0/fnmusic-sync.zip
```

仓库路径由中转 URL 自动识别，无需在配置文件中登记仓库。统计接口路径中的主机和仓库名应与中转源 URL 一致。

## Cloudflare 部署

### 一键部署（推荐）

1. 点击本页顶部的 **Deploy to Cloudflare** 按钮。
2. 按页面提示授权 GitHub 并选择项目和资源配置。
3. 启动部署。部署脚本先运行 `wrangler deploy` 创建资源，再执行 `wrangler d1 migrations apply DB --remote` 初始化表，最后重新部署 Worker。
4. 即使部署平台跳过 migrations，Worker 也会在第一次统计查询或下载计数时尝试创建所需表和索引。
5. 部署完成后，可在 Cloudflare Workers 控制台为 Worker 绑定自定义域名。

默认不需要设置 `STATS_TOKEN`；未设置时，私有统计接口会拒绝访问，但下载中转、徽章、总计和健康检查不受影响。

### 手动部署教程（连接已有 GitHub 仓库）

如果不想点击 Deploy 按钮创建一份新的 GitHub 仓库，可以在 Cloudflare 直接连接你已有的仓库。

<details>
<summary>方式 A：Cloudflare Dashboard 连接 Git 仓库</summary>


1. 打开 Cloudflare Dashboard → **Workers & Pages** → **Create**，选择连接 Git 仓库的选项。
2. 授权 GitHub，并选择你已有的 `release-download-stats` 仓库（或你自己的 fork）。
3. 在构建设置中使用：
   - **Build command**：`npm run typecheck && npm test`
   - **Deploy command**：`npm run deploy`（不要再把 `npm run deploy` 填到 Build command；它负责部署 Worker 和执行 D1 migrations）
   - **Root directory**：仓库根目录（留空或填写 `/`，按界面要求）
   - **Build output directory**：Worker 项目不需要静态站点输出目录；如果界面没有此项，直接忽略。
4. 确认仓库根目录的 `wrangler.toml` 中包含 `DB` 绑定，且不要手动填写虚假的 `database_id`。本项目要求 Wrangler `4.45.0` 或更新版本，首次部署时会根据 `database_name` 自动创建 D1 资源。
5. 启动部署。项目的 `npm run deploy` 会按顺序执行：部署 Worker 并创建资源 → 应用 D1 migrations → 再部署 Worker。
6. 保存 Git 集成后，Cloudflare Workers Builds 会监听所选生产分支；之后向该分支推送新提交会自动构建并部署。可在 Worker 的 **Settings → Builds** 查看连接的仓库、生产分支和构建历史。
7. 部署完成后，在 Worker 的 **Settings → Domains & Routes** 中添加你的域名，例如 `download.example.com`。
8. 验证：
   - 打开 `https://你的域名/health`，应返回 `{"ok": true}`。
   - 打开 `https://你的域名/stats/cnb.cool/dtapp/fnmusic-sync.json`，应返回统计 JSON，而不是 `Stats query failed`。

> 注意：如果你的 Cloudflare 构建环境不允许运行 Wrangler 部署命令，使用下面的 CLI 方式。不要把 Build output directory 填成 `dist`，也不要把本项目当成 Pages 静态站点部署。

</details>

<details>
<summary>方式 B：命令行手动部署（推荐用于排错）</summary>


需要本机安装最新稳定版 Node.js（与 CI 一样使用最新发行版），并从 GitHub 克隆你自己的仓库：

```sh
git clone https://github.com/你的账号/release-download-stats.git
cd release-download-stats
npm install
npx wrangler login
npm run typecheck
npm test
npm run deploy
```

第一次执行 `npm run deploy` 时，Wrangler 会根据 `wrangler.toml` 的 `database_name` 自动创建 D1 资源，然后脚本应用迁移并重新部署。不要先手动创建另一个同名数据库，也不要把全零 UUID 填入 `database_id`。

如果你的 Cloudflare 账户已经有名为 `release-download-stats` 的 D1 数据库，或者自动创建资源提示名称冲突：
1. 打开 Cloudflare Dashboard → **Storage & databases → D1 SQL database**，确认已有数据库的名称和 ID。
2. 修改 `wrangler.toml`，在 `[[d1_databases]]` 下添加正确的 `database_id = "你的真实数据库 ID"`。
3. 再运行 `npm run deploy`。已有数据库不会因为这条命令而自动清空；迁移使用 `IF NOT EXISTS` 创建缺少的表。

如需使用私有统计接口，再设置密钥：

```sh
npx wrangler secret put STATS_TOKEN
```

</details>

#### 检查 D1 是否初始化

在 Cloudflare Dashboard → **Storage & databases → D1** 中打开本项目绑定的数据库，进入 Console 执行：

```sql
SELECT name
FROM sqlite_master
WHERE type = 'table'
ORDER BY name;
```

应看到 `repository_stats` 和 `file_stats`（Cloudflare 可能还会显示内部表 `_cf_KV`）。如果只有 `_cf_KV`，先重新运行 `npm run deploy`；Worker 也会在统计请求时尝试自动创建所需表，但部署后仍应确认数据库绑定的是同一个 D1。

私有统计接口调用示例：

```sh
curl -H "Authorization: Bearer $STATS_TOKEN" \
  'https://download.example.com/_stats/repositories?limit=100'

curl -G -H "Authorization: Bearer $STATS_TOKEN" \
  --data-urlencode 'platform=github.com' \
  --data-urlencode 'repository=/dtapps/fnmusic-sync' \
  'https://download.example.com/_stats/files?limit=100'
```

## 统计限制

- 只统计经过本 Worker 的 GET 请求；HEAD 请求和直接访问源站不计数。
- 计数代表请求次数，不代表下载成功次数；重复请求、机器人和重试也会计入。
- D1 写入失败时会记录日志，但仍然跳转到源站，避免统计故障阻断下载。
- `/total` 是所有已统计仓库请求数的合计；同一个用户多次请求会被多次计数。

## EdgeOne 部署（Blob 存储）

EdgeOne 适配器使用 `@edgeone/pages-blob` 持久化统计快照，不再依赖需要申请和绑定的 KV。Blob 免费版提供 1 GB 存储空间；首次调用 `getStore("release-download-stats")` 时会自动创建命名空间。

1. 将仓库部署到支持 Node.js SDK 的 EdgeOne Pages / Makers Functions 运行环境。**`@edgeone/pages-blob` 是 Node.js SDK；如果项目使用的是不支持该 SDK 的 Edge Functions 运行时，需要改用兼容的 Node.js 运行时。**
2. 安装依赖（项目构建通常会自动安装）：

   ```sh
   npm install @edgeone/pages-blob
   ```

3. 配置项目环境变量：
   - `REPOSITORIES`：JSON 仓库数组，格式见下方示例。
   - `SYNC_SECRET`：手动同步接口的 Bearer 密钥。
   - `GITHUB_TOKEN`、`CNB_TOKEN`：按需配置；公开仓库可先不设置。
   - `GITHUB_API_BASE`：按需配置。`CACHE_TTL_SECONDS` 对使用 Blob 的 EdgeOne 适配器不生效，因为 Blob 不支持 `expirationTtl`。
4. **不需要申请 KV、创建 KV 命名空间或配置 `STATS_KV` 绑定。** 首次访问函数时，Blob 会自动创建名为 `release-download-stats` 的命名空间。
5. 首次部署后，调用 `POST /sync` 初始化统计数据：

   ```sh
   curl -X POST \
     -H "Authorization: Bearer $SYNC_SECRET" \
     https://你的域名/sync
   ```

   请将示例中的域名和密钥替换为自己的值。后续可通过平台定时任务调用同步接口，或使用项目所支持的定时触发能力更新统计数据。

Blob 适配器使用强一致读取，尽量确保同步完成后立即读取到新数据。Blob 不提供 KV 的 `expirationTtl`，所以统计对象不会按缓存 TTL 自动过期，而是由后续同步覆盖更新；请留意免费版 1 GB 的存储额度。

## 其他平台适配器

仓库中其他平台适配器和旧 API 统计核心仍保留原有实现；Cloudflare 根目录 Worker 的自统计下载计数模式独立使用 D1，不受 EdgeOne Blob 适配器影响。

## 本地开发

需要最新稳定版 Node.js。CI 使用 `actions/setup-node` 的 `node-version: latest` 自动选择最新发行版，并在运行日志中打印实际的 Node.js 和 npm 版本。

```sh
npm install
npm run typecheck
npm test
```
