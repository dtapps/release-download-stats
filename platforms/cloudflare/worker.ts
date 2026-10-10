import { handleRequest, syncStats } from "../../src/service";
import { readConfig, type RuntimeEnv } from "../../src/config";
import type { KVStore, RepositoryTarget } from "../../src/types";
import downloadProxy from "./download-proxy/worker";

interface Env extends RuntimeEnv {
  STATS_KV: KVNamespace;
  DB: D1Database;
  STATS_TOKEN: string;
}

const store = (kv: KVNamespace): KVStore => ({
  get: (key) => kv.get(key),
  put: (key, value, options) => kv.put(key, value, options),
});

function ownRepositoryIdentity(target: RepositoryTarget): { platform: string; repository: string } {
  return {
    platform: target.provider === "github" ? "github.com" : "cnb.cool",
    repository: "/" + target.repository.replace(/^\\/+|\\/+$/g, ""),
  };
}

function configForEnv(env: Env) {
  const config = readConfig(env);
  return {
    ...config,
    // Badge counts come from requests that passed through our own download
    // proxy. Do not use provider API download_count values for these badges.
    getOwnDownloadCount: async (target: RepositoryTarget): Promise<number> => {
      const identity = ownRepositoryIdentity(target);
      const row = await env.DB.prepare(
        "SELECT request_count FROM repository_stats WHERE platform = ? AND repository = ?",
      ).bind(identity.platform, identity.repository).first<{ request_count: number }>();
      return Number(row?.request_count ?? 0);
    },
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const isProxyRequest = url.pathname.startsWith("/https://");
    const isStatsRequest = url.pathname.startsWith("/_stats/");

    if (isProxyRequest || isStatsRequest) {
      const response = await downloadProxy.fetch(request, env);
      // Refresh the existing badge/KV snapshots after a successful counted
      // download request, so /badge/:id and /stats.json show our own count.
      if (isProxyRequest && request.method === "GET" && response.status === 302) {
        try {
          await syncStats(store(env.STATS_KV), configForEnv(env));
        } catch (error) {
          // Never break a download because the badge cache could not refresh.
          console.error("Badge stats refresh failed", error);
        }
      }
      return response;
    }

    return handleRequest(request, store(env.STATS_KV), configForEnv(env));
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await syncStats(store(env.STATS_KV), configForEnv(env));
  },
};
