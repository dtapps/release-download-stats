import type { FetchLike, ProviderStats } from "./types";

interface GitHubAsset {
  download_count?: number;
}
interface GitHubRelease {
  draft?: boolean;
  assets?: GitHubAsset[];
}

const API_VERSION = "2022-11-28";

export async function fetchGitHubDownloads(
  repository: string,
  token: string | undefined,
  fetcher: FetchLike = fetch,
  apiBase = "https://api.github.com",
): Promise<ProviderStats> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("repository must use owner/name format");
  }

  let total = 0;
  let page = 1;
  let updatedAt = new Date().toISOString();
  const perPage = 100;

  // GitHub paginates releases. Stop only on a short page; fail rather than
  // silently returning a partial total when an upstream page errors.
  while (true) {
    const url = new URL(`/repos/${repository}/releases`, apiBase);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));

    const headers = new Headers({
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
    });
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const response = await fetcher(url, { headers });
    if (!response.ok) {
      throw new Error(`GitHub API returned HTTP ${response.status} on page ${page}`);
    }

    const releases = await response.json() as GitHubRelease[];
    if (!Array.isArray(releases)) throw new Error("Unexpected GitHub releases response");

    for (const release of releases) {
      if (release.draft) continue;
      for (const asset of release.assets ?? []) {
        const count = asset.download_count;
        if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
          total += Math.trunc(count);
        }
      }
    }

    if (releases.length < perPage) break;
    page += 1;
    if (page > 100) {
      throw new Error("GitHub release pagination exceeded 100 pages; refusing a potentially incomplete total");
    }
  }

  return { downloads: total, updatedAt, source: "GitHub Releases API" };
}