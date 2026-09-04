-- 001_init — DigitalTwin core schema
-- Contract: "DigitalTwin Rebuild Plan" section 10 (MySQL 8, InnoDB, utf8mb4).
-- Two-layer identity: internal BIGINT UNSIGNED PK never leaves the process;
-- CHAR(26) ULID public_id is the only id that appears in URLs, APIs and logs.
-- Collation utf8mb4_unicode_ci; Turkish name ordering is done in the app layer
-- with Intl.Collator('tr') so the I/ı trap never reaches the database.
-- All timestamps are stored UTC and formatted per locale on display.

CREATE TABLE users (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id     CHAR(26) NOT NULL UNIQUE,
  email         VARCHAR(320) NOT NULL UNIQUE,
  username      VARCHAR(64)  NOT NULL UNIQUE,
  full_name     VARCHAR(160) NOT NULL,
  org           ENUM('internal','external') NOT NULL DEFAULT 'internal',
  global_role   VARCHAR(48)  NOT NULL DEFAULT 'Viewer',
  status        ENUM('invited','active','inactive','suspended') NOT NULL,
  password_hash VARBINARY(255) NULL,           -- argon2id; NULL while invited
  password_set_at   TIMESTAMP NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  failed_attempts   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until      TIMESTAMP NULL,
  last_seen_at      TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_users_status (status), KEY idx_users_org (org)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sites (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL UNIQUE,            -- 'Sakarya LM1'
  status ENUM('active','setup','archived') NOT NULL DEFAULT 'setup',
  storage_slots INT UNSIGNED NULL, picking_slots INT UNSIGNED NULL,
  footprint_m2  INT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sites_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE assignments (                       -- user x site x role
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  role VARCHAR(48) NOT NULL,
  granted_by BIGINT UNSIGNED NOT NULL,
  granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_site (user_id, site_id),
  CONSTRAINT fk_asg_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_asg_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_asg_by   FOREIGN KEY (granted_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE invitations (                       -- invite lifecycle
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash BINARY(32) NOT NULL UNIQUE,         -- SHA-256; raw token only in the email
  invited_by BIGINT UNSIGNED NOT NULL,
  expires_at TIMESTAMP NOT NULL,                 -- default +7 days
  resent_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  accepted_at TIMESTAMP NULL, revoked_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_inv_user (user_id),
  CONSTRAINT fk_inv_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_inv_by   FOREIGN KEY (invited_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sessions (
  id BINARY(16) PRIMARY KEY,                     -- random 128 bit
  user_id BIGINT UNSIGNED NOT NULL,
  device VARCHAR(160) NULL, ip VARBINARY(16) NULL,
  trusted_until TIMESTAMP NULL,                  -- trusted device
  keep_signed_in TINYINT(1) NOT NULL DEFAULT 0,
  mfa_pending TINYINT(1) NOT NULL DEFAULT 0,     -- set until the OTP step clears
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activity_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP NULL,
  KEY idx_sess_user (user_id), KEY idx_sess_exp (expires_at),
  CONSTRAINT fk_sess_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE two_factor (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  totp_secret VARBINARY(255) NOT NULL,           -- encrypted in the app layer
  confirmed_at TIMESTAMP NULL,
  CONSTRAINT fk_2fa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE recovery_codes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  code_hash BINARY(32) NOT NULL,
  used_at TIMESTAMP NULL,
  KEY idx_rc_user (user_id),
  CONSTRAINT fk_rc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE api_keys (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  prefix CHAR(8) NOT NULL,                       -- the part shown in the list
  key_hash BINARY(32) NOT NULL UNIQUE,           -- raw key returned once, at creation
  scope ENUM('read','read_write') NOT NULL DEFAULT 'read',
  site_id BIGINT UNSIGNED NULL,                  -- NULL = all sites
  created_by BIGINT UNSIGNED NOT NULL,
  last_used_at TIMESTAMP NULL, revoked_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_key_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_key_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE webhooks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL UNIQUE,
  url VARCHAR(2048) NOT NULL,
  events JSON NOT NULL,                          -- ['user.invited','site.created',...]
  secret VARBINARY(255) NOT NULL,                -- signing secret, encrypted
  status ENUM('active','paused','failing') NOT NULL DEFAULT 'active',
  fail_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_delivery_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE jobs (                              -- job queue
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL UNIQUE,
  kind VARCHAR(64) NOT NULL,                     -- ifc_import, report_export, backup...
  payload JSON NULL,
  site_id BIGINT UNSIGNED NULL,
  status ENUM('queued','running','done','failed','cancelled') NOT NULL DEFAULT 'queued',
  progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
  error_text TEXT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  queued_by BIGINT UNSIGNED NOT NULL,
  queued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP NULL, finished_at TIMESTAMP NULL,
  KEY idx_jobs_status (status, queued_at),
  CONSTRAINT fk_jobs_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL,
  CONSTRAINT fk_jobs_by FOREIGN KEY (queued_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE audit_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NULL,            -- NULL = system / browser
  actor_label VARCHAR(64) NOT NULL,              -- 'system', 'browser', email
  level ENUM('info','warn','error') NOT NULL,
  kind VARCHAR(48) NULL,                         -- auth, role_change, invite...
  message VARCHAR(1024) NOT NULL,
  meta JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_time (created_at), KEY idx_audit_actor (actor_label),
  CONSTRAINT fk_audit_user FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE settings (                          -- single-row org settings
  id TINYINT UNSIGNED PRIMARY KEY DEFAULT 1,
  session_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 20,
  keep_signed_in_allowed TINYINT(1) NOT NULL DEFAULT 1,
  keep_signed_in_days TINYINT UNSIGNED NOT NULL DEFAULT 14,
  trusted_device_days TINYINT UNSIGNED NOT NULL DEFAULT 30,
  concurrent_session_limit TINYINT UNSIGNED NOT NULL DEFAULT 3,
  mfa_required TINYINT(1) NOT NULL DEFAULT 1,
  sso_enforced_domains JSON NULL,                -- ['@netlog.com.tr']
  external_users_allowed TINYINT(1) NOT NULL DEFAULT 1,
  invite_expiry_days TINYINT UNSIGNED NOT NULL DEFAULT 7,
  updated_by BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
