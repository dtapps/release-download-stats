import type { RepositoryTarget, StatsConfig } from "./types";

export interface RuntimeEnv {
  /** JSON array; see README for the format. */
  REPOSITORIES?: string;
  /** Backward-compatible single GitHub repository fallback. */
  REPOSITORY?: string;
  GITHUB_TOKEN?: string;
  CNB_TOKEN?: string;
  GITHUB_API_BASE?: string;
  CACHE_TTL_SECONDS?: string;
  SYNC_SECRET?: string;
}

function parseRepositories(value: string): RepositoryTarget[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("REPOSITORIES must be a valid JSON array");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("REPOSITORIES must be a non-empty JSON array");
  }

  const ids = new Set<string>();
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`REPOSITORIES[${index}] must be an object`);
    const value = item as Record<string, unknown>;
    const id = typeof value.id === "string" ? value.id.trim() : "";
    const provider = value.provider;
    const repository = typeof value.repository === "string" ? value.repository.trim() : "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id)) {
      throw new Error(`REPOSITORIES[${index}].id must be a URL-safe identifier`);
    }
    if (ids.has(id)) throw new Error(`Duplicate repository id: ${id}`);
    ids.add(id);
    if (provider !== "github" && provider !== "cnb") {
      throw new Error(`REPOSITORIES[${index}].provider must be "github" or "cnb"`);
    }
    if (!repository || repository.split("/").length !== 2 || repository.split("/").some((part) => !part)) {
      throw new Error(`REPOSITORIES[${index}].repository must use owner/name format`);
    }
    const releasesUrl = typeof value.releasesUrl === "string" ? value.releasesUrl.trim() : undefined;
    if (provider === "cnb" && !releasesUrl) {
      throw new Error(`REPOSITORIES[${index}].releasesUrl is required for CNB targets`);
    }
    if (releasesUrl) {
      const url = new URL(releasesUrl);
      if (url.protocol !== "https:") throw new Error(`REPOSITORIES[${index}].releasesUrl must use HTTPS`);
    }
    return { id, provider, repository, releasesUrl } as RepositoryTarget;
  });
}

export function readConfig(env: RuntimeEnv): StatsConfig & { syncSecret?: string } {
  let repositories: RepositoryTarget[];
  if (env.REPOSITORIES?.trim()) {
    repositories = parseRepositories(env.REPOSITORIES);
  } else if (env.REPOSITORY?.trim()) {
    // Compatibility for the initial single-GitHub-repository configuration.
    repositories = [{
      id: env.REPOSITORY.split("/").pop()!.replace(/[^A-Za-z0-9._-]/g, "-"),
      provider: "github",
      repository: env.REPOSITORY.trim(),
    }];
  } else {
    throw new Error("REPOSITORIES is required; configure a JSON array of repository targets");
  }

  const cacheTtlSeconds = env.CACHE_TTL_SECONDS ? Number(env.CACHE_TTL_SECONDS) : undefined;
  if (cacheTtlSeconds !== undefined && (!Number.isFinite(cacheTtlSeconds) || cacheTtlSeconds <= 0)) {
    throw new Error("CACHE_TTL_SECONDS must be a positive number");
  }
  return {
    repositories,
    githubToken: env.GITHUB_TOKEN,
    cnbToken: env.CNB_TOKEN,
    githubApiBase: env.GITHUB_API_BASE,
    cacheTtlSeconds,
    syncSecret: env.SYNC_SECRET,
  };
}