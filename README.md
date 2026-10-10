# Release Download Stats

一个基于 TypeScript 的边缘运行时下载量统计服务，用于统计 GitHub 和 CNB 仓库的 Release 附件下载量，并生成可嵌入 README 的 SVG 徽章。

> **当前状态：开发中。** GitHub 统计核心、缓存接口和徽章路由已实现；CNB API 分页以及各平台的实际运行时入口仍需按官方文档验证。请先阅读本文的“已知限制”，不要在未验证数据完整性的情况下把统计结果当作最终数字。

## 功能

- 统计 GitHub Releases 中非草稿 Release 的附件下载量。
- 支持配置 CNB Releases API 地址，统计响应中附件的 `assets[].download_count`。
- 提供 Shields 风格的 SVG 徽章。
- 将统计快照保存到 KV，徽章请求不直接访问上游 API。
- 支持定时同步和受密钥保护的手动同步接口。
- 提供 Cloudflare Workers、Cloudflare Pages、EdgeOne Makers 适配入口，以及 ESA 的运行时适配模板。
- 不依赖 SQL 数据库。

## 徽章与接口

将 `https://你的服务域名` 替换为部署后的地址。

| 路径 | 说明 |
| --- | --- |
| `/total` | GitHub 与 CNB 最近一次成功统计值之和 |
| `/github` | GitHub Release 附件下载量 |
| `/cnb` | CNB Release 附件下载量 |
| `/stats.json` | 返回统计快照、更新时间和采集警告 |
| `/health` | 健康检查 |
| `/sync` | 手动同步；必须使用 POST 并提供密钥 |

README 徽章示例：

```md
![总下载量](https://你的服务域名/total)
![GitHub 下载量](https://你的服务域名/github)
![CNB 下载量](https://你的服务域名/cnb)
```

## 配置项

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `REPOSITORY` | 是 | GitHub 仓库，格式为 `owner/name` |
| `GITHUB_TOKEN` | 否 | GitHub Token；建议配置以提高 API 限额 |
| `CNB_RELEASES_URL` | 使用 CNB 时必需 | 从 CNB 官方 OpenAPI 文档确认并复制的 Releases API 完整地址 |
| `CNB_TOKEN` | 视接口权限而定 | 访问 CNB API 所需的令牌 |
| `SYNC_SECRET` | 是 | 手动同步接口的访问密钥 |
| `CACHE_TTL_SECONDS` | 否 | KV 快照过期时间，默认 30 天 |
| `GITHUB_API_BASE` | 否 | GitHub API 根地址，主要用于 GitHub Enterprise 或测试 |

**不要将 Token 或同步密钥提交到 Git 仓库。** 在平台控制台或平台 CLI 的 Secret 功能中配置敏感值。

## CNB API：需要先核实

