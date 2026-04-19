# Villa Azul — V8 Load-Save Round-Trip Report

- Generated: 2026-04-19T18:37:01.857Z
- Shared source: `/tmp/pascal-villa/scenes/a6e7919eacbe.json`
- Isolated data dir: `/tmp/pascal-villa-v8`
- Transport: stdio (`bun /Users/adrian/Desktop/editor/.worktrees/mcp-server/packages/mcp/dist/bin/pascal-mcp.js --stdio`)
- New sceneId (copy): `d346bd83beb9`
- Rebuilt sceneId (apply_patch): `0a264e09564f`
- Duplicated sceneId: `db09cfe4a8fc`

## Original node-type counts

| Type | Count |
|---|---:|
| building | 1 |
| door | 10 |
| fence | 5 |
| level | 1 |
| site | 1 |
| slab | 1 |
| wall | 12 |
| window | 12 |
| zone | 13 |
| **total** | **56** |

## Results

| # | Check | Status | Detail |
|---|---|:---:|---|
| 1 | 1.read-original | PASS | nodes=56, roots=1, types={"site":1,"building":1,"level":1,"wall":12,"zone":13,"door":10,"window":12,"slab":1,"fence":5} |
| 2 | 2.spawn-isolated-stdio | PASS | PASCAL_DATA_DIR=/tmp/pascal-villa-v8 |
| 3 | 3.save_scene(copy) | PASS | id=d346bd83beb9 version=1 nodes=56 bytes=44285 |
| 4 | 4a.load→get_scene ids preserved | PASS | 56 ids, match=true |
| 5 | 4b.load→get_scene rootNodeIds | PASS | orig=[site_5mzaasm5o9a9d0sf] loaded=[site_5mzaasm5o9a9d0sf] |
| 6 | 4c.load→get_scene deep-equal per-node | PASS | diffs=0 |
| 7 | 5.apply_patch rebuild counts | PASS | ops=53 created=53 total=56 diffs=none |
| 8 | 6.duplicate_level + save + reload counts | PASS | valid=true new=54 total=110 diffs=none |
| 9 | 7.stableStringify(orig.nodes) === stableStringify(reloaded.nodes) | PASS | orig=23333ch reloaded=23333ch equal=true |
| 10 | 7b.on-disk isolated file graph === shared file graph | PASS | path=/tmp/pascal-villa-v8/scenes/d346bd83beb9.json equal=true |

## Summary

- Passed: **10/10**
- Failed: **0/10**
- Overall: **PASS**

## Original vs loaded-after-save — per-type count diff

| Type | Original | Loaded | Match |
|---|---:|---:|:---:|
| building | 1 | 1 | YES |
| door | 10 | 10 | YES |
| fence | 5 | 5 | YES |
| level | 1 | 1 | YES |
| site | 1 | 1 | YES |
| slab | 1 | 1 | YES |
| wall | 12 | 12 | YES |
| window | 12 | 12 | YES |
| zone | 13 | 13 | YES |

## Notes

- `save_scene({ includeCurrentScene: false, graph })` should persist the graph verbatim, preserving all node ids.
- `stableStringify` normalises key order so byte equality is order-independent; this is the canonical "deep-equal" check here.
- Step 5 rebuilds the scene by save/load-ing a shell (site+building+level) then replaying every remaining node as an `apply_patch` `create` op. Only counts-per-type are compared (node ids on the rebuild will equal the originals because we reuse the same ids in the patches).
- Step 6 exercises `duplicate_level` against the copied scene; the site/building remain shared (count=1), while per-level types should double.
