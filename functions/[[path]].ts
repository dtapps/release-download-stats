import { handleRequest, syncStats } from "../src/service";
import { readConfig, type RuntimeEnv } from "../src/config";
import type { KVStore } from "../src/types";

interface Env extends RuntimeEnv {
  STATS_KV: KVNamespace;
}
const store = (kv: KVNamespace): KVStore => ({
  get: (key) => kv.get(key),
  put: (key, value, options) => kv.put(key, value, options),
});

export const onRequest: PagesFunction<Env> = async ({ request, env }) =>
  handleRequest(request, store(env.STATS_KV), readConfig(env));

// Pages Functions does not expose the Workers scheduled() handler here.
// Use an external scheduler to POST /sync with Authorization: Bearer <SYNC_SECRET>.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const config = readConfig(env);
  return handleRequest(request, store(env.STATS_KV), config);
};