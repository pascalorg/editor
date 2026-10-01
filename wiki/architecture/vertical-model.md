# Vertical Model

*How buildings stack: stored level heights, plane-bound wall/ceiling tops, slab placement + thickness, support hosts, and the clamp rules that keep it all coherent.*

Applies to: anything that reads or writes vertical geometry — levels, walls, slabs, ceilings, roofs, stairs, fences, floor-placed items.

The invariant, in one sentence:

> Raising a room floor creates a solid platform without moving its wall tops or ceiling.
> Raising a ground footprint lifts its walls, ceilings, roofs and supported upper storeys.
> Plane-bound walls keep following the storey; explicit walls keep their body height above their elected base.
> Ground-hosted terrain walls retain their authored body-height rule. Platform fill and
> per-face wall bases extend only the bottom, independently of the hosted-child datum.

**Sources**: `packages/core/src/services/storey.ts`, `packages/core/src/systems/wall/wall-top.ts`, `packages/core/src/systems/slab/slab-support.ts`, `packages/core/src/systems/stair/stair-rise.ts`, `packages/core/src/utils/vertical-scene-migration.ts`

## Stored truth

| Field | Meaning | Absent means |
|---|---|---|
| `level.height` | Storey height in meters, floor-to-floor. Level world Y is resolved by `getLevelElevations`, ordered by the `level` ordinal. | Unmigrated legacy data (never seen post-load; the migration writes it). Consumers fall back to `DEFAULT_LEVEL_HEIGHT` (2.5). |
| `level.baseElevation` | Additive offset from the computed stack position. It shifts this level and cumulatively shifts every higher level in the same building; negative offsets are valid. | Zero (the schema default). |
| `wall.height` | Explicit body height above the elected structural support, including below datum. | **Plane-bound**: follows the footprint-adjusted storey plane, clamped to covering-slab undersides. |
| `ceiling.height` | Explicit custom height, write-clamped to the bound. | **Follows the level**: resolves live to `getCeilingClampBound` = `min(level height, covering underside) − 0.01`. |
| `roof.support.kind` | `walls` follows the highest spatially matched wall top in the roof’s level frame; `level` keeps custom Y; `roof` retains its roof-surface attachment rule. Room and curved-wall creation write `walls`; free-drawn rectangles write `level` at Y 0. | Existing roofs remain custom (`level`); no load migration enables following. |
| `slab.floorHeight` | Ground-contact base plate authored floor top, in level-local metres. Upper plates author the top through thickness with a fixed underside. | Automatic floor datum from its supports. |
| `slab.foundation` | Base plate support to terrain at site contact: solid or none, with a separate material and paint target. | No foundation. |
| `slab.elevation` | Manual slab walking surface intent, level-local; derived geometry on floor plates. | Default 0.05. |
| `slab.thickness` | Authored structural thickness, growing **downward** over `[elevation − thickness, elevation]`. Platform thickness is derived as the distance from base top to room floor. | Default 0.05. |
| `slab.recessed` | Recess intent: open shell whose floor is `elevation` and whose rim is `recessedRimElevation`. Excluded from "covering" queries and wall-face adoption. | Solid slab. |
| `slab.recessedRimElevation` | Optional rim anchor for a raised/lowered recess. Relative presets preserve this anchor while changing depth. | Level plane (`0`), preserving legacy pools. |
| `slab.fillToTerrain` | Manual slabs only: adds a terrain-following perimeter fill below the fixed underside. Base plates use `foundation` instead. The walking surface and authored structural thickness stay flat. | No terrain foundation. |
| `supportSlabId` | Persisted support host on walls and all floor-placed kinds. Written at commit **only when overlapping supports disagree on elevation**; `'ground'` sentinel pins bare ground under a deck. Structural blockes always pin their placement-time host so a room slab generated above them cannot feed back and lift the platform. | Support is elected per query (coverage election for walls, footprint max for items). |
| `wall.supportOffset` | Optional level-local delta from the elected support. Terrain wall chains use it to keep every segment on the first point's construction plane while storing only one number, never terrain samples. | Zero offset: the wall sits directly on its elected slab or sculpted ground source. |
| `fence.supportOffset` | Optional level-local delta from the fence's slab host or level plane. It translates the complete fence while preserving height. | Zero offset: the fence sits directly on its host or level plane. |
| `wall.fillToTerrain` | Extends the wall downward from its authored base to the terrain with independently sampled left/right faces. The wall body height and top stay unchanged. | Fixed base with no terrain infill. |
| `stair.deckSlabId` | Destination deck: rise follows `deck.elevation − the stair's own elected base` live; cutout sync disabled while attached. | Destination is a level. |
| `stair.totalRise` | Explicit custom rise (wins over everything). | Follows: the deck's `elevation`, else the destination room walking surface or base plate top, each **minus the stair's own elected base**; `syncStairRises` converges straight-stair segments to the resolved rise. |

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
| `resolveRoofElevation`, `resolveRoofWallTopElevation` | `systems/roof/roof-elevation.ts` | Highest spatially matched wall top for `walls` support, including explicit heights and elected bases, converted to the roof's level frame |
| `computeWallSlabSupport`, `getSlabSupportForItem`, `getSupportCandidatesForFootprint` | `systems/slab/slab-support.ts` + spatial-grid manager | Support election (rendered polygons, host-preferring, optional `maxElevation` cap) |
| `resolveSlabPlacementElevation` | `systems/slab/slab-placement.ts` | Translates a solid slab's authored top/thickness interval onto a captured base plane; recessed slabs stay level-relative |
| `getSlabBaseElevation`, `applySlabBaseElevationChange`, `applySlabThicknessChange` | `nodes/slab/elevation-limit.ts` | Separates whole-body underside placement from fixed-base thickness editing |
| `resolveFenceLiftElevation` | `nodes/fence/lift.ts` | Fence slab-host elevation plus its optional manual support offset |
| `clampSlabElevationForWalls` | slab-support + `nodes/slab/elevation-limit.ts` | Slab top clamp under plane-bound walls |

