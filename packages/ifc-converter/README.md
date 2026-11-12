# @pascal-app/ifc-converter

Pure conversion logic for IFC → Pascal scene graphs. Takes a `Uint8Array` of
IFC bytes, returns `{ nodes, rootNodeIds, stats }` shaped against
`@pascal-app/core` schemas.

No DOM, no React. The UI lives in `apps/ifc-converter`.

`IFCBEAM` and `IFCBEAMSTANDARDCASE` are imported as editable `block` nodes.
Their triangulated IFC geometry preserves cross-sections, rotations, and slopes;
positions are relative to the containing storey. IFC IDs, names, properties,
and material metadata are retained. Beams without renderable geometry are
reported in the conversion log. Imported beams use the block editor rather than
dedicated parametric beam controls.

Native Pascal nodes are produced when the converter can recover the required
parameters for sites, buildings, levels, walls, doors, windows, slabs, columns,
and IFC spaces (as room zones). IFC stair flights are retained as exact imported
meshes; roofs retain Pascal hierarchy and source metadata but are not yet a
complete parametric conversion. Railings, coverings other than ceilings and
flooring, furnishings, proxies, curtain walls, plates, members, footings,
vegetation (`IfcGeographicElement`), and elements whose native parameters
cannot be recovered are retained as selectable `imported-mesh` nodes using
their IFC triangle geometry and color.
Imported meshes are import-only and do not appear as empty objects in the editor
palette.

Door families are derived from `IfcDoor.OperationType`. Glazing is applied from
the standardized `Pset_DoorCommon.GlazingAreaFraction` property rather than
from element names or project-specific conventions.

## Room-first structure

The importer writes intent for Pascal's room-first model; the scene load
migrations (room adoption, floor plates) and the structure kernel turn it into
rooms, floor plates and ceilings. `tests/room-first-load.test.ts` converts the
reference files and runs that load chain.

- **Walls.** Merged collinear fragments, then every straight wall end moves
  along its axis onto the centreline it meets (L and T joins; ends inside
  another wall's body reach its centreline, `IfcRelConnectsPathElements` widens
  the reach). Walls crossing mid-span split; thin cladding (tiles, skirting)
  and walls lining or hidden in another wall stay imported meshes. Openings
  keep their plan position. An `IfcMaterialLayerSetUsage` whose reference line
  is a wall face becomes `justification` (`a`/`b`) with start/end on that face,
  and each junction is rebuilt where the reference lines meet (junctions they
  cannot close stay centred); other offsets are moved to the body centreline.
- **Rooms.** `IfcSpace` becomes a room zone (`LongName` → name, `Name` →
  room number) with a `seed` at its pole of inaccessibility; it is adopted by
  the wall loop it fills. Spaces sharing one wall loop (open plan, or joined
  through a gap in the walls) get separators along their shared borders or
  across the gap; a space mostly bounded by walls but open on one side (a
  curtain-wall facade) is closed along its open edges. Wall loops no space
  claims become rooms too (`metadata.ifcDerived: 'wall-loop'`).
- **Floors.** Slab tops are the true walking surface (the extrusion's upper
  end, or the mesh when the body is more than one extrusion) and thickness is
  the IFC thickness. Structural floors (`FLOOR`/`BASESLAB`/unset) whose top
  matches the level's main floor within 2 cm and that floor at least one room
  whole (openings aside) become floor-plate templates: the
  kernel re-derives the plate from the rooms and keeps the IFC top and
  thickness (`referenceFloorElevation`, `foundation`). A part reaching more than
  1 m² / 5 % past the rooms and walls stays a hand-drawn slab (`metadata.ifcSplit:
  'outside-rooms'`). Other slabs stay hand-drawn with their holes, and rooms
  standing on them point at them with `floor.sourceSlabId`; rooms with no slab
  under them have `hasFloor: false`. Holes in room floors, and the unfloored
  part of a room a plate only partly carries, become `floor-opening` nodes.
  Levels are marked `floorOwnershipMigrated` so the load migration's legacy
  floor guesses leave these decisions alone.
- **Finishes.** Slabs up to 6 cm thick lying on a structural floor inside rooms
  (Revit "Finish Floor" types) and `IfcCovering` `FLOORING` become the room's
  `floor.finish` when one covers most of the room, and `floor.regions` for the
  rest (a library material chosen from the material/type name — wood, tile,
  marble, stone, concrete — else the surface colour), plus the `floorFinish`
  label. A finish slab is removed only when all of it is represented. The
  plate's top is the finish top and its thickness includes the finish.
- **Ceilings.** `IfcCovering` `CEILING` becomes the automatic ceiling of the
  room it covers, at the covering's underside, keeping the covering's own
  holes (profile voids and `IfcRelVoidsElement` openings). Sloped coverings stay
  imported meshes. When a file models ceilings, a
  room without one gets `hasCeiling: false`; files without ceiling coverings
  keep Pascal's default ceilings except for rooms without a floor.
- **Doors and windows** carry `wallId` and `floorThresholdVersion: 1`.
- **Site.** The site polygon is the `IfcSite` footprint when it holds the
  model, else the imported extent plus 5 m.
- **Pascal round trip.** Elements carrying a `Pascal` property set (written by
  `@pascal-app/ifc-converter/export`) keep their node id (imported meshes
  included) and skip wall cleanup
  (merging, joins, duplicate-opening removal); storeys read the `GrossHeight`
  quantity for the top storey's height.

Browser callers use the default WebIFC WASM path (`/`). Node callers can pass
`{ wasmPath: '/absolute/path/to/web-ifc/' }` in `ConversionOptions`.
