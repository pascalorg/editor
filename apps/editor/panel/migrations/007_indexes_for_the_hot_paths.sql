-- Indexes for the three lookups that run on pages everyone opens.
--
-- `sites.scene_id` was added by 004 with no index, so `publishedSceneIds()`
-- and `unpublishScene()` — which run on the console's scenes tab, on every
-- publish and on every scene delete — scan the whole table. It is also the
-- column the sign-in showcase joins on.
--
-- `users.created_at` is the ORDER BY of the account list and had no index, so
-- every listing filesorted the table.
--
-- `audit_log.created_at` orders the audit trail, which is the fastest-growing
-- table in the schema and the one most likely to be read with a LIMIT.
--
-- CREATE INDEX is not idempotent on MariaDB 10.11 (no IF NOT EXISTS for
-- indexes in every version), so each one is guarded against information_schema
-- and executed only when missing. The runner splits on semicolons outside
-- strings, so each guard is one statement.

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sites' AND INDEX_NAME = 'idx_sites_scene') = 0,
  'ALTER TABLE sites ADD KEY idx_sites_scene (scene_id)',
  'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'idx_users_created') = 0,
  'ALTER TABLE users ADD KEY idx_users_created (created_at)',
  'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_log' AND INDEX_NAME = 'idx_audit_created') = 0,
  'ALTER TABLE audit_log ADD KEY idx_audit_created (created_at)',
  'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