## Clamp rules (clamp, never ask)

- A slab under plane-bound walls clamps its elevation to `level height − MIN_WALL_HEIGHT` (0.5).
- Ceilings clamp (at write time, and reactively downward via space-detection) to `min(level top, covering-slab underside) − 0.01`.
- Plane-bound wall tops clamp to covering-slab undersides. Upper base-plate height and thickness edits keep the underside fixed, leaving the walls below unchanged. Explicit-height walls keep their authored height.
- Solid slab controls have non-overlapping contracts: the cube translates the occupied interval while preserving `thickness`; the chevron and panel thickness control hold the underside fixed and move the walking surface by writing `thickness` and `elevation` together. Panel elevation translates the body while preserving thickness. Recesses store their rim separately so floor/rim/depth controls and presets remain relative to the same anchor.
- Structural elevation trackers move the reference base, not the body dimensions. A slab tracker moves its underside and keeps `thickness`; a wall tracker writes `supportOffset` and materializes its current body `height`; a fence tracker writes `supportOffset` and keeps `height`. Recessed slabs retain their separate rim/depth control.
- Auto plates (`boundary: 'auto'`) render their stored full footprint unchanged. Wall-face adoption in `getRenderableSlabPolygon` applies only to grounded manual slabs (`elevation − thickness ≤ 0.01`, not recessed) — floating decks keep their drawn polygon and are skipped as seam candidates.

## Footprint construction height

`setFloorFoundation` expands one floor-height edit into one history transaction.
Explicit room floors (including mezzanines), custom ceilings and custom roofs on
that footprint translate by the same delta. Wall-following roofs and automatic
ceilings resolve their new height from the footprint plane. Following walls never
receive an explicit height.

Every base plate is classified by actual support: lower meaningful room plates
in the same building must cover at least 1.5 m² and half of its usable footprint
after union and holes to make it supported. Only a ground-bearing plate at the
site datum may have a solid foundation. Unsupported upper plates still hold
their underside when thickness changes, as supported plates do. Upper height
edits write thickness and resolved elevation together and never store
`floorHeight`. Ground-contact thickness grows downward. The upper height
control starts at the fixed underside plus minimum thickness (0.02 m); over
0.40 m thickness shows an advisory and remains editable.

