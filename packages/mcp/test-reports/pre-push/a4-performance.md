# A4 — Pre-push performance review (feat/mcp-server)

Date: 2026-04-18 · Scope: `git diff main..HEAD` (18 commits, +38,785 LOC) · Evidence: `test-reports/{t1-stdio,t2-http,phase8,villa-azul}`.

## Verdict

**SHIP WITH NOTES.** At v0.1 scale (≤ 56 nodes, ≤ 50 scenes) every path is sub-200 ms. Scaling liabilities appear above ~1k scenes or under concurrent writes — neither is the launch target.

## Hot paths (measured / estimated)

| Path | Time | Source |
|---|---|---|
| T1 stdio, 21 tools round-trip | **106 ms** (~5 ms/tool) | t1-stdio/REPORT.md L11 |
| P10 full sweep, 30 tools + 3 resources + 3 prompts | **152 ms** | p10-full-sweep.md L15 |
| P9 edges, 13 cases incl. 5k-node save | **419 ms** | p9-edges.md L5 |
| `/scene/:id` SSR (56 nodes) | **58.3 ms**, 81.7 KB HTML | v6-page.md L12 |
| `/scenes` list SSR | **20.9 ms**, 20.0 KB | v6-page.md L14 |
| MCP stdio cold-start to ready | ~1.0-1.5 s (Bun + SDK + core + Zod) | implied |
| HTTP startup + 1st session | ~2 s; 2nd client rejected | t2-http REPORT.md L14 |

106 ms for 21 tools is reasonable — stdio RTT dominates. Slowest non-vision tool paths: `validate_scene` (Zod-parse every node), `export_json` (`JSON.parse(JSON.stringify)` clone), `apply_patch` (2-pass dry-run + apply), `check_collisions` (O(n²) AABB, bounded by items/level).

## Scaling concerns (severity order)

1. **Filesystem index rebuild on every mutation.** `save`/`delete`/`rename` call `collectAllMeta()` → `readFile` every scene (filesystem-scene-store.ts L192-193, L233). At 1k scenes ≈ 200-400 ms/save; at 10k ≈ 2-4 s. Fix: incremental index patch.
2. **`.index.json` drift under concurrent writes** (P8 BUG 2). 3/20 scenes hidden from `list_scenes` after parallel burst. Correctness, not perf, but fix depends on #1.
3. **expectedVersion race** (P8 BUG 1). 5 parallel saves all claim success; only one `rename` wins. Need per-id mutex or `O_EXCL` lockfile. Supabase unaffected (server-side CAS via `.eq('version', …)`).
4. **`findNodes({levelId})`** calls `resolveLevelId` per node → full ancestry walk each time. O(n × depth). ~25k walks at 5k nodes. Memoize per call.
5. **`getChildren`/`_collectDescendants`** iterate all nodes per call. O(n) each; fine today, slow at 50k.
6. **`exportJSON` uses `JSON.parse(JSON.stringify)`** (scene-bridge.ts L39-46). Replace with `structuredClone` for ~2× speedup.
7. **Fixed-point serialize loop in `save`** (L168-184) stringifies up to 5× per save to settle `sizeBytes`. At 2.4 MB that's 125 ms wasted.
8. **`check_collisions` O(n²)** — bounded by items/level; degenerate at 1k+ items.
9. **5k-node client render is unverified.** P9 saved 5k-node scene (2.4 MB) but no FPS measurement. Villa Azul 56 nodes = 120 FPS. This is the single biggest unknown for client perf.

## Build-size

- `packages/mcp/dist/`: **904 KB** total (66 JS files, 210 KB code + 91 KB `.d.ts` + maps).
- Top 5 JS: `bridge/scene-bridge.js` 18.2 KB · `storage/filesystem-scene-store.js` 13.3 KB · `tools/photo-to-scene/photo-to-scene.js` 12.6 KB · `tools/variants/mutations.js` 11.3 KB · `storage/supabase-scene-store.js` 10.8 KB.
- Average file 3.2 KB — no bundle bloat.
- **`@supabase/supabase-js`**: MCP-only (package.json L41), lazy-imported (supabase-scene-store.ts L141). **Zero editor bundle impact.**

## Memory

- `SceneBridge` is a singleton `useScene` store shared across MCP sessions. Zundo `limit: 50` bounds history. 5k-node graph × 50 = ~120 MB upper bound — bounded, not leaked.
- `urlCache` (packages/core/src/lib/asset-storage.ts L6) unbounded, browser-only; pre-existing Phase 3 flag, not regressed.
- `atomicWrite` cleans `.tmp` on failure (L287); P8 observed `stray .tmp=0`.

## Recommended follow-ups

1. **(P1)** Incremental `.index.json` patch on save/delete/rename (fixes concerns #1 + #2).
2. **(P1)** Per-id `Promise`-chain mutex in Filesystem store to close expectedVersion race (#3).
3. **(P2)** Lazy-load vision/photo-to-scene/variants tools behind first-call gate. Saves ~40 KB + ~100 ms cold-start.
4. **(P2)** Swap `JSON.parse(JSON.stringify)` in `exportJSON` → `structuredClone`.
5. **(P3)** Memoize `levelId` per node in `SceneBridge`. 10-50× speedup on `find_nodes({levelId})`.
6. **(P3)** Fix StreamableHTTP single-session; add multi-session dispatcher or clear 503.

## Benchmarks to add

1. **`bench/scene-bridge.bench.ts`** — `findNodes({levelId})` + `_collectDescendants` at 1k/5k/10k nodes; assert p99 < 50 ms.
2. **`bench/filesystem-store.bench.ts`** — `save()`+`list()` at 100/1k/10k scenes; current code will fail at 10k (concern #1).
3. **`bench/client-render.bench.ts`** — React profiler over `applySceneGraphToEditor` at 1k/5k nodes; assert first-paint < 500 ms and steady FPS ≥ 30.

## Red flags

None ship-blocking. Scaling liabilities (#1-#3) well-understood. **Client render at 5k nodes is the only material unknown** and should be verified pre-GA, not pre-push.

Report: `/Users/adrian/Desktop/editor/.worktrees/mcp-server/packages/mcp/test-reports/pre-push/a4-performance.md`
