# Release Download Stats

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/dtapps/release-download-stats)

一个基于 Cloudflare Workers + D1 的下载中转与自统计徽章服务。**无需预先配置仓库**：第一次访问中转 URL 时自动创建仓库记录并累计请求数，徽章直接读取自有数据库里的计数。

点击上方 **Deploy to Cloudflare** 按钮，可以将项目复制到自己的 GitHub 账户，并通过 Cloudflare 部署 Worker 和创建所需的 D1 数据库。部署脚本会先应用 D1 migrations，自动初始化数据表。

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
3. 启动部署。部署脚本会先运行 `wrangler d1 migrations apply DB --remote` 初始化数据库表，再部署 Worker。
4. 部署完成后，可在 Cloudflare Workers 控制台为 Worker 绑定自定义域名。

默认不需要设置 `STATS_TOKEN`；未设置时，私有统计接口会拒绝访问，但下载中转、徽章、总计和健康检查不受影响。

### 命令行部署（可选）

如果要部署到自己的 Cloudflare 账户：

1. 登录 Wrangler：

   ```sh
   npx wrangler login
   ```

2. 创建 D1 数据库：

   ```sh
   npx wrangler d1 create release-download-stats
   ```

3. 将返回的 database ID 填入根目录 `wrangler.toml`，替换全零占位 ID。
4. 安装、检查并部署（部署命令会自动应用 migrations）：

   ```sh
   npm install
   npm run typecheck
   npm test
   npm run deploy
   ```

5. 如需使用私有统计接口，再设置密钥：

   ```sh
   npx wrangler secret put STATS_TOKEN
   ```

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

## 其他平台适配器

仓库中保留的其他边缘平台适配器和旧 API 统计核心仍是原有实现；上述无需仓库配置的自统计模式对应根目录 Cloudflare Worker 部署入口。

## 本地开发

需要 Node.js 22 或兼容版本。

```sh
npm install
npm run typecheck
npm test
```