本项目不会猜测 CNB API 的路径。请先查看 [CNB OpenAPI](https://api.cnb.cool)，确认以下信息后再设置 `CNB_RELEASES_URL`：

1. 使用的是列出仓库全部 Releases 的接口，而不是 ReleaseEvent 历史事件接口。
2. 返回的数据中包含 Release 附件的 `download_count`。
3. 如果接口有分页，已确认分页参数和终止条件，并能遍历全部 Releases。

目前适配器可解析数组响应，或常见的 `data`、`items`、`releases`、`results` 包装结构，并汇总嵌套的 `assets[].download_count`。**当前适配器尚未实现 CNB 分页遍历**；如果接口分页，当前结果可能不完整。在分页逻辑补齐并验证前，不应把结果用于需要精确总量的场景。

ReleaseEvent 历史记录不能直接等同于当前仓库所有 Releases 的完整下载量。

## Cloudflare Workers 部署

1. 在 Cloudflare 控制台创建 Workers KV namespace。
2. 将 namespace ID 填入根目录的 `wrangler.toml`，替换 `REPLACE_WITH_KV_NAMESPACE_ID`。
3. 检查 `wrangler.toml` 中的 `REPOSITORY`。
4. 配置 Secret：

   ```sh
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler secret put CNB_TOKEN
   npx wrangler secret put CNB_RELEASES_URL
   npx wrangler secret put SYNC_SECRET
   ```

   如果暂时不统计 CNB，可以不配置 CNB 相关变量；但 CNB 徽章在首次成功采集前不会有可用数据。

5. 安装依赖并执行检查：

   ```sh
   npm install
   npm run typecheck
   npm test
   ```

6. 部署：

   ```sh
   npm run deploy:cloudflare
   ```

7. 部署后检查 `/health`，再通过 POST 请求执行第一次同步：

   ```sh
   curl -X POST \
     -H "Authorization: Bearer 你的SYNC_SECRET" \
     https://你的服务域名/sync
   ```

根目录的 `wrangler.toml` 配置了每小时运行一次的 Cron Trigger。定时任务使用 UTC 时间。可参考 [Workers 定时处理程序文档](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/) 和 [KV 绑定文档](https://developers.cloudflare.com/kv/concepts/kv-bindings/)。

## Cloudflare Pages

`functions/[[path]].ts` 是 Pages Functions 适配入口。部署时需要将 KV namespace 绑定为 `STATS_KV`，并配置所需环境变量。

Pages Functions 的请求处理入口不等同于 Workers 的 Cron Trigger。请使用外部定时器或平台支持的调度方式，定时向 `/sync` 发送带有 `Authorization: Bearer 你的SYNC_SECRET` 请求头的 POST 请求。

部署前请在 Pages 项目中确认函数路由、KV 绑定和环境变量的实际配置。

## EdgeOne Pages / Makers

项目在 `edgeone/functions/[[path]].ts` 提供了适配模板，按 Makers KV 的 `get` / `put` 形式封装存储。

部署前请在当前 EdgeOne Makers 项目中核实：
- 实际支持的函数目录和路由约定；
- KV 绑定变量名称及返回值类型；
- 定时任务是否可用，以及如何配置；
- 环境变量在运行时的读取方式。

如果平台没有可用的定时任务，可以用外部定时服务调用受密钥保护的 `POST /sync`。该入口尚未在真实 EdgeOne 项目中完成端到端部署验证。

参考资料：[Makers KV 文档](https://pages.edgeone.ai/document/kv-storage)、[Pages KV 集成文档](https://pages.edgeone.ai/document/pages-kv-integration)。

## ESA Pages

`esa/handler.ts` 当前是运行时中立的适配器工厂，并非可以直接复制部署的 ESA Pages 函数入口。请根据 ESA 项目当前提供的 Request/Response 入口、定时任务和 KV 接口，将它连接到共享服务。

ESA KV 是可选的。如果不想启用 ESA KV，可以选择其他兼容的存储实现或将该平台作为后续适配目标。不要在未确认 ESA 运行时 API 的情况下，直接假定它与 Cloudflare Workers 兼容。

## 统计和缓存行为

- GitHub 统计会分页读取 Releases，每页最多 100 条；如果超过内置安全上限，程序会报错而不是静默返回部分结果。
- GitHub 统计汇总非草稿 Release 的附件下载量。
- KV 中保存最近一次统计快照；徽章请求只读取缓存。
- 某个来源采集失败时，如果有该来源上一次成功的数据，会保留旧值并在 `/stats.json` 的 `warnings` 中记录警告。
- 如果某个来源从未成功采集，对应徽章返回服务不可用，而不是伪造为 0。
- `/sync` 仅接受带正确 Bearer 密钥的 POST 请求。
- 目前 CNB 分页尚未实现，因此 CNB 总量只有在确认 API 返回完整 Releases 列表时才可认为完整。

## 本地开发

需要 Node.js 22 或兼容版本。

```sh
npm install
npm run typecheck
npm test
```

## 项目结构

```text
src/
  badge.ts       SVG 徽章渲染
  cnb.ts         CNB API 适配器
  config.ts      环境变量配置
  github.ts      GitHub Release 统计
  service.ts     共享同步、缓存和 HTTP 路由
  types.ts       类型和 KV 接口
platforms/
  cloudflare/    Cloudflare Workers 入口
functions/       Cloudflare Pages Functions 入口
edgeone/         EdgeOne Makers 适配模板
esa/             ESA 适配器模板
tests/           单元测试
```

## 许可证

当前仓库尚未添加许可证文件。明确开源许可前，请不要假定项目可以按任意开源许可证使用。
