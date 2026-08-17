# Vertical Model

*How buildings stack: stored level heights, plane-bound wall/ceiling tops, slab placement + thickness, support hosts, and the clamp rules that keep it all coherent.*

Applies to: anything that reads or writes vertical geometry — levels, walls, slabs, ceilings, stairs, fences, floor-placed items.

The invariant, in one sentence:

> Ordinary plane-bound wall tops are pinned to the level plane. A wall drafted on
> terrain or another raised support preserves the ghost's body height by materializing
> that height and translating the wall from its elected base. Optional terrain infill
> extends only the bottom; it never changes the authored wall height or top.

**Sources**: `packages/core/src/services/storey.ts`, `packages/core/src/systems/wall/wall-top.ts`, `packages/core/src/systems/slab/slab-support.ts`, `packages/core/src/systems/stair/stair-rise.ts`, `packages/core/src/utils/vertical-scene-migration.ts`

## Stored truth

| Field | Meaning | Absent means |
|---|---|---|
| `level.height` | Storey height in meters, floor-to-floor. Level world Y is resolved by `getLevelElevations`, ordered by the `level` ordinal. | Unmigrated legacy data (never seen post-load; the migration writes it). Consumers fall back to `DEFAULT_LEVEL_HEIGHT` (2.5). |
| `level.baseElevation` | Additive offset from the computed stack position. It shifts this level and cumulatively shifts every higher level in the same building; negative offsets are valid. | Zero (the schema default). |
| `wall.height` | Explicit body height (half wall, parapet, or a raised-support draft whose ghost height must remain invariant). Ground-hosted walls always resolve top = elected base + height, including below datum; other legacy sunken supports retain their absolute-top constraint. | **Plane-bound** (the default for ordinary datum placement): the top follows `getWallPlaneTop` — `min(level height, lowest covering-slab underside over the span)`. |
| `ceiling.height` | Explicit custom height, write-clamped to the bound. | **Follows the level**: resolves live to `getCeilingClampBound` = `min(level height, covering underside) − 0.01`. |
| `slab.elevation` | The walking surface (top), level-local. | Default 0.05. |
| `slab.thickness` | Grows **downward**: the solid occupies `[elevation − thickness, elevation]`. | Default 0.05. |
| `slab.recessed` | Recess intent: open shell whose floor is `elevation` and whose rim is `recessedRimElevation`. Excluded from "covering" queries and wall-face adoption. | Solid slab. |
| `slab.recessedRimElevation` | Optional rim anchor for a raised/lowered recess. Relative presets preserve this anchor while changing depth. | Level plane (`0`), preserving legacy pools. |
| `slab.fillToTerrain` | Adds a terrain-following perimeter foundation below a solid slab's fixed underside. The walking surface and authored structural thickness stay flat. | No terrain foundation. |
| `supportSlabId` | Persisted support host on walls and all floor-placed kinds. Written at commit **only when overlapping supports disagree on elevation**; `'ground'` sentinel pins bare ground under a deck. Structural blockes always pin their placement-time host so a room slab generated above them cannot feed back and lift the platform. | Support is elected per query (coverage election for walls, footprint max for items). |
| `wall.supportOffset` | Optional level-local delta from the elected support. Terrain wall chains use it to keep every segment on the first point's construction plane while storing only one number, never terrain samples. | Zero offset: the wall sits directly on its elected slab or sculpted ground source. |
| `fence.supportOffset` | Optional level-local delta from the fence's slab host or level plane. It translates the complete fence while preserving height. | Zero offset: the fence sits directly on its host or level plane. |
| `wall.fillToTerrain` | Extends the wall downward from its authored base to the terrain with independently sampled left/right faces. The wall body height and top stay unchanged. | Fixed base with no terrain infill. |
| `stair.deckSlabId` | Destination deck: rise follows `deck.elevation − the stair's own elected base` live; cutout sync disabled while attached. | Destination is a level. |
| `stair.totalRise` | Explicit custom rise (wins over everything). | Follows: derived from the deck or the containing level; `syncStairRises` converges straight-stair segments to the resolved rise. |

Two schema rules protect these semantics:

