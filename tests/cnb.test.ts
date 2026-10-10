import { describe, expect, it } from "vitest";
import { fetchCNBDownloads } from "../src/cnb";

describe("fetchCNBDownloads", () => {
  it("sums download_count values from a configured response", async () => {
    const fetcher = async () => new Response(JSON.stringify({
      data: {
        releases: [
          { assets: [{ download_count: 7 }, { download_count: 3 }] },
          { assets: [{ download_count: 11 }] },
        ],
      },
    }), { status: 200 });

    const result = await fetchCNBDownloads("https://api.example.test/releases", undefined, fetcher);
    expect(result.downloads).toBe(21);
  });

  it("rejects non-HTTPS endpoint URLs", async () => {
    await expect(fetchCNBDownloads("http://api.example.test/releases", undefined))
      .rejects.toThrow("must use HTTPS");
  });

  it("fails on an unexpected response envelope instead of reporting zero", async () => {
    await expect(fetchCNBDownloads(
      "https://api.example.test/releases",
      undefined,
      async () => new Response(JSON.stringify({ message: "unexpected" }), { status: 200 }),
    )).rejects.toThrow("Unexpected CNB response");
  });
});