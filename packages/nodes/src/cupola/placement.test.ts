import { expect, test } from 'bun:test'
import { RoofSegmentNode } from '@pascal-app/core'
import { getRoofOuterSurfaceFrameAtPoint } from '@pascal-app/viewer'
import { buildCupolaGeometry, CupolaNode, cupolaMount, resolveCupolaPlacement } from './index'

const roof = RoofSegmentNode.parse({ width: 8, depth: 6, roofType: 'gable' })
const cupola = CupolaNode.parse({})
test('ridge alignment seats the cupola at the ridge and footprint checks reject edges and trims', () => {
  const ridge = resolveCupolaPlacement(roof, cupola, 0.13, 1, { alignRidge: true })
  expect(ridge.position[2]).toBeCloseTo(0)
  expect(ridge.valid).toBe(true)
  expect(resolveCupolaPlacement(roof, cupola, 4.5, 0).valid).toBe(false)
  expect(
    resolveCupolaPlacement(RoofSegmentNode.parse({ ...roof, trim: { right: 2 } }), cupola, 1.8, 0)
      .valid,
  ).toBe(false)
})
test('grid, raw cursor and roof offset retain their requested coordinates', () => {
  const grid = resolveCupolaPlacement(roof, cupola, 0.13, 1.37, { gridStep: 0.25, roofOffset: 0.2 })
  expect(grid.position[0]).toBe(0.25)
  expect(grid.position[2]).toBe(1.25)
  expect(grid.position[1]).toBeCloseTo(
    getRoofOuterSurfaceFrameAtPoint(roof, 0.25, 1.25).point.y + 0.2,
  )
  expect(resolveCupolaPlacement(roof, cupola, 0.13, 1.37).position[0]).toBe(0.13)
})
test('the upright mounting skirt meets the roof around its full perimeter on ridge and slope', () => {
  for (const position of [
    [0, 0, 0],
    [1, 0, 1],
  ] as [number, number, number][]) {
    const node = { ...cupola, position, rotation: 0.4 }
    const mount = cupolaMount(roof, node)
    const geometry = buildCupolaGeometry(node, roof)
    const vertices = geometry.getAttribute('position')
    const c = Math.cos(node.rotation),
      s = Math.sin(node.rotation)
    for (const [x, y, z] of mount.perimeter) {
      const expected = getRoofOuterSurfaceFrameAtPoint(
        roof,
        position[0] + x * c + z * s,
        position[2] - x * s + z * c,
      ).point.y
      expect(y + mount.seatY).toBeCloseTo(expected, 6)
      expect(
        Array.from({ length: vertices.count }, (_, i) =>
          Math.hypot(
            vertices.getX(i) - x,
            vertices.getY(i) - (y + mount.seatY - mount.centerY),
            vertices.getZ(i) - z,
          ),
        ).some((d) => d < 1e-6),
      ).toBe(true)
    }
    geometry.dispose()
  }
})

test('magnetic placement on a shed stays on the slope instead of jumping to its high eave', () => {
  const shed = RoofSegmentNode.parse({ roofType: 'shed', width: 8, depth: 6 })
  const placed = resolveCupolaPlacement(shed, cupola, 0, 1, { alignRidge: true })
  expect(placed.position[2]).toBe(1)
  expect(placed.valid).toBe(true)
})
