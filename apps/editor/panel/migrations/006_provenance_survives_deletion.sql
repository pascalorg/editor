-- Deleting a user must not be blocked by what they once did.
--
-- Five columns record who performed an action — created a site, granted an
-- assignment, sent an invitation, created an API key, queued a job. All five
-- were NOT NULL with a bare FOREIGN KEY, whose default rule is RESTRICT: the
-- moment an account had created anything, DELETE FROM users failed with a
-- constraint error the UI could only report as "something went wrong".
--
-- Provenance is history, not ownership. The site outlives its creator; the
-- record of *who* becomes NULL, exactly as audit_log.actor_user_id already
-- does. (The readers were flipped to LEFT JOIN in the same change, so rows
-- with a deleted actor keep appearing in every list.)

ALTER TABLE sites DROP FOREIGN KEY fk_sites_creator;
ALTER TABLE sites MODIFY created_by BIGINT UNSIGNED NULL;
ALTER TABLE sites ADD CONSTRAINT fk_sites_creator
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE assignments DROP FOREIGN KEY fk_asg_by;
ALTER TABLE assignments MODIFY granted_by BIGINT UNSIGNED NULL;
ALTER TABLE assignments ADD CONSTRAINT fk_asg_by
  FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE invitations DROP FOREIGN KEY fk_inv_by;
ALTER TABLE invitations MODIFY invited_by BIGINT UNSIGNED NULL;
ALTER TABLE invitations ADD CONSTRAINT fk_inv_by
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE api_keys DROP FOREIGN KEY fk_key_by;
ALTER TABLE api_keys MODIFY created_by BIGINT UNSIGNED NULL;
ALTER TABLE api_keys ADD CONSTRAINT fk_key_by
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE jobs DROP FOREIGN KEY fk_jobs_by;
ALTER TABLE jobs MODIFY queued_by BIGINT UNSIGNED NULL;
ALTER TABLE jobs ADD CONSTRAINT fk_jobs_by
  FOREIGN KEY (queued_by) REFERENCES users(id) ON DELETE SET NULL;
