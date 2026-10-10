/**
 * Ensure the D1 schema exists even when a platform's build pipeline skipped
 * Wrangler migrations. Every statement is idempotent, so this is safe on
 * concurrent requests and on databases that were already migrated.
 */
export async function ensureStatsSchema(db: D1Database): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS repository_stats (
      platform TEXT NOT NULL,
      repository TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
      first_requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (platform, repository)
    )`,
    `CREATE TABLE IF NOT EXISTS file_stats (
      platform TEXT NOT NULL,
      repository TEXT NOT NULL,
      resource_path TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
      first_requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (platform, repository, resource_path)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_repository_stats_count
      ON repository_stats(request_count DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_file_stats_count
      ON file_stats(request_count DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_file_stats_repository
      ON file_stats(platform, repository)`,
    `CREATE TABLE IF NOT EXISTS request_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requested_at TEXT NOT NULL,
      platform TEXT NOT NULL,
      repository TEXT NOT NULL,
      resource_path TEXT NOT NULL,
      method TEXT NOT NULL,
      status_code INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_request_history_requested_at
      ON request_history(requested_at DESC, id DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_request_history_repository
      ON request_history(platform, repository, requested_at DESC)`,
  ];

  for (const statement of statements) {
    await db.prepare(statement).run();
  }
}
