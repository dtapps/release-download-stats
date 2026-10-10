import type { StatsConfig } from "./types";

export interface RuntimeEnv {
  REPOSITORY: string;
  GITHUB_TOKEN?: string;
  CNB_TOKEN?: string;
  CNB_RELEASES_URL?: string;
  GITHUB_API_BASE?: string;
  CACHE_TTL_SECONDS?: string;
  SYNC_SECRET?: string;
}

export function readConfig(env: RuntimeEnv): StatsConfig & { syncSecret?: string } {
  if (!env.REPOSITORY) throw new Error("REPOSITORY is required (owner/name)");
  return {
    repository: env.REPOSITORY,
    githubToken: env.GITHUB_TOKEN,
    cnbToken: env.CNB_TOKEN,
    cnbReleasesUrl: env.CNB_RELEASES_URL,
    githubApiBase: env.GITHUB_API_BASE,
    cacheTtlSeconds: env.CACHE_TTL_SECONDS ? Number(env.CACHE_TTL_SECONDS) : undefined,
    syncSecret: env.SYNC_SECRET,
  };
}