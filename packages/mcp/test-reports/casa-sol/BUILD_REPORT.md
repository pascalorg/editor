# Casa del Sol — Build Report

Generated: 2026-04-18T16:32:27.015Z
Server: http://localhost:3917/mcp
Transport used: **in-memory** — in-memory fallback — HTTP server returned: Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Server already initialized"},"id":null}
Initial node count: 3

## Steps

| # | Name | Status | Duration | Summary |
|---|------|--------|----------|---------|
| 1 | discover | OK | 1ms | building=building_hhprs7o5kz0q2qo7, level=level_9ded0vdlfag09tdt |
| 2 | perimeter walls | OK | 1ms | 4 walls via create_wall |
| 3 | interior walls | OK | 0ms | 5 walls via apply_patch |
| 4 | zones | OK | 1ms | 7 zones |
| 5 | openings | OK | 2ms | 6 doors, 6 windows, 0 failures |
| 6 | pool zone+slab | OK | 1ms | zone=zone_av8rfpjgcpmpx4pb, basin slab=slab_tqyxze2hshzm1it3 |
| 7 | privacy fences | OK | 0ms | 5 fences via apply_patch |
| 8 | garden zone | OK | 0ms | zone=zone_gtpdocou2nceicp9 |
| 9 | measure cross-zone | OK | 0ms | distance=12.649m |
| 10 | export json | OK | 0ms | wrote 26761 bytes -> scene.json |
| 11 | duplicate level | OK | 0ms | newLevelId=level_zgyhyd1f4vtrm05v, cloned=37 nodes |

## Per-Step Details

### Step 1 — discover

- Status: **OK**
- Duration: 1ms
- Summary: building=building_hhprs7o5kz0q2qo7, level=level_9ded0vdlfag09tdt
- Node IDs (2): `building_hhprs7o5kz0q2qo7, level_9ded0vdlfag09tdt`

### Step 2 — perimeter walls

- Status: **OK**
- Duration: 1ms
- Summary: 4 walls via create_wall
- Node IDs (4): `wall_vc5l8mk2b3j3ukvq, wall_9jaybb53j2r5j5en, wall_a16b1eirqz5p9f98, wall_yiwfcyw716g5ql5y`

### Step 3 — interior walls

- Status: **OK**
- Duration: 0ms
- Summary: 5 walls via apply_patch
- Node IDs (5): `wall_9vmyxyv2kea0t2vn, wall_53gr0rtp1ssmxvz2, wall_yzuosc4u4z0a9jqo, wall_eeogjzcwm711gzam, wall_3mznfrklw8ar7jrz`

### Step 4 — zones

- Status: **OK**
- Duration: 1ms
- Summary: 7 zones
- Node IDs (7): `zone_b51zjgfr0cgc7ncc, zone_x409m2lnw1jpmi8m, zone_and0s1ux5v8rexj6, zone_n8w3oyzr3c4ovcbu, zone_c1wa4cr91h215zzk, zone_e8e6qqmx85tockrm, zone_ebbidjjln9doosy5`

### Step 5 — openings

- Status: **OK**
- Duration: 2ms
- Summary: 6 doors, 6 windows, 0 failures
- Node IDs (12): `door_v19tfw6dbg60pjka, door_57wgnpcft27n51ui, door_lv8wmjjs6em9ayqg, door_g1ffn08lohho4vf0, door_zuyuxee4afd5ae0o, door_n4kgjkvq18a87rh0, window_6lkp36vh0kpe8vsl, window_8klttdg0qbxw0v6h, window_r9mc8jkp0dem9s8u, window_bbmwfj9hjxfz6y7c, window_19otr8qt84hke69s, window_qy4pp3lwyn5cq2u1`

### Step 6 — pool zone+slab

- Status: **OK**
- Duration: 1ms
- Summary: zone=zone_av8rfpjgcpmpx4pb, basin slab=slab_tqyxze2hshzm1it3
- Node IDs (2): `zone_av8rfpjgcpmpx4pb, slab_tqyxze2hshzm1it3`

### Step 7 — privacy fences

