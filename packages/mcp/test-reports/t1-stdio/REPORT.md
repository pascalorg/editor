# T1 stdio MCP test report

Generated: 2026-04-18T16:04:24.979Z

## Summary

- Tools listed: **21/21** OK
- Tools exercised: **21**
- Passed: **21/21**
- Failed: **0/21**
- Total run time: **106 ms**
- Transport: stdio (`bun packages/mcp/dist/bin/pascal-mcp.js --stdio`)

## Pass/fail matrix

| # | Tool | Status | Summary |
|---|------|--------|---------|
| 1 | `get_scene` | PASS | 3 nodes, 1 roots |
| 2 | `get_node` | PASS | node type=site, id=site_71e14qucq8msx6w7 |
| 3 | `describe_node` | PASS | type=site, 1 children |
| 4 | `find_nodes` | PASS | 1 level node(s) |
| 5 | `measure` | PASS | distance=0.000m |
| 6 | `apply_patch` | PASS | applied=1, created=1 |
| 7 | `create_level` | PASS | levelId=level_fkcj2m1n3vq4xfx6 |
| 8 | `create_wall` | PASS | wallId=wall_iznvk1lp5u2zb77v |
| 9 | `place_item` | PASS | status: catalog_unavailable |
| 10 | `cut_opening` | PASS | openingId=door_72wicnv8i6c0pqru |
| 11 | `set_zone` | PASS | zoneId=zone_p1ek0k35wz93mdqo |
| 12 | `duplicate_level` | PASS | newLevelId=level_4kpvf7vxyok3l7v2, 6 nodes |
| 13 | `delete_node` | PASS | deleted 6 node(s) |
| 14 | `undo` | PASS | undone=1 |
| 15 | `redo` | PASS | redone=1 |
| 16 | `export_json` | PASS | 5678 chars JSON |
| 17 | `export_glb` | PASS | status: not_implemented |
| 18 | `validate_scene` | PASS | valid=true, errors=0 |
| 19 | `check_collisions` | PASS | 0 collision(s) |
| 20 | `analyze_floorplan_image` | PASS | expected status: sampling_unavailable |
| 21 | `analyze_room_photo` | PASS | expected status: sampling_unavailable |

## Detail per tool

### 1. `get_scene` — PASS

Summary: 3 nodes, 1 roots

```json
{"nodes":{"site_71e14qucq8msx6w7":{"object":"node","id":"site_71e14qucq8msx6w7","type":"site","parentId":null,"visible":true,"metadata":{},"polygon":{"type":"polygon","points":[[-15,-15],[15,-15],[15,15],[-15,15]]},"children":[{"object":"node","id":"building_gyseslm2yvanyqkc","type":"building","parentId":null,"visible"…
```

### 2. `get_node` — PASS

Summary: node type=site, id=site_71e14qucq8msx6w7

```json
{"node":{"object":"node","id":"site_71e14qucq8msx6w7","type":"site","parentId":null,"visible":true,"metadata":{},"polygon":{"type":"polygon","points":[[-15,-15],[15,-15],[15,15],[-15,15]]},"children":[{"object":"node","id":"building_gyseslm2yvanyqkc","type":"building","parentId":null,"visible":true,"metadata":{},"child…
```

### 3. `describe_node` — PASS

Summary: type=site, 1 children

```json
{"id":"site_71e14qucq8msx6w7","type":"site","parentId":null,"ancestryIds":[],"childrenIds":["building_gyseslm2yvanyqkc"],"properties":{"object":"node","id":"site_71e14qucq8msx6w7","type":"site","parentId":null,"visible":true,"metadata":{},"polygon":{"type":"polygon","points":[[-15,-15],[15,-15],[15,15],[-15,15]]},"chil…
```

### 4. `find_nodes` — PASS

Summary: 1 level node(s)

```json
{"nodes":[{"object":"node","id":"level_7somiy6h3is3wqw8","type":"level","parentId":null,"visible":true,"metadata":{},"children":[],"level":0}]}
```