`getLevelElevations` sums footprint lifts along the nearest covering plate at
each lower storey, walking past empty or non-overlapping levels; it is memoised
per scene graph. Ground lift is `floorHeight − automaticFloorHeight`; upper
lift is the resolved base top minus that automatic datum. Alternative supports at one level must
have equal displacement or the grouped `slabIds` choice is required.
The command never writes `level.baseElevation`; adding or removing construction
above cannot leave a stored offset behind. Ground wall planes use the authored
storey height plus their own footprint lift, independent of other footprints.

An upper level, roof or ceiling spanning footprints with unequal requested shifts
returns `floor-foundation-shared-storey`; commands and MCP refuse the whole edit.
Supporting footprints must carry rooms and have at least 1.5 m² of plate area.
Smaller or roomless remnants under the same storey travel with it. An upper roof
alone does not establish ground support. `setFloorFoundation` accepts `slabIds`:
the requested height targets the first plate and every selected plate moves by
that delta. Upper siblings change their own thickness to keep each underside
fixed; ground siblings change their `floorHeight`. Slots apply only to the
first plate. Clearing ground `floorHeight` returns to the automatic datum.

Manual slabs wholly inside the footprint, ground-hosted wall/fence centerlines
inside it, and ground-hosted positioned nodes anchored inside it inherit a derived
`floorConstructionLift`. Their stored ground-relative elevations stay unchanged,
so the translated decks cannot feed back into automatic foundation placement.
Room-floor feasibility skips uniform upward translations that cannot reduce
clearance; ground thickness and footprint changes recheck doors and explicit
wall tops in the storey below. Room edits
check the edited room and rooms sharing its walls/openings, with cached geometry
and feasibility results. Existing conflicts may improve without being refused.

Plate edits keep explicit wall heights while their bases move. Legacy load
reconciliation still preserves pre-plate wall tops when first deriving plates.
The final ceiling clamp runs after footprint derivation
so the first and second loads agree. Client and hosted authority use this same pass.

## Pointer-decided placement

Grid events intersect a plane that rides the ghost's elevation, so any stacked-surface decision must come from the true camera ray, not the plane hit: `getPointedSupportSurface` returns the nearest eligible surface plus the crossing point, and both the support-election cap (`maxElevation`) and the cursor XZ derive from that single computation. Pointing under a deck elects the floor; pointing at the deck top elects the deck. Upward-facing block geometry is a shared placement surface for slabs, fences, columns, stairs, items, and registry-driven floor objects; wall drafting may additionally include upward-facing wall, stackable-item, and column geometry. Those node-top hits freeze a scalar construction plane for the throw; they are not a persistent hosting edge and do not follow later host edits. Slabs store the plane as `elevation`, walls and fences as `supportOffset`, and floor-placed position nodes as their canonical Y offset. Each also pins the slab or ground beneath the block, preventing a later generated slab from feeding back and lifting the placed object. Ordinary slab/ground hits persist their elected support source and retain the normal stepped-base behavior. 2D floorplan placement has no camera ray and keeps max-election.

Wall and slab drafting share the horizontal construction-plane resolver. A slab freezes the
first snapped vertex's plane, keeps later vertices on that flat plane, and translates its authored
vertical interval onto the captured base at commit. It never drapes thickness or individual
vertices over terrain. Optional terrain following is a separate perimeter foundation from the
fixed underside; it never changes the slab interval. Recessed slabs keep an explicit rim anchor. A locked
construction plane is tagged `fixed-plane` so a plane at world Y=0 cannot be mistaken for the
terrain query plane on later pointer moves.

