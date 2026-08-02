# Layout clearance — error & reporting log

Permanent checklist so door / item layout bugs do not regress.
Use when changing `door-clearance.ts`, `layout-clearance.ts`, `furnish_room`, `verify_scene`, or `check_collisions`.

## Reporting codes / messages

| Source | Message / skip reason | Meaning |
|---|---|---|
| `furnish_room` skip | `blocks door clearance` | Pose hits door keep-out (real or planned) |
| `furnish_room` skip | `overlaps another item` | Pose hits another floor item (gap required) |
| `furnish_room` skip | `outside room bounds` | Pose leaves room polygon bounds |
| `verify_scene` | `Door … is blocked by item …` | Existing item in door keep-out |
| `verify_scene` / `check_collisions` | `Items overlap: A and B` | Item–item footprint conflict |
| `check_collisions` | `kind: item-aabb` | Same as overlap, structured |

Agents should treat skip reasons and verify issues as actionable, not ignore them.

## Known pitfalls (found in review) — do not reintroduce

### L1 — Multi-level false positives
**Bug:** Plan X/Z only; upstairs furniture blocked downstairs doors.  
**Rule:** Every door/item comparison must share the same **level id** (walk `parentId` via `resolveNodeLevelId`).  
**Test:** Keepouts / collisions with two levels, same plan footprint, must not cross.

### L2 — Planned entrance keep-out skipped when other doors exist
**Bug:** Planned keep-out only if `existingKeepouts.length === 0` globally.  
**Rule:** For `furnish_room`, always add planned keep-out for **this room’s** `doorWallIndex` unless an existing keep-out already covers that edge (`keepoutCoversPlanned`).  
**Test:** Level has door in room A; furnish room B without a door → still protects B’s door wall.

### L3 — Gap sign inverted
**Bug:** `a.maxX - gap > b.minX` required deeper penetration for larger gap.  
**Rule:** `gap` = **minimum free space**. Overlap if boxes expanded by gap still intersect:  
`a.maxX + gap > b.minX && a.minX - gap < b.maxX` (same for Z).  
**Test:** Two items 0.05 m apart with `gap = 0.08` must report collision.

### L4 — Item scale ignored
**Bug:** Used raw `asset.dimensions` instead of `getScaledDimensions`.  
**Rule:** Scene items always use `itemNodePlanAabb` / `getScaledDimensions`. Catalog placements (not yet scaled) use asset dimensions.  
**Test:** Scaled item collides when scaled footprint overlaps.

### L5 — Client navigation does not re-apply light preview (apps/editor)
**Bug:** `useEffect([])` only on mount; same-route query change ignored.  
**Rule:** Depend on search-string / `useSearchParams` for light preview shading.  
**Test:** Manual or unit: change `?disable=postFx` without remount → solid shading applies.

## Pre-merge checklist

- [ ] Level-scoped door + item tests green  
- [ ] Planned keep-out with sibling-room doors green  
- [ ] Gap semantics unit test green  
- [ ] Scaled dimensions unit test green  
- [ ] `bun test` for door/layout/room/scene-query/check-collisions  

## Related PRs

- #569 — MCP layout clearance  
- #570 — Light preview / editor redirect  
