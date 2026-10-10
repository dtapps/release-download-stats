export type Provider = "github" | "cnb";

export interface RepositoryTarget {
  /** Stable, URL-safe identifier used by /badge/:id and /stats/:id.json. */
  id: string;
  provider: Provider;
  /** Source repository in owner/name or namespace/name format. */
  repository: string;
  /** Required for CNB: exact, verified Releases API URL. */
  releasesUrl?: string;
}

export interface ProviderStats {
  downloads: number;
  updatedAt: string;
  source: string;
}

export interface RepositorySnapshot {
  schemaVersion: 1;
  id: string;
  provider: Provider;
  repository: string;
  downloads: number;
  updatedAt: string;
  source: string;
  warning?: string;
}

export interface StatsSnapshot {
  schemaVersion: 1;
  updatedAt: string;
  repositories: RepositorySnapshot[];
  totalDownloads: number;
  warnings: string[];
}

export interface KVStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface StatsConfig {
  repositories: RepositoryTarget[];
  githubToken?: string;
  cnbToken?: string;
  githubApiBase?: string;
  cacheTtlSeconds?: number;
}

export interface FetchLike {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
}