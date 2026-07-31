-- 002_roles_and_requests
--
-- Two additions on top of the contract's 12 tables. Both are called for by the
-- document but left without a DDL block there, so they are kept in their own
-- migration rather than smuggled into 001.
--
--   roles            — section 10 closing note: "system roles (Admin, Editor,
--                      Viewer) are constants in code; custom roles can move into
--                      roles(name, permissions JSON)". This is the counterpart of
--                      the prototype's `perms` dictionary and backs the Roles tab.
--   access_requests  — the `#/request` screen (section 03, "Account request") and
--                      the request -> invite loop (WP7) need somewhere to park a
--                      self-service request until an administrator approves it.
--                      Approval writes users + invitations; this table only holds
--                      the pending ask.

CREATE TABLE roles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(48) NOT NULL UNIQUE,
  permissions JSON NOT NULL,                     -- ['view_projects','edit_users',...]
  is_system TINYINT(1) NOT NULL DEFAULT 0,       -- system roles cannot be deleted
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE access_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL UNIQUE,
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(320) NOT NULL,
  username VARCHAR(64) NOT NULL,
  department VARCHAR(64) NOT NULL,
  requested_role VARCHAR(48) NOT NULL,
  note VARCHAR(1024) NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  decided_by BIGINT UNSIGNED NULL,
  decided_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_req_status (status, created_at),
  CONSTRAINT fk_req_decider FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One pending request per address; a rejected/approved row must not block a retry.
CREATE UNIQUE INDEX uq_req_pending_email ON access_requests ((
  CASE WHEN status = 'pending' THEN email END
));
