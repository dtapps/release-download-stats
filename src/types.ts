export type Provider = "github" | "cnb";

export interface RepositoryTarget {
  /** Stable URL-safe ID used by /badge/:id and /stats/:id.json. */
  id: string;
  provider: Provider;
  /** GitHub owner/name, or CNB namespace/repository path. */
  repository: string;
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
  /** null means this target has not yet completed a successful sync. */
  downloads: number | null;
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
  /** Optional first-party counter used instead of querying a provider API. */
  getOwnDownloadCount?: (target: RepositoryTarget) => Promise<number>;
}

export interface FetchLike {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
}
