# Phase 8 P7 — Editor HTTP API Verification

**Agent**: P7 (Editor API direct-fetch)
**Scope**: Exercise every verb + error path on the editor's `/api/scenes` and
`/api/scenes/[id]` routes via native `fetch` against
`http://localhost:3002`, using the shared data dir `/tmp/pascal-phase8`.
**No MCP involved** — this report verifies the HTTP contract the MCP server
consumes.
**Script**: `packages/mcp/test-reports/phase8/p7-editor-api.ts`
**Result**: **18 / 18 PASS**

## Setup notes

- The editor dev server was already running against the shared data dir.
- Parallel P-agents share `/tmp/pascal-phase8`; the list-count test observed
  **39 scenes** at time of run (P1-P6 + P7 + sibling writers).
- Cleanup: the script unlinks `/tmp/pascal-phase8/scenes/p7-my-id.json`
  before running. We discovered that a malformed file on disk (nodes missing
  a string `type`) wedges the store — `GET`/`PUT`/`PATCH`/`DELETE` all return
  `400 invalid` because the filesystem backend's `readPersisted` validates on
  every read. The direct `unlink` is necessary because even the DELETE route
  reads-before-unlink.
- **Important graph shape contract**: each node value must be a non-null
  object with a non-empty string `type` field (see
  `packages/mcp/src/storage/filesystem-scene-store.ts:325-335`). Using `kind`
  in place of `type` passes POST (since POST only does a `typeof === 'object'`
  check) but poisons subsequent reads — a real gotcha for clients.

## HTTP status-code matrix

| #  | Test                              | Expected                | Actual                               | Pass |
|----|-----------------------------------|-------------------------|--------------------------------------|------|
| 1  | POST happy                        | 201 + Location header   | 201, Location=/scene/<id>            | PASS |
| 2  | POST missing `name`               | 400 invalid_request     | 400 invalid_request                  | PASS |
| 3  | POST graph is string (not object) | 400 invalid_request     | 400 invalid_request                  | PASS |
| 4  | POST explicit `id: 'p7-my-id'`    | 201 with id preserved   | 201 id=p7-my-id                      | PASS |
| 5  | POST duplicate id                 | 409 or 400 (document)   | **400 `invalid`** (documented)       | PASS |
| 6  | GET list                          | 200 scenes >= 2         | 200 count=39                         | PASS |
| 7  | GET ?limit=1                      | 200 scenes == 1         | 200 count=1                          | PASS |
| 8  | GET ?projectId=nope (document)    | 200                     | 200 count=0 (**strict filter**)      | PASS |
| 9  | GET by id                         | 200 + ETag: "1"         | 200, ETag="1", version=1             | PASS |
| 10 | GET missing id                    | 404 not_found           | 404 not_found                        | PASS |
| 11 | PUT If-Match: "1"                 | 200 version=2           | 200 version=2                        | PASS |
| 12 | PUT body expectedVersion=2        | 200 version=3           | 200 version=3                        | PASS |
| 13 | PUT no If-Match, no body version  | 200 or 4xx (document)   | **400 `invalid`** (**strict**)       | PASS |
| 14 | PUT If-Match: "99" (stale)        | 409 version_conflict    | 409 version_conflict                 | PASS |
| 15 | PATCH name: 'renamed'             | 200 name=renamed        | 200 name=renamed                     | PASS |
| 16 | PATCH name: ''                    | 400 invalid_request     | 400 invalid_request                  | PASS |
| 17 | DELETE happy + re-GET             | 204 then 404            | DELETE=204, GET=404                  | PASS |
| 18 | DELETE already-deleted            | 404 not_found           | 404 not_found                        | PASS |

## Documented behaviours

- **Duplicate-id (#5)**: editor returns **`400 invalid`**, not `409`. The store
  layer throws `SceneInvalidError` on slug collision when no
  `expectedVersion` is supplied (see
  `filesystem-scene-store.ts:131-135`). Clients expecting `409 Conflict` for
  duplicate-id per REST convention should be aware this API uses `400`.
- **`projectId` filter (#8)**: the filter is **strict** — unknown `projectId`
  returns an empty list rather than ignoring the filter.
- **PUT without version (#13)**: **strict**. The editor rejects a PUT that
  provides neither `If-Match` nor `expectedVersion` after the first write with
  `400 invalid`. Callers must always supply a concurrency token to mutate an
  existing scene.

## Headers verified

- `Location: /scene/<id>` on 201 from POST.
- `ETag: "<version>"` on 200 from GET, PUT, and PATCH.
- `If-Match: "<version>"` accepted and honored on PUT; weak form `W/"..."`
  parsed by the route per RFC 7232 (not separately tested here).

## Files

- Script: `/Users/adrian/Desktop/editor/.worktrees/mcp-server/packages/mcp/test-reports/phase8/p7-editor-api.ts`
- Report: `/Users/adrian/Desktop/editor/.worktrees/mcp-server/packages/mcp/test-reports/phase8/p7-editor-api.md`