### 5. `measure` — PASS

Summary: distance=0.000m

```json
{"distanceMeters":0,"units":"meters"}
```

### 6. `apply_patch` — PASS

Summary: applied=1, created=1

```json
{"appliedOps":1,"deletedIds":[],"createdIds":["wall_t1patch_1776528264967"]}
```

### 7. `create_level` — PASS

Summary: levelId=level_fkcj2m1n3vq4xfx6

```json
{"levelId":"level_fkcj2m1n3vq4xfx6"}
```

### 8. `create_wall` — PASS

Summary: wallId=wall_iznvk1lp5u2zb77v

```json
{"wallId":"wall_iznvk1lp5u2zb77v"}
```

### 9. `place_item` — PASS

Summary: status: catalog_unavailable

```json
{"itemId":"item_g971o8cwvpzw0qhx","status":"catalog_unavailable"}
```

### 10. `cut_opening` — PASS

Summary: openingId=door_72wicnv8i6c0pqru

```json
{"openingId":"door_72wicnv8i6c0pqru"}
```

### 11. `set_zone` — PASS

Summary: zoneId=zone_p1ek0k35wz93mdqo

```json
{"zoneId":"zone_p1ek0k35wz93mdqo"}
```

### 12. `duplicate_level` — PASS

Summary: newLevelId=level_4kpvf7vxyok3l7v2, 6 nodes

```json
{"newLevelId":"level_4kpvf7vxyok3l7v2","newNodeIds":["level_4kpvf7vxyok3l7v2","wall_i4d5be8v8vni4m7a","wall_34mhnuwozzzxoq2h","item_l62wjnjhmvy7fo17","door_cinkqu1h3rsmva82","zone_fpykyioy7rrzq3es"]}
```

### 13. `delete_node` — PASS

Summary: deleted 6 node(s)

```json
{"deletedIds":["level_4kpvf7vxyok3l7v2","wall_i4d5be8v8vni4m7a","wall_34mhnuwozzzxoq2h","item_l62wjnjhmvy7fo17","door_cinkqu1h3rsmva82","zone_fpykyioy7rrzq3es"]}
```

### 14. `undo` — PASS

Summary: undone=1

```json
{"undone":1}
```

### 15. `redo` — PASS

Summary: redone=1

```json
{"redone":1}
```

### 16. `export_json` — PASS

Summary: 5678 chars JSON

```json
{"json":"{\n  \"nodes\": {\n    \"site_71e14qucq8msx6w7\": {\n      \"object\": \"node\",\n      \"id\": \"site_71e14qucq8msx6w7\",\n      \"type\": \"site\",\n      \"parentId\": null,\n      \"visible\": true,\n      \"metadata\": {},\n      \"polygon\": {\n        \"type\": \"polygon\",\n        \"points\": [\n     …
```

### 17. `export_glb` — PASS

Summary: status: not_implemented

```json
{"status":"not_implemented","reason":"GLB export requires the Three.js renderer, which is browser-only"}
```

### 18. `validate_scene` — PASS

Summary: valid=true, errors=0

```json
{"valid":true,"errors":[]}
```

### 19. `check_collisions` — PASS

Summary: 0 collision(s)

```json
{"collisions":[]}
```

### 20. `analyze_floorplan_image` — PASS

Summary: expected status: sampling_unavailable

```json
"MCP error -32600: sampling_unavailable"
```

### 21. `analyze_room_photo` — PASS

Summary: expected status: sampling_unavailable

```json
"MCP error -32600: sampling_unavailable"
```

## Tools listed by server

```
analyze_floorplan_image
analyze_room_photo
apply_patch
check_collisions
create_level
create_wall
cut_opening
delete_node
describe_node
duplicate_level
export_glb
export_json
find_nodes
get_node
get_scene
measure
place_item
redo
set_zone
undo
validate_scene
```
