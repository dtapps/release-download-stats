# Release Download Stats

A small TypeScript edge app that exposes cached SVG badges for release-asset downloads from GitHub and CNB.

> **CNB setup requires one explicit verification step.** CNB's official OpenAPI documentation describes release assets with a `download_count` field, but this repository intentionally does not invent a release-list endpoint. Copy the current Releases API URL from [CNB OpenAPI](https://api.cnb.cool) and set it as `CNB_RELEASES_URL`. The response must contain a release array with nested `assets[].download_count`. If the endpoint is paginated, configure an endpoint that returns all releases or extend the CNB adapter with the documented pagination scheme before relying on the total.

## Routes

- `/total` — total downloads from the latest successful GitHub and CNB snapshots
- `/github` — GitHub release-asset downloads
- `/cnb` — CNB release-asset downloads
- `/stats.json` — snapshot and collection warnings
- `/health` — health check
- `/sync` — protected manual refresh; requires `Authorization: Bearer <SYNC_SECRET>`

Badges are served from KV and do not call upstream APIs on every request. The scheduled sync refreshes the snapshot hourly. If one provider fails, the last successful value for that provider is retained and a warning is recorded. If no provider has any usable value, the sync fails rather than publishing a fake zero.

## Configuration

- `REPOSITORY`: GitHub repository in `owner/name` format
- `GITHUB_TOKEN`: optional, recommended to raise API rate limits
- `CNB_RELEASES_URL`: exact verified CNB Releases API URL (required for CNB stats)
- `CNB_TOKEN`: token for CNB OpenAPI if required
- `SYNC_SECRET`: required for manual `/sync`
- `CACHE_TTL_SECONDS`: optional KV snapshot TTL
- `GITHUB_API_BASE`: optional, mainly for testing GitHub Enterprise

Never commit access tokens or secrets.

## Cloudflare Workers

1. Create a Workers KV namespace.
2. Put its ID in `wrangler.toml` instead of `REPLACE_WITH_KV_NAMESPACE_ID`.
3. Set secrets:
   ```sh
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler secret put CNB_TOKEN
   npx wrangler secret put CNB_RELEASES_URL
   npx wrangler secret put SYNC_SECRET
   ```
   For `CNB_RELEASES_URL`, use the exact endpoint URL copied from CNB OpenAPI; it is a URL, not a token.
4. Set `REPOSITORY` in `wrangler.toml` or use `wrangler secret put REPOSITORY` if you prefer not to store it in config.
5. Deploy: `npm install && npm run deploy:cloudflare`.
6. Check `/health`; then trigger the first sync with an authenticated POST to `/sync`.

Cron triggers run in UTC. See [Cloudflare Scheduled Handler docs](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/) and [KV bindings docs](https://developers.cloudflare.com/kv/concepts/kv-bindings/).

## Cloudflare Pages

The `functions/[[path]].ts` adapter is a Pages Functions entrypoint. Bind a KV namespace as `STATS_KV`. Pages Functions do not run the Workers `scheduled()` export; use a separate scheduler to POST `/sync` with the secret header. Confirm the Pages project environment variables and KV binding in the dashboard.

## EdgeOne Makers

The adapter under `edgeone/functions/[[path]].ts` uses the Makers KV `get(key, { type: "text" })` and `put(key, value)` methods documented by EdgeOne. Bind a KV namespace as `STATS_KV` and configure the runtime variables. Verify the exact Functions routing convention and scheduled-task availability in the current Makers project before deploying; if scheduled execution is unavailable, use an external scheduler to call the protected `/sync` route.

References: [Makers KV](https://pages.edgeone.ai/document/kv-storage), [Makers KV integration](https://pages.edgeone.ai/document/pages-kv-integration).

## ESA Pages

`esa/handler.ts` provides a runtime-neutral adapter factory, not a claim that ESA exposes Cloudflare's handler or binding APIs. Connect its `fetch` and `sync` methods to the actual Request/Response and scheduling hooks documented for your ESA Pages project. KV is optional: if you do not want to enable ESA KV, provide another supported store or deploy this adapter where a compatible KV is available. Verify the runtime signature and binding names in the console before deployment.

## Development

```sh
npm install
npm test
npm run typecheck
```

## Badge Markdown

Replace `https://YOUR_DEPLOYMENT` with your deployed URL:

```md
![Total downloads](https://YOUR_DEPLOYMENT/total)
![GitHub downloads](https://YOUR_DEPLOYMENT/github)
![CNB downloads](https://YOUR_DEPLOYMENT/cnb)
```

## Scope and limitations

- GitHub totals sum the `download_count` of non-draft release assets across paginated releases.
- CNB totals sum `assets[].download_count` from the configured API response. The adapter does not infer historical totals from ReleaseEvent history.
- CNB pagination is not guessed. Confirm that your configured endpoint returns all relevant releases.
- Provider failures are surfaced in `/stats.json`; stale successful snapshots are retained where possible.
- No SQL database is required; storage is behind a minimal KV interface.
