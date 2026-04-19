# Villa Azul - V9 Spatial + MCP Tool Validation Report

- Scene id: `a6e7919eacbe`
- Data dir: `/tmp/pascal-villa`
- Transport: stdio (`/Users/adrian/Desktop/editor/.worktrees/mcp-server/packages/mcp/dist/bin/pascal-mcp.js`)
- Generated: 2026-04-19T18:37:02.658Z
- Duration: 94 ms

## Results

| # | Check | Status | Note |
|---|---|:---:|---|
| | load_scene | PASS | id=a6e7919eacbe name='Villa Azul' nodes=56 |
| | 1. find_nodes(zone, levelId) | PASS | got 13 (expected 13) |
| | 2. find_nodes(door) | PASS | got 10 (expected 10) |
| | 3. find_nodes(window) | PASS | got 12 (expected 12) |
| | 4. find_nodes(fence) | PASS | got 5 (expected 5) |
| | 5. describe_node(living-dining) | PASS | desc='Zone "Living dining" with 4 vertices' |
| | 6. measure(master,pool) | PASS | distance=19.602m (expected > 10m) |
| | 7. check_collisions | PASS | collisions=0 (expected 0) |
| | 8. get_node(pool-slab) | PASS | slab slab_azul_pool elevation=-2 (expected -2) |
| | 9. find_nodes(zoneId=living-dining) | PASS | 26 nodes in polygon, types={"building":1,"wall":2,"zone":1,"door":10,"window":12} |
| | 10. resource scene/current/summary | PASS | mime=text/markdown bytes=432 hasVillaAzul=false hasZone=13=true |
| | 11. resource constraints/{levelId} | PASS | mime=application/json slabs=1 wallPolygons=12 poolInSlabs=true |

## Summary

- Pass: 12/12
- Fail: 0
- Overall: PASS