Auto-room surfaces derive their vertical placement from the enclosing walls when no
`zone.floor.elevation` is authored. `autoRoomVerticalPlacements` takes each boundary wall's
ground (terrain) plus `supportOffset` and places the flat plate 0.05 m above the highest one.
Slabs do not count: auto slabs would feed back, and a manual slab under a few walls is a
terrace or platform (a room standing on one gets no generated floor). A migrated base plate
may carry `legacyFloor`, the floor height most of its rooms had before room-first floors;
it replaces the derived datum so migrated walls and rooms keep their height. Terrain strokes
invalidate the wall-base signature and update derived plates once per committed stroke. Live
terrain dabs do not write floor geometry.

Explicit zone elevation wins over derived placement. Grounded rooms in one
connected footprint share a base plate at its automatic datum or authored
`floorHeight`. Raising a room adds a solid platform in its clear polygon above
the base; lowering a room cuts that clear polygon out of the base and adds a
sunken plate. Room-facing walls meet their room floor, while structural support
and exterior faces stay on the base. Mezzanines remain separate open supports.
Manual coverage of at least 60% suppresses a room's generated floor, wall ring included.

Floor-level openings stand on the higher adjacent room floor. Its plate extends
through the aperture; the exposed step is a room-owned plate riser, without a
wall notch or duplicate wall fill. Other openings retain wall-relative positions.
`door.verticalAnchor` and `window.verticalAnchor` may explicitly choose `wall` or
`floor`; absence infers floor anchoring from a bottom at or below 1 cm. Migration
pins a formerly elevated opening to `wall` only when the support correction would
otherwise change that classification, preserving its world position.

Base foundations are separate terrain-following meshes below the plate band,
with their own paint target and continuous perimeter UV distance. Platforms are
closed solids from base top to room floor; exposed terrace sides remain edges.
Room-facing skirting follows the room floor and exterior skirting follows the
base. Structural steps and open edges paint `zone.floorStepFinish` and
`zone.floorEdgeFinish`; the default step finish is the upper room's floor finish.

## Stacked mezzanine rooms

A mezzanine is a room zone with `floor.support: 'open'`, an explicit
`floor.elevation`, and an authored polygon. `hostZoneId` is optional grouping
metadata; geometry decides which room ceilings overlap it. These zones do not
enter planar room matching or create separators. The host keeps its complete
floor, room identity and floor quantities.

`createMezzanine(nodes, { hostZoneId, polygon, elevation?, thickness?, mintId })`
validates a simple polygon of at least 1 m² inside the host's reference polygon, allowing
wall-centre outlines; derivation clips them to the clear wall faces. Stacked zones
on one level cannot overlap. Elevation defaults to half the stored storey height,
snapped to 0.05 m; `floor.thickness` defaults to 0.2 m. `setZoneIntent` edits the
floor finish, elevation and thickness; it cannot change support or clear a
mezzanine’s explicit elevation. Elevation must exceed thickness and be at most
storey height minus 0.3 m; invalid edits return structured conflicts. `deleteZone` removes it, each through one scene transaction.
The MCP adapter is `create_mezzanine`.

Each mezzanine has a separate auto slab with derived `support: 'open'`, even at
the same elevation as another plate. Wall footprints clip its outline at the
wall faces. It renders only its authored thickness, with an `underside` and
`edge` sides, without platform or terrain fill. The kernel stores open perimeter
and hole-edge intervals in `slab.railing: Array<{ start, end }>`; the slab geometry builder uses
the existing fence geometry to render 1.1 m railings as edge-slot geometry.
Stairs targeting the plate cut a gap across their top landing width.
There are no additional fence nodes. The derived guard protects both fields and
the mezzanine slab's elevation, thickness, recess and fill; callers edit zone
intent instead.

Mezzanine plates never elect as wall support or contribute wall face bases.
Creation pins existing unhosted floor intent inside the outline to the host
plate in the same commit, preserving its per-frame support election. New items
use the existing pointed-surface election, including placement underneath;
stairs can use the plate's `deckSlabId`. Every overlapping ground-room ceiling
gets a `source: 'room'` hole. A mezzanine ceiling exists only when both its floor and ceiling are enabled and
there is at least 2.0 m between its floor and the resolved footprint plane. Deletion removes
the plate, its railing geometry and the host ceiling hole in the originating
commit. Host move/rotate/duplicate operations carry contained stacked zones,
including polygon, seed and copied hosting references. Host deletion removes
contained stacked zones and handles their contents with the same keep/delete
choice. Mezzanine-only deletion scopes contents to its plate and ceiling hosts.
No new migration is needed; the existing room/ceiling adoption routines
exclude stacked zones from room matching and preserve valid auto-ceiling links.

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

