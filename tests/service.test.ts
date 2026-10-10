import { describe, expect, it } from "vitest";
import { handleRequest, SNAPSHOT_KEY } from "../src/service";
import type { KVStore, RepositorySnapshot, StatsConfig } from "../src/types";

function memoryKV(initial: Record<string, string> = {}): KVStore {
  const data = new Map(Object.entries(initial));
  return {
    get: async (key) => data.get(key) ?? null,
    put: async (key, value) => { data.set(key, value); },
  };
}

const targets: StatsConfig["repositories"] = [
  { id: "fnmusic-sync", provider: "github", repository: "dtapps/fnmusic-sync" },
  { id: "certflow", provider: "github", repository: "dtapps/certflow" },
];

function cached(target: typeof targets[number], downloads: number): RepositorySnapshot {
  return {
    schemaVersion: 1,
    id: target.id,
    provider: target.provider,
    repository: target.repository,
    downloads,
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "test",
  };
}

describe("multi-repository handleRequest", () => {
  it("serves each configured repository's own SVG badge", async () => {
    const kv = memoryKV({
      "release-download-stats:v2:repo:fnmusic-sync": JSON.stringify(cached(targets[0], 123)),
      "release-download-stats:v2:repo:certflow": JSON.stringify(cached(targets[1], 456)),
    });
    const first = await handleRequest(new Request("https://badge.example/badge/fnmusic-sync"), kv, { repositories: targets });
    const second = await handleRequest(new Request("https://badge.example/badge/certflow"), kv, { repositories: targets });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.text()).toContain("123");
    expect(await second.text()).toContain("456");
  });

  it("returns each repository as separate JSON data", async () => {
    const kv = memoryKV({
      "release-download-stats:v2:repo:fnmusic-sync": JSON.stringify(cached(targets[0], 123)),
      "release-download-stats:v2:repo:certflow": JSON.stringify(cached(targets[1], 456)),
    });
    const response = await handleRequest(new Request("https://badge.example/stats/fnmusic-sync.json"), kv, { repositories: targets });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "fnmusic-sync", downloads: 123 });
  });

  it("keeps aggregate total separate from each repository count", async () => {
    const kv = memoryKV({
      "release-download-stats:v2:repo:fnmusic-sync": JSON.stringify(cached(targets[0], 123)),
      "release-download-stats:v2:repo:certflow": JSON.stringify(cached(targets[1], 456)),
    });
    const response = await handleRequest(new Request("https://badge.example/total"), kv, { repositories: targets });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("579");
  });

  it("requires a secret and POST for manual sync", async () => {
    const kv = memoryKV();
    const unauthorized = await handleRequest(new Request("https://badge.example/sync", { method: "POST" }), kv, { repositories: targets });
    expect(unauthorized.status).toBe(401);
    const wrongMethod = await handleRequest(new Request("https://badge.example/sync", {
      method: "GET", headers: { authorization: "Bearer secret" },
    }), kv, { repositories: targets, syncSecret: "secret" });
    expect(wrongMethod.status).toBe(405);
  });

  it("rejects unknown repository IDs rather than serving another repository", async () => {
    const response = await handleRequest(new Request("https://badge.example/badge/not-configured"), memoryKV(), { repositories: targets });
    expect(response.status).toBe(404);
  });
});