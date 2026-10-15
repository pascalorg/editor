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
