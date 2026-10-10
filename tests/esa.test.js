import { beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../esa/handler.js";

const values = new Map();

class MockEdgeKV {
  constructor(options) {
    expect(options).toEqual({ namespace: "release-download-stats" });
  }

  async get(key) {
    return values.has(key) ? values.get(key) : undefined;
  }

  async put(key, value) {
    values.set(key, value);
  }
}

beforeEach(() => {
  values.clear();
  vi.stubGlobal("EdgeKV", MockEdgeKV);
});

describe("ESA download proxy", () => {
  it("serves the homepage and health endpoint", async () => {
    const home = await handler.fetch(new Request("https://stats.example.com/"));
    expect(home.status).toBe(200);
    expect(home.headers.get("content-type")).toContain("text/html");
    expect(await home.text()).toContain("下载请求自统计服务");

    const health = await handler.fetch(new Request("https://stats.example.com/health"));
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, storage: "ESA EdgeKV" });
  });

  it("counts GET requests by host and path while ignoring query strings", async () => {
    const first = await handler.fetch(new Request(
      "https://stats.example.com/https://github.com/owner/repo/releases/download/v1/file.zip?token=one",
    ));
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe(
      "https://github.com/owner/repo/releases/download/v1/file.zip?token=one",
    );

    const second = await handler.fetch(new Request(
      "https://stats.example.com/https://github.com/owner/repo/releases/download/v1/file.zip?token=two",
    ));
    expect(second.status).toBe(302);

    const stats = await handler.fetch(new Request(
      "https://stats.example.com/stats/github.com/owner/repo.json",
    ));
    expect(await stats.json()).toMatchObject({
      platform: "github.com",
      repository: "/owner/repo",
      downloads: 2,
      source: "First-party download proxy (ESA EdgeKV)",
    });

    const total = await handler.fetch(new Request("https://stats.example.com/total"));
    expect(total.headers.get("content-type")).toContain("image/svg+xml");
    expect(values.get("total")).toContain('"downloads":2');

    const head = await handler.fetch(new Request(
      "https://stats.example.com/https://github.com/owner/repo/releases/download/v1/file.zip",
      { method: "HEAD" },
    ));
    expect(head.status).toBe(302);
    expect(values.get("total")).toContain('"downloads":2');
  });

  it("serves a Shields.io Dynamic JSON Badge with customizable label and color", async () => {
    const response = await handler.fetch(new Request(
      "https://stats.example.com/shields.json?label=%E4%B8%8B%E8%BD%BD%E8%AF%B7%E6%B1%82%E6%95%B0&color=%23409EFF",
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      label: "下载请求数",
      message: "0",
      color: "#409EFF",
    });
  });

  it("rejects unsupported source hosts", async () => {
    const response = await handler.fetch(new Request(
      "https://stats.example.com/https://example.com/owner/repo/file.zip",
    ));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "Not found or invalid target URL" });
  });
});
