# Phase 8 P1 — templates lifecycle (stdio MCP)

Generated: 2026-04-19T18:18:14.719Z
Transport: stdio (`bun packages/mcp/dist/bin/pascal-mcp.js --stdio`), data dir `/tmp/pascal-phase8-p1`.

**Summary:** 18/18 PASS, 0 FAIL, 100 ms.

## Steps

| # | Step | Status | Detail |
|---|------|--------|--------|
| 1 | list_templates | PASS | ids=[empty-studio,garden-house,two-bedroom], empty-studio(10), two-bedroom(25), garden-house(18) |
| 2a/empty-studio | create_from_template + save_scene | PASS | templateId=empty-studio, createdNodes=10, sceneId=58d29341f2ac, version=1 |
| 2b/empty-studio | validate_scene | PASS | valid=true, errors=0 |
| 2c/empty-studio | get_scene counts | PASS | nodes=10, zones=1, walls=4, doors=1, windows=1 |
| 2a/two-bedroom | create_from_template + save_scene | PASS | templateId=two-bedroom, createdNodes=25, sceneId=5e1fbd0fd735, version=1 |
| 2b/two-bedroom | validate_scene | PASS | valid=true, errors=0 |
| 2c/two-bedroom | get_scene counts | PASS | nodes=25, zones=4, walls=9, doors=4, windows=5 |
| 2a/garden-house | create_from_template + save_scene | PASS | templateId=garden-house, createdNodes=18, sceneId=b11de24c35c5, version=1 |
| 2b/garden-house | validate_scene | PASS | valid=true, errors=0 |
| 2c/garden-house | get_scene counts | PASS | nodes=18, zones=2, walls=4, doors=2, windows=4 |
| 3 | list_scenes | PASS | scenes=3, names=[p1-empty-studio,p1-garden-house,p1-two-bedroom] |
| 4 | measure between zones | PASS | from=zone_q04o6614gj1k6025, to=zone_zyts5lliy88xf7tj, distance=5.000m |
| 5/empty-studio | delete_scene | PASS | id=58d29341f2ac, deleted=true |
| 5/two-bedroom | delete_scene | PASS | id=5e1fbd0fd735, deleted=true |
| 5/garden-house | delete_scene | PASS | id=b11de24c35c5, deleted=true |
| 5/final | list_scenes empty | PASS | remaining scenes=0 |
| 6a | create_from_template unknown id | PASS | tool_error text="MCP error -32602: unknown_template: nonexistent. Call list_templates for the set of valid ids." |
| 6b | load_scene missing id | PASS | tool_error text="MCP error -32602: scene_not_found" |

## Per-template snapshot (step 2c)

| Template | Scene name | nodes | zones | walls | doors | windows |
|----------|------------|-------|-------|-------|-------|---------|
| empty-studio | p1-empty-studio | 10 | 1 | 4 | 1 | 1 |
| two-bedroom | p1-two-bedroom | 25 | 4 | 9 | 4 | 5 |
| garden-house | p1-garden-house | 18 | 2 | 4 | 2 | 4 |
