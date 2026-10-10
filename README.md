# Release Download Stats

一个基于 TypeScript 的边缘下载量统计服务，可配置**多个 GitHub 或 CNB 仓库**，分别统计每个仓库的 Release 附件下载量，并生成可嵌入 README 的 SVG 徽章。

## 核心功能

- 使用一个 `REPOSITORIES` JSON 配置同时指定多个仓库。
- 每个仓库使用独立 ID、独立 KV 缓存、独立徽章 URL，不会把不同仓库的下载量混在一起。
- 支持 GitHub Releases 和 CNB Releases；CNB API 基础地址固定为 `https://api.cnb.cool`，使用官方 `ListReleases` 接口路径自动查询。
- 提供单仓库徽章、单仓库 JSON、全部仓库列表和总下载量徽章。
- 徽章请求只读 KV 缓存；定时任务或 `POST /sync` 负责刷新数据。
- 不依赖 SQL 数据库。

## 配置多个仓库

配置环境变量 `REPOSITORIES`，内容是 JSON 数组。每个条目都需要唯一的 `id`、`provider` 和 `repository`。

GitHub 仓库示例：

```json
[
  {
    "id": "fnmusic-sync",
    "provider": "github",
    "repository": "dtapps/fnmusic-sync"
  },
  {
    "id": "certflow",
    "provider": "github",
    "repository": "dtapps/certflow"
  }
]
```

同时统计 CNB 仓库时，给对应条目设置 `provider: "cnb"`，并提供 `releasesUrl`：

```json
[
  {
    "id": "fnmusic-sync",
    "provider": "github",
    "repository": "dtapps/fnmusic-sync"
  },
  {
    "id": "my-cnb-project",
    "provider": "cnb",
    "repository": "命名空间/仓库名",
    "releasesUrl": "https://从 CNB 官方 OpenAPI 确认的完整 Releases API 地址"
  }
]
```

`id` 是你自己定义的短名称，用在 URL 中；`repository` 才是实际仓库地址。多个仓库的 ID 不能重复。CNB 的 API 地址必须按你实际项目的官方 API 文档填写，本项目不会猜测 API 路径。

## 接口

将 `https://你的服务域名` 替换为部署后的地址。

| URL | 用途 |
| --- | --- |
| `/` 或 `/total` | 所有已成功同步仓库的下载量之和 |
| `/badge/fnmusic-sync` | 指定 ID 仓库的 SVG 下载量徽章 |
| `/stats/fnmusic-sync.json` | 指定 ID 仓库的统计 JSON |
| `/repositories.json` | 所有已配置仓库的独立统计结果 |
| `/stats.json` | 最近一次同步的汇总快照及警告 |
| `/health` | 健康检查 |
| `/sync` | 手动同步所有已配置仓库；仅接受带密钥的 POST |

例如，在 README 中显示 `dtapps/fnmusic-sync` 的下载量：

```md
![fnmusic-sync 下载量](https://你的服务域名/badge/fnmusic-sync)
```

另一个仓库使用另一个 ID：

```md
![certflow 下载量](https://你的服务域名/badge/certflow)
```

总下载量徽章是所有成功同步仓库的总和。如果你只需要某个仓库，请使用 `/badge/:id`，不要使用 `/total`。

## 环境变量

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `REPOSITORIES` | 是，推荐 | 多仓库 JSON 数组，见上方示例 |
| `REPOSITORY` | 兼容旧配置 | 单个 GitHub 仓库；建议迁移到 `REPOSITORIES` |
| `GITHUB_TOKEN` | 可选 | GitHub Token，建议配置以提高 API 限额 |
| `CNB_TOKEN` | 视权限而定 | CNB API 所需令牌 |
| `SYNC_SECRET` | 是 | 手动同步接口的 Bearer 密钥 |
| `GITHUB_API_BASE` | 可选 | GitHub API 根地址，主要用于 GitHub Enterprise 或测试 |
| `CACHE_TTL_SECONDS` | 可选 | 缓存过期时间，默认 30 天 |

不要将 Token 或同步密钥提交到仓库。请通过平台的 Secret 功能配置。

## Cloudflare Workers 部署

1. 在 Cloudflare 控制台创建 Workers KV namespace。
2. 在 `wrangler.toml` 中填入 KV namespace ID。
3. 将 `wrangler.toml` 的 `REPOSITORIES` 设置为 JSON 字符串，例如：

   ```toml
   [vars]
   REPOSITORIES = '[{"id":"fnmusic-sync","provider":"github","repository":"dtapps/fnmusic-sync"},{"id":"certflow","provider":"github","repository":"dtapps/certflow"}]'
   ```

4. 配置密钥：

   ```sh
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler secret put SYNC_SECRET
   ```

   若配置需要鉴权的 CNB 仓库，还需要设置 `CNB_TOKEN`。CNB API 基础地址和 Releases 路径由程序固定处理，无需配置 URL。

5. 安装、检查和部署：

   ```sh
   npm install
   npm run typecheck
   npm test
   npm run deploy:cloudflare
   ```

6. 首次部署后手动触发同步：

   ```sh
   curl -X POST -H "Authorization: Bearer 你的SYNC_SECRET" https://你的服务域名/sync
   ```

根目录 `wrangler.toml` 中配置了每小时一次的 Cron Trigger。定时任务会刷新所有配置的仓库。

## Cloudflare Pages、EdgeOne Makers 与 ESA

共享统计核心使用同一套 `REPOSITORIES` 配置和 KV 接口。部署到各平台时，必须将 `REPOSITORIES` 作为环境变量提供，并按对应平台要求绑定 KV。

- Cloudflare Pages：将 KV namespace 绑定为 `STATS_KV`；Pages Functions 本身不等同于 Workers Cron，使用外部定时器请求 `POST /sync`。
- EdgeOne Makers：入口文件为适配模板，部署前核实当前项目的函数路由、KV 绑定、环境变量和定时任务接口。
- ESA Pages：`esa/handler.ts` 是运行时中立适配器工厂，不是已经验证可直接部署的 ESA 函数入口；ESA KV 可以不启用，但需要提供兼容的存储实现。

不能仅凭 TypeScript 编译通过就认定平台部署完成。每个平台的运行时入口、KV 和定时触发都应实际验证。

## 统计规则和已知限制

- GitHub 统计分页读取 Release，并汇总非草稿 Release 的附件 `download_count`。
- CNB 适配器使用官方 `ListReleases` 路径，尝试根据响应分页头或每页数量遍历 Release；如果 CNB 实际响应使用不同的分页头格式，应以真实接口响应为准调整。
- 一个仓库同步失败不会覆盖该仓库上一次成功的缓存值；首次同步失败的仓库会在汇总快照中标记警告。
- 未配置的仓库 ID 返回 404，不会意外显示其他仓库的数字。

## 本地开发

需要 Node.js 22 或兼容版本。

```sh
npm install
npm run typecheck
npm test
```

## 许可证

仓库尚未添加许可证文件。明确开源许可证前，请不要假定项目可以按任意开源许可证使用。
