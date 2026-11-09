import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanGeometry,
  type GeometryContext,
  getRoofSegmentVisibleTopBounds,
  RoofNode,
  RoofSegmentNode,
} from '@pascal-app/core'
import { createFloorplanContextExtensions } from '@pascal-app/editor'
import { buildRoofFloorplan } from './floorplan'

/**
 * No overhang, wall or shingle reach: the eave sits on the wall line, so a test about clipping or
 * creases reads in round numbers. Otherwise the editor plan runs out to the eave.
 */
const FLUSH = { overhang: 0, wallThickness: 0, shingleThickness: 0 }

function buildContext(
  node: ReturnType<typeof RoofNode.parse>,
  children: AnyNode[],
  siblings: AnyNode[],
  nodes: Record<string, AnyNode>,
  drafting = false,
): GeometryContext {
  return {
    resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    children,
    siblings,
    parent: null,
    ...(drafting ? { extensions: createFloorplanContextExtensions({ drafting: true }) } : {}),
  }
}

/** Every primitive in the group, nested groups (the 'roof-plan' stratum) flattened. */
function flat(geometry: FloorplanGeometry | null): FloorplanGeometry[] {
  if (!geometry) return []
  if (geometry.kind !== 'group') return [geometry]
  return geometry.children.flatMap((child) => flat(child))
}

/**
 * The SOLID merged outline — the wall line under the roof. The dashed ring
 * a sheet draws outside it is the drip edge (footprint + overhang); it is
 * excluded here by its dash pattern so this stays a test about footprint clipping.
 */
function outlinePoints(geometry: FloorplanGeometry | null): [number, number][] {
  return flat(geometry).flatMap((child) =>
    child.kind === 'polygon' && child.fill === 'none' && !child.strokeDasharray
      ? (child.points as [number, number][])
      : [],
  )
}

/** The DASHED merged outline — the eave / rake edge, overhang included. */
function eavePoints(geometry: FloorplanGeometry | null): [number, number][] {
  return flat(geometry).flatMap((child) =>
    child.kind === 'polygon' && child.fill === 'none' && child.strokeDasharray
      ? (child.points as [number, number][])
      : [],
  )
}

function labels(geometry: FloorplanGeometry | null): { text: string; x: number; y: number }[] {
  return flat(geometry).flatMap((child) =>
    child.kind === 'text' ? [{ text: child.text, x: child.x, y: child.y }] : [],
  )
}

/** Arrowheads are the only three-point polylines the roof plan emits. */
function arrowHeads(geometry: FloorplanGeometry | null): [number, number][] {
  return flat(geometry).flatMap((child) =>
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
      ...FLUSH,
    })
    const enteringSegment = RoofSegmentNode.parse({
      id: 'rseg_entering',
      type: 'roof-segment',
      parentId: enteringRoof.id,
      roofType: 'gable',
      width: 8,
      depth: 4,
      ...FLUSH,
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

  test('keeps a mounted conical roof visible above its host in plan view', () => {
    const hostRoof = RoofNode.parse({
      id: 'roof_host',
      type: 'roof',
      children: ['rseg_host'],
    })
    const conicalRoof = RoofNode.parse({
      id: 'roof_conical',
      type: 'roof',
      children: ['rseg_conical'],
      support: {
        kind: 'roof',
        roofSegmentId: 'rseg_host',
        localPosition: [0, 0],
        curbHeight: 0.5,
      },
    })
    const hostSegment = RoofSegmentNode.parse({
      id: 'rseg_host',
      type: 'roof-segment',
      parentId: hostRoof.id,
      roofType: 'gable',
      width: 10,
      depth: 8,
    })
    const conicalSegment = RoofSegmentNode.parse({
      id: 'rseg_conical',
      type: 'roof-segment',
      parentId: conicalRoof.id,
      roofType: 'conical',
      width: 3,
      depth: 3,
    })
    const nodes = {
      [hostRoof.id]: hostRoof,
      [conicalRoof.id]: conicalRoof,
      [hostSegment.id]: hostSegment,
      [conicalSegment.id]: conicalSegment,
    }

    const geometry = buildRoofFloorplan(
      conicalRoof,
      buildContext(conicalRoof, [conicalSegment], [hostRoof], nodes),
    )
    const outline = outlinePoints(geometry)

    expect(geometry).not.toBeNull()
    expect(Math.min(...outline.map(([x]) => x))).toBeCloseTo(-1.5, 6)
    expect(Math.max(...outline.map(([x]) => x))).toBeCloseTo(1.5, 6)
  })
})

