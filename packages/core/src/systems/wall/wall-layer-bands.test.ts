import { describe, expect, test } from 'bun:test'
import type { Assembly, WallNode } from '../../schema'
import { getWallArcData } from './wall-curve'
import { getWallPlanFootprint } from './wall-footprint'
import { getWallLayerBands, type WallLayerBand } from './wall-layer-bands'
import { calculateLevelMiters, type Point2D } from './wall-mitering'

const stacks = new WeakMap<WallNode, Assembly>()
const sum = (assembly: Assembly) => assembly.layers.reduce((t, layer) => t + layer.thickness, 0)

function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  extra: Partial<WallNode> & { layers?: Assembly } = {},
): WallNode {
  const { layers, ...fields } = extra
  const node = {
    id,
    type: 'wall',
    object: 'node',
    visible: true,
    parentId: 'level_test',
    children: [],
    start,
    end,
    thickness: 0.2,
    height: 2.5,
    frontSide: 'interior',
    backSide: 'exterior',
    metadata: {},
    ...(layers ? { thickness: sum(layers) } : {}),
    ...fields,
  } as WallNode
  if (layers) stacks.set(node, layers)
  return node
}

const bandsOf = (w: WallNode, miters = calculateLevelMiters([w])) =>
  getWallLayerBands(w, stacks.get(w)!, miters)

const area = (ring: Point2D[]) =>
  ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length]!
    return sum + point.x * next.y - next.x * point.y
  }, 0) / 2

const bandArea = (band: WallLayerBand) => band.polygons.reduce((sum, ring) => sum + area(ring), 0)

/** Signed offset of a plan point from a straight wall's centreline along +n. */
const offsetOf = (w: WallNode, point: Point2D) => {
  const [sx, sy] = w.start
  const length = Math.hypot(w.end[0] - sx, w.end[1] - sy)
  const nx = -(w.end[1] - sy) / length
  const ny = (w.end[0] - sx) / length
  return (point.x - sx) * nx + (point.y - sy) * ny
}

/** Bands tile the footprint: each ring stays in its strip and the areas add up. */
function expectTiling(w: WallNode, walls: WallNode[], offset = offsetOf) {
  const miters = calculateLevelMiters(walls)
  const result = bandsOf(w, miters)
  expect(result.diagnostics).toEqual([])
  const footprintArea = Math.abs(area(getWallPlanFootprint(w, miters)))
  let total = 0
  for (const band of result.bands) {
    expect(band.polygons.length).toBeGreaterThan(0)
    for (const ring of band.polygons) {
      expect(area(ring)).toBeGreaterThan(0)
      for (const point of ring) {
        const at = offset(w, point)
        expect(at).toBeGreaterThanOrEqual(band.back - 1e-6)
        expect(at).toBeLessThanOrEqual(band.front + 1e-6)
      }
    }
    total += bandArea(band)
  }
  expect(total).toBeCloseTo(footprintArea, 9)
  return result
}

const fourLayers: Assembly = {
  layers: [
    { id: 'drywall', role: 'lining', thickness: 0.0127 },
    { id: 'studs', role: 'structure', thickness: 0.1397, core: true },
    { id: 'sheathing', role: 'sheathing', thickness: 0.0111 },
    { id: 'stucco', role: 'finish', thickness: 0.0222 },
  ],
}

