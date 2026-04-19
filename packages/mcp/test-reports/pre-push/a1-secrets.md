# A1 — Secrets + PII scan

## Summary
SAFE TO PUSH. No real secrets, tokens, credentials, JWTs, PEM blocks, or PII leaked. Personal email `rexinacho@gmail.com` appears only in `Co-Authored-By`-equivalent git author metadata (a public identity the user already uses for GitHub). Several MEDIUM-severity absolute-path hardcodes (`/Users/adrian/...`) in test-report scripts do not reveal secrets but do reveal local machine layout.

## BLOCKERS
None.

## HIGH
None. Author email `rexinacho@gmail.com` is the committer identity on all 18 commits — treated as acceptable public identity (same address baked into git log of any fork). No other email, no user UUID, no machine hostname, no cookie values leaked.

## MEDIUM
1. `/Users/adrian/Desktop/editor/.worktrees/mcp-server/...` hardcoded in 7 committed TS scripts and ~10 committed MD reports. Not secrets, but exposes local filesystem layout and worktree name. Files: `packages/mcp/test-reports/villa-azul/{v2-geometry,v3-dimensions,v4-openings,v5-http}.ts`, `packages/mcp/test-reports/casa-sol/build.ts`, `packages/mcp/test-reports/phase8/p4-url-hardening.ts`, `packages/mcp/test-reports/t2-http/run.ts`, plus md files under `test-reports/phase8/` and `test-reports/villa-azul/`. Redact with sed replacing `/Users/adrian/Desktop/editor/.worktrees/mcp-server` -> `<repo>` or move absolute paths behind `process.cwd()`.
2. Hardcoded dev URLs `http://localhost:3917` and `http://localhost:3002` appear in test-reports only (never in production source under `apps/editor/app/**` or `packages/mcp/src/**` shipped code). Acceptable for test fixtures; flag for follow-up.

## LOW
1. `/tmp/pascal-*` paths in test scripts — not user-specific (generic tmp); fine to ship.
2. `apps/editor/env.mjs` correctly references env-var names (`SUPABASE_SERVICE_ROLE_KEY`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `GOOGLE_CLIENT_SECRET`) via `process.env.*` — no values.

## Files scanned
- diff size: 40768 lines, 176 files
- untracked files: none
- .env files present in diff: none; `.env.example` at repo root (placeholder comments only, not in diff)
- direct reads: `.github/workflows/mcp-ci.yml` (clean, no secret values), `packages/mcp/sql/migrations/0001_scenes.sql` (schema + RLS only), `packages/mcp/package.json` (no tokens in scripts), `apps/editor/public/dev/casa-sol.json` (scene geometry only), `packages/mcp/test-reports/villa-azul/build-summary.json` (synthetic IDs)
- git authors: all 18 commits by `Adrian Perez <rexinacho@gmail.com>` — consistent, no stray identities
- no `.orig`, `.swp`, `.DS_Store`, binary blobs staged
- regex scans for `sk_live_`, `sk_test_`, `ghp_`, `AKIA`, `AIza`, `xoxb-`, `eyJ...`, `-----BEGIN`, JWTs, `npm_[A-Za-z0-9]{36}`, `Authorization: Bearer` — all zero matches

## Confidence
high

---
**One-line verdict for integrator: SAFE TO PUSH** (optional MEDIUM cleanup: redact `/Users/adrian/...` paths from committed test-reports before publishing a polished PR)
