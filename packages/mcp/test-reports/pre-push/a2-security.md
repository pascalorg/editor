# A2 Pre-push Security Audit — `feat/mcp-server`

**Verdict: FIX BEFORE PUSH** (1 HIGH, 2 MEDIUM-HIGH bugs that materially weaken the A7/P4 hardening). The rest are MEDIUM/LOW follow-ups acceptable after push.

Scope: `git diff main..HEAD`, focused on new attack surface. No secret-scan (A1 owns).

---

## Findings

### HIGH-1 — PUT `/api/scenes/[id]` skips `AnyNode` revalidation
`apps/editor/app/api/scenes/[id]/route.ts:9-18`
`graphSchema` is `z.unknown().refine(v is object)`. POST route added `AnyNode.safeParse` per-node (P4 fix), PUT/PATCH did not. Attacker re-submits a hostile `ItemNode.asset.src: javascript:…` or `ScanNode.url: file:///etc/passwd` via PUT — every URL-hardening gate introduced in A7 is bypassed for updates. Impact: equivalent to the original P4 CVE but on the update path.
**Fix:** share `graphSchema` (with the `superRefine` loop from `route.ts:15-34`) between POST and PUT; treat `graph` on PUT as required and revalidate identically. Add a regression test that submits `javascript:alert(1)` via PUT and asserts 400.

### HIGH-2 — SSRF via `photo_to_scene` / `analyze_floorplan_image` / `analyze_room_photo`
`packages/mcp/src/tools/photo-to-scene/photo-to-scene.ts:102-116`, `packages/mcp/src/tools/vision/analyze-floorplan-image.ts:76-90` (analyze-room-photo is analogous).
`resolveImageBlock` does a raw `fetch(image)` for any `http(s)` URL with **no**:
- host allowlist / loopback+link-local denylist (`127.0.0.0/8`, `169.254.169.254`, `::1`, `fc00::/7`, `10.0.0.0/8`, `172.16/12`, `192.168/16`)
- IPv6 literal check (`http://[::1]/`, `http://[::ffff:169.254.169.254]`)
- redirect-chain validation (`fetch` follows redirects by default — `http://attacker.com/ → http://169.254.169.254/...`)
- response size cap (full `arrayBuffer()` into memory — DoS vector; attacker serves a 10 GB stream)
- content-type validation (server will base64-encode anything and ship to the LLM)
- timeout

On a shared dev machine this is the exact cloud-metadata / internal-network exfil primitive we closed for `AssetUrl`. Because these tools run server-side (not browser), the `AssetUrl` validator is NOT applied to the `image` argument.
**Fix:** reuse the hardening from `AssetUrl` — only accept `https://` + optional `PASCAL_ALLOWED_IMAGE_ORIGINS` env allowlist, reject private/link-local/loopback ranges (resolve DNS first, check against `ipaddr.js`/equivalent), set `redirect: 'manual'` and re-validate each hop, enforce `Content-Length` ≤ e.g. 20 MB, `AbortSignal.timeout(10_000)`.

### MEDIUM-1 — Editor API routes have no authentication, rate limit, body cap, or CORS policy
`apps/editor/app/api/scenes/route.ts` and `[id]/route.ts`, also `apps/editor/next.config.ts:16-20` (`bodySizeLimit: '100mb'`).
- No auth (TODO is documented but still shipping — on a shared LAN dev box anyone can POST/DELETE/rename). Default-deny recommended with an env flag `PASCAL_ALLOW_UNAUTH=1` for solo-dev.
- `request.json()` enforces only Next's global `100mb` limit; even with `MAX_SCENE_BYTES=10 MB` inside the store, the parser already allocated the full request body. DoS vector.
- No `Content-Type` validation — if the client sends `text/plain` Next still parses; fine in practice but log a warning.
- No CORS headers: Next default is same-origin only, which is safe for now; when we ship a CDN we'll need to add this. Document it.
- No rate limit (A1 flagged in Phase 3, still unfixed).
**Fix after push** is acceptable if we land an auth stub + body-size check before public demo. Do add a 1 MB soft cap on request body for now (`Content-Length` header check) — cheap, prevents trivial DoS.

