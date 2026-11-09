# Kitchen model geometry

The kitchen models use procedural geometry so dimensions, finishes, opening poses,
and material slots remain editable. Detail is concentrated on silhouettes, exposed
edges, controls, and interiors visible when doors or drawers open.

## Measuring geometry

From the repository root:

```sh
bun packages/nodes/src/cabinet/__bench__/geometry.ts
```

The probe builds each catalog preset with default dimensions and counts every mesh
and triangle, including hidden interiors and interaction hit meshes. These are
generated geometry counts, not measured frame times or GPU draw calls. Countertops
owned by a parent run are not included in these module counts.

## October 2026 refinement baseline

The before column was measured before the model refinement passes; the after
column includes the new drawer runners, gas pan supports, and interior details.

| Catalog item | Before triangles | After triangles | After meshes |
| --- | ---: | ---: | ---: |
| Wall cabinet | 396 | 300 | 15 |
| Base cabinet | 1,032 | 936 | 53 |
| Drawer cabinet | 672 | 672 | 41 |
| Dishwasher | 2,528 | 1,312 | 69 |
| Gas cooktop | 5,776 | 3,192 | 79 |
| Induction cooktop | 15,736 | 1,920 | 58 |
| Sink cabinet | 3,848 | 2,032 | 36 |
| Tall pantry | 420 | 324 | 17 |
| Oven tower | 26,356 | 9,742 | 195 |
| Fridge | 3,068 | 1,800 | 106 |

The tall pantry catalog preset is a shelf cabinet. Pull-out pantry variants and
range hoods are separate compartment options and are not represented by that row.

## Modeling choices

- Cabinet fronts use one chamfer segment with metre-scale UVs. Carcass boards keep
  their simpler box geometry.
- Small cylindrical hardware uses fewer radial segments; broad faces remain flat.
- Induction markings and microwave screen dots are flat geometry. Microwave dots
  share one mesh; gas pan supports are merged into one mesh.
- Sink bowls taper without extra triangles. Fridge crispers have actual open tops.
- Drawer runners have stationary and moving pieces. Pantry handles share the
  cabinet handle implementation and respect the selected style.
- Opening pivots, material-slot metadata, and existing scene schemas are retained.

Added runners and basket supports increase mesh counts for some items even where
triangle counts decrease. Further performance work should measure runtime batching
and interaction costs rather than assuming triangle savings translate directly to
frame-rate gains.

## Run finishing and placement feedback

The run inspector's **Finish & align** section matches base heights, rear faces,
reveals and handle settings in one undo step. Attached upper cabinets share the
first upper cabinet's bottom elevation. Tall appliance heights and compartment
contents are preserved. Countertops remain grouped by height and depth; toe-kicks
merge across adjacent base and tall units with matching footprints. Inside corner
joins suppress overhangs and finished panels on their shared edges.

**Fit wall fillers** closes 50–150 mm gaps beside perpendicular walls with editable
`wall-filler` modules. The 50 mm lower bound is the module schema minimum. Fillers
have solid fronts without handles, share the run countertop and plinth, and suppress
outer overhangs/end panels where they meet the wall. Both ends undo together;
repeating the action does not add duplicate fillers. Existing scenes retain the
`standard` module-kind default.

Placement reports blocking overlaps in both views. Advisory opening-clearance
notices use the registry hook during placement, movement, and inspection. Clearance checks use oriented front envelopes and vertical overlap
against visible floor-placed objects and straight walls on the same level. They
estimate operating space rather than simulating an exact hinge sweep; curved walls
and wall openings are not resolved by this advisory check. Alt retains force-place
behavior. Opening warnings do not prevent placement.


Finishing actions and clearance checks also ship as the built-in plugin's
`kitchen_finish_run` and `kitchen_check_clearance` tools. The inspector and agents
share the same planner and hosted-item checks. See the [nodes package](../../packages/nodes/README.md#kitchen-agent-tools)
for host registration and limitations.
