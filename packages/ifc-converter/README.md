# @pascal-app/ifc-converter

Pure conversion logic between IFC and Pascal scene graphs. No DOM, no React;
the UI lives in `apps/ifc-converter`.

```ts
import { convertIfcToPascal, convertPascalToIfc } from '@pascal-app/ifc-converter'

const scene = await convertIfcToPascal(ifcBytes)
const exportedIfcBytes = convertPascalToIfc(scene, { projectName: 'Pascal Project' })
```

The IFC4 exporter currently writes the spatial hierarchy, straight walls,
slabs, ceilings, columns, doors/windows with void relationships, spaces,
duct/pipe segments, tessellated roof-segment shells, straight/curved/spiral
stair bodies, basic common property sets, and material associations. Roof
layers, overhangs, trims, merged segment unions, stair railings, and stair
accessories are simplified in the current geometry export.
