# Furniture-fit evidence boundaries

## Current tool semantics

The public MCP repository source reviewed on 2026-09-08 provides these relevant operations. Published and hosted releases may lag this source; inspect each connected server's tool schemas and use only the advertised inputs and outputs.

- `get_level_summary` returns wall, zone, item, slab, and ceiling summaries for a level. Zone bounds and areas are in meters.
- `get_scene` returns the full scene graph, including each item's `asset.dimensions`, node `scale`, position, and rotation.
- `measure` returns center-to-center distance between supported nodes. Calling it with the same polygon node ID returns area, not wall-to-wall clearance.
- In the reviewed source, `check_collisions` accepts `levelId`, `minimumClearance` in meters or natural-language units, `floorOnly`, and an optional read-only `candidate` with exact dimensions, position, Y rotation, and level. It reports overlap or clearance violations between item footprints and returns the candidate ID, method, units, `assessmentGraphHash`, checked and skipped evidence, source/effective dimensions, footprint bounds, and unsupported checks. It uses scaled width/depth, Y rotation, and a plan axis-aligned bounding box. The candidate exists only for the call. Older releases can expose a no-argument form and a smaller result.
- `verify_scene` runs schema validation plus practical checks. Its layout checks include item-item plan AABBs with an 8 cm gap and rectangular door keep-outs.

When the connected schema supports it, use `minimumClearance: 0` only when the question is literal overlap. Pass the user's required gap for walking or operating clearance and report each returned `violation` as either `overlap` or `clearance`. If those fields are absent, supplement the legacy result with read-only node evidence and mark unsupported clearance claims as not checked.

The default door keep-out extends 0.65 m perpendicular to both faces of the wall and 0.05 m beyond each side of the modeled door opening. It is an access rectangle, not a hinge, swing direction, leaf arc, or code-compliance model.

No modeled doors means door access is `not checked` or `insufficient evidence`, never `passed`. A clean validator cannot establish a check whose necessary geometry is absent. The same applies to absent ceiling, wall, and obstacle geometry.

A numeric `level.height`, `zone.ceilingHeight`, wall height, catalog label, or imported metadata field is not automatically a measured clearance. Without provenance recording the clear floor-to-obstacle measurement and tying its spatial coverage to the exact ceiling, soffit, sill, railing, or obstacle above the proposed footprint, use it only to flag a possible mismatch that needs measurement. A modeled ceiling-shaped node or template default without that provenance is still nominal. Do not turn nominal metadata into a categorical height `passed` or `failed` result.

When measured vertical evidence is available, name its source, measured value, and coverage of the tested footprint. Compare it manually with the supplied item height and label the method accordingly; current Pascal footprint tools do not independently certify vertical clearance. Conditional reasoning is allowed: for example, “if the nominal 2.70 m value is confirmed as the clear height at this position, the 3.10 m item would be too tall.” Keep the current verdict `not checked` or `insufficient evidence` until the condition is established.

`verify_scene` does not include a read-only candidate supplied to a different tool. Do not use its clean result to pass candidate spacing or candidate door access. Those rows remain `not checked` unless a separate assessment includes that candidate and the necessary geometry. A `check_collisions` call at an explicit gap can establish only that tested gap against inspected items.

Items positioned in a non-level parent frame, such as wall-mounted furniture, are skipped instead of approximated. Carry their skipped reasons and the `hosted_item_world_transform` limitation into the report. Here, “hosted item” means an item attached to another scene node, not a cloud account.

`assessmentGraphHash` hashes the graph inspected by the collision call. It does not establish a saved revision, scene identity, account ownership, or reconnect persistence; obtain those separately from project and persistence operations.

## What a footprint verdict means

`Footprint fits` means only that the tested horizontal bounding footprint is inside the stated measured boundary and passes the checks named in the report at that pose. Because rotated objects are reduced to a plan AABB, the result can be conservative for irregular shapes.

The report must name whether room containment came from:

- a tool-returned rectangular zone bound;
- an explicit polygon/corner check;
- user-supplied dimensions without a connected scene; or
- an unverified assumption.

Do not combine values with different provenance as if they were one measurement.

## Unsupported or separately evidenced questions

Current footprint tools do not establish:

- ceiling, soffit, sill, railing, or overhead clearance for furniture;
- full 3D mesh intersection or soft-part compression;
- door-leaf swing geometry, hinge side, or handle clearance;
- a delivery route through entries, halls, corners, stairs, or elevators;
- whether the item can be tilted, disassembled, or removed from packaging;
- floor loading, anchoring, fire egress, accessibility, structural adequacy, or code compliance.

These checks require additional measured inputs and a tool that models them. Mark them `not checked` or `insufficient evidence`; do not infer them from a clear plan footprint or nominal scene metadata. Both unsupported positive and unsupported negative conclusions are misleading.

## Minimum useful follow-up measurements

When evidence is insufficient, request the smallest set that can change the answer:

- room wall-to-wall width and depth at the intended position;
- candidate item width, height, and depth in one clear unit;
- intended orientation and distance from walls or existing items;
- narrowest door/hall/elevator dimensions for a delivery question;
- ceiling/soffit/sill height for a vertical-clearance question;
- packaging and disassembly dimensions when relevant.

Do not ask for every possible measurement when one missing value is decisive.
