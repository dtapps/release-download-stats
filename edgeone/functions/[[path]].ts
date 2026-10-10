import { getStore } from "@edgeone/pages-blob";
import { handleRequest, syncStats } from "../../src/service";
import { readConfig, type RuntimeEnv } from "../../src/config";
import type { KVStore } from "../../src/types";

// Blob 命名空间会在首次访问时自动创建，不需要申请或绑定 KV。
// 使用强一致读取，避免同步完成后徽章仍读到旧缓存。
const blob = getStore({ name: "release-download-stats", consistency: "strong" });

const store: KVStore = {
  get: async (key) => {
    const value = await blob.get(key, { type: "text", consistency: "strong" });
    return typeof value === "string" ? value : null;
  },
  // Blob 不支持 KV 的 expirationTtl；统计快照由后续同步覆盖更新。
  put: async (key, value) => {
    await blob.set(key, value);
  },
};

declare const REPOSITORIES: string;
declare const GITHUB_TOKEN: string | undefined;
declare const CNB_TOKEN: string | undefined;
declare const GITHUB_API_BASE: string | undefined;
declare const CACHE_TTL_SECONDS: string | undefined;
declare const SYNC_SECRET: string | undefined;

function env(): RuntimeEnv {
  return { REPOSITORIES, GITHUB_TOKEN, CNB_TOKEN, GITHUB_API_BASE, CACHE_TTL_SECONDS, SYNC_SECRET };
}

export async function onRequest(context: { request: Request }): Promise<Response> {
  return handleRequest(context.request, store, readConfig(env()));
}

// Configure the Makers scheduled trigger to invoke /sync with the secret header,
// or use the platform scheduler if enabled for the project.
export async function scheduled(): Promise<void> {
  await syncStats(store, readConfig(env()));
}
