# Slab niches and bumps

Slab features act on the **top surface only**. A niche removes a rectangular
volume downward; a bump adds one upward. A niche can be nested in a slab bump.
Pool shells are excluded because their floor/rim model differs from a solid slab.

## Editing

Select a slab and use **Add niche** or **Add bump** in its action menu or the
**Features** section of the slab/floor-plate panel. Point inside the selected
slab and click to place. Select a bump to add a niche to its top.

Four single-arrow handles resize the footprint while keeping the opposite edge
fixed. The vertical arrow changes recess/projection depth. The inspector uses
Width, Length, Depth, Position X and Position Z; finishes belong to the paint
tool. Previews are translucent filled boxes on the editor layer, stripped from
exports. Escape cancels the preview; a committed gesture writes once for undo.

Floor-plan tools support placement, movement, and both footprint dimensions.
Depth is adjusted through the shared inspector. Grid and magnetic snapping use
the active context; Alt uses the raw cursor. Physical fit/backing rules still
apply.

## Scene contract

`SlabFeatureNode` uses `parentId` to name its slab or parent bump. Width is along
X and Length along Z. For a slab child, X/Z are centre offsets from the slab's
first authored outline vertex. This datum translates with whole-slab movement.
For a nested niche, X/Z are offsets from the bump centre. Depth is vertical.
Changing the slab's datum vertex also moves its features; outline edits are
refused if the feature tree no longer fits.

The full footprint must remain inside the rendered slab boundary, outside
openings, and inside its bump when nested. Unrelated features cannot overlap.
Niches leave at least 0.02 m of solid backing, including when cut into a bump.
Slab edits use the registry's relation validation to preserve these constraints.

Feature geometry is composed into the slab body before its material partitions
and batching. The feature renderer supplies picking and hosted children, without
emitting a second solid. Missing paint overrides inherit the parent bump or the
slab/room finish. Feature UVs use metre coordinates. Bump tops and niche floors
expose the existing surface-hosting protocol for items and procedural items.
Slab/level duplication remaps child ownership and attachment keys; cascade
deletion removes the owned feature tree.

## Agent support

`@pascal-app/nodes/agent-tools` exports `slabFeatureAgentTools`, with
`pascal_create_slab_feature` and `pascal_update_slab_feature`.
`@pascal-app/nodes/agent-operations` exports `slabFeatureAgentOperations`.
Hosts register these through the same reviewed plugin-tool configuration as the
wall-feature pack; installation and authorization remain host-owned. Both agent
operations reuse the manual placement validator.

## Check record

Biome and package type checks passed during implementation. Automated tests and
interactive acceptance were not run in this continuation. Acceptance still needs
to cover solid volumes, picking/batching, nested placement, paint, hosted objects,
undo/redo, old-scene reload, and saved/exported geometry. Hosted-chat registration
and semantic IFC mappings are separate integrations.
