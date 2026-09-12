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
