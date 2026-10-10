export type Provider = "github" | "cnb";

export interface ProviderStats {
  downloads: number;
  updatedAt: string;
  source: string;
}

export interface StatsSnapshot {
  schemaVersion: 1;
  repository: string;
  total: number;
  github: ProviderStats | null;
  cnb: ProviderStats | null;
  updatedAt: string;
  warnings: string[];
}

export interface KVStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface StatsConfig {
  repository: string;
  githubToken?: string;
  cnbToken?: string;
  cnbReleasesUrl?: string;
  githubApiBase?: string;
  cacheTtlSeconds?: number;
}

export interface FetchLike {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
}