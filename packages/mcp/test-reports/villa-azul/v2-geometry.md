# Villa Azul - V2 Geometry Report

- Scene: `/tmp/pascal-villa/scenes/a6e7919eacbe.json`
- Generated: 2026-04-19T18:34:19.967Z
- Script: `packages/mcp/test-reports/villa-azul/v2-geometry.ts`

## Summary: 7/7 checks passed

| # | Check | Status |
|---|-------|--------|
| 1 | Zones closed & non-degenerate | PASS |
| 2 | Zones don't overlap | PASS |
| 3 | Perimeter walls closed loop | PASS |
| 4 | Interior walls connected (no floating endpoints) | PASS |
| 5 | Wall endpoints inside fenced envelope | PASS |
| 6 | Pool basin slab == pool zone polygon | PASS |
| 7 | Fence gap at south entrance (x in [-1,1], z=10) | PASS |

## 1. Zones closed & non-degenerate - PASS

**Details:**
- Master bedroom: 4 verts, area=18.00m^2
- Master bath: 4 verts, area=12.00m^2
- Bedroom 2: 4 verts, area=12.00m^2
- Shared bath: 4 verts, area=6.00m^2
- Bedroom 3: 4 verts, area=12.00m^2
- Living dining: 4 verts, area=42.00m^2
- Kitchen: 4 verts, area=18.00m^2
- Entry hall: 4 verts, area=15.00m^2
- Corridor: 4 verts, area=15.00m^2
- Pool: 4 verts, area=32.00m^2
- Outdoor kitchen: 4 verts, area=15.00m^2
- Driveway: 4 verts, area=29.25m^2
- Back patio: 4 verts, area=20.00m^2

## 2. Zones don't overlap - PASS

**Details:**
- Pairwise BB-overlap check clean for 13 zones

## 3. Perimeter walls closed loop - PASS

**Details:**
- Perimeter corners: -10.000,-5.000 | -10.000,5.000 | 5.000,-5.000 | 5.000,5.000

## 4. Interior walls connected (no floating endpoints) - PASS

**Details:**
- wall_sl9ngyohpt1ckxrz: start=segment, end=segment
- wall_k253bcp3cbmvmksf: start=segment, end=segment
- wall_3gthhmi6v5sli2ac: start=segment, end=segment
- wall_88e7i818yv4tircj: start=segment, end=segment
- wall_m7rg6bf7mucmlh4m: start=segment, end=segment
- wall_7z6vgmyzr27vobgn: start=segment, end=segment
- wall_icyfprzyd4034us0: start=segment, end=segment
- wall_8f5iiqr81xxx2drm: start=segment, end=segment

## 5. Wall endpoints inside fenced envelope - PASS

**Details:**
- All 24 wall endpoints within |x|<=12.5, |z|<=10

## 6. Pool basin slab == pool zone polygon - PASS

**Details:**
- Pool zone & basin share 4-vertex polygon

## 7. Fence gap at south entrance (x in [-1,1], z=10) - PASS

**Details:**
- fence_0t2fy6fnsnm5lycx [-12.5,10]->[-1,10] clears gap
- fence_yp0s2xc7ian4p0y2 [1,10]->[12.5,10] clears gap
