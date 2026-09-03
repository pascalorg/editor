import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanGeometry,
  type GeometryContext,
  RoofNode,
  RoofSegmentNode,
} from '@pascal-app/core'
import { buildRoofFloorplan } from './floorplan'

function buildContext(
  node: ReturnType<typeof RoofNode.parse>,
  children: AnyNode[],
  siblings: AnyNode[],
  nodes: Record<string, AnyNode>,
): GeometryContext {
  return {
    resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    children,
    siblings,
    parent: null,
  }
}

/**
 * The SOLID merged outline — the wall line under the roof. The dashed ring
 * outside it is the drip edge (footprint + overhang); it is excluded here by
 * its dash pattern so this stays a test about footprint clipping.
 */
function outlinePoints(geometry: FloorplanGeometry | null): [number, number][] {
  if (geometry?.kind !== 'group') return []
  return geometry.children.flatMap((child) =>
    child.kind === 'polygon' && child.fill === 'none' && !child.strokeDasharray
      ? (child.points as [number, number][])
      : [],
  )
}

/** The DASHED merged outline — the eave / rake edge, overhang included. */
function eavePoints(geometry: FloorplanGeometry | null): [number, number][] {
  if (geometry?.kind !== 'group') return []
  return geometry.children.flatMap((child) =>
    child.kind === 'polygon' && child.fill === 'none' && child.strokeDasharray
      ? (child.points as [number, number][])
      : [],
  )
}

function labels(geometry: FloorplanGeometry | null): { text: string; x: number; y: number }[] {
  if (geometry?.kind !== 'group') return []
  return geometry.children.flatMap((child) =>
    child.kind === 'text' ? [{ text: child.text, x: child.x, y: child.y }] : [],
  )
}

/** Arrowheads are the only three-point polylines the roof plan emits. */
function arrowHeads(geometry: FloorplanGeometry | null): [number, number][] {
  if (geometry?.kind !== 'group') return []
  return geometry.children.flatMap((child) =>
    child.kind === 'polyline' && child.points.length === 3
      ? [child.points[1] as [number, number]]
      : [],
  )
}

describe('buildRoofFloorplan roof intersections', () => {
  test('clips the smaller roof footprint and keeps the larger host outline', () => {
    const hostRoof = RoofNode.parse({
      id: 'roof_host',
      type: 'roof',
      children: ['rseg_host'],
    })
    const enteringRoof = RoofNode.parse({
      id: 'roof_entering',
      type: 'roof',
      position: [3, 0, 0],
      children: ['rseg_entering'],
    })
    const hostSegment = RoofSegmentNode.parse({
      id: 'rseg_host',
      type: 'roof-segment',
      parentId: hostRoof.id,
      roofType: 'mansard',
      width: 10,
      depth: 8,
    })
    const enteringSegment = RoofSegmentNode.parse({
      id: 'rseg_entering',
      type: 'roof-segment',
      parentId: enteringRoof.id,
      roofType: 'gable',
      width: 8,
      depth: 4,
    })
    const nodes = {
      [hostRoof.id]: hostRoof,
      [enteringRoof.id]: enteringRoof,
      [hostSegment.id]: hostSegment,
      [enteringSegment.id]: enteringSegment,
    }

    const enteringGeometry = buildRoofFloorplan(
      enteringRoof,
      buildContext(enteringRoof, [enteringSegment], [hostRoof], nodes),
    )
    const enteringOutline = outlinePoints(enteringGeometry)
    expect(Math.min(...enteringOutline.map(([x]) => x))).toBeCloseTo(5, 6)
    expect(Math.max(...enteringOutline.map(([x]) => x))).toBeCloseTo(7, 6)

    const hostGeometry = buildRoofFloorplan(
      hostRoof,
      buildContext(hostRoof, [hostSegment], [enteringRoof], nodes),
    )
    const hostOutline = outlinePoints(hostGeometry)
    expect(Math.min(...hostOutline.map(([x]) => x))).toBeCloseTo(-5, 6)
    expect(Math.max(...hostOutline.map(([x]) => x))).toBeCloseTo(5, 6)
  })
})

/** The PlanCrafters cottage's auto roof: 46' × 32' gable at a 7:12 pitch. */
function cottageRoof(overrides: Record<string, unknown> = {}) {
  const roof = RoofNode.parse({ id: 'roof_c', type: 'roof', children: ['rseg_c'] })
  const segment = RoofSegmentNode.parse({
    id: 'rseg_c',
    type: 'roof-segment',
    parentId: roof.id,
    roofType: 'gable',
    width: 14.0208,
    depth: 9.7536,
    pitch: 30.256437,
    overhang: 0.529302,
    ...overrides,
  })
  const nodes = { [roof.id]: roof, [segment.id]: segment }
  return buildRoofFloorplan(roof, buildContext(roof, [segment], [], nodes))
}

describe('roof plan slope annotation', () => {
  test('every slope gets a down-slope arrow tagged with the pitch in 12ths', () => {
    const geometry = cottageRoof()
    // A gable has two planes falling away from the ridge, so two arrows.
    const pitch = labels(geometry).filter((label) => label.text === '7:12')
    expect(pitch).toHaveLength(2)

    // 30.256° → tan × 12 = 7.00 exactly; the tag is not a rounded guess.
    expect(Math.round(Math.tan((30.256437 * Math.PI) / 180) * 12 * 100) / 100).toBe(7)

    // Heads sit near the eaves (|z| ≈ 0.86 × half-depth = 4.19 m), one on
    // each side of the ridge at z = 0 — the arrows point DOWN-slope.
    const heads = arrowHeads(geometry)
      .map(([, z]) => z)
      .sort((a, b) => a - b)
    expect(heads).toHaveLength(2)
    expect(heads[0]).toBeCloseTo(-4.194, 2)
    expect(heads[1]).toBeCloseTo(4.194, 2)

    // Both tags sit on the SAME side of their own arrow — opposing slopes
    // must not put their labels on opposite sides of the ridge.
    const shafts = [-14.0208 / 2, 14.0208 / 2].map((half) => half * 0.35)
    expect(pitch.map((label) => label.x).sort((a, b) => a - b)).toEqual([
      shafts[0]! + 0.24,
      shafts[1]! + 0.24,
    ])
  })

  test('the eave line is dashed and lies outside the wall line by the overhang', () => {
    const geometry = cottageRoof()
    const wall = outlinePoints(geometry)
    const eave = eavePoints(geometry)
    expect(eave.length).toBeGreaterThan(0)
    // Footprint is 14.0208 × 9.7536; the drip edge adds the horizontal
    // component of the 0.5293 m overhang (plus half the wall thickness).
    expect(Math.max(...wall.map(([x]) => x))).toBeCloseTo(7.0104, 4)
    expect(Math.max(...eave.map(([x]) => x))).toBeGreaterThan(7.4)
    expect(Math.min(...eave.map(([, z]) => z))).toBeLessThan(-5.3)
  })

  test('a flat roof is not annotated with a pitch it does not have', () => {
    const geometry = cottageRoof({ roofType: 'flat', pitch: 0 })
    expect(labels(geometry).filter((label) => /:12$/.test(label.text))).toHaveLength(0)
  })
})
