# Vertical Model

*How buildings stack: stored level heights, plane-bound wall/ceiling tops, slab placement + thickness, support hosts, and the clamp rules that keep it all coherent.*

Applies to: anything that reads or writes vertical geometry — levels, walls, slabs, ceilings, stairs, fences, floor-placed items.

The invariant, in one sentence:

> Wall tops are pinned to the level plane; floors and platforms move what stands on
> them, never the walls or the storey above; anything that doesn't fit is clamped,
> never asked.

**Sources**: `packages/core/src/services/storey.ts`, `packages/core/src/systems/wall/wall-top.ts`, `packages/core/src/systems/slab/slab-support.ts`, `packages/core/src/systems/stair/stair-rise.ts`, `packages/core/src/store/use-scene.ts` (migration Pass 3)

## Stored truth

| Field | Meaning | Absent means |
|---|---|---|
| `level.height` | Storey height in meters, floor-to-floor. Level world Y = per-building prefix sum of stored heights, ordered by the `level` ordinal (`getLevelElevations`). | Unmigrated legacy data (never seen post-load; the migration writes it). Consumers fall back to `DEFAULT_LEVEL_HEIGHT` (2.5). |
| `wall.height` | Explicit custom height (half wall, parapet). Top = elected base + height. | **Plane-bound** (the default): the top follows `getWallPlaneTop` — `min(level height, lowest covering-slab underside over the span)`. Slabs lift only the base. |
| `ceiling.height` | Explicit custom height, write-clamped to the bound. | **Follows the level**: resolves live to `getCeilingClampBound` = `min(level height, covering underside) − 0.01`. |
| `slab.elevation` | The walking surface (top), level-local. | Default 0.05. |
| `slab.thickness` | Grows **downward**: the solid occupies `[elevation − thickness, elevation]`. | Default 0.05. |
| `slab.recessed` | Pool intent: open shell, floor at (negative) `elevation`, inner walls up to the plane. Excluded from "covering" queries and wall-face adoption. | Solid slab. |
| `supportSlabId` | Persisted support host on walls and all floor-placed kinds. Written at commit **only when overlapping supports disagree on elevation**; `'ground'` sentinel pins bare ground under a deck. | Support is elected per query (coverage election for walls, footprint max for items). |
| `stair.deckSlabId` | Destination deck: rise follows `deck.elevation − the stair's own elected base` live; cutout sync disabled while attached. | Destination is a level. |
| `stair.totalRise` | Explicit custom rise (wins over everything). | Follows: derived from the deck or the containing level; `syncStairRises` converges straight-stair segments to the resolved rise. |

Two schema rules protect these semantics:

- **No Zod defaults on meaning-bearing fields.** `level.height`, `wall.height`, `ceiling.height`, `stair.totalRise` are `.optional()` with no `.default()` — absence is data. Creation sites write values explicitly; `migrateNodes` output is cast, not parsed, so a schema default would never materialize on legacy load anyway.
- **The store deletes explicit-`undefined` keys.** `updateNode(id, { height: undefined })` removes the key (see `mergeNodeUpdate` in `node-actions.ts`); that is how "Follows level/deck" mode switches work. UI mode controls derive state from field presence — no persisted mode enums.

## Resolution helpers (use these, never `?? 2.5`)

| Helper | Home | Resolves |
|---|---|---|
| `getStoredLevelHeight`, `getLevelElevations`, `getLevelAbove/Below` | `services/storey.ts` | Level heights, per-building stacking, neighbors |
| `getWallPlaneTop` | `services/storey.ts` | A plane-bound wall's top: level height clamped to covering-slab undersides, span-sampled with boundary-inclusive band overlap |
| `resolveWallTop`, `resolveWallEffectiveHeight`, `MIN_WALL_HEIGHT` | `systems/wall/wall-top.ts` | A wall's top / effective height given plane + elected base |
| `getWallEffectiveHeightForNodes` | spatial-grid manager | The above with the real slab election, for UI overlays |
| `getCeilingClampBound`, `getCoveringSlabUndersideAt` | `services/storey.ts` | Ceiling bound; the cross-level covering query (level above, non-recessed slabs) |
| `resolveCeilingHeight` | `services/level-height.ts` | A ceiling's effective height (explicit or follows) |
| `resolveStairTotalRise`, `syncStairRises` | `systems/stair/stair-rise.ts` | Stair rise precedence + straight-flight convergence |
| `computeWallSlabSupport`, `getSlabSupportForItem`, `getSupportCandidatesForFootprint` | `systems/slab/slab-support.ts` + spatial-grid manager | Support election (rendered polygons, host-preferring, optional `maxElevation` cap) |
| `clampSlabElevationForWalls`, `applySlabTopChange`, `SLAB_UNSTICK_THRESHOLD` | slab-support + `nodes/slab/elevation-limit.ts` | Slab edit clamps and the adaptive drag/panel rules |