- Status: **OK**
- Duration: 0ms
- Summary: 5 fences via apply_patch
- Node IDs (5): `fence_hnhjl6vicj3fs234, fence_me6wvw6rf93y2um4, fence_af22csiukvc7gjyf, fence_lp6d7gkrado9z0cc, fence_a09o9w183o453oqh`

### Step 8 — garden zone

- Status: **OK**
- Duration: 0ms
- Summary: zone=zone_gtpdocou2nceicp9
- Node IDs (1): `zone_gtpdocou2nceicp9`

### Step 9 — measure cross-zone

- Status: **OK**
- Duration: 0ms
- Summary: distance=12.649m
- Node IDs (2): `wall_vc5l8mk2b3j3ukvq, fence_af22csiukvc7gjyf`

### Step 10 — export json

- Status: **OK**
- Duration: 0ms
- Summary: wrote 26761 bytes -> scene.json

### Step 11 — duplicate level

- Status: **OK**
- Duration: 0ms
- Summary: newLevelId=level_zgyhyd1f4vtrm05v, cloned=37 nodes
- Node IDs (1): `level_zgyhyd1f4vtrm05v`

## Opening attempts

| Label | Kind | Wall | OK | Opening Id / Error |
|-------|------|------|----|--------------------|
| front-door | door | `wall_vc5l8mk2b3j3ukvq` | yes | door_v19tfw6dbg60pjka |
| sliding-pool | door | `wall_vc5l8mk2b3j3ukvq` | yes | door_57wgnpcft27n51ui |
| kitchen-back | door | `wall_9jaybb53j2r5j5en` | yes | door_lv8wmjjs6em9ayqg |
| master-door | door | `wall_53gr0rtp1ssmxvz2` | yes | door_g1ffn08lohho4vf0 |
| bedroom-2-door | door | `wall_yzuosc4u4z0a9jqo` | yes | door_zuyuxee4afd5ae0o |
| bath2-door | door | `wall_3mznfrklw8ar7jrz` | yes | door_n4kgjkvq18a87rh0 |
| living-pic | window | `wall_vc5l8mk2b3j3ukvq` | yes | window_6lkp36vh0kpe8vsl |
| living-2 | window | `wall_vc5l8mk2b3j3ukvq` | yes | window_8klttdg0qbxw0v6h |
| kitchen-w | window | `wall_a16b1eirqz5p9f98` | yes | window_r9mc8jkp0dem9s8u |
| master-w | window | `wall_yiwfcyw716g5ql5y` | yes | window_bbmwfj9hjxfz6y7c |
| bedroom-2-w | window | `wall_yiwfcyw716g5ql5y` | yes | window_19otr8qt84hke69s |
| bath2-high | window | `wall_9jaybb53j2r5j5en` | yes | window_qy4pp3lwyn5cq2u1 |

## Final scene totals

| Node type | Count |
|-----------|-------|
| site | 1 |
| building | 1 |
| level | 2 |
| wall | 18 |
| fence | 10 |
| zone | 18 |
| slab | 2 |
| door | 12 |
| window | 12 |
| **total** | **76** |

## Validation

- Final `validate_scene`: valid=`true`, errors=0

## Duplicate-level

- Pre-duplicate node count: **39**
- Post-duplicate node count: **76**
- New level id: `level_zgyhyd1f4vtrm05v`
- Nodes cloned: 37

## Known discrepancies with DESIGN.md

- Garden zone polygon equals the full site polygon (20x15) — per design brief §Garden zone we set it to the site polygon and rely on the building zones overlapping visually, rather than subtracting the building footprint.
- Build fell back to in-memory MCP transport. The HTTP server at http://localhost:3917/mcp rejected the SDK client's initialize with "Server already initialized" — the server uses the SDK's single-session StreamableHTTPServerTransport which only accepts one `initialize` POST per process lifetime. The tool surface exercised is identical; only the wire transport differs.

## Artifacts

- `scene.json`: full pretty-printed JSON export (26761 bytes)
- `build.log`: stdout from this run
- `BUILD_REPORT.md`: this file
