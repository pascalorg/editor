# Casa del Sol — design brief

A single-story 3-bedroom, 2-bathroom house with a swimming pool and a privacy-screened perimeter, built entirely via `@pascal-app/mcp` HTTP tools against a fresh scene.

## Lot
- Site polygon: 20 × 15 m rectangle centred at origin → corners (−10, −7.5) to (10, 7.5).
- Origin axes: +x = east, +z = south (core convention; floor plane is xz).

## Building envelope
- Footprint: 12 × 8 m, centred west-of-origin at about (−2, 0).
- Wall thickness: 0.2 m. Wall height: 2.7 m.
- Floor elevation: 0. Single storey.

## Interior rooms (zones)
Origin for interior: building SW corner at (−8, −4). All rooms span the 8 m building depth somehow.

| Room            | Footprint (x × z)    | Polygon corners                         |
|-----------------|----------------------|-----------------------------------------|
| Living / dining | 7 × 4                | (−8,  0) (−1,  0) (−1,  4) (−8,  4)     |
| Kitchen         | 5 × 4                | (−1,  0) ( 4,  0) ( 4,  4) (−1,  4)     |
| Bedroom 2       | 4 × 4                | (−8, −4) (−4, −4) (−4,  0) (−8,  0)     |
| Hallway         | 3 × 1                | (−4, −2) (−1, −2) (−1, −1) (−4, −1)     |
| Bathroom 2      | 3 × 2                | (−4, −4) (−1, −4) (−1, −2) (−4, −2)     |
| Bathroom 1      | 3 × 1                | (−4, −1) (−1, −1) (−1,  0) (−4,  0)     |
| Master bedroom  | 5 × 4                | (−1, −4) ( 4, −4) ( 4,  0) (−1,  0)     |

## Walls (perimeter + partitions, one wall per edge)
**Perimeter (4):**
1. South outer: (−8, 4) → (4, 4)
2. North outer: (−8, −4) → (4, −4)
3. West outer: (−8, −4) → (−8, 4)
4. East outer: (4, −4) → (4, 4)

**Interior (partitions):**
5. Living/Kitchen split: (−1, 0) → (−1, 4)
6. North bedrooms split: (−1, −4) → (−1, 0)
7. Bedroom 2 east wall: (−4, −4) → (−4, 0)
8. Hallway north edge: (−4, −1) → (−1, −1)
9. Hallway south edge: (−4, −2) → (−1, −2)

## Openings (doors + windows)
All positions are normalised 0..1 along the wall (start → end).

| Kind    | Wall                                   | Pos | Width | Height | Purpose              |
|---------|----------------------------------------|-----|-------|--------|----------------------|
| door    | 1 (south outer)                        | 0.20| 0.9   | 2.1    | Front entrance       |
| door    | 1 (south outer)                        | 0.75| 2.2   | 2.1    | Sliding glass to pool|
| door    | 2 (north outer)                        | 0.65| 0.9   | 2.1    | Kitchen back door    |
| door    | 6 (N-bedrooms split, middle)           | 0.30| 0.8   | 2.1    | Master bedroom door  |
| door    | 7 (Bedroom 2 east wall)                | 0.50| 0.8   | 2.1    | Bedroom 2 door       |
| door    | 9 (Hallway south edge)                 | 0.50| 0.7   | 2.0    | Bathroom 2 door      |
| window  | 1 (south outer, living)                | 0.30| 2.0   | 1.4    | Living picture window|
| window  | 1 (south outer, living)                | 0.45| 1.4   | 1.4    | Living window 2      |
| window  | 3 (west outer)                         | 0.25| 1.0   | 1.1    | Kitchen window       |
| window  | 4 (east outer)                         | 0.25| 1.4   | 1.4    | Master window        |
| window  | 4 (east outer)                         | 0.75| 1.4   | 1.4    | Bedroom 2 window     |
| window  | 2 (north outer, bathroom 2)            | 0.30| 0.8   | 0.6    | Bathroom 2 high      |

(Core validates `cut_opening` arguments; if wall-endpoint geometry makes two openings collide, the tool returns an error and the script logs the conflict.)

## Exterior elements

**Swimming pool (east of house):**
- Zone polygon: (5, −1.5) (10, −1.5) (10, 1.5) (5, 1.5) — 5 × 3 m.
- Metadata: `{ kind: "pool", depthM: 1.8, finish: "tile" }`.
- Additional slab at elevation −1.8 m to represent the pool basin (same polygon).

**Privacy screen fence (lot perimeter):**
- Style: `privacy`, height 1.8 m.
- Four fence segments around the 20 × 15 lot, with a 2 m gap at the south entrance (x ∈ [−1, 1]).
- Segments:
  1. South-west: (−10, 7.5) → (−1, 7.5)
  2. South-east: (1, 7.5) → (10, 7.5)
  3. East: (10, 7.5) → (10, −7.5)
  4. North: (10, −7.5) → (−10, −7.5)
  5. West: (−10, −7.5) → (−10, 7.5)

**Garden zone** (everything that isn't building or pool):
- One big zone labelled "garden" with the remaining polygon.

## Success criteria
- `validate_scene` returns `valid: true, errors: 0` after every step.
- Final node count ≥ 30 (1 site + 1 building + 1 level + ~14 walls + 5 fences + ~7 zones + 6 doors + 7 windows + 1 pool slab ≈ 43).
- `export_json` produces a valid parseable JSON.
- `duplicate_level` works (produces a second storey at the same layout).
- Scene exports and imports cleanly: write the export to disk, `unloadScene` via the bridge (if exposed) or setScene from the export, re-validate.

## Non-goals
- Catalog items (no furniture — the catalog is unavailable in headless mode).
- Realistic materials / textures (MCP doesn't set `material`; editor picks defaults).
- Roof geometry — the roof system is render-only; we skip for v0.1.
