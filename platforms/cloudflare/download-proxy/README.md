# Cloudflare Download Proxy

A standalone Worker that counts download requests and redirects to public release assets hosted on the allowlisted providers. It does not require a provider token for public assets.

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

The Worker counts GET requests and returns a 302 redirect. HEAD requests redirect without incrementing counters. Counts mean requests through this proxy, not verified completed downloads.

The repository key uses the first two path segments (for example `/dtapp/certflow`). The file key uses the exact source hostname and pathname. Query strings are preserved when redirecting but excluded from the file key; fragments are not sent to the Worker by browsers.

## Deploy

From the repository root:

```sh
npx wrangler d1 create release-download-stats
```

Copy the returned database ID to `wrangler.download-proxy.toml`, then initialize the database:

```sh
npx wrangler d1 execute release-download-stats --remote --file=platforms/cloudflare/download-proxy/schema.sql --config=wrangler.download-proxy.toml
```

Set a separate secret for the private statistics endpoints:

```sh
npx wrangler secret put STATS_TOKEN --config=wrangler.download-proxy.toml
```

Deploy:

```sh
npx wrangler deploy --config=wrangler.download-proxy.toml
```

Bind a custom domain to this Worker in the Cloudflare dashboard after confirming the generated workers.dev URL works.

## Query stats

```sh
curl -H "Authorization: Bearer $STATS_TOKEN" \
  'https://download.example.com/_stats/repositories?limit=100'

curl -G -H "Authorization: Bearer $STATS_TOKEN" \
  --data-urlencode 'platform=cnb.cool' \
  --data-urlencode 'repository=/dtapp/certflow' \
  'https://download.example.com/_stats/files?limit=100'
```

The stats endpoints require `STATS_TOKEN`. Keep it in a secret manager or shell environment; do not commit it.

## Important behavior

- Query parameters are excluded from the statistics key but retained in the redirect destination.
- URL fragments are not transmitted in HTTP requests and cannot be recovered by the Worker.
- If D1 writes fail, the Worker logs the failure and still redirects, so an occasional request may not be counted.
- Requests made directly to the origin host do not pass through this Worker and cannot be counted.
