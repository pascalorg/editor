# Villa Azul — V7 Parentage Report

Scene: `/tmp/pascal-villa/scenes/a6e7919eacbe.json`
Nodes: 56 (meta.nodeCount=56)
Roots: 1 (site_5mzaasm5o9a9d0sf)

**Overall: FAIL**

| # | Check | Count | Result |
| - | ----- | ----- | ------ |
| 1 | C1 parent chain valid (terminates at root, no cycles, no dangling refs) | 2 | FAIL |
| 2 | C2 rootNodeIds consistent (real nodes, parentId=null, all null-parent nodes accounted for) | 2 | FAIL |
| 3 | C3 container children bidirectional (every id exists; every parentId has reverse entry) | 53 | FAIL |
| 4 | C4 site.children holds building objects matching nodes | 1 | PASS |
| 5 | C5 no orphans (every non-root parentId exists) | 53 | PASS |
| 6 | C6 level.children includes all wall/zone/slab/fence children (levels: level_r58jrtlaqqfx4rf0=31) | 31 | PASS |
| 7 | C7 wall.children lists all door+window openings (sampled wall=wall_qgrnmxmo0go9yy3q) | 6 | PASS |

## C1 parent chain valid (terminates at root, no cycles, no dangling refs) — failures
- chain from level_r58jrtlaqqfx4rf0 terminates at non-root level_r58jrtlaqqfx4rf0
- chain from wall_qgrnmxmo0go9yy3q terminates at non-root level_r58jrtlaqqfx4rf0
- chain from wall_2s65apfvekdglbod terminates at non-root level_r58jrtlaqqfx4rf0
- chain from wall_ohb57u9y7pegelg9 terminates at non-root level_r58jrtlaqqfx4rf0
- chain from wall_vnzffl9uhhp7u7ng terminates at non-root level_r58jrtlaqqfx4rf0

## C2 rootNodeIds consistent (real nodes, parentId=null, all null-parent nodes accounted for) — failures
- node level_r58jrtlaqqfx4rf0 has parentId=null but is not a root nor a site child

## C3 container children bidirectional (every id exists; every parentId has reverse entry) — failures
- child level_r58jrtlaqqfx4rf0 parentId=null but listed under building_a1nzo5owe89pelr6
