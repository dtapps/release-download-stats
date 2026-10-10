import { describe, expect, it } from "vitest";
import { fetchGitHubDownloads } from "../src/github";

describe("fetchGitHubDownloads", () => {
  it("sums non-draft release assets and paginates", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      const data = calls === 1
        ? Array.from({ length: 100 }, () => ({ draft: false, assets: [{ download_count: 2 }] }))
        : [{ draft: true, assets: [{ download_count: 100 }] }, { draft: false, assets: [{ download_count: 3 }] }];
      return new Response(JSON.stringify(data), { status: 200 });
    };
    const result = await fetchGitHubDownloads("owner/repo", undefined, fetcher);
    expect(calls).toBe(2);
    expect(result.downloads).toBe(203);
  });

  it("does not hide upstream failures", async () => {
    await expect(fetchGitHubDownloads("owner/repo", undefined, async () => new Response("", { status: 403 })))
      .rejects.toThrow("HTTP 403");
  });
});