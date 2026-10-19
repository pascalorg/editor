import { ColumnNode } from '@pascal-app/core'
import { createColumnShaftGeometry, createColumnSpiralGeometry } from '../geometry'
import { columnShaftLayout } from '../shape'

// Run with bun packages/nodes/src/column/__bench__/geometry.ts. CPU construction only; not viewer FPS.
for (const scenario of ['round spiral', 'rectangular spiral', 'bulged fluted'] as const) {
  const crossSection = scenario === 'rectangular spiral' ? 'rectangular' : 'round'
  const node = ColumnNode.parse({
    crossSection,
    shaftProfile: scenario === 'bulged fluted' ? 'bulged' : 'tapered',
    shaftBulge: 0.12,
    shaftSegmentCount: 32,
    shaftDetail: scenario === 'bulged fluted' ? 'fluted' : 'spiral',
    fluteCount: scenario === 'bulged fluted' ? 16 : 0,
    spiralRibCount: scenario === 'bulged fluted' ? 0 : 24,
    spiralTwist: 1,
  })
  const { shaftHeight } = columnShaftLayout(node)
  const start = performance.now()
  let triangles = 0
  for (let i = 0; i < 30; i++) {
    const geometries = [
      createColumnShaftGeometry(node, shaftHeight),
      createColumnSpiralGeometry(node, shaftHeight),
    ]
    triangles = geometries.reduce(
      (sum, geometry) =>
        sum +
        (geometry ? (geometry.index?.count ?? geometry.getAttribute('position').count) / 3 : 0),
      0,
    )
    for (const geometry of geometries) geometry?.dispose()
  }
  console.log({
    scenario,
    meshes: scenario === 'bulged fluted' ? 1 : 2,
    triangles,
    millisecondsPerBuild: (performance.now() - start) / 30,
  })
}
