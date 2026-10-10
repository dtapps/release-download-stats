import { handleRequest, syncStats } from "./service";
import { readConfig, type RuntimeEnv } from "./config";
import type { KVStore } from "./types";

export interface RuntimeContext {
  waitUntil?(promise: Promise<unknown>): void;
}

export function createHandler(env: RuntimeEnv & { STATS_KV: KVStore }) {
  const config = readConfig(env);
  return {
    fetch(request: Request): Promise<Response> {
      return handleRequest(request, env.STATS_KV, config);
    },
    async sync(): Promise<void> {
      await syncStats(env.STATS_KV, config);
    },
  };
}