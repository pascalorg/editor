# @pascal-app/ifc-converter

Pure conversion logic for IFC → Pascal scene graphs. Takes a `Uint8Array` of
IFC bytes, returns `{ nodes, rootNodeIds, stats }` shaped against
`@pascal-app/core` schemas.

No DOM, no React. The UI lives in `apps/ifc-converter`.

Native Pascal nodes are produced for sites, buildings, levels, walls, doors,
windows, slabs, stairs, roofs, columns, and IFC spaces (as room zones). Beams,
railings, coverings, furnishings, proxies, curtain walls, plates, members,
footings, and native wall/slab shapes that cannot be parameterized are retained
as selectable `imported-mesh` nodes using their IFC triangle geometry and color.
Imported meshes are import-only and do not appear as empty objects in the editor
palette.

Door families are derived from `IfcDoor.OperationType`. Glazing is applied from
the standardized `Pset_DoorCommon.GlazingAreaFraction` property rather than
from element names or project-specific conventions.

Browser callers use the default WebIFC WASM path (`/`). Node callers can pass
`{ wasmPath: '/absolute/path/to/web-ifc/' }` in `ConversionOptions`.
