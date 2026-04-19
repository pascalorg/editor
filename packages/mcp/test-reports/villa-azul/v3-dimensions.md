# Villa Azul — V3 Dimensional Accuracy Report

- Scene file: `/tmp/pascal-villa/scenes/a6e7919eacbe.json`
- Generated: 2026-04-18
- Tolerance: < 1% per-zone area error
- Method: shoelace formula applied to each zone's `polygon` array; all polygons
  in this scene are axis-aligned rectangles, so areas reduce to width × height.
  Computed by hand from extracted coords (Bash execution disabled in sandbox).

## Per-zone areas

| Zone | Expected (m²) | Actual (m²) | Abs err (m²) | % err | Pass |
|---|---:|---:|---:|---:|:---:|
| Master bedroom | 18.00 | 18.000 | 0.000 | 0.000% | PASS |
| Master bath | 12.00 | 12.000 | 0.000 | 0.000% | PASS |
| Bedroom 2 | 12.00 | 12.000 | 0.000 | 0.000% | PASS |
| Shared bath | 6.00 | 6.000 | 0.000 | 0.000% | PASS |
| Bedroom 3 | 12.00 | 12.000 | 0.000 | 0.000% | PASS |
| Living dining | 42.00 | 42.000 | 0.000 | 0.000% | PASS |
| Kitchen | 18.00 | 18.000 | 0.000 | 0.000% | PASS |
| Entry hall | 15.00 | 15.000 | 0.000 | 0.000% | PASS |
| Corridor | 15.00 | 15.000 | 0.000 | 0.000% | PASS |
| Pool | 32.00 | 32.000 | 0.000 | 0.000% | PASS |
| Outdoor kitchen | 15.00 | 15.000 | 0.000 | 0.000% | PASS |
| Driveway | 29.25 | 29.250 | 0.000 | 0.000% | PASS |
| Back patio | 20.00 | 20.000 | 0.000 | 0.000% | PASS |

## Aggregate checks

| Check | Expected | Actual | % err | Pass |
|---|---:|---:|---:|:---:|
| Interior sum (first 9 zones) | 150.00 m² | 150.000 m² | 0.000% | PASS |
| Pool exactly 32 m² (8 × 4) | 32 m² | 32.000 m² | 0.000% | PASS |
| Site polygon area | 500 m² | 900.000 m² | 80.000% | FAIL |
| Pool ↔ Master bedroom centroid dist | 17–20 m | 19.602 m | — | PASS |

## Centroids (reference)

| Zone | cx | cy |
|---|---:|---:|
| Master bedroom | -8.500 | -2.000 |
| Master bath | -8.500 | 3.000 |
| Bedroom 2 | -5.500 | -3.000 |
| Shared bath | -5.500 | 0.000 |
| Bedroom 3 | -5.500 | 3.000 |
| Living dining | -1.000 | -1.500 |
| Kitchen | -1.000 | 3.500 |
| Entry hall | 3.500 | -2.500 |
| Corridor | 3.500 | 2.500 |
| Pool | 11.000 | 0.000 |
| Outdoor kitchen | 9.500 | 4.500 |
| Driveway | -9.250 | 7.750 |
| Back patio | 0.000 | 6.500 |

## Pool ↔ Master bedroom distance

- Pool centroid: (11, 0)
- Master bedroom centroid: (-8.5, -2)
- dx = 19.5, dy = 2 → d = √(19.5² + 2²) = √384.25 ≈ **19.602 m** (within 17–20 m)

## Summary

- Zones pass (<1%): YES (13 / 13)
- Interior sum pass: YES (150.000 m² vs 150 m², exact)
- Pool exact pass: YES (32.000 m²)
- Site polygon pass: **NO** — site is 30×30 = 900 m², spec expects 25×20 = 500 m²
- Pool ↔ Master distance pass: YES (19.602 m)
- **Overall: FAIL** (one aggregate check fails: site polygon area)

## Notes / deviations

- Site polygon points are `[[-15,-15],[15,-15],[15,15],[-15,15]]`, i.e. a
  30 × 30 square (900 m²), not the 25 × 20 = 500 m² lot called for by the
  design spec. All zone and building geometry does fit inside this larger
  site, so the building envelope and interior footprint are still correct;
  only the site boundary itself is wrong.
- All 13 zone polygons are exact axis-aligned rectangles with integer or
  half-integer vertices; shoelace areas equal width × height with no
  floating-point drift (errors are 0 to machine precision).
- Interior 9-zone total is exactly 150 m² (0% error), confirming the
  15 × 10 m interior envelope.
- Pool footprint is exactly 8 × 4 = 32 m², matching spec.