- **No Zod defaults on meaning-bearing fields.** `level.height`, `wall.height`, `ceiling.height`, `stair.totalRise` are `.optional()` with no `.default()` — absence is data. Creation sites write values explicitly; `migrateNodes` output is cast, not parsed, so a schema default would never materialize on legacy load anyway.
- **The store deletes explicit-`undefined` keys.** `updateNode(id, { height: undefined })` removes the key (see `mergeNodeUpdate` in `node-actions.ts`). Legacy plane-bound walls may still omit `height`; the wall panel resolves and materializes their current body height before enabling terrain infill. Ceiling and stair follow modes continue to derive from field presence — no persisted mode enums.

## Resolution helpers (use these, never `?? 2.5`)

| Helper | Home | Resolves |
|---|---|---|
| `getStoredLevelHeight`, `getLevelElevations`, `getLevelAbove/Below` | `services/storey.ts` | Level heights, offset-aware per-building stacking, neighbors |
| `getWallPlaneTop` | `services/storey.ts` | A plane-bound wall's top: level height clamped to covering-slab undersides, span-sampled with boundary-inclusive band overlap |
| `resolveWallTop`, `resolveWallEffectiveHeight`, `MIN_WALL_HEIGHT` | `systems/wall/wall-top.ts` | A wall's top / effective height given plane + elected base |
| `getWallBaseElevationForNodes`, `getWallEffectiveHeightForNodes` | spatial-grid manager | The elected base and body height with terrain/support offsets, for UI overlays |
| `getCeilingClampBound`, `getCoveringSlabUndersideAt` | `services/storey.ts` | Ceiling bound; the cross-level covering query (level above, non-recessed slabs) |
| `resolveCeilingHeight` | `services/level-height.ts` | A ceiling's effective height (explicit or follows) |
| `resolveStairTotalRise`, `syncStairRises` | `systems/stair/stair-rise.ts` | Stair rise precedence + straight-flight convergence |
| `computeWallSlabSupport`, `getSlabSupportForItem`, `getSupportCandidatesForFootprint` | `systems/slab/slab-support.ts` + spatial-grid manager | Support election (rendered polygons, host-preferring, optional `maxElevation` cap) |
| `resolveSlabPlacementElevation` | `systems/slab/slab-placement.ts` | Translates a solid slab's authored top/thickness interval onto a captured base plane; recessed slabs stay level-relative |
| `getSlabBaseElevation`, `applySlabBaseElevationChange`, `applySlabThicknessChange` | `nodes/slab/elevation-limit.ts` | Separates whole-body underside placement from fixed-base thickness editing |
| `resolveFenceLiftElevation` | `nodes/fence/lift.ts` | Fence slab-host elevation plus its optional manual support offset |
| `clampSlabElevationForWalls` | slab-support + `nodes/slab/elevation-limit.ts` | Slab top clamp under plane-bound walls |

## Clamp rules (clamp, never ask)