### MEDIUM-2 — `SceneLoader` fetches a scene and passes directly to the editor without re-validating the graph
`apps/editor/components/scene-loader.tsx:40-46` + `apps/editor/app/scene/[id]/page.tsx:25-36`.
`fetchScene` → JSON.parse → `<SceneLoader initialScene=...>`. The editor store's `setScene` does NOT run `AnyNode.safeParse`. Since our store only accepts Zod-validated payloads on write, today this is mostly defense-in-depth — but a pre-existing corrupted row or a future non-revalidating ingest path would render attacker-controlled node data directly into the 3D scene, where `ItemNode.asset.src` becomes a `<model-viewer src=…>` / three.js loader URL. With HIGH-1 open, an attacker CAN land a hostile URL via PUT; this route then renders it.
**Fix:** run the same `graphSchema.safeParse(scene.graph)` in the server component (`page.tsx`) before handing to `<SceneLoader>`. On failure, render "corrupted scene" 500. Cheap belt-and-braces.

### MEDIUM-3 — `apply_patch` has no batch-size or graph-size quota
`packages/mcp/src/tools/apply-patch.ts:8-16`. `patches` is `z.array(PatchSchema)` with no `.max()`. A 100k-op batch runs under the server's `Event` loop, blocks every other tool, and can push the in-memory graph past `MAX_SCENE_BYTES` only at `save_scene` time (so the work is wasted but the DoS is real).
**Fix:** `z.array(PatchSchema).max(1000)`; reject when post-apply `nodeCount > 50_000`.

### MEDIUM-4 — `next.config.ts` sets `bodySizeLimit: '100mb'` globally for Server Actions
`apps/editor/next.config.ts:16-20`. Too permissive. With no auth this gives every network neighbour a 100 MB write primitive.
**Fix:** lower to `'10mb'` to match `MAX_SCENE_BYTES`.

### LOW-1 — `sanitizeSlug` drops unicode silently; edge cases are safe but worth a test
`packages/mcp/src/storage/slug.ts:17-32`. `\u0000` → stripped. `../` → `.` stripped → collapse `-` → safe. Emoji → stripped. Confusables (`а` Cyrillic → stripped since not `[a-z]`). No path traversal possible because the regex only admits `[a-z0-9-]`. Good. But because `isValidSlug` is called post-sanitize in `save()` (line 120) and the slug alphabet excludes `_`, confirm no caller expects underscores. Add explicit tests for `null byte`, `\\`, and multi-code-point inputs.

### LOW-2 — SQL RLS: `service_role` bypass is correct but `scene_revisions` lacks a write policy
`packages/mcp/sql/migrations/0001_scenes.sql:63-66`. Only a SELECT policy exists. `service_role` still writes fine (bypasses RLS), but if a future code path runs under `authenticated` it will silently fail inserts. Add `revisions_service_write` or an `insert` policy tied to owner. No injection surface — migration is DDL only, no dynamic SQL. Grants not explicitly set (relies on Supabase defaults); recommend explicit `revoke all … grant select … on scenes to anon`.

### LOW-3 — CI workflow permissions
`.github/workflows/mcp-ci.yml`. Uses `pull_request` (NOT `pull_request_target` — safe), `permissions: contents: read` (minimum). Good. No secret use. Green.

### LOW-4 — Residuals check
- `window.__pascalScene`: grep of src code returns zero hits in ship paths — only in `test-reports/**` and docs. Confirmed gone.
- Supabase dep pinned `^2` is loose. Lock to `2.x.y` at next dep-hygiene pass. No known active CVE on `@supabase/supabase-js@2` as of 2026-04-18.
- `@ts-expect-error` additions are limited to `packages/core/src/schema/asset-url.test.ts:1` (bun:test import) — benign.

---

## Unfixed from Phase 3 (surfaced but shipping)
- Editor API auth (HIGH, tracked). See MEDIUM-1.
- Rate limit (MEDIUM, tracked).
- Thumbnail upload endpoint is a stub (`scene-loader.tsx:84-89`) — not a vuln, just non-functional.

## Recommended before push
1. HIGH-1: share graphSchema between POST and PUT.
2. HIGH-2: SSRF hardening on the three vision URL-fetch paths.
3. MEDIUM-4: lower bodySizeLimit to 10 MB.
4. Add regression tests for HIGH-1 and HIGH-2 (mirror `asset-url.test.ts` style).