describe('wall layer bands (F2 band math)', () => {
  test('a free wall: one rectangle per layer, from the front face inward', () => {
    const w = wall('wall_a', [0, 0], [4, 0], { layers: fourLayers })
    const result = expectTiling(w, [w])
    expect(result.diagnostics).toEqual([])
    expect(result.bands.map((band) => band.layerId)).toEqual([
      'drywall',
      'studs',
      'sheathing',
      'stucco',
    ])
    const [drywall, studs, sheathing, stucco] = result.bands
    expect(drywall!.front).toBeCloseTo(0.09285, 9)
    expect(drywall!.back).toBeCloseTo(0.08015, 9)
    expect(studs!.front - studs!.back).toBeCloseTo(0.1397, 9)
    expect(sheathing!.back).toBeCloseTo(-0.07065, 9)
    expect(stucco!.back).toBeCloseTo(-0.09285, 9)
    // +n of a wall running +x is +y: the front face is the +y side.
    const ys = stucco!.polygons[0]!.map((point) => point.y)
    expect(Math.min(...ys)).toBeCloseTo(-0.09285, 9)
    expect(Math.max(...ys)).toBeCloseTo(-0.07065, 9)
    expect(bandArea(stucco!)).toBeCloseTo(4 * 0.0222, 9)
  })

  test('a mitred corner: both walls tile their footprints', () => {
    const a = wall('wall_a', [0, 0], [4, 0], { layers: fourLayers })
    const b = wall('wall_b', [4, 0], [4, 3], { layers: fourLayers })
    expectTiling(a, [a, b])
    expectTiling(b, [a, b])
  })

  test('an acute corner: bands follow the long mitre tips', () => {
    const rad = (12 * Math.PI) / 180
    const thick: Assembly = {
      layers: fourLayers.layers.map((l) =>
        l.core ? { ...l, thickness: l.thickness + 0.2143 } : l,
      ),
    }
    const a = wall('wall_a', [0, 0], [4, 0], { layers: thick })
    const b = wall('wall_b', [4, 0], [4 - 3 * Math.cos(rad), 3 * Math.sin(rad)], {
      thickness: 0.4,
    })
    const miters = calculateLevelMiters([a, b])
    // The outer tip runs 1.9 m past the wall's end.
    const tip = Math.max(...getWallPlanFootprint(a, miters).map((point) => point.x))
    expect(tip).toBeGreaterThan(4 + 1.5)
    expectTiling(a, [a, b])
  })

  test('a band face through the junction vertex of a three-way end cap', () => {
    const halves: Assembly = {
      layers: [
        { id: 'front-half', role: 'finish', thickness: 0.1 },
        { id: 'back-half', role: 'finish', thickness: 0.1 },
      ],
    }
    const a = wall('wall_a', [0, 0], [4, 0], { layers: halves })
    const b = wall('wall_b', [4, 0], [8, 0])
    const c = wall('wall_c', [4, 0], [4, 3])
    const miters = calculateLevelMiters([a, b, c])
    // The end cap carries the junction point itself, on the centreline.
    expect(getWallPlanFootprint(a, miters)).toContainEqual({ x: 4, y: 0 })
    const result = expectTiling(a, [a, b, c])
    expect(result.bands[0]!.back).toBeCloseTo(0, 12)
  })

  test('a 1 mm membrane keeps a band of its own', () => {
    const w = wall('wall_a', [0, 0], [3, 0], {
      layers: {
        layers: [
          { id: 'lining', role: 'lining', thickness: 0.0127 },
          { id: 'core', role: 'structure', thickness: 0.1746, core: true },
          { id: 'membrane', role: 'membrane', thickness: 0.001 },
          { id: 'finish', role: 'finish', thickness: 0.0127 },
        ],
      },
    })
    const result = expectTiling(w, [w])
    expect(bandArea(result.bands[2]!)).toBeCloseTo(3 * 0.001, 9)
  })

  test('an empty layer draws no band', () => {
    const w = wall('wall_a', [0, 0], [4, 0], {
      layers: {
        layers: [
          { id: 'finish', role: 'finish', thickness: 0.08 },
          { id: 'none', role: 'air', thickness: 0 },
          { id: 'lining', role: 'lining', thickness: 0.02 },
        ],
      },
    })
    const result = expectTiling(w, [w])
    expect(result.bands.map((band) => band.layerId)).toEqual(['finish', 'lining'])
  })

  test('a curved wall: the bands resample the footprint arcs and tile it', () => {
    const w = wall('wall_a', [0, 0], [4, 0], { curveOffset: 1, layers: fourLayers })
    const arc = getWallArcData(w)!
    // Offset along +n: toward the centre on a counter-clockwise arc.
    const radial = (_: WallNode, point: Point2D) =>
      (arc.radius - Math.hypot(point.x - arc.center.x, point.y - arc.center.y)) *
      (arc.direction > 0 ? 1 : -1)
    expectTiling(w, [w], radial)
  })

  test('a curved wall mitred to a straight one tiles too', () => {
    const w = wall('wall_a', [0, 0], [4, 0], { curveOffset: -0.8, layers: fourLayers })
    const b = wall('wall_b', [4, 0], [4, 3])
    const miters = calculateLevelMiters([w, b])
    const result = bandsOf(w, miters)
    const total = result.bands.reduce((sum, band) => sum + bandArea(band), 0)
    expect(total).toBeCloseTo(Math.abs(area(getWallPlanFootprint(w, miters))), 9)
  })

  test('a zero-length wall resolves its stack but draws no band', () => {
    const w = wall('wall_a', [1, 1], [1, 1], { layers: fourLayers })
    const result = bandsOf(w)
    expect(result.layers).toHaveLength(4)
    expect(result.bands.every((band) => band.polygons.length === 0)).toBe(true)
  })
})
