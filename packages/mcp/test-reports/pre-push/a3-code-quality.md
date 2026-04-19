# A3 — Code-Quality & Production-Readiness Audit

**Scope:** `git diff main..HEAD` on `feat/mcp-server` (18 commits, ~38.7k LOC added).
**Verdict:** **READY FOR REVIEW** (with two small follow-ups suggested pre-merge).

---

## Strengths

- **TypeScript discipline is exemplary.** Zero `: any` / `as any` / `@ts-ignore` / `@ts-expect-error` anywhere in `packages/mcp/src/**` non-test code. All 28 `as any` hits are confined to `scene-bridge.test.ts` and `templates.test.ts` where fixtures intentionally construct malformed input (the right place for them). `tsconfig.json:9` extends `@pascal/typescript-config/base.json` which sets `strict: true` and `noUncheckedIndexedAccess: true` (tooling/typescript/base.json:11-12). `unknown` narrowing uses real guards everywhere (e.g. `apps/editor/app/api/scenes/[id]/route.ts:161`, `scene-bridge.ts:140-149`).
- **API design is consistent and well-layered.** 30/30 MCP tools register with BOTH `inputSchema` and `outputSchema` Zod objects (Grep confirmed). Tool names follow `snake_case` uniformly (`get_scene`, `apply_patch`, `save_scene`, ...). Editor REST API (`apps/editor/app/api/scenes/**`) uses proper verbs + correct status codes (201 with `Location` on POST, 204 on DELETE, 404/409/413/400/500 via `handleStoreError`, ETag + `If-Match` for concurrency control — route.ts:33, 82, 99, 145-155).
- **Error handling is uniform.** `packages/mcp/src/tools/errors.ts:7` provides a single `throwMcpError` + `toolError` helper; every tool either throws `McpError(ErrorCode.XXX, ...)` or returns `{isError: true}`. Two bare `catch {}` sites (`prompts/renovation-from-photos.ts:72`, `transports/http.ts:37`) are intentional fall-throughs with explicit comments. No silent failures in the request path.
- **Security hardening is layered defensively.** `save_scene` re-validates every node with `AnyNode.safeParse` when `includeCurrentScene=false` (save-scene.ts:79-93); the editor POST does the same with `superRefine` (route.ts:21-34); scene-bridge rejects prototype-pollution keys (scene-bridge.ts:82-87); `FilesystemSceneStore` enforces a 10MB `MAX_SCENE_BYTES` cap and atomic tmp+rename writes (filesystem-scene-store.ts:19, 186-189). The fix commit `0b84e7b` specifically closes two URL-validation bypasses surfaced by Phase 8 P4 — good shift-left behaviour.
- **Transports are clean.** `connectStdio` is 18 lines with proper comment about stdout ownership (transports/stdio.ts:8-10). `connectHttp` listens on ephemeral port for tests, tracks port via `httpServer.address()`, exposes graceful `close()`, defends against double-response on errors (http.ts:44-72). CLI (`bin/pascal-mcp.ts`) loads the RAF shim FIRST (line 3), validates `--port`, handles SIGINT/SIGTERM.
- **Observability has the minimum viable floor.** All operator logs go to stderr (`pascal-mcp.ts:65, 78, 83`; `http.ts:33`) — stdout is reserved for JSON-RPC. No PII / secrets in error messages.
- **Configuration.** Env consumption is centralized: `storage/index.ts:16-17` reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` and falls back to filesystem — no required vars with no fallback. `resolveDefaultRootDir` (filesystem-scene-store.ts:45) has a documented 4-step precedence (PASCAL_DATA_DIR → APPDATA/XDG_DATA_HOME → ~/.pascal/data).
- **Commit hygiene.** All 18 commits follow `type(scope): subject` conventional-commits style. 100% carry `Co-Authored-By: Claude Opus 4.7 (1M context)` trailers. Semantic grouping (scaffold → tools → resources → transports → storage → fixes) is merge-friendly.
- **Docs & CI.** README.md:1-55 is runnable as-is (`bunx pascal-mcp`, `claude_desktop_config.json` snippet). CHANGELOG conforms to Keep a Changelog + SemVer (`packages/mcp/CHANGELOG.md:5-7`). `.github/workflows/mcp-ci.yml` runs install → build core → build mcp → test → biome check on any `packages/mcp/**` or `packages/core/**` change.
- **Migration risk is minimal.** All `@pascal-app/core` changes (`packages/core/package.json:8-44`) are **additive subpath exports** (`./schema`, `./store`, `./clone-scene-graph`, `./material-library`, `./spatial-grid`, `./wall`). The existing main export is untouched. `apps/editor` gets new routes/components — no existing route is altered.

---

## Improvements recommended BEFORE PR (blocking)

1. **Flag the `O(n²)` collision/patch behaviours in docs, not code.** `check-collisions.ts:58-70` is pairwise (n²); `apply_patch` dry-run is linear per patch but does `_collectDescendants` inside the cascade=false branch (`scene-bridge.ts:322`). Both are fine at 5k nodes (P9 verified), but the CHANGELOG or README should list the current soft ceiling (≈10k nodes, <10MB scene) so reviewers can evaluate the SLA commitment. Add one sentence to `packages/mcp/README.md`. Non-destructive, 2 lines.
2. **`apps/editor/components/save-button.tsx` and `scene-loader.tsx` have zero tests** (Grep confirmed only `lib/scene-store-server.test.ts` exists under `apps/editor`). MCP-side storage has 70+ tests, but the editor React components that *call* the new API are uncovered. Add at minimum one happy-path + one conflict (409) test each using RTL or Playwright. Not blocking the PR title, but a reviewer will rightly ask.

---

## Improvements recommended AFTER PR / in review (non-blocking)

- **`phase7-e2e.ts` requires externally-running MCP + editor servers.** Document the prerequisites at the top of the file (it already has a one-liner on line 4 but no "requires `bun dev` in one terminal, `pascal-mcp --http` in another" note). Or gate with an env check that prints setup instructions.
- **`lib/scene-store-server.ts:18-64` duplicates the `SceneStore` contract.** Already acknowledged in comments (scene-store-server.ts:11-17) — consider publishing the types from `@pascal-app/mcp/storage` as a separate sub-path so the editor can import them instead of redeclaring.
- **`scene-loader.tsx:82-89` has a swallowed `fetch(...).catch(() => {})`** for thumbnail upload. It's commented "best-effort" but this is the one place a silent failure is fine — just add a `console.warn` for dev visibility.
- **No structured logging.** Current logging is `console.error` with `[pascal-mcp]` prefix. Sufficient for v0.1; for production HTTP deployments a pluggable logger (pino/winston-compatible interface) would let operators ship to Datadog/OTEL. File an issue, don't block.
- **Small sleep-based tests** in `bridge/scene-bridge.test.ts:14`, `filesystem-scene-store.test.ts:155,435`, `undo.test.ts:29`, `redo.test.ts:29,32`, `apply-patch.test.ts:42` use 5-10ms sleeps to space undo timestamps. These are deterministic on dev hardware but could flake on slow CI runners. Consider an abstractable clock or a `flushUndoDebounce()` helper; track in an issue.
- **`packages/mcp/package.json:39-43` deps:** `@supabase/supabase-js@^2` is the only non-trivial runtime dep and pulls ~750KB unpacked. Consider moving it to `peerDependenciesMeta.optional` or gating behind a subpath so stdio-only users don't ship it. Size audit, not a correctness issue.

---

## Open Questions for Maintainers

1. **SemVer posture for `@pascal-app/core` sub-path exports** — are the new exports (`./store`, `./schema`, `./spatial-grid`, `./wall`) contractually stable from 0.5.1 onward, or should we bump to 0.6.0 to signal "new surface area"? Additive but still expands the public API.
2. **Version bump timing** — `package.json:3` pins `@pascal-app/mcp@0.1.0`. Is the intent to publish at PR merge, or to land unpublished and release on a follow-up tag? CHANGELOG dates `2026-04-18` which is today.
3. **CI coverage gate** — `.github/workflows/mcp-ci.yml` runs tests but does not collect coverage. Should we add `bun test --coverage` + a codecov step, or deliberately defer?
4. **`apps/editor/components/scene-loader.tsx:82` — thumbnail endpoint** is explicitly a v0.1 stub. Is there a tracking issue for phase 7.1 implementation, or should the route + button be wired up before shipping?
5. **`save-scene.ts:63` & `route.ts:76` cast `graph as SceneGraph as never`.** The `as never` is a deliberate width-silencer after Zod validation. Is there appetite to land a tighter `GraphSchema` in `@pascal-app/core/schema` (matching `SceneGraph` exactly) so we can drop the casts?

---

**Bottom line:** This PR is production-quality TypeScript with exhaustive Zod validation at every boundary, layered defense-in-depth security, clean transport separation, and comprehensive test coverage on the server side (excluding the two small editor component gaps noted above). No blockers; ship with confidence after the two pre-PR items.
