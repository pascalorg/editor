-- 003_password_resets
--
-- Section 08 lists `reset` among the step-4 endpoints but section 10 has no
-- table behind it. The `invitations` table is the obvious near-fit — same
-- token_hash / expires_at / user_id shape — but its columns mean invite things
-- (resent_count, accepted_at) and overloading them would make "how many invites
-- are pending" unanswerable. A reset link is its own object, so it gets its own
-- table with the same hashing discipline: SHA-256 stored, raw token only ever in
-- the email.

CREATE TABLE password_resets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash BINARY(32) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,             -- 30 minutes, per the reset screen copy
  used_at TIMESTAMP NULL,
  requested_ip VARBINARY(16) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pwr_user (user_id),
  KEY idx_pwr_expiry (expires_at),
  CONSTRAINT fk_pwr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