- **Only `support.kind: 'walls'` roofs follow walls.** The resolver projects the roof’s XZ centre onto its parent level’s lower neighbour, selected by `findLevelBelowId` from `getLevelElevations` in the same building stack (ordinals need not be consecutive). It uses the smallest enclosing room at that point and takes the highest resolved wall top without clamping to the storey. Conical roofs match curved walls by arc centre and radius against their transformed segment footprint, without a wall-ID binding. No matching enclosure or arc freezes Y and preserves follow intent, so redrawing walls resumes following. Negative level-local Y is valid: 2.5 m walls under a 3 m storey put the roof at −0.5 m. `RoofElevationSystem` re-derives Y only for following roofs on wall, slab, level, building, site, and roof edits, history-paused and one microtask after store updates so the spatial grid has settled. Settled updates publish a separate scene commit without adding an undo step; an outer gesture’s history pause retains commit ownership. The panel’s “Follows walls” choice enables this rule; “Custom” writes `level` and keeps Y. An explicit Y change exceeding 1e-4 m in the panel or 3D move handle switches to `level` in the same patch; XZ-only moves retain `walls` and re-resolve spatially. Undo/redo restores mode and Y together. Roof-surface attachments hide this mode control and retain their own rule. Schema version stays 3 and load never opts existing roofs into following.
- **Ordinals are semantic.** `level < 0` renders "Basement N"; `level === 0` is the ground-floor lookup. Never renumber without the zero anchor.
- **Boundary geometry.** Auto plates store full wall footprints; manual slabs and older snapshots can still put wall/ceiling clamp samples exactly on polygon edges — always use the boundary-inclusive band-overlap helpers (`wallOverlapsSlabFootprint`, `slabCoversPoint`), never raw ray-cast point-in-polygon on those paths.
- **Straight stairs build from stored segment heights**, not the resolved rise — any rise change must go through `syncStairRises` (applied by `StairOpeningSystem`, history-paused, one microtask after store updates so the spatial grid has settled).
- **Reactivity is explicit.** A `level.height` change dirties that level's walls/stairs/ceilings/fences; a slab change dirties overlapping same-level supports, the level below's walls/ceilings, and deck-attached stairs. Every live terrain dab dirties ground-hosted structures, `fillToTerrain` walls/slabs, every `floorPlaced` node at grade, and every kind whose builder asked for `ctx.levelBaseAt`, through the transient `useLiveTerrain` subscription in `spatial-grid-sync.ts`; the scene graph and undo history are still written only once when the stroke commits. Ending or canceling a stroke runs the same sweep so dependents settle back onto the persisted field. Slab handles reuse the slab-change dependency helper for live previews. If a new consumer reads these bounds, wire its dirty rule there.
- **Auto floors derive once per terrain stroke.** Floors without authored elevation follow persisted boundary-wall bases; explicit zone intent remains fixed.
- **Host lifecycle.** Retiring a plate remaps `supportSlabId`/`deckSlabId` to its surviving plate in the same commit. Deleting a slab without a successor strips those references; a host merely reshaped away falls back silently and resumes if the slab returns.
- **Clone paths differ.** `clone-scene-graph.ts` remaps `supportSlabId`/`deckSlabId`; the editor clipboard (`scene-clipboard.ts`) intentionally does not (it re-elects); room placement remaps them (fixed in the private repo's `room-placement.ts`). When adding a new clone/instantiation path, remap both fields.

## Deferred by decision

Persistent Room identity, partial-storey navigation, slab reference-face enums, suspended ceilings, and a site datum for sloped terrain all have named gates in `plans/` — none block this model. Decks ship as catalog rooms/presets; the one-gesture mezzanine/balcony tools were removed (code preserved at editor `e30042db`).
