import { handleRequest, syncStats } from "../../src/service";
import { readConfig, type RuntimeEnv } from "../../src/config";
import type { KVStore } from "../../src/types";

// Bind a Makers KV namespace to the variable name STATS_KV in the project.
// EdgeOne Makers documents get(key, {type:"text"}) and put(key, value).
declare const STATS_KV: {
  get(key: string, options?: { type: string }): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
};

const store: KVStore = {
  get: (key) => STATS_KV.get(key, { type: "text" }),
  put: (key, value) => STATS_KV.put(key, value),
};

declare const REPOSITORY: string;
declare const GITHUB_TOKEN: string | undefined;
declare const CNB_TOKEN: string | undefined;
declare const CNB_RELEASES_URL: string | undefined;
declare const GITHUB_API_BASE: string | undefined;
declare const CACHE_TTL_SECONDS: string | undefined;
declare const SYNC_SECRET: string | undefined;

function env(): RuntimeEnv {
  return { REPOSITORY, GITHUB_TOKEN, CNB_TOKEN, CNB_RELEASES_URL, GITHUB_API_BASE, CACHE_TTL_SECONDS, SYNC_SECRET };
}

export async function onRequest(context: { request: Request }): Promise<Response> {
  return handleRequest(context.request, store, readConfig(env()));
}

// Configure the Makers scheduled trigger to invoke /sync with the secret header,
// or use the platform scheduler if enabled for the project.
export async function scheduled(): Promise<void> {
  await syncStats(store, readConfig(env()));
}