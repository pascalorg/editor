# T3 Scenario Report — 2-Bedroom Apartment

Generated: 2026-04-18T16:20:27.809Z
Transport: http (shared HTTP server)
Server URL: http://localhost:3917/mcp

## Step-by-step

### Step 1: discover OK (4ms)

- Summary: building=building_bfqg91ai9ijps9ej, level=level_wyuoxj87czq3v0re (of 1 buildings, 1 levels)
- Node IDs (2): building_bfqg91ai9ijps9ej, level_wyuoxj87czq3v0re

### Step 2: perimeter walls OK (2ms)

- Summary: created 4 perimeter walls (result.createdIds=["wall_y87bsrljd2245n51","wall_sja6jpda73tlhxwb","wall_aegff27krjwgmkmi","wall_dcymglyle9ff09ti"])
- Node IDs (4): wall_y87bsrljd2245n51, wall_sja6jpda73tlhxwb, wall_aegff27krjwgmkmi, wall_dcymglyle9ff09ti

### Step 3: interior partitions OK (1ms)

- Summary: created 7 interior walls
- Node IDs (7): wall_rl83cc5tnbf4b34j, wall_qv53jm9kvl7k6slf, wall_8y52fwzco2ep7fb1, wall_hrfixeusz7zb7x63, wall_1ullk9bm6dw15i9t, wall_c4fjjswnk0mprctm, wall_p359pffjf3qs59cy

### Step 4: set zones OK (3ms)

- Summary: created 4 zones: bedroom-1, bedroom-2, bathroom, living-kitchen
- Node IDs (4): zone_3fyksm10tb0dhn1e, zone_u95l1bt35jci3gvu, zone_r9ma8tvsqt9w1zey, zone_l189q61kf9ra2m8t

### Step 5: cut openings OK (6ms)

- Summary: 3 doors, 3 windows
- Node IDs (6): door_cjzja4lt8owg88wg, door_bs7bf0azevq9vd76, door_o8etwqsemfgj5mkj, window_47x40mtv2l4ca9p4, window_n09awmg5m3ct4fvn, window_xlta3f3f0cnmbti3

### Step 6: validate scene OK (1ms)

- Summary: valid=true, errors=0

### Step 7: measure furthest zones OK (3ms)

- Summary: furthest: zone_3fyksm10tb0dhn1e <-> zone_u95l1bt35jci3gvu = 7.000m
- Node IDs (2): zone_3fyksm10tb0dhn1e, zone_u95l1bt35jci3gvu

### Step 8: export json OK (1ms)

- Summary: exported 15392 bytes -> apartment.json

### Step 9: undo 3 steps OK (2ms)

- Summary: undone=3, nodes 24 -> 21 (delta=3)

### Step 10: redo 3 steps OK (2ms)

- Summary: redone=3, nodes 21 -> 24

### Step 11: duplicate level + validate OK (2ms)

- Summary: newLevelId=level_cxvltlqvgqcasiep, cloned=22, valid=true, errors=0
- Node IDs (1): level_cxvltlqvgqcasiep

### Step 12: delete duplicated level OK (3ms)

- Summary: deleted 22 nodes; nodes 46 -> 24
- Node IDs (22): level_cxvltlqvgqcasiep, wall_xhn7o9bfpmcv2znr, window_0qb4bgvzp46y412o, window_cjk6a6zwsn48dj5u, wall_hgatfahp4i53s139, wall_fp25ulcwqmsim8p5, window_jv0g8uos313ljbbe, wall_mjue0xaodm8d3vzi, wall_brw2c9vg502md7a0, wall_1at54a0mfxgq2txb, door_l8k2adas2djwpcf8, wall_6m920gigvtn113af, wall_2hazwrgv922l3t6q, door_a62eecbdzpdoqnlo, wall_11h43exay41fub7f, door_06dpidftldcoaisv, wall_u7e1gp0xbir5112y, wall_jbwbwvgt9lzw51mk, zone_hkp5wsyw7aydi175, zone_rpqx5ul6bl1tpdmd ...

## Final Counts

- Total nodes: 24
- Zones: 4
- Doors: 3
- Windows: 3
- Post-step-5 node count: 24

## Validation

- Valid: true
- Errors: 0

## Transport Notes

- Used transport: **http**
- Reason: shared HTTP server