## Clamp rules (clamp, never ask)

- A slab under plane-bound walls clamps its elevation to `level height − MIN_WALL_HEIGHT` (0.5).
- Ceilings clamp (at write time, and reactively downward via space-detection) to `min(level top, covering-slab underside) − 0.01`.
- Plane-bound wall tops clamp to covering-slab undersides — a thick or flush upper-level slab shortens the walls below it (Revit's attach-to-floor-bottom, automatic). Explicit-height walls are exempt.
- Slab vertical editing is adaptive: the panel moves placement (thickness untouched); the viewport drag stretches a grounded slab (elevation and thickness together) up to `SLAB_UNSTICK_THRESHOLD` (0.4), then unsticks it into a 0.05-thick deck; floating decks move with thickness preserved and re-ground at underside 0; pools keep the drag-through-zero gesture.
- Wall-face adoption in `getRenderableSlabPolygon` applies only to grounded slabs (`elevation − thickness ≤ 0.01`, not recessed) — floating decks keep their drawn polygon and are skipped as seam candidates.

## Pointer-decided placement

Grid events intersect a plane that rides the ghost's elevation, so any stacked-surface decision must come from the true camera ray, not the plane hit: `getPointedSupportSurface` returns the nearest slab plane the ray crosses inside its rendered polygon plus the crossing point, and both the support-election cap (`maxElevation`) and the cursor XZ derive from that single computation. Pointing under a deck elects the floor; pointing at the deck top elects the deck; commits persist the capped winner (or `'ground'`). 2D floorplan placement has no camera ray and keeps max-election.

## Load migration (lives in `migrateNodes` Pass 3, indefinitely)

Because community autosave only persists after the first post-load edit, the migration must remain in `migrateNodes`:

- Writes each legacy level's **exact** derived height (a default legacy storey stores 2.55 = 0.05 slab + 2.5 wall) — never snapped to presets.
- Compacts `level` ordinals per building, anchored at zero (non-negatives → 0,1,2…; negatives → −1,−2… — basements stay basements). Runs every load; idempotent.
- Classifies wall tops against the derived plane: `|plane − top| < 0.20` **strict** → plane-bound (height key removed); else explicit (materializing 2.5 on absent-height short walls). ε calibrated by a prod census: intentional 0.20-short walls exist and must not snap.
- Ceilings within ε of the bound (and all `autoFromWalls` ceilings) drop their height → follows mode; stairs drop the legacy blind `totalRise: 2.5`. Both gated on the scene being legacy (some level lacked `height`).
- Slabs get `thickness := elevation` (byte-identical occupied interval, including degenerate zero); negative-elevation pools become `recessed: true` with elevation unchanged.

## Gotchas

- **Ordinals are semantic.** `level < 0` renders "Basement N"; `level === 0` is the ground-floor lookup. Never renumber without the zero anchor.
- **Boundary geometry.** Auto slabs derive polygons from wall centerlines, so wall/ceiling clamp samples sit exactly on polygon edges — always use the boundary-inclusive band-overlap helpers (`wallOverlapsSlabFootprint`, `slabCoversPoint`), never raw ray-cast point-in-polygon on those paths.
- **Straight stairs build from stored segment heights**, not the resolved rise — any rise change must go through `syncStairRises` (applied by `StairOpeningSystem`, history-paused, one microtask after store updates so the spatial grid has settled).
- **Reactivity is explicit.** A `level.height` change dirties that level's walls/stairs/ceilings/fences; a slab change dirties the level below's walls/ceilings and deck-attached stairs (`spatial-grid-sync.ts`). If a new consumer reads these bounds, wire its dirty rule there.
- **Host lifecycle.** Deleting a slab strips `supportSlabId`/`deckSlabId` from survivors in the same undo commit; a host merely reshaped away falls back silently and resumes if the slab returns.
- **Clone paths differ.** `clone-scene-graph.ts` remaps `supportSlabId`/`deckSlabId`; the editor clipboard (`scene-clipboard.ts`) intentionally does not (it re-elects); room placement remaps them (fixed in the private repo's `room-placement.ts`). When adding a new clone/instantiation path, remap both fields.

## Deferred by decision (see the private repo's plan archive)

Persistent Room identity, partial-storey navigation, slab reference-face enums, suspended ceilings, and a site datum for sloped terrain all have named gates in `plans/` — none block this model. Decks ship as catalog rooms/presets; the one-gesture mezzanine/balcony tools were removed (code preserved at editor `e30042db`).
