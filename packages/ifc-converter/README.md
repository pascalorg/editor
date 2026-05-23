# @pascal-app/ifc-converter

Pure conversion logic for IFC → Pascal scene graphs. Takes a `Uint8Array` of
IFC bytes, returns `{ nodes, rootNodeIds, stats }` shaped against
`@pascal-app/core` schemas.

No DOM, no React. The UI lives in `apps/ifc-converter`.
