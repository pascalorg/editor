-- Which language to write to a person in.
--
-- The console already renders in English or Turkish per reader, but mail is
-- composed with nobody present to ask — so the preference has to be stored.
-- It is recorded from the reader's own cookie when they sign in, which keeps
-- it true without anyone having to maintain it.
ALTER TABLE users ADD COLUMN locale VARCHAR(5) NOT NULL DEFAULT 'en';