/** Every straight line the plan draws, as rounded endpoint pairs in either order. */
function lineKey(from: [number, number], to: [number, number]): string {
  const key = (point: [number, number]) =>
    point.map((value) => (Math.abs(value) < 0.005 ? 0 : value).toFixed(2)).join(',')
  const a = key(from)
  const b = key(to)
  return a < b ? `${a} ${b}` : `${b} ${a}`
}

function planLines(geometry: FloorplanGeometry | null): string[] {
  return flat(geometry).flatMap((child) =>
    child.kind === 'line' ? [lineKey([child.x1, child.y1], [child.x2, child.y2])] : [],
  )
}

describe('roof plan creases from the roof surface', () => {
  // A 10 × 8 gable, ridge along x, and a 4-wide wing roof running into it from +z,
  // its ridge along z: both on the same plate at the same pitch.
  function wingedHouse() {
    const main = RoofNode.parse({ id: 'roof_main', type: 'roof', children: ['rseg_main'] })
    const wing = RoofNode.parse({
      id: 'roof_wing',
      type: 'roof',
      position: [0, 0, 5],
      children: ['rseg_wing'],
    })
    const mainSegment = RoofSegmentNode.parse({
      id: 'rseg_main',
      type: 'roof-segment',
      parentId: main.id,
      roofType: 'gable',
      width: 10,
      depth: 8,
      pitch: 30,
      wallHeight: 0,

      ...FLUSH,
    })
    const wingSegment = RoofSegmentNode.parse({
      id: 'rseg_wing',
      type: 'roof-segment',
      parentId: wing.id,
      roofType: 'gable',
      width: 10,
      depth: 4,
      pitch: 30,
      wallHeight: 0,
      rotation: Math.PI / 2,

      ...FLUSH,
    })
    const nodes = {
      [main.id]: main,
      [wing.id]: wing,
      [mainSegment.id]: mainSegment,
      [wingSegment.id]: wingSegment,
    }
    return {
      main: buildRoofFloorplan(main, buildContext(main, [mainSegment], [wing], nodes)),
      wing: buildRoofFloorplan(wing, buildContext(wing, [wingSegment], [main], nodes)),
    }
  }

  test("a wing's ridge runs on past the main roof's wall line to where it meets the main slope", () => {
    const { wing } = wingedHouse()
    expect(planLines(wing)).toContain(lineKey([0, 10], [0, 2]))
  })

  test('the valleys run from where the eaves cross up to the ridge, drawn once', () => {
    const { main, wing } = wingedHouse()
    expect(planLines(main)).toEqual(
      expect.arrayContaining([
        lineKey([-5, 0], [5, 0]),
        lineKey([0, 2], [2, 4]),
        lineKey([0, 2], [-2, 4]),
      ]),
    )
    expect(planLines(wing)).not.toContain(lineKey([0, 2], [2, 4]))
  })

  test('a hip draws its ridge and four hips', () => {
    const roof = RoofNode.parse({ id: 'roof_h', type: 'roof', children: ['rseg_h'] })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_h',
      type: 'roof-segment',
      parentId: roof.id,
      roofType: 'hip',
      width: 10,
      depth: 6,
      ...FLUSH,
    })
    const nodes = { [roof.id]: roof, [segment.id]: segment }
    const lines = planLines(buildRoofFloorplan(roof, buildContext(roof, [segment], [], nodes)))
    expect(lines).toEqual(
      expect.arrayContaining([
        lineKey([-2, 0], [2, 0]),
        lineKey([-5, -3], [-2, 0]),
        lineKey([-5, 3], [-2, 0]),
        lineKey([5, -3], [2, 0]),
        lineKey([5, 3], [2, 0]),
      ]),
    )
    expect(lines).toHaveLength(5)
  })
})

