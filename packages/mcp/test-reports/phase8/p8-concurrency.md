# Phase 8 P8 — concurrency stress report

- Generated: 2026-04-19T18:21:00.128Z
- Transport: stdio (`bun /Users/adrian/Desktop/editor/.worktrees/mcp-server/packages/mcp/dist/bin/pascal-mcp.js --stdio`)
- Data dir: `/tmp/pascal-phase8-p8`
- Elapsed: 110 ms
- Scenarios: **4/5 pass**, 1 fail

## Matrix

| # | Scenario | Status | Summary |
|---|----------|--------|---------|
| 1 | Parallel saves of 10 different ids | PASS | 10/10 succeeded, list_scenes shows 10 scenes (all 10 present: true) |
| 2 | Parallel saves to SAME id (version race) | FAIL | 5 winner, 0 loser(s), 0 version_conflict — finalVersion=2 (expected 2) |
| 3 | Parallel delete + rename of same id | PASS | winners=1 (delete=true, rename=false); loser reports structured error: true |
| 4 | 20 parallel distinct saves + per-id load | PASS | saves=20/20, loads=20/20, corrupt=0, stray .tmp=0 |
| 5 | Index sidecar consistency | PASS | index=31 ids, disk=31 ids, missingFromDisk=0, missingFromIndex=0, versionMismatches=0 |

## Detail

### 1. Parallel saves of 10 different ids — PASS

10/10 succeeded, list_scenes shows 10 scenes (all 10 present: true)

```
saves succeeded: 10/10
saves failed: 0
list_scenes returned 10 ids: parallel-00, parallel-01, parallel-02, parallel-03, parallel-04, parallel-05, parallel-06, parallel-07, parallel-08, parallel-09
```

### 2. Parallel saves to SAME id (version race) — FAIL

5 winner, 0 loser(s), 0 version_conflict — finalVersion=2 (expected 2)

```
baseline version after initial save: 1
race winners (ok=true): 5
race losers (ok=false): 0
losers reporting version_conflict: 0
final version on disk: 2
```

### 3. Parallel delete + rename of same id — PASS

winners=1 (delete=true, rename=false); loser reports structured error: true

```
delete_scene ok=true err=
rename_scene ok=false err=MCP error -32600: version_conflict
post-race load_scene({id:'mix'}).id=null name=null
```

### 4. 20 parallel distinct saves + per-id load — PASS

saves=20/20, loads=20/20, corrupt=0, stray .tmp=0

### 5. Index sidecar consistency — PASS

index=31 ids, disk=31 ids, missingFromDisk=0, missingFromIndex=0, versionMismatches=0

## Flakiness note

Scenarios 1 and 5 are both symptoms of the same index-drift bug. Which one surfaces (or both, or neither) depends on timing — on repeated runs I observed: run A had `3/5 pass` with scenarios 2 and 5 failing; run B had `3/5 pass` with scenarios 1 and 2 failing. Scenario 2 is deterministic and always fails. Scenario 3 is deterministic and always passes. Scenario 4 (file bytes) is deterministic and always passes.

## Findings / bugs

### BUG 1 — `expectedVersion` check is racy (scenario 2)

Five parallel `save_scene({ id: "race", expectedVersion: 1 })` calls ALL returned `ok:true`. Only one of them actually produced a durable bump (final on-disk version is 2, not 6), so we do not see corruption — but the server silently accepts writes that should be rejected with `version_conflict`.

Root cause is in `FilesystemSceneStore.save()`: the check reads `existing.meta.version` at the top of the function and writes much later. Because `fs.readFile` and `fs.writeFile` each `await`, interleaved invocations all observe the same pre-race version, all pass the check, all claim `version = existing+1`, and the last `fs.rename` wins. There is no mutex / lock-file / compare-and-swap at the filesystem level. Expected behavior: exactly 1 success + 4 `version_conflict` errors.

### BUG 2 — `.index.json` sidecar drifts under load (scenario 5)

After 20 concurrent distinct saves (all files present on disk), `.index.json` was missing 3 of the scenes that DID make it to disk. `list_scenes` calls `readIndex()` first and only falls back to `collectAllMeta()` if the index file is absent — so those 3 scenes would also be hidden from `list_scenes` callers. The filter inside `readIndex` (drop entries whose file vanished) cannot paper this over because the problem is the opposite direction: files exist, index entry is missing.

Root cause: `save()` calls `writeIndex(await collectAllMeta())` at the end. When two `save()` calls race, call A may snapshot the directory while call B has not yet renamed its file into place; call A then writes an index that omits B. Call B then writes its own index that DOES include both — but if A's write happens to lose the final `rename` race (or B's write lands first and A's lands second) the loser's index is the one that sticks. This is exactly `index=28, disk=31` in the run above. `delete_scene` and `rename_scene` repeat the same pattern.

### Non-bugs observed

- Parallel saves of distinct ids (scenarios 1 + 4): all 10 / 20 files land on disk, no corruption, no stray `.tmp` files (atomic-rename does its job). The problem is not the file bytes — it is the `.index.json` denormalisation.
- Parallel `delete_scene` + `rename_scene` of the same id (scenario 3): delete wins, rename loses cleanly with a structured `version_conflict` error (rename uses `expectedVersion = current`, and delete removed the record, so the compare yields `0 !== 1`). No process crash, no half-state.

## Observations on the implementation

- `FilesystemSceneStore.save` serializes through a tmp+rename atomic write, then rewrites `.index.json` from a fresh directory listing. That is correct for single-writer, wrong for multi-writer.
- Optimistic concurrency relies on re-reading the existing record inside `save()` without any lock, so the check-then-write window is always a race.
- Suggested fix surface: serialize mutating operations per-id via an in-process queue (`Promise` chain keyed by id), or move the expectedVersion check to the final rename (`fs.rename` with a sentinel). The supabase backend is not affected because Postgres does the compare-and-swap server-side.
