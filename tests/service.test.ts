import { describe, expect, it } from "vitest";
import { handleRequest, SNAPSHOT_KEY } from "../src/service";
import type { KVStore, StatsSnapshot } from "../src/types";

function memoryKV(initial: Record<string, string> = {}): KVStore {
  const data = new Map(Object.entries(initial));
  return {
    get: async (key) => data.get(key) ?? null,
    put: async (key, value) => { data.set(key, value); },
  };
}

const snapshot: StatsSnapshot = {
  schemaVersion: 1,
  repository: "owner/repo",
  total: 125,
  github: { downloads: 100, updatedAt: "2026-01-01T00:00:00.000Z", source: "test" },
  cnb: { downloads: 25, updatedAt: "2026-01-01T00:00:00.000Z", source: "test" },
  updatedAt: "2026-01-01T00:00:00.000Z",
  warnings: [],
};

describe("handleRequest", () => {
  it("serves an SVG badge from KV without calling upstream APIs", async () => {
    const kv = memoryKV({ [SNAPSHOT_KEY]: JSON.stringify(snapshot) });
    const response = await handleRequest(new Request("https://badge.example/total"), kv, {
      repository: "owner/repo",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(await response.text()).toContain("downloads");
  });

  it("requires a secret and POST for manual sync", async () => {
    const kv = memoryKV({ [SNAPSHOT_KEY]: JSON.stringify(snapshot) });
    const unauthorized = await handleRequest(new Request("https://badge.example/sync", {
      method: "POST",
    }), kv, { repository: "owner/repo" });
    expect(unauthorized.status).toBe(401);

    const wrongMethod = await handleRequest(new Request("https://badge.example/sync", {
      method: "GET",
      headers: { authorization: "Bearer secret" },
    }), kv, { repository: "owner/repo", syncSecret: "secret" });
    expect(wrongMethod.status).toBe(405);
  });

  it("does not fake zero when one provider has never succeeded", async () => {
    const onlyGithub = { ...snapshot, cnb: null, total: 100 };
    const kv = memoryKV({ [SNAPSHOT_KEY]: JSON.stringify(onlyGithub) });
    const response = await handleRequest(new Request("https://badge.example/cnb"), kv, {
      repository: "owner/repo",
    });
    expect(response.status).toBe(503);
  });
});