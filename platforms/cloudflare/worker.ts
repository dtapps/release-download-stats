import { handleRequest, syncStats } from "../../src/service";
import { readConfig, type RuntimeEnv } from "../../src/config";
import type { KVStore } from "../../src/types";

interface Env extends RuntimeEnv {
  STATS_KV: KVNamespace;
}
const store = (kv: KVNamespace): KVStore => ({
  get: (key) => kv.get(key),
  put: (key, value, options) => kv.put(key, value, options),
});

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, store(env.STATS_KV), readConfig(env));
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await syncStats(store(env.STATS_KV), readConfig(env));
  },
};