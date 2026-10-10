import { describe, expect, it } from "vitest";
import { fetchCNBDownloads } from "../src/cnb";

describe("fetchCNBDownloads", () => {
  it("uses the fixed CNB API base and the documented ListReleases path", async () => {
    const requested: string[] = [];
    const fetcher = async (input: string | URL | Request) => {
      requested.push(String(input));
      return new Response(JSON.stringify([
        { assets: [{ download_count: 7 }, { download_count: 3 }] },
        { assets: [{ download_count: 11 }] },
      ]), { status: 200 });
    };

    const result = await fetchCNBDownloads("team/my-project", undefined, fetcher);
    expect(result.downloads).toBe(21);
    expect(requested[0]).toBe("https://api.cnb.cool/team/my-project/-/releases?page=1&page_size=100");
  });

  it("sums releases across pages using the total count response header", async () => {
    const requested: string[] = [];
    const fetcher = async (input: string | URL | Request) => {
      requested.push(String(input));
      const page = new URL(String(input)).searchParams.get("page");
      const releases = page === "1"
        ? Array.from({ length: 100 }, () => ({ assets: [{ download_count: 2 }] }))
        : [{ assets: [{ download_count: 5 }] }];
      return new Response(JSON.stringify(releases), {
        status: 200,
        headers: { "X-Total-Count": "101" },
      });
    };

    const result = await fetchCNBDownloads("team/my-project", undefined, fetcher);
    expect(result.downloads).toBe(205);
    expect(requested).toHaveLength(2);
    expect(new URL(requested[1]).searchParams.get("page")).toBe("2");
  });

  it("fails on an unexpected response envelope instead of reporting zero", async () => {
    await expect(fetchCNBDownloads(
      "team/my-project",
      undefined,
      async () => new Response(JSON.stringify({ message: "unexpected" }), { status: 200 }),
    )).rejects.toThrow("Unexpected CNB ListReleases response");
  });

  it("rejects invalid repository paths", async () => {
    await expect(fetchCNBDownloads("../escape", undefined)).rejects.toThrow("namespace/repository");
  });
});