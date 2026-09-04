# @pascal-app/ifc-converter

Pure conversion logic for IFC → Pascal scene graphs. Takes a `Uint8Array` of
IFC bytes, returns `{ nodes, rootNodeIds, stats }` shaped against
`@pascal-app/core` schemas.

No DOM, no React. The UI lives in `apps/ifc-converter`.

Native Pascal nodes are produced when the converter can recover the required
parameters for sites, buildings, levels, walls, doors, windows, slabs, columns,
and IFC spaces (as room zones). IFC stair flights are retained as exact imported
meshes; roofs retain Pascal hierarchy and source metadata but are not yet a
complete parametric conversion. Beams,
railings, coverings, furnishings, proxies, curtain walls, plates, members,
footings, and elements whose native parameters cannot be recovered are retained
as selectable `imported-mesh` nodes using their IFC triangle geometry and color.
Imported meshes are import-only and do not appear as empty objects in the editor
palette.

Door families are derived from `IfcDoor.OperationType`. Glazing is applied from
the standardized `Pset_DoorCommon.GlazingAreaFraction` property rather than
from element names or project-specific conventions.

Browser callers use the default WebIFC WASM path (`/`). Node callers can pass
`{ wasmPath: '/absolute/path/to/web-ifc/' }` in `ConversionOptions`.
