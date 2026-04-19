# Phase 8 P10 — full sweep (stdio MCP)

Generated: 2026-04-19T18:21:20.973Z

## Summary

- Transport: stdio (`bun packages/mcp/dist/bin/pascal-mcp.js --stdio`)
- Data dir: `/tmp/pascal-phase8-p10`
- Sampling: mocked via `client.setRequestHandler(CreateMessageRequestSchema, …)`
- Tools listed: **30**
- Resources listed: **3** static + **1** template
- Prompts listed: **3**
- Total entries exercised: **37**
- PASS: **37** / PARTIAL: **0** / FAIL: **0**
- Run time: **152 ms**

## Listed tools

```
analyze_floorplan_image
analyze_room_photo
apply_patch
check_collisions
create_from_template
create_level
create_wall
cut_opening
delete_node
delete_scene
describe_node
duplicate_level
export_glb
export_json
find_nodes
generate_variants
get_node
get_scene
list_scenes
list_templates
load_scene
measure
photo_to_scene
place_item
redo
rename_scene
save_scene
set_zone
undo
validate_scene
```

## Listed resources

```
(static)
pascal://catalog/items
pascal://scene/current
pascal://scene/current/summary

(templates)
pascal://constraints/{levelId}
```

## Listed prompts

```
from_brief
iterate_on_feedback
renovation_from_photos
```

## Pass matrix — tools

| # | Tool | Status | Note |
|---|------|--------|------|
| 1 | `list_templates` | PASS | 3 templates |
| 2 | `create_from_template` | PASS | templateId=two-bedroom nodes=25 |
| 3 | `get_scene` | PASS | 25 nodes / 1 roots |
| 4 | `get_node` | PASS | type=site |
| 5 | `describe_node` | PASS | type=site children=1 |
| 6 | `find_nodes` | PASS | 1 level(s) |
| 7 | `measure` | PASS | d=6.403m |
| 8 | `apply_patch` | PASS | applied=1 |
| 9 | `create_level` | PASS | levelId=level_7fjtu570j6yyxcm4 |
| 10 | `create_wall` | PASS | wallId=wall_2b2og8j9nrr6jk6t |
| 11 | `place_item` | PASS | itemId=item_efdmfnownqwa3yd4 |
| 12 | `cut_opening` | PASS | openingId=door_c0cul6bctrwf76md |
| 13 | `set_zone` | PASS | zoneId=zone_7ljy8xitu0km2q8d |
| 14 | `duplicate_level` | PASS | newLevelId=level_i5yq9hk2kwd9unpw nodes=28 |
| 15 | `delete_node` | PASS | deleted 28 nodes |
| 16 | `undo` | PASS | undone=1 |
| 17 | `redo` | PASS | redone=1 |
| 18 | `export_json` | PASS | 21051 chars |
| 19 | `export_glb` | PASS | bytes/b64=0 |
| 20 | `validate_scene` | PASS | valid=true errors=0 |
| 21 | `check_collisions` | PASS | 0 collision(s) |
| 22 | `analyze_floorplan_image` | PASS | walls=4 rooms=1 conf=0.82 |
| 23 | `analyze_room_photo` | PASS | w=4m fixtures=2 |
| 24 | `save_scene` | PASS | id=7b7ca35340e3 v=1 nodes=31 |
| 25 | `list_scenes` | PASS | 1 scene(s) |
| 26 | `load_scene` | PASS | id=7b7ca35340e3 nodes=31 |
| 27 | `generate_variants` | PASS | 2 variants, ids=2 |
| 28 | `photo_to_scene` | PASS | sceneId=fbde55412851 walls=4 rooms=1 |
| 29 | `rename_scene` | PASS | name=p10 base renamed |
| 30 | `delete_scene` | PASS | deleted=86366d07b242 |

## Pass matrix — resources

| # | Resource | Status | Note |
|---|----------|--------|------|
| 1 | `pascal://scene/current` | PASS | 8 nodes / 1 roots |
| 2 | `pascal://scene/current/summary` | PASS | 425 chars of markdown |
| 3 | `pascal://catalog/items` | PASS | 0 items |
| 4 | `pascal://constraints/{levelId}` | PASS | slabs=0 wallPolys=4 |

## Pass matrix — prompts

| # | Prompt | Status | Note |
|---|--------|--------|------|
| 1 | `from_brief` | PASS | 1 message(s) |
| 2 | `iterate_on_feedback` | PASS | 1 message(s) |
| 3 | `renovation_from_photos` | PASS | 6 message(s) |
