import { handleRequest, syncStats } from "../src/service";
import { readConfig, type RuntimeEnv } from "../src/config";
import type { KVStore } from "../src/types";

/**
 * Runtime-neutral ESA adapter.
 *
 * Wire this handler to the Request/Response entrypoint documented for your ESA
 * Pages runtime. KV is optional: provide a compatible store only if you've
 * enabled and bound ESA KV; otherwise use another supported KV implementation.
 * Verify the actual ESA function signature and binding names in your console
 * before deployment instead of assuming Cloudflare-compatible globals.
 */
export function createESAHandlers(env: RuntimeEnv, store?: KVStore) {
  if (!store) {
    return {
      fetch: async (): Promise<Response> => new Response(
        "ESA KV is not configured. Bind a KV store or deploy the shared handler with an external supported store.",
        { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
      ),
    };
  }
  const config = readConfig(env);
  return {
    fetch: (request: Request) => handleRequest(request, store, config),
    sync: () => syncStats(store, config),
  };
}