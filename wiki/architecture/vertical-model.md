# Vertical Model

*How buildings stack: stored level heights, plane-bound wall/ceiling tops, slab placement + thickness, support hosts, and the clamp rules that keep it all coherent.*

Applies to: anything that reads or writes vertical geometry — levels, walls, slabs, ceilings, roofs, stairs, fences, floor-placed items.

The invariant, in one sentence:

> Raising a room floor creates a solid platform without moving its wall tops or ceiling.
> Raising a ground footprint lifts its walls, ceilings, roofs and supported upper storeys.
> Plane-bound walls, including explicit heights equal to the stored storey height, follow the storey.
> Other explicit walls keep their body height above their elected base.
> Ground-hosted terrain walls retain their authored body-height rule. Platform fill and
> per-face wall bases extend only the bottom, independently of the hosted-child datum.

**Sources**: `packages/core/src/services/storey.ts`, `packages/core/src/systems/wall/wall-top.ts`, `packages/core/src/systems/slab/slab-support.ts`, `packages/core/src/systems/stair/stair-rise.ts`, `packages/core/src/utils/vertical-scene-migration.ts`

## Stored truth

| Field | Meaning | Absent means |
|---|---|---|
| `level.height` | Storey height in meters, floor-to-floor. Level world Y is resolved by `getLevelElevations`, ordered by the `level` ordinal. | Unmigrated legacy data (never seen post-load; the migration writes it). Consumers fall back to `DEFAULT_LEVEL_HEIGHT` (2.5). |
| `level.baseElevation` | Additive offset from the computed stack position. It shifts this level and cumulatively shifts every higher level in the same building; negative offsets are valid. | Zero (the schema default). |
| `wall.height` | Equal to the stored `level.height` within 1e-6 m: storey intent, unless ground-hosted. Otherwise an explicit body height above elected structural support, including below datum. | **Plane-bound**: follows the footprint-adjusted storey plane, clamped to covering-slab undersides. |
| `ceiling.height` | Explicit custom height, write-clamped to the bound. | **Follows the level**: resolves live to `getCeilingClampBound` = `min(level height, covering underside) − 0.01`. |
| `roof.support.kind` | `walls` follows the highest spatially matched wall top in the roof’s level frame; `level` keeps custom Y; `roof` retains its roof-surface attachment rule. Room and curved-wall creation, a rectangle drawn onto a roof level and the agents' `create_roof` write `walls`; other free-drawn rectangles write `level` at Y 0 (see [Roof levels](#roof-levels)). | Existing roofs remain custom (`level`); no load migration enables following. |
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
| `getWallTop` | `services/storey.ts` | A wall's resolved top given scene + elected base; compares explicit height to the raw stored storey height, not the clamped or lifted plane |
| `resolveWallTop`, `resolveWallEffectiveHeight`, `wallFollowsStorey`, `MIN_WALL_HEIGHT` | `systems/wall/wall-top.ts` | A wall's top / effective height given plane + elected base + raw authored storey height |
| `getWallBaseElevationForNodes`, `getWallEffectiveHeightForNodes` | spatial-grid manager | The elected base and body height with terrain/support offsets, for UI overlays |
| `getCeilingClampBound`, `getCoveringSlabUndersideAt` | `services/storey.ts` | Ceiling bound; the cross-level covering query (level above, non-recessed slabs) |
| `resolveCeilingHeight` | `services/level-height.ts` | A ceiling's effective height (explicit or follows) |
| `resolveStairTotalRise`, `syncStairRises` | `systems/stair/stair-rise.ts` | Stair rise precedence + straight-flight convergence |
| `stairReachesStoreyAbove`, `stairClimbsToNoStorey` | `systems/stair/stair-rise-query.ts` | Whether a stair is a way to the storey above, as `verify_scene` and the hosts' checks count one: a flight onto a deck or to no level (a `fromLevelId` and no `toLevelId`: porch steps) is not; one naming a level above is; one following its storey is when a storey stands above; one with its own `totalRise` and no level named is within a riser of the floor-to-floor height |
| `resolveRoofElevation`, `resolveRoofWallTopElevation` | `systems/roof/roof-elevation.ts` | Highest spatially matched wall top for `walls` support, including explicit heights and elected bases, converted to the roof's level frame |
| `computeWallSlabSupport`, `getSlabSupportForItem`, `getSupportCandidatesForFootprint` | `systems/slab/slab-support.ts` + spatial-grid manager | Support election (rendered polygons, host-preferring, optional `maxElevation` cap) |
| `resolveSlabPlacementElevation` | `systems/slab/slab-placement.ts` | Translates a solid slab's authored top/thickness interval onto a captured base plane; recessed slabs stay level-relative |
| `getSlabBaseElevation`, `applySlabBaseElevationChange`, `applySlabThicknessChange` | `nodes/slab/elevation-limit.ts` | Separates whole-body underside placement from fixed-base thickness editing |
| `resolveFenceLiftElevation` | `nodes/fence/lift.ts` | Fence slab-host elevation plus its optional manual support offset |
| `clampSlabElevationForWalls` | slab-support + `nodes/slab/elevation-limit.ts` | Slab top clamp under plane-bound walls |

## Clamp rules (clamp, never ask)

- A slab under plane-bound walls clamps its elevation to `level height − MIN_WALL_HEIGHT` (0.5).
- Ceilings clamp (at write time, and reactively downward via space-detection) to `min(level top, covering-slab underside) − 0.01`.
- Plane-bound wall tops, including explicit heights matching the stored storey height, clamp to covering-slab undersides. Upper base-plate height and thickness edits keep the underside fixed, leaving the walls below unchanged. Other explicit-height walls keep their authored body height.
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

Plate edits keep custom explicit wall heights while their bases move. Legacy load
reconciliation still preserves pre-plate wall tops when first deriving plates.
The final ceiling clamp runs after footprint derivation
so the first and second loads agree. Client and hosted authority use this same pass.

## Explicit storey-height walls and saved scenes

`create_room` stores a supplied `wallHeight` unchanged; omitting it leaves the wall
plane-bound. A supplied height equal to the raw stored `level.height` now means
the same storey intent. For a 3.6 m storey, a wall standing on a slab whose top and
thickness are 0.05 m resolves to top 3.60 m, not 3.65 m. An upper slab at local
elevation 0.05 m and thickness 0.05 m has underside 3.60 m in the lower level's
frame, so the wall body is 3.55 m and does not penetrate the slab.

Already-saved walls receive this correction on resolution, without rewriting
their height keys or changing slab thickness. Custom heights remain body-relative:
a 4.2 m wall on the same support still tops out at 4.25 m. Ground-hosted walls
(`supportSlabId: 'ground'`) retain body-height semantics even at storey height.
Without an authored level height, explicit walls retain body-height semantics;
existing legacy load migration still owns conversion of those scenes.

Equality is inferred intent, not a persisted follow mode: deliberately authoring a
body height exactly equal to the storey height cannot be distinguished from
storey intent. If the stored storey height later changes, the unchanged explicit
wall height becomes custom; omit `height` for unconditional following.

`verify_scene` reports `wall_covering_slab_contact` with both `wallId` and `slabId`,
the wall top, slab underside/top, penetration depth, and walking-surface
coplanarity. Heights are in the wall's level-local frame. A wall seated exactly at
the underside is not a contact issue. Covering queries respect holes, boundaries,
wall thickness and curves, and exclude recessed slabs. Deliberately tall walls
remain allowed; the observation flags their intersection for review rather than
silently shortening them.

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

## Roof levels

Retained roof geometry may be an `item` explicitly classified with `metadata.role: 'roof'`.
It can live on a declared roof level, remains roof content when copied, and participates in
the same level visibility and exploded transforms. This classification does not supply native
roof parameters, wall following or automatic roof seating. A name or asset category alone does
not classify it. Split geometry spanning roof and occupied-storey content before classifying;
preserve world placement when reparenting and retain the source mapping. Ordinary items, room
ceilings and occupied walls stay on storeys. `apply_patch` can set the role and parent together: merge the role into the existing metadata
to retain source lineage and other fields;
removing the role while leaving the item on a roof level is refused.

A roof lives on the level directly above the storey whose walls carry it; over a building's
top storey that is its roof level (`metadata.role: 'roof'`, named Roof), kept above every storey,
so exploded and solo level views lift the roof off the plan. One core service,
`services/roof-level.ts`, states it for every roof writer: `planRoofLevel` (the storey above, or
the roof level to reuse, declare or create), `roofsOver` (the roofs over a storey),
`storeyInsertIndex` (a new top storey goes under the roof level, which moves up one),
`liftRoofLevels` (after a write adds levels, the roof levels topping the stack go back over every
other level), `roofLevelOrderBreach` (a reorder putting a roof level under a storey it stood over),
`servesAsRoofLevel` (the one test of a level's role, which `list_levels`, `verify_scene`, the
agents' refusals and the editor's tools read) and `isRoofLevel` (declared). The agents'
`create_roof` and the editor's roof tool (a room's footprint, a rectangle or cone drawn over a
walled storey, a cone over a curved wall) place roofs by it; `add_level`, the editor's "add a
floor" and the stair tool's new upper floor insert under the roof level; the level selector, the
chat's `reorder_level`, the capture app's REST reorder and `apply_patch` refuse an order
`roofLevelOrderBreach` names; with a roof level on top, the selector's top "+" reads *Add a floor
under the roof*.

`planRoofLevel`, from the levels above the storey in its building:

| Above the storey | The roof goes |
|---|---|
| a storey with anything on it, anywhere above | on the storey directly above (a porch, a lower wing); `create_roof` refuses `storey_above` |
| a roof level above every other level | on that roof level (the lowest), declared if it held only roofs |
| one empty level, nothing else | on it, declared the roof level (a name a person gave stays) |
| empty levels still to be built, support levels | on a new Roof level above the highest of them |
| nothing | on a new Roof level directly above |

A declared level is the roof level whatever it holds (`verify_scene` reports walls on it as
`roof_level_occupied`). In a building that declares none, a level that holds only roofs (written
before levels declared their role) counts as one when only such levels stand above it: the run at
the top of the stack. A level holding only roofs under a storey, or beside a declared roof level,
is a storey still to be built with a lower wing's roof on it, so walls can be drawn on it, a write
that adds a level elsewhere leaves it where it is, and a roof seated on it never turns it into the
building's roof. A building's lowest level is always a storey, so a carport's roof on its posts
gets a new floor on top. A roof placed by hand on the level above selects that level with it, so
it stays in view. A rectangle or cone drawn on a walled storey goes to the level above when an edge
of it bears on the storey's walls or it covers a room they enclose, standing on the walls
(`support: 'walls'`) as a room's roof does; a porch or portico drawn over posts beside the house
does neither and stays on the storey, and one drawn onto a storey above (a lower wing) keeps that
level's plane.

Which storey a roof covers is derived, never stored (`coveredStoreyId`): on a roof level, the
highest storey below that holds something; on a storey, the storey below when the roof stands near
its floor (a porch's or a lower wing's roof, where the rule puts it), else the storey itself (a
roof written on its own walls' level). `roofsOver` reads it, so a porch roof on the upper storey
does not stop `create_roof` capping that storey; a lower wing's roof that follows walls follows the
walls below only, not the upper storey's along its edge; and `verify_scene` reports a roof mixed
into a storey (`roof_mixed_in_storey`) exactly for a roof standing on its walls (below), the ones
the repair moves, and a roof level below a storey, an empty one still to be built included
(`roof_level_not_on_top`). Existing scenes are not migrated. Unpainted gables on a roof level take the cladding of the storey's walls below
(`levelWallCladdingRef`).

A roof held by the storey whose walls carry it is a roof the rule moves (`isRoofOnStoreyWalls`,
in `services/roof-move.ts`). Bearing is read at a roof's edges (`segmentBearing`,
`services/roof-bearing.ts`, the Architect's test moved into core): the walls of the storey along a
segment's edges with open air past them, a cone's curved wall under its sector, and the eave they
need, their tops less the roof's rise over them. A roof bears on them when it follows walls or its
segment's base or eave stands within 0.15 m of that eave (knee walls on the plate, or its own
walls rising to it). A wall with a room past it is one the roof dies into, and a wall that runs on
past the roof's end into rooms belongs to the house a porch is buried in, so a porch or a portico
on its posts and beam (a full-width one flush with the house's sides too) and a lower wing's roof
on the storey above are not moved. `verify_scene`'s `roof_mixed_in_storey` names the move for it.
Such a roof offers "Move to the roof level" on its panel (in 2D and 3D; "Move to <storey>" under an
upper storey, as `roofLevelAbove` reads it), and agents have `move_roofs_to_roof_level`: both run
`planRoofsOffStorey`, which moves the storey's roofs on its walls to the level the rule gives them
in one undo step, each container dropped by `planRoofLevel`'s `storeyOffset` so it stands where it
stood; a roof following walls keeps following where its follow on the target still reads the
storey's walls, and turns custom over a support level or a level still to be built.

Every writer seats the roofs it writes, in the store call that writes them, so undo and remote
clients see the write as made and nothing corrects it afterwards. A UI writer passes its changes
through `seatRoofs` (paste, cut and paste and Duplicate, a fresh placement dropped by the move tool,
a roof moved or turned, a segment moved, resized or turned in 2D or drawn into the selected roof,
a roof's or a segment's inspector fields, and
`buildLevelDuplicateCreateOps` for `duplicate_level`, the level selector and the site panel): a
roof the write puts on its walls' storey goes where the repair would put it, its create entry
rewritten in place and the roof level created after its building. Agent writes that name nodes and
parents themselves (apply_patch's `roof-levels` guard on every bridge, `save_scene`'s graph) run
`seatWrittenRoofs`, which appends the seat as ops with a note each, so a refusal still points at
the model's own op. `save_scene` judges a graph against the scene it is saved over (the session's
when the save goes to it, else the stored one) and saves a graph with no scene under it as it is.
A roof the write only edits, written on its walls before the rule, stays where it is
(`verify_scene` keeps reporting it). Bearing reads each level's walls, rooms and wall tops once per
scene snapshot, however many segments a write or a verify pass tests.

What the rule cannot place is redirected in the UI and refused to agents. Storey content
(`isStoreyContent`: walls, rooms, slabs, ceilings, items, stairs, and every kind that stands on a
floor, `capabilities.floorPlaced`) aimed at a roof level goes to the storey it covers (`storeyOf`):
a paste carrying any lands there whole, the selection with it, and a tool placing it, armed while a
roof level is active (a roof just placed selects its level), switches to that storey. Agents are
refused, with the covered storey's id so one retry lands: storey content on a level serving as the
roof level (`roof_level`, `refuseRoofLevel`; `place_items` per item, `add_object` on a level), a
walled level declared the roof level
(`roof_level_holds_storey`) and floor indexes putting a roof level under a storey
(`roof_level_on_top`); a storey an agent creates at or above the roof level moves it up instead.

A roof above the storey it covers at a height of its own (`support` level, as moved roofs, the
agents' and the auto roof's are, measured from that storey's floor) keeps its height over that
floor when the storey's height changes: the roof elevation sync moves it (`roofsKeptOverStorey`)
without an undo step of its own, as it does a roof following walls.

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

- Writes each legacy level's **exact** derived height (a default legacy storey stores 2.55 = 0.05 slab + 2.5 wall) — never snapped to presets. A wall with no stored height counts as `DEFAULT_WALL_HEIGHT` up from its slab, as the editor drew it.
- An agent write that creates a level without a height, or clears one (MCP `apply_patch`), gets the height this migration would derive from what the level holds once the write lands (`fillLevelHeights`; an empty level: `DEFAULT_LEVEL_HEIGHT`), and the answer's `notes` say so. The session that wrote it and the editor that loads it then read the same storey.
- Compacts `level` ordinals per building, anchored at zero (non-negatives → 0,1,2…; negatives → −1,−2… — basements stay basements). Runs every load; idempotent.
- Classifies wall tops against the derived plane: `|plane − top| < 0.20` **strict** → plane-bound (height key removed); else explicit (materializing 2.5 on absent-height short walls). ε calibrated by a prod census: intentional 0.20-short walls exist and must not snap.
- Ceilings within ε of the bound (and all `autoFromWalls` ceilings) drop their height → follows mode; stairs drop the legacy blind `totalRise: 2.5`. Both gated on the scene being legacy (some level lacked `height`).
- Slabs get `thickness := elevation` (byte-identical occupied interval, including degenerate zero); negative-elevation pools become `recessed: true` with elevation unchanged.

## Gotchas

- **Only `support.kind: 'walls'` roofs follow walls.** The resolver projects the roof’s XZ centre onto its parent level’s lower neighbour, selected by `findLevelBelowId` from `getLevelElevations` in the same building stack (ordinals need not be consecutive). It uses the smallest enclosing room at that point and takes the highest resolved wall top without clamping to the storey. Conical roofs match curved walls by arc centre and radius against their transformed segment footprint, without a wall-ID binding. No matching enclosure or arc freezes Y and preserves follow intent, so redrawing walls resumes following. Negative level-local Y is valid: 2.5 m walls under a 3 m storey put the roof at −0.5 m. `RoofElevationSystem` re-derives Y only for following roofs on wall, slab, level, building, site, and roof edits, history-paused and one microtask after store updates so the spatial grid has settled. Settled updates publish a separate scene commit without adding an undo step; an outer gesture’s history pause retains commit ownership. Hosts that edit outside the editor apply the same rule synchronously through `reconcileDocument`, so their commit already carries the roof. The panel’s “Follows walls” choice enables this rule; “Custom” writes `level` and keeps Y. An explicit Y change exceeding 1e-4 m in the panel or 3D move handle switches to `level` in the same patch; XZ-only moves retain `walls` and re-resolve spatially. Undo/redo restores mode and Y together. Roof-surface attachments hide this mode control and retain their own rule. Schema version stays 3 and load never opts existing roofs into following.
- **The ground line.** A building's levels stand on a ground line: `building.groundLevelId` names the level at grade, the levels with a lower `level` index are below grade (`groundLevelOf`, `levelUnderNamedGround`; `levelGradeStanding` reads it, so the hole, the veil, the dive, `verify_scene` and the agent's pictures follow). Absent, it is the lowest level whose floor is not under the flat datum — what every scene read before the line — so existing scenes change nothing. "Set as ground floor" (the level panel, the agent's `set_ground_level`, `buildGroundLevelChanges`) names the level, seats the building so its floor datum, the top of the foundation where the wood framing starts, stands `GROUND_FLOOR_ABOVE_GRADE` = 0.203 m (8 in; IRC R317.1) over grade (height only; flat site: Y 0.203, terrain: 0.203 m over the mean ground height under its floor, `gradeUnderLevel`) and renumbers the indices so it is 0; one change set, one undo step. Levels stack up from the lowest one's own `baseElevation`, so a floor added under the line must not lift what is over it: `buildLevelBelowChanges` (the "+" below and `add_level` below) takes the lowest floor's place one storey down. Under the line a level is never at grade (on terrain that leaves it out of the ground it reads partly below); at or over it, terrain alone can bury part of a floor. `verify_scene` reports `basement_at_grade` (a negative index whose floor stands at grade) and `ground_level_unseated` (a named ground floor standing outside the seat). "Seated" is a band, grade to 0.203 m over it, within 5 cm (`GroundSeat.seated`): a scene seated before the 8 in rule, at grade, stays quiet, and the amber panel line and the finding speak only for a floor under the ground or well over the foundation top; `atFoundationTop` is the exact seat, the one "Set as ground floor" moves a floor to and the one that disables its menu entry. The panel line reads the datum over the ground (`Ground · +0.20`).

**The foundation wall.** A new wall against the ground on a level below grade (below grade everywhere, or under the named ground line, `levelHoldsFoundationWalls`; against the ground means on the outline of the level's walls, the outline `genericFoundation` draws under) is born as an 8 in CMU core (0.203 m, `material: 'cmu'`, `core`) with a 2x4 pressure-treated furring layer laid flat on the inside (0.038 m, `role: 'furring'`), `face: 'exterior'`, thickness the sum (0.241 m): IRC R317.1 for the treated furring on below-grade masonry, 16 in on centre not stored (no geometry). `planWallInsertion` (the editor's wall tools, rooms, zone edges) and `add_wall` ask `withFoundationConstruction` (`lib/foundation-wall.ts`) with the level's walls and the walls just drawn: a wall inside a closed circuit of other walls and not on it (`enclosedWallIds`) is a partition and keeps the ordinary wall, any other is on the outline, a wall no circuit surrounds yet counting as the outline in the making, so a basement drawn wall by wall is foundation all round and a partition drawn once the perimeter is closed is not. A wall drawn before the circuit that later encloses it stays foundation (existing walls are never rewritten, and the side classification the reconciler writes only exists once rooms do). A caller's `thickness` or `assembly` wins, existing walls are never rewritten, and a level the hillside only half buries with no ground line named holds ordinary walls. The new-building creation sites (`loadScene`, `add_level` on an empty scene, the hosted bridge) still start the building at Y 0; only "Set as ground floor" and `set_ground_level` seat the 8 in.

**The construction follows the region.** The 8 in CMU stack above is the generic and US answer; `foundationReadingOf` (`lib/foundation-construction.ts`, the table `FOUNDATION_CONSTRUCTIONS` beside `FOUNDATION_STANDARD`) picks the construction of a building: by region, read from the site with the precedence of Bones' jurisdiction guess and without importing Bones: `metadata.codeOverrides.state`, `address.state`, `parcel.state` (a US state: CMU), then the country the dossier address ends with, then a point (`dossier.point`, `parcel.originLngLat`) in a box over Europe: cast concrete (0.354 m: a 4 mm bitumen membrane and 10 cm of insulation outside a 25 cm concrete core, floor 0.15 m over grade). A site that says nothing, a Canadian province, and a point over North America keep the CMU. The browser is not read (core runs on the server too). `withFoundationConstruction` writes the chosen assembly on new walls against the ground, `groundSeat.aboveGrade` is the chosen seat (`seated` and `atFoundationTop` follow it, `GROUND_FLOOR_ABOVE_GRADE` stays the block value), and `genericFoundation` stems carry `material` (`cmu`, `concrete`) and the construction's stem width. The Europe numbers are sensible defaults (`source: 'default'`): 20 to 25 cm cellar walls and 10 cm perimeter insulation are usual, 150 mm is the damp-proof course height of British practice; none is one country's code. Existing walls are never rewritten.

- **Ordinals are semantic.** `level < 0` renders "Basement N"; `level === 0` is the ground-floor lookup. Never renumber without the zero anchor.
- **Boundary geometry.** Auto plates store full wall footprints; manual slabs and older snapshots can still put wall/ceiling clamp samples exactly on polygon edges — always use the boundary-inclusive band-overlap helpers (`wallOverlapsSlabFootprint`, `slabCoversPoint`), never raw ray-cast point-in-polygon on those paths.
- **Straight stairs build from stored segment heights**, not the resolved rise — any rise change must go through `syncStairRises` (applied by `StairOpeningSystem`, history-paused, one microtask after store updates so the spatial grid has settled; and synchronously by `reconcileDocument` for hosts that edit outside the editor). Without the built-in stair kind registered (a bare MCP server), the rise elects the stair's support with `stairBaseElevation`, which agrees with the registered kind's floor-placed election.
- **Reactivity is explicit.** A `level.height` change dirties that level's walls/stairs/ceilings/fences; a slab change dirties overlapping same-level supports, the level below's walls/ceilings, and deck-attached stairs. Every live terrain dab dirties ground-hosted structures, `fillToTerrain` walls/slabs, every `floorPlaced` node at grade, and every kind whose builder asked for `ctx.levelBaseAt`, through the transient `useLiveTerrain` subscription in `spatial-grid-sync.ts`; the scene graph and undo history are still written only once when the stroke commits. Ending or canceling a stroke runs the same sweep so dependents settle back onto the persisted field. Slab handles reuse the slab-change dependency helper for live previews. If a new consumer reads these bounds, wire its dirty rule there.
- **Auto floors derive once per terrain stroke.** Floors without authored elevation follow persisted boundary-wall bases; explicit zone intent remains fixed.
- **Host lifecycle.** Retiring a plate remaps `supportSlabId`/`deckSlabId` to its surviving plate in the same commit. Deleting a slab without a successor strips those references; a host merely reshaped away falls back silently and resumes if the slab returns.
- **Clone paths differ.** `clone-scene-graph.ts` remaps `supportSlabId`/`deckSlabId`; the editor clipboard (`scene-clipboard.ts`) intentionally does not (it re-elects); room placement remaps them (fixed in the private repo's `room-placement.ts`). When adding a new clone/instantiation path, remap both fields.

## Deferred by decision

Persistent Room identity, partial-storey navigation, slab reference-face enums, suspended ceilings, and a site datum for sloped terrain are deferred; none block this model. Decks ship as catalog rooms/presets; the one-gesture mezzanine/balcony tools were removed (code preserved at editor `e30042db`).