- A slab under plane-bound walls clamps its elevation to `level height − MIN_WALL_HEIGHT` (0.5).
- Ceilings clamp (at write time, and reactively downward via space-detection) to `min(level top, covering-slab underside) − 0.01`.
- Plane-bound wall tops clamp to covering-slab undersides — a thick or flush upper-level slab shortens the walls below it (Revit's attach-to-floor-bottom, automatic). Explicit-height walls are exempt.
- Solid slab controls have non-overlapping contracts: the cube translates the occupied interval while preserving `thickness`; the chevron and panel thickness control hold the underside fixed and move the walking surface by writing `thickness` and `elevation` together. Panel elevation translates the body while preserving thickness. Recesses store their rim separately so floor/rim/depth controls and presets remain relative to the same anchor.
- Structural elevation trackers move the reference base, not the body dimensions. A slab tracker moves its underside and keeps `thickness`; a wall tracker writes `supportOffset` and materializes its current body `height`; a fence tracker writes `supportOffset` and keeps `height`. Recessed slabs retain their separate rim/depth control.
- Wall-face adoption in `getRenderableSlabPolygon` applies only to grounded slabs (`elevation − thickness ≤ 0.01`, not recessed) — floating decks keep their drawn polygon and are skipped as seam candidates.

## Pointer-decided placement

Grid events intersect a plane that rides the ghost's elevation, so any stacked-surface decision must come from the true camera ray, not the plane hit: `getPointedSupportSurface` returns the nearest eligible surface plus the crossing point, and both the support-election cap (`maxElevation`) and the cursor XZ derive from that single computation. Pointing under a deck elects the floor; pointing at the deck top elects the deck. Upward-facing block geometry is a shared placement surface for slabs, fences, columns, stairs, items, and registry-driven floor objects; wall drafting may additionally include upward-facing wall, stackable-item, and column geometry. Those node-top hits freeze a scalar construction plane for the throw; they are not a persistent hosting edge and do not follow later host edits. Slabs store the plane as `elevation`, walls and fences as `supportOffset`, and floor-placed position nodes as their canonical Y offset. Each also pins the slab or ground beneath the block, preventing a later generated slab from feeding back and lifting the placed object. Ordinary slab/ground hits persist their elected support source and retain the normal stepped-base behavior. 2D floorplan placement has no camera ray and keeps max-election.

Wall and slab drafting share the horizontal construction-plane resolver. A slab freezes the
first snapped vertex's plane, keeps later vertices on that flat plane, and translates its authored
vertical interval onto the captured base at commit. It never drapes thickness or individual
vertices over terrain. Optional terrain following is a separate perimeter foundation from the
fixed underside; it never changes the slab interval. Recessed slabs keep an explicit rim anchor. A locked
construction plane is tagged `fixed-plane` so a plane at world Y=0 cannot be mistaken for the
terrain query plane on later pointer moves.

Auto-room surfaces derive their vertical placement from the enclosing walls. Each boundary wall's
base is resolved through the same election the renderer uses — including the ground under it, so a
room stamped or drawn on bare terrain gets terrain input even though no wall carries an explicit
`supportSlabId`. The floor takes the **highest** wall base and keeps its established 0.05 m
walking-surface offset above it; the ceiling takes the **lowest** wall top and sits 0.01 m below it.
Both surfaces stay flat: a mixed-elevation enclosure no longer bails to a fallback placement, and
the highest base is chosen because the lower walls extend down into the ground anyway, so no
daylight opens under any wall. Existing `autoFromWalls` surfaces reconcile with later wall
support-offset changes **and with sculpts** — the level's structure signature hashes each wall's
resolved level base, so moving the ground under a finished room re-derives its floor and ceiling
(once per stroke, inside the stroke's own undo step). Manual surfaces are never rewritten. Auto
slabs are excluded from this wall-base election so a derived floor cannot recursively lift its own
walls and then itself.

## Inheriting terrain (the generic seam)

`levelBaseElevationAt(nodes, levelId, x, z)` is **the** answer to "what surface does a node rest on
when nothing built is under it" — the sculpted ground where terrain supports that storey, `0`
everywhere else. Terrain used to be opt-in per kind because each site spelled the question
`terrainSupportLift(…) ?? 0` and every consumer that forgot to ask silently assumed the plane
`y = 0`. Resolving a base through this function is all a kind needs to follow the ground; there is
nothing to register. Callers that must tell flat ground apart from a built surface flush with the
storey base still need `terrainSupportLift`'s null — both read `0` and only the first drapes.

Three ways a kind's Y reaches the ground, in the order to prefer them:

1. **`capabilities.floorPlaced`** — the resolver (`getFloorPlacedElevation`) elects per footprint
   between the overlapping slabs and the level base, and `FloorElevationSystem` writes the result to
   the registered mesh every frame. Correct for anything that stands on a surface.
2. **`ctx.levelBaseAt(x, z)` in a pure `def.geometry` builder** — for kinds that bake their own
   vertical origin into the meshes (a fence's inner lift group). Calling it also *enrols* the kind in
   terrain invalidation: `noteLevelBaseConsumer` records the type on first build, and
   `markTerrainSupportDependents` dirties those nodes on every terrain change so the baked origin
   rebuilds. Asking is the registration — deliberately, because a declarative flag would be another
   per-kind opt-in and "every kind with a builder" would rebuild the whole ground floor per brush dab.
   Absent for `def.floorplan` (the plan view draws no elevation), so shared builders must treat it as
   optional rather than assume flat ground in 2D.
3. **`levelBaseElevationAt` directly** — for resolvers outside the render path that already hold the
   nodes record (support election, snap guides, handle placement). Sample at the *same* XZ the
   renderer samples, or the overlay and the mesh will disagree.

A collective renderer (one component drawing many nodes, e.g. instanced meshes) gets none of this for
free: `FloorElevationSystem` writes to the node's registered object, which for those kinds is the
selection proxy, not the instance. Such renderers must resolve each instance's Y through
`getFloorStackedPosition` themselves.

## Load migration (lives in `migrateVerticalSceneNodes`, indefinitely)

Because community autosave only persists after the first post-load edit, the migration must remain on the load path. It is pure and server-safe so the editor loader and hosted scene authority canonicalize identical fields before collaboration compares or persists an operation:

- Writes each legacy level's **exact** derived height (a default legacy storey stores 2.55 = 0.05 slab + 2.5 wall) — never snapped to presets.
- Compacts `level` ordinals per building, anchored at zero (non-negatives → 0,1,2…; negatives → −1,−2… — basements stay basements). Runs every load; idempotent.
- Classifies wall tops against the derived plane: `|plane − top| < 0.20` **strict** → plane-bound (height key removed); else explicit (materializing 2.5 on absent-height short walls). ε calibrated by a prod census: intentional 0.20-short walls exist and must not snap.
- Ceilings within ε of the bound (and all `autoFromWalls` ceilings) drop their height → follows mode; stairs drop the legacy blind `totalRise: 2.5`. Both gated on the scene being legacy (some level lacked `height`).
- Slabs get `thickness := elevation` (byte-identical occupied interval, including degenerate zero); negative-elevation pools become `recessed: true` with elevation unchanged.

## Gotchas

- **Ordinals are semantic.** `level < 0` renders "Basement N"; `level === 0` is the ground-floor lookup. Never renumber without the zero anchor.
- **Boundary geometry.** Auto slabs derive polygons from wall centerlines, so wall/ceiling clamp samples sit exactly on polygon edges — always use the boundary-inclusive band-overlap helpers (`wallOverlapsSlabFootprint`, `slabCoversPoint`), never raw ray-cast point-in-polygon on those paths.
- **Straight stairs build from stored segment heights**, not the resolved rise — any rise change must go through `syncStairRises` (applied by `StairOpeningSystem`, history-paused, one microtask after store updates so the spatial grid has settled).
- **Reactivity is explicit.** A `level.height` change dirties that level's walls/stairs/ceilings/fences; a slab change dirties overlapping same-level supports, the level below's walls/ceilings, and deck-attached stairs. Every live terrain dab dirties ground-hosted structures, `fillToTerrain` walls/slabs, every `floorPlaced` node at grade, and every kind whose builder asked for `ctx.levelBaseAt`, through the transient `useLiveTerrain` subscription in `spatial-grid-sync.ts`; the scene graph and undo history are still written only once when the stroke commits. Ending or canceling a stroke runs the same sweep so dependents settle back onto the persisted field. Slab handles reuse the slab-change dependency helper for live previews. If a new consumer reads these bounds, wire its dirty rule there.
- **Auto-room re-derivation is per stroke, not per dab.** Live dabs publish only to `useLiveTerrain` and never touch the scene store, so the structure-signature diff that re-derives room floors and ceilings runs once on release. Mid-drag the ground-hosted walls follow the brush while the floor waits for release — deliberate: re-deriving per dab means a scene write per dab and a floor that jitters under the cursor.
- **Host lifecycle.** Deleting a slab strips `supportSlabId`/`deckSlabId` from survivors in the same undo commit; a host merely reshaped away falls back silently and resumes if the slab returns.
- **Clone paths differ.** `clone-scene-graph.ts` remaps `supportSlabId`/`deckSlabId`; the editor clipboard (`scene-clipboard.ts`) intentionally does not (it re-elects); room placement remaps them (fixed in the private repo's `room-placement.ts`). When adding a new clone/instantiation path, remap both fields.

## Deferred by decision (see the private repo's plan archive)

Persistent Room identity, partial-storey navigation, slab reference-face enums, suspended ceilings, and a site datum for sloped terrain all have named gates in `plans/` — none block this model. Decks ship as catalog rooms/presets; the one-gesture mezzanine/balcony tools were removed (code preserved at editor `e30042db`).