describe('the editor plan runs out to the eave', () => {
  function singleRoof(roofType: 'gable' | 'hip', drafting = false) {
    const roof = RoofNode.parse({ id: 'roof_e', type: 'roof', children: ['rseg_e'] })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_e',
      type: 'roof-segment',
      parentId: roof.id,
      roofType,
      width: 10,
      depth: 6,
    })
    const nodes = { [roof.id]: roof, [segment.id]: segment }
    return {
      edge: getRoofSegmentVisibleTopBounds(segment),
      geometry: buildRoofFloorplan(roof, buildContext(roof, [segment], [], nodes, drafting)),
    }
  }

  test('the outline is the eave and rake, overhang included, not the wall line', () => {
    const { edge, geometry } = singleRoof('gable')
    const outline = outlinePoints(geometry)
    expect(edge.minX).toBeLessThan(-5.1)
    expect(Math.min(...outline.map(([x]) => x))).toBeCloseTo(edge.minX, 6)
    expect(Math.max(...outline.map(([x]) => x))).toBeCloseTo(edge.maxX, 6)
    expect(Math.min(...outline.map(([, z]) => z))).toBeCloseTo(edge.minZ, 6)
    expect(Math.max(...outline.map(([, z]) => z))).toBeCloseTo(edge.maxZ, 6)
  })

  test("a gable's ridge runs out to both rakes", () => {
    const { edge, geometry } = singleRoof('gable')
    expect(planLines(geometry)).toEqual([lineKey([edge.minX, 0], [edge.maxX, 0])])
  })

  test("a hip's hips run out to the eave corners", () => {
    const { edge, geometry } = singleRoof('hip')
    expect(planLines(geometry)).toEqual(
      expect.arrayContaining([
        lineKey([-2, 0], [2, 0]),
        lineKey([edge.minX, edge.minZ], [-2, 0]),
        lineKey([edge.minX, edge.maxZ], [-2, 0]),
        lineKey([edge.maxX, edge.minZ], [2, 0]),
        lineKey([edge.maxX, edge.maxZ], [2, 0]),
      ]),
    )
  })

  test('a drafted sheet still outlines the wall line and dashes the eave past it', () => {
    const { edge, geometry } = singleRoof('hip', true)
    const outline = outlinePoints(geometry)
    expect(Math.min(...outline.map(([x]) => x))).toBeCloseTo(-5, 6)
    expect(Math.min(...eavePoints(geometry).map(([x]) => x))).toBeCloseTo(edge.minX, 6)
    expect(planLines(geometry)).toContain(lineKey([-5, -3], [-2, 0]))
  })
})

/** A 46' × 32' gable at a 7:12 pitch. */
function cottageRoof(overrides: Record<string, unknown> = {}, drafting = true) {
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
  return buildRoofFloorplan(roof, buildContext(roof, [segment], [], nodes, drafting))
}

describe('roof plan slope annotation', () => {
  test('the editor plan keeps its linework without arrows, pitch tags, eave line or roof-plan role', () => {
    const geometry = cottageRoof({}, false)
    expect(geometry?.kind).toBe('group')
    if (geometry?.kind !== 'group') return
    expect(geometry.metadata).toBeUndefined()
    expect(geometry.children.some((child) => child.kind === 'group')).toBe(false)
    expect(arrowHeads(geometry)).toHaveLength(0)
    expect(labels(geometry)).toHaveLength(0)
    expect(eavePoints(geometry)).toHaveLength(0)
    expect(arrowHeads(cottageRoof({ roofType: 'shed' }, false))).toHaveLength(1)
  })

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

describe("the roof's wall line while it is selected or moved", () => {
  const BLUE = '#2563eb'
  function wallLines(view: { selected?: boolean; moving?: boolean }) {
    const roof = RoofNode.parse({ id: 'roof_w', type: 'roof', children: ['rseg_w'] })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_w',
      type: 'roof-segment',
      parentId: roof.id,
      roofType: 'gable',
      width: 10,
      depth: 6,
    })
    const nodes = { [roof.id]: roof, [segment.id]: segment }
    const geometry = buildRoofFloorplan(roof, {
      ...buildContext(roof, [segment], [], nodes),
      viewState: {
        selected: false,
        highlighted: false,
        hovered: false,
        moving: false,
        unit: 'metric',
        ...view,
        palette: { selectedStroke: BLUE } as never,
      },
    })
    return flat(geometry).filter(
      (child) => child.kind === 'polygon' && child.stroke === BLUE && child.fill === 'none',
    )
  }

  test('a selected or moved roof draws each segment where it stands on the walls', () => {
    for (const view of [{ selected: true }, { moving: true }]) {
      const lines = wallLines(view).filter((child) =>
        child.kind === 'polygon'
          ? child.points.every(([x, z]) => Math.abs(x) === 5 && Math.abs(z) === 3)
          : false,
      )
      expect(lines).toHaveLength(1)
    }
  })

  test('at rest it draws only the eaves', () => {
    expect(wallLines({})).toHaveLength(0)
  })
})
