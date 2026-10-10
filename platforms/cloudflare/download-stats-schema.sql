CREATE TABLE IF NOT EXISTS repository_download_stats (
  platform TEXT NOT NULL,
  repository TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  first_requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (platform, repository)
);

CREATE TABLE IF NOT EXISTS file_download_stats (
  platform TEXT NOT NULL,
  repository TEXT NOT NULL,
  resource_path TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  first_requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (platform, repository, resource_path)
);

CREATE INDEX IF NOT EXISTS idx_repository_download_stats_count
  ON repository_download_stats(request_count DESC);

CREATE INDEX IF NOT EXISTS idx_file_download_stats_count
  ON file_download_stats(request_count DESC);

CREATE INDEX IF NOT EXISTS idx_file_download_stats_repository
  ON file_download_stats(platform, repository);
