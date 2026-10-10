# Cloudflare Download Proxy

This proxy is integrated into the main Cloudflare Worker at `platforms/cloudflare/worker.ts`. It shares the existing domain with the download badges and uses the same D1 database as the badge statistics source.

## Allowed hosts

- `cnb.cool`
- `github.com`
- `gitea.com`
- `gitlab.com`
- `gitee.com`
- `gitcode.com`

Only HTTPS URLs on these exact hosts are accepted. Other hosts, custom ports, credentials in URLs, and non-GET/HEAD methods are rejected.

## URL format

Append the full source URL after the proxy origin:

```text
https://download.example.com/https://cnb.cool/dtapp/certflow/-/releases/download/v1.0.0/certflow.zip
https://download.example.com/https://github.com/dtapps/certflow/releases/download/v1.0.0/certflow.zip
```

GET requests increment D1 counters and return a 302 redirect. HEAD requests redirect without incrementing counters. Counts mean requests through this proxy, not verified completed downloads.

The repository key uses the first two path segments (for example `/dtapp/certflow`). The file key uses the exact source hostname and pathname. Query strings are preserved when redirecting but excluded from the file key.

## D1 setup

Create a D1 database and place its ID in the root `wrangler.toml` under the `DB` binding. Initialize the schema from the repository root:

```sh
npx wrangler d1 create release-download-stats
npx wrangler d1 execute release-download-stats --remote --file=platforms/cloudflare/download-proxy/schema.sql
npx wrangler secret put STATS_TOKEN
npx wrangler secret put SYNC_SECRET
npm run deploy:cloudflare
```

The root Worker also needs its existing KV namespace ID configured in `wrangler.toml`. Replace all `REPLACE_WITH_...` placeholders before deployment.

## Query stats

The private endpoints require the `STATS_TOKEN` secret:

```sh
curl -H "Authorization: Bearer $STATS_TOKEN" \
  'https://download.example.com/_stats/repositories?limit=100'

curl -G -H "Authorization: Bearer $STATS_TOKEN" \
  --data-urlencode 'platform=cnb.cool' \
  --data-urlencode 'repository=/dtapp/certflow' \
  'https://download.example.com/_stats/files?limit=100'
```

## Important behavior

- The existing SVG badges and JSON statistics remain available. Cloudflare badge counts use the first-party D1 counters, not the providers' download count APIs.
- Only requests passing through this Worker can be counted. Direct requests to the origin are not included.
- Query parameters do not affect the statistics key but are retained in the redirect.
- If D1 writes fail, the Worker logs the error and still redirects; that request may not be counted.
