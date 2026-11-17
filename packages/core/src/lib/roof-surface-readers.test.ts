import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  BaseNode,
  ChimneyNode,
  DormerNode,
  getRoofSegmentCoveringSeat,
  getRoofSegmentShellSeat,
  getRoofSegmentShellSupport,
  LevelNode,
  nodeRegistry,
  nodeType,
  objectId,
  pickRoofCoveringSeat,
  RoofNode,
  RoofSegmentNode,
  type RoofSurfaceResult,
  type RoofSurfaceSeat,
  registerNode,
  SkylightNode,
} from '../index'

type Point = [number, number]
const rootId = 'roof_readers'
const pitch = (Math.atan(0.5) * 180) / Math.PI
const slopeNormal: [number, number, number] = [0, 2 / Math.sqrt(5), 1 / Math.sqrt(5)]
const readers = [getRoofSegmentCoveringSeat, getRoofSegmentShellSeat] as const

function segment(patch: Record<string, unknown> = {}): RoofSegmentNode {
  return RoofSegmentNode.parse({
    id: 'rseg_readers',
    parentId: rootId,
    roofType: 'flat',
    width: 8,
    depth: 6,
    wallHeight: 2,
    pitch,
    wallThickness: 0.2,
    overhang: 0,
    deckThickness: 0.2,
    shingleThickness: 0.05,
    fascia: false,
    wallShell: 'omit',
    ...patch,
  })
}

function scene(node: RoofSegmentNode, others: AnyNode[] = [], patch: Record<string, unknown> = {}) {
  const children = [node, ...others].filter(
    (entry) => entry.type === 'roof-segment' && entry.parentId === rootId,
  )
  const roof = RoofNode.parse({ id: rootId, children: children.map((entry) => entry.id), ...patch })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [roof, node, ...others].map((entry) => [entry.id, entry]),
  )
  return { roof, nodes }
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

function box(x: number, z: number, half = 0.02): Point[] {
  return [
    [x - half, z - half],
    [x + half, z - half],
    [x + half, z + half],
    [x - half, z + half],
  ]
}

function expectSeat(
  result: RoofSurfaceResult<RoofSurfaceSeat>,
  node: RoofSegmentNode,
  point: Point,
  height: number,
  normal?: [number, number, number],
): RoofSurfaceSeat {
  expect(result.status).toBe('supported')
  if (result.status !== 'supported') throw new Error(JSON.stringify(result))
  const seat = result.value
  expect(seat.segment.id).toBe(node.id)
  for (const [axis, expected] of [point[0], height, point[1]].entries()) {
    expect(seat.position[axis]).toBeCloseTo(expected, 8)
  }
  expect(Math.hypot(...seat.normal)).toBeCloseTo(1, 8)
  expect(seat.normal[1]).toBeGreaterThan(0)
  if (normal)
    for (const [axis, expected] of normal.entries())
      expect(seat.normal[axis]).toBeCloseTo(expected, 8)
  const [a, b, c] = seat.triangle.vertices
  expect([a, b, c].flat().every(Number.isFinite)).toBe(true)
  // Independent barycentric containment and height: a nominal point without a backing triangle is not a seat.
  const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2])
  expect(Math.abs(denominator)).toBeGreaterThan(0)
  const wa = ((b[2] - c[2]) * (point[0] - c[0]) + (c[0] - b[0]) * (point[1] - c[2])) / denominator
  const wb = ((c[2] - a[2]) * (point[0] - c[0]) + (a[0] - c[0]) * (point[1] - c[2])) / denominator
  const wc = 1 - wa - wb
  for (const weight of [wa, wb, wc]) expect(weight).toBeGreaterThanOrEqual(-1e-8)
  expect(wa * a[1] + wb * b[1] + wc * c[1]).toBeCloseTo(height, 8)
  for (const [axis, expected] of seat.normal.entries())
    expect(seat.triangle.normal[axis]).toBeCloseTo(expected, 8)
  return seat
}

function expectUnmeasured(
  result: RoofSurfaceResult<unknown>,
  reason: 'accessory-cut' | 'plugin-cut' | 'roof-intersection',
  ids: string[],
) {
  expect(result.status).toBe('unmeasured')
  if (result.status !== 'unmeasured') throw new Error(JSON.stringify(result))
  expect(result.reason).toBe(reason)
  expect([...result.nodeIds].sort()).toEqual([...ids].sort())
}

// Literal analytic anchors frozen before c2 writes; c1 independently established these against
// the native renderer. These tests never compute their expected positions from c1 triangle helpers.
describe('strict physical point seats', () => {
  const shellCases: {
    name: string
    patch: Record<string, unknown>
    point: Point
    height: number
  }[] = [
    { name: 'flat', patch: { roofType: 'flat' }, point: [0.3, 0.7], height: 2 },
    { name: 'gable', patch: { roofType: 'gable' }, point: [0, 1], height: 3 },
    { name: 'hip', patch: { roofType: 'hip' }, point: [2, 0], height: 3 },
    { name: 'shed', patch: { roofType: 'shed' }, point: [0, -1], height: 4 },
    { name: 'gambrel', patch: { roofType: 'gambrel' }, point: [0, 2.25], height: 2.375 },
    { name: 'mansard', patch: { roofType: 'mansard' }, point: [0, 0], height: 2 + 9 / 14 },
    { name: 'dutch', patch: { roofType: 'dutch' }, point: [0, 0.75], height: 3.125 },
    {
      name: 'barrel',
      patch: { roofType: 'barrel', barrelRise: 1, barrelSegments: 4 },
      point: [0, 2.5 / Math.sqrt(10)],
      height: (1 + 15 / Math.sqrt(10)) / 2,
    },
    {
      name: 'conical',
      patch: { roofType: 'conical', width: 6, depth: 6 },
      point: [0.75 * (1 + Math.cos(Math.PI / 24)), -0.75 * Math.sin(Math.PI / 24)],
      height: 2.75,
    },
  ]
  for (const { name, patch, point, height } of shellCases) {
    test(`${name} returns its physical structural datum, not a layer underside`, () => {
      const node = segment(patch)
      const { roof, nodes } = scene(node)
      expectSeat(getRoofSegmentShellSeat(roof, node, point, nodes), node, point, height)
    })
  }

  for (const roofType of ['gable', 'shed']) {
    test(`${roofType} covering includes native build-up while shell excludes it`, () => {
      const node = segment({ roofType })
      const { roof, nodes } = scene(node)
      const point: Point = [0, 1]
      const shellY = 3
      expectSeat(
        getRoofSegmentShellSeat(roof, node, point, nodes),
        node,
        point,
        shellY,
        slopeNormal,
      )
      // Bare brush roofs offset .25 m of layers perpendicular to a 1:2 slope.
      expectSeat(
        getRoofSegmentCoveringSeat(roof, node, point, nodes),
        node,
        point,
        shellY + Math.sqrt(5) / 8,
        slopeNormal,
      )
    })
  }

  test('stored shed dispatch retains its own physical vertical-thickness recipe', () => {
    const node = segment({
      roofType: 'shed',
      width: 4,
      depth: 4,
      shedFootprintPieces: [
        [
          [-2, -2],
          [2, -2],
          [2, 2],
          [-2, 2],
        ],
      ],
    })
    const { roof, nodes } = scene(node)
    expectSeat(getRoofSegmentShellSeat(roof, node, [0, -1], nodes), node, [0, -1], 3.5, slopeNormal)
    // Stored/native shed plane: deck/cos(theta) + shingle*cos(theta), not the bare brush recipe.
    expectSeat(
      getRoofSegmentCoveringSeat(roof, node, [0, -1], nodes),
      node,
      [0, -1],
      3.5 + 0.12 * Math.sqrt(5),
      slopeNormal,
    )
  })

  test('glazed covering and barrel datum do not inherit shingle build-up', () => {
    const glazed = segment({ roofType: 'gable', roofSystem: 'glazed' })
    const first = scene(glazed)
    for (const read of readers)
      expectSeat(read(first.roof, glazed, [1, 1], first.nodes), glazed, [1, 1], 3, slopeNormal)
    const barrel = segment({ roofType: 'barrel', barrelRise: 1, barrelSegments: 4 })
    const second = scene(barrel)
    const z = 2.5 / Math.sqrt(10)
    for (const read of readers)
      expectSeat(
        read(second.roof, barrel, [0, z], second.nodes),
        barrel,
        [0, z],
        (1 + 15 / Math.sqrt(10)) / 2,
      )
  })

  test('covering overhang is real support, but not structural support or an outside fallback', () => {
    const node = segment({ overhang: 1 })
    const { roof, nodes } = scene(node)
    expectSeat(
      getRoofSegmentCoveringSeat(roof, node, [4.5, 0], nodes),
      node,
      [4.5, 0],
      2.25,
      [0, 1, 0],
    )
    expect(getRoofSegmentShellSeat(roof, node, [4.5, 0], nodes)).toEqual({
      status: 'miss',
      reason: 'outside-surface',
    })
    for (const read of readers)
      expect(read(roof, node, [100, 100], nodes)).toEqual({
        status: 'miss',
        reason: 'outside-surface',
      })
  })

  test('trimmed regions and collapsed stored geometry have no invented seats', () => {
    const trimmed = segment({ roofType: 'gable', trim: { left: 1 } })
    const first = scene(trimmed)
    for (const read of readers)
      expect(read(first.roof, trimmed, [-3.5, 0], first.nodes)).toEqual({
        status: 'miss',
        reason: 'outside-surface',
      })
    expectSeat(
      getRoofSegmentShellSeat(first.roof, trimmed, [0, 1], first.nodes),
      trimmed,
      [0, 1],
      3,
    )
    const collapsed = segment({
      roofType: 'shed',
      shedFootprintPieces: [
        [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
      ],
    })
    const second = scene(collapsed)
    for (const read of readers)
      expect(read(second.roof, collapsed, [0.5, 0], second.nodes)).toEqual({
        status: 'miss',
        reason: 'outside-surface',
      })
  })

  test('rejects nonfinite local queries without mutating frozen scene inputs', () => {
    const node = segment({ position: [20, 7, -30], rotation: 0.7 })
    const { roof, nodes } = scene(node, [], { position: [11, 13, 17], rotation: 1.2 })
    const before = structuredClone({ roof, node, nodes })
    freeze({ roof, node, nodes })
    for (const read of readers) {
      expectSeat(
        read(roof, node, freeze([0.3, 0.7] as Point), nodes),
        node,
        [0.3, 0.7],
        read === getRoofSegmentShellSeat ? 2 : 2.25,
      )
      for (const point of [
        [Number.NaN, 0],
        [0, Number.POSITIVE_INFINITY],
      ] as Point[]) {
        expect(read(roof, node, point, nodes)).toEqual({ status: 'miss', reason: 'invalid-query' })
      }
    }
    expect({ roof, node, nodes }).toEqual(before)
  })
})

describe('reciprocal typed host membership', () => {
  test('named readers reject orphaned, unlisted, missing and mistyped hosts', () => {
    const node = segment()
    const valid = scene(node)
    const orphan = { ...node, parentId: 'roof_elsewhere' }
    const unlisted = { ...valid.roof, children: [] }
    const invalid = [
      { roof: valid.roof, node: orphan, nodes: { ...valid.nodes, [node.id]: orphan } },
      { roof: valid.roof, node, nodes: { ...valid.nodes, [node.id]: orphan } },
      { roof: unlisted, node, nodes: { ...valid.nodes, [valid.roof.id]: unlisted } },
      { roof: valid.roof, node, nodes: { [node.id]: node } },
      { roof: valid.roof, node, nodes: { [valid.roof.id]: valid.roof } },
      {
        roof: valid.roof,
        node,
        nodes: { ...valid.nodes, [node.id]: { ...node, type: 'slab' } as unknown as AnyNode },
      },
    ]
    for (const entry of invalid) {
      for (const read of readers)
        expect(read(entry.roof, entry.node, [0, 0], entry.nodes)).toEqual({
          status: 'miss',
          reason: 'invalid-host',
        })
      expect(getRoofSegmentShellSupport(entry.roof, entry.node, box(0, 0), entry.nodes)).toEqual({
        status: 'miss',
        reason: 'invalid-host',
      })
    }
  })

  test('equivalent immutable host values need not share object identity with the supplied map', () => {
    const node = segment()
    const { roof, nodes } = scene(node)
    for (const read of readers) {
      expectSeat(
        read(structuredClone(roof), structuredClone(node), [0, 0], nodes),
        node,
        [0, 0],
        read === getRoofSegmentShellSeat ? 2 : 2.25,
      )
    }
    expect(
      getRoofSegmentShellSupport(structuredClone(roof), structuredClone(node), box(0, 0), nodes)
        .status,
    ).toBe('supported')
  })
})

describe('finite native accessory cuts', () => {
  test('dormer guards use the rotated INNER cavity, not outer footprint or axis-aligned bounds', () => {
    const node = segment({ children: ['dormer_cut'] })
    const dormer = DormerNode.parse({
      id: 'dormer_cut',
      parentId: node.id,
      roofSegmentId: node.id,
      roofType: 'flat',
      width: 2,
      depth: 1,
      height: 1,
      roofHeight: 0,
      wallSkirtHeight: 1,
      position: [0, 2.1, 0],
      rotation: Math.PI / 4,
    })
    const { roof, nodes } = scene(node, [dormer])
    for (const read of readers) {
      expectUnmeasured(read(roof, node, [0, 0.5], nodes), 'accessory-cut', [dormer.id])
      // Rotated local x=.96 lies in the outer wall strip, outside the inner half-width .95.
      for (const point of [
        [0.96 / Math.sqrt(2), -0.96 / Math.sqrt(2)],
        [0.9, 0.9],
        [3, 0],
      ] as Point[]) {
        expectSeat(
          read(roof, node, point, nodes),
          node,
          point,
          read === getRoofSegmentShellSeat ? 2 : 2.25,
        )
      }
    }
    expectUnmeasured(getRoofSegmentShellSupport(roof, node, box(0, 0.5), nodes), 'accessory-cut', [
      dormer.id,
    ])
    // Full-footprint checking must find a cut even when its center and corners all avoid the cut.
    const offCenter = {
      ...dormer,
      position: [-1, 2.1, 0] as [number, number, number],
      width: 0.5,
      depth: 0.5,
      rotation: 0,
    }
    const next = scene(node, [offCenter])
    const outline: Point[] = [
      [-2, -1],
      [2, -1],
      [2, 1],
      [-2, 1],
    ]
    for (const point of [...outline, [0, 0] as Point])
      expect(getRoofSegmentShellSeat(next.roof, node, point, next.nodes).status).toBe('supported')
    expectUnmeasured(
      getRoofSegmentShellSupport(next.roof, node, outline, next.nodes),
      'accessory-cut',
      [dormer.id],
    )
  })

  test('dormer cuts are finite in height as well as plan', () => {
    const node = segment({ children: ['dormer_above'] })
    const dormer = DormerNode.parse({
      id: 'dormer_above',
      parentId: node.id,
      roofSegmentId: node.id,
      roofType: 'flat',
      width: 2,
      depth: 1,
      height: 1,
      roofHeight: 0,
      wallSkirtHeight: 1,
      position: [0, 100, 0],
    })
    const { roof, nodes } = scene(node, [dormer])
    for (const read of readers)
      expectSeat(
        read(roof, node, [0, 0], nodes),
        node,
        [0, 0],
        read === getRoofSegmentShellSeat ? 2 : 2.25,
      )
    expect(getRoofSegmentShellSupport(roof, node, box(0, 0), nodes).status).toBe('supported')
  })

  test('native cut references are not silently discarded for stale accessory host fields', () => {
    const node = segment({ children: ['dormer_stale'] })
    const dormer = DormerNode.parse({
      id: 'dormer_stale',
      parentId: 'rseg_elsewhere',
      roofSegmentId: 'rseg_elsewhere',
      roofType: 'flat',
      width: 1,
      depth: 1,
      height: 1,
      roofHeight: 0,
      wallSkirtHeight: 1,
      position: [0, 2.1, 0],
    })
    const { roof, nodes } = scene(node, [dormer])
    // Native dispatch follows segment.children and still calls this referenced child's cutter.
    for (const read of readers)
      expectUnmeasured(read(roof, node, [0, 0], nodes), 'accessory-cut', [dormer.id])
    expectUnmeasured(getRoofSegmentShellSupport(roof, node, box(0, 0), nodes), 'accessory-cut', [
      dormer.id,
    ])
  })

  test('presentation visibility does not remove cuts, whereas native transient metadata does', () => {
    const node = segment({ visible: false, children: ['dormer_visibility'] })
    const dormer = DormerNode.parse({
      id: 'dormer_visibility',
      parentId: node.id,
      roofSegmentId: node.id,
      visible: false,
      roofType: 'flat',
      width: 1,
      depth: 1,
      height: 1,
      roofHeight: 0,
      wallSkirtHeight: 1,
      position: [0, 2.1, 0],
    })
    const ordinary = scene(node, [dormer], { visible: false })
    for (const read of readers)
      expectUnmeasured(read(ordinary.roof, node, [0, 0], ordinary.nodes), 'accessory-cut', [
        dormer.id,
      ])
    const transient = { ...dormer, metadata: { isTransient: true } }
    const next = scene(node, [transient], { visible: false })
    for (const read of readers)
      expectSeat(
        read(next.roof, node, [0, 0], next.nodes),
        node,
        [0, 0],
        read === getRoofSegmentShellSeat ? 2 : 2.25,
      )
    expect(getRoofSegmentShellSupport(next.roof, node, box(0, 0), next.nodes).status).toBe(
      'supported',
    )
  })

  test('skylight expansion and yaw follow its finite native cutter, ignoring stored position Y', () => {
    const node = segment({ children: ['skylight_cut'] })
    const skylight = SkylightNode.parse({
      id: 'skylight_cut',
      parentId: node.id,
      roofSegmentId: node.id,
      width: 1,
      height: 0.5,
      frameThickness: 0.1,
      cutoutOffset: 0.05,
      rotation: Math.PI / 2,
      position: [0, 999, 0],
    })
    const { roof, nodes } = scene(node, [skylight])
    // Native unturned size is 1.3 x .8; quarter-turn gives half-extents .4 x .65.
    for (const read of readers) {
      expectUnmeasured(read(roof, node, [0, 0.64], nodes), 'accessory-cut', [skylight.id])
      for (const point of [
        [0.41, 0],
        [0, 0.66],
        [3, 0],
      ] as Point[]) {
        expectSeat(
          read(roof, node, point, nodes),
          node,
          point,
          read === getRoofSegmentShellSeat ? 2 : 2.25,
        )
      }
    }
    expectUnmeasured(getRoofSegmentShellSupport(roof, node, box(0, 0), nodes), 'accessory-cut', [
      skylight.id,
    ])
  })

  test('a skylight two-metre-tall cut need not reach the structural datum below a thick build-up', () => {
    const node = segment({ deckThickness: 5, shingleThickness: 0, children: ['skylight_high'] })
    const skylight = SkylightNode.parse({
      id: 'skylight_high',
      parentId: node.id,
      roofSegmentId: node.id,
      position: [0, 0, 0],
    })
    const { roof, nodes } = scene(node, [skylight])
    // Covering y=7, native cut [6,8]; structural y=2 is outside that finite solid.
    expectUnmeasured(getRoofSegmentCoveringSeat(roof, node, [0, 0], nodes), 'accessory-cut', [
      skylight.id,
    ])
    expectSeat(getRoofSegmentShellSeat(roof, node, [0, 0], nodes), node, [0, 0], 2)
    expect(getRoofSegmentShellSupport(roof, node, box(0, 0), nodes).status).toBe('supported')
  })

  test('a tilted and yawed skylight can cut shell beyond its untilted plan rectangle', () => {
    const node = segment({ roofType: 'gable', children: ['skylight_tilted'] })
    const skylight = SkylightNode.parse({
      id: 'skylight_tilted',
      parentId: node.id,
      roofSegmentId: node.id,
      width: 1,
      height: 0.5,
      frameThickness: 0.1,
      cutoutOffset: 0.05,
      rotation: Math.PI / 2,
      position: [0, 999, 1],
    })
    const { roof, nodes } = scene(node, [skylight])
    // Native basis: right=(1,0,0), normal=(0,2,1)/sqrt(5), forward=(0,-1,2)/sqrt(5).
    // At shell z=.33 the box's normal coordinate is -.25 and forward coordinate
    // -.67*sqrt(5)/2 + .125 ~= -.6241, inside the yawed half-depth .65.
    // An untilted ±.65 rectangle would incorrectly miss this point's -.67 displacement.
    expectUnmeasured(getRoofSegmentShellSeat(roof, node, [0, 0.33], nodes), 'accessory-cut', [
      skylight.id,
    ])
    expectUnmeasured(getRoofSegmentCoveringSeat(roof, node, [0, 1], nodes), 'accessory-cut', [
      skylight.id,
    ])
    // Even the conservative projected extent ends at z=1 + .65*cos(theta) + sin(theta) < 2.2.
    expectSeat(
      getRoofSegmentShellSeat(roof, node, [0, 2.2], nodes),
      node,
      [0, 2.2],
      2.4,
      slopeNormal,
    )
    expectSeat(
      getRoofSegmentCoveringSeat(roof, node, [0, 2.2], nodes),
      node,
      [0, 2.2],
      2.4 + Math.sqrt(5) / 8,
      slopeNormal,
    )
  })

  test('chimneys do not cut their host roof even when their footprint and cutoutOffset are large', () => {
    const node = segment({ children: ['chimney_noncut'] })
    const chimney = ChimneyNode.parse({
      id: 'chimney_noncut',
      parentId: node.id,
      roofSegmentId: node.id,
      width: 4,
      depth: 4,
      cutoutOffset: 1,
    })
    const { roof, nodes } = scene(node, [chimney])
    for (const read of readers)
      expectSeat(
        read(roof, node, [0, 0], nodes),
        node,
        [0, 0],
        read === getRoofSegmentShellSeat ? 2 : 2.25,
      )
    expect(getRoofSegmentShellSupport(roof, node, box(0, 0), nodes).status).toBe('supported')
  })

  for (const patch of [
    {
      roofType: 'shed',
      pitch: 0,
      shedFootprintPieces: [
        [
          [-2, -2],
          [2, -2],
          [2, 2],
          [-2, 2],
        ],
      ],
    },
    { roofType: 'shed', pitch: 0, arc: { centerX: 0, centerZ: 10, radius: 10 } },
  ]) {
    test(`native direct ${patch.arc ? 'band' : 'stored shed'} dispatch does not receive generic accessory cuts`, () => {
      const node = segment({ ...patch, children: ['dormer_bypassed'] })
      const dormer = DormerNode.parse({
        id: 'dormer_bypassed',
        parentId: node.id,
        roofSegmentId: node.id,
        roofType: 'flat',
        width: 1,
        depth: 1,
        height: 1,
        roofHeight: 0,
        wallSkirtHeight: 1,
        position: [0, 2.1, 0],
      })
      const { roof, nodes } = scene(node, [dormer])
      for (const read of readers)
        expectSeat(
          read(roof, node, [0, 0], nodes),
          node,
          [0, 0],
          read === getRoofSegmentShellSeat ? 2 : 2.25,
        )
      expect(getRoofSegmentShellSupport(roof, node, box(0, 0), nodes).status).toBe('supported')
    })
  }

  test('an untrimmed native conical sector also bypasses generic accessory CSG', () => {
    const node = segment({
      roofType: 'conical',
      width: 6,
      depth: 6,
      conicalStartAngle: 0,
      conicalSweepAngle: Math.PI / 2,
      children: ['dormer_sector'],
    })
    const dormer = DormerNode.parse({
      id: 'dormer_sector',
      parentId: node.id,
      roofSegmentId: node.id,
      roofType: 'flat',
      width: 1,
      depth: 1,
      height: 1,
      roofHeight: 0,
      wallSkirtHeight: 1,
      position: [1, 3, 1],
    })
    const { roof, nodes } = scene(node, [dormer])
    const shellY = 3.5 - Math.sqrt(2) / 2
    expectSeat(getRoofSegmentShellSeat(roof, node, [1, 1], nodes), node, [1, 1], shellY)
    expectSeat(
      getRoofSegmentCoveringSeat(roof, node, [1, 1], nodes),
      node,
      [1, 1],
      shellY + Math.sqrt(5) / 8,
    )
    expect(getRoofSegmentShellSupport(roof, node, box(1, 1), nodes).status).toBe('supported')
  })

  for (const patch of [
    { roofType: 'gable', roofSystem: 'glazed' },
    { roofType: 'barrel', barrelRise: 1, barrelSegments: 4 },
  ]) {
    test(`native independent ${patch.roofType} dispatch still receives its accessory cuts`, () => {
      const node = segment({ ...patch, children: ['dormer_independent'] })
      const dormer = DormerNode.parse({
        id: 'dormer_independent',
        parentId: node.id,
        roofSegmentId: node.id,
        roofType: 'flat',
        width: 1,
        depth: 1,
        height: 1,
        roofHeight: 0,
        wallSkirtHeight: 1,
        position: [1, 3, 1],
      })
      const { roof, nodes } = scene(node, [dormer])
      for (const read of readers)
        expectUnmeasured(read(roof, node, [1, 1], nodes), 'accessory-cut', [dormer.id])
      expectUnmeasured(getRoofSegmentShellSupport(roof, node, box(1, 1), nodes), 'accessory-cut', [
        dormer.id,
      ])
    })
  }

  test('only an immutable prospective scene removing the edited dormer removes its old cut', () => {
    const node = segment({ children: ['dormer_existing'] })
    const dormer = DormerNode.parse({
      id: 'dormer_existing',
      parentId: node.id,
      roofSegmentId: node.id,
      roofType: 'flat',
      width: 1,
      depth: 1,
      height: 1,
      roofHeight: 0,
      wallSkirtHeight: 1,
      position: [0, 2.1, 0],
    })
    const original = freeze(scene(node, [dormer]))
    const before = structuredClone(original)
    for (const read of readers)
      expectUnmeasured(read(original.roof, node, [0, 0], original.nodes), 'accessory-cut', [
        dormer.id,
      ])
    const replacementHost = { ...node, children: [] }
    const prospective = { ...original.nodes, [node.id]: replacementHost }
    delete prospective[dormer.id]
    for (const read of readers)
      expectSeat(
        read(original.roof, replacementHost, [0, 0], freeze(prospective)),
        replacementHost,
        [0, 0],
        read === getRoofSegmentShellSeat ? 2 : 2.25,
      )
    expect(
      getRoofSegmentShellSupport(original.roof, replacementHost, box(0, 0), prospective).status,
    ).toBe('supported')
    // Duplication has not removed the original node/cut and therefore cannot reuse its occupied seat.
    for (const read of readers)
      expectUnmeasured(read(original.roof, node, [0, 0], original.nodes), 'accessory-cut', [
        dormer.id,
      ])
    expect(original).toEqual(before)
  })

  test('unknown registered plugin cutters remain unmeasured without executing render callbacks', () => {
    const restore = nodeRegistry._snapshot()
    try {
      const Cut = BaseNode.extend({ id: objectId('c2cut'), type: nodeType('test:c2-roof-cut') })
      registerNode({
        kind: 'test:c2-roof-cut',
        schemaVersion: 1,
        schema: Cut,
        capabilities: {
          roofAccessory: {
            buildCut: () => {
              throw new Error('Core must not execute a plugin renderer to invent measured coverage')
            },
          },
        },
      } as unknown as AnyNodeDefinition)
      const node = segment({ children: ['c2cut_unknown'] })
      const cut = Cut.parse({ id: 'c2cut_unknown', parentId: node.id }) as unknown as AnyNode
      const { roof, nodes } = scene(node, [cut])
      for (const read of readers)
        expectUnmeasured(read(roof, node, [0, 0], nodes), 'plugin-cut', [cut.id])
      expectUnmeasured(getRoofSegmentShellSupport(roof, node, box(0, 0), nodes), 'plugin-cut', [
        cut.id,
      ])
    } finally {
      restore()
    }
  })

  test('wall-only plugin cutters cannot be mistaken for cuts through the covering or structural roof surface', () => {
    const restore = nodeRegistry._snapshot()
    try {
      const Cut = BaseNode.extend({ id: objectId('c2wallcut'), type: nodeType('test:c2-wall-cut') })
      registerNode({
        kind: 'test:c2-wall-cut',
        schemaVersion: 1,
        schema: Cut,
        capabilities: {
          roofAccessory: {
            cutScope: 'wall',
            buildCut: () => {
              throw new Error('Core must not execute renderer callbacks')
            },
          },
        },
      } as unknown as AnyNodeDefinition)
      const node = segment({ children: ['c2wallcut_one'] })
      const cut = Cut.parse({ id: 'c2wallcut_one', parentId: node.id }) as unknown as AnyNode
      const { roof, nodes } = scene(node, [cut])
      for (const read of readers)
        expectSeat(
          read(roof, node, [0, 0], nodes),
          node,
          [0, 0],
          read === getRoofSegmentShellSeat ? 2 : 2.25,
        )
      expect(getRoofSegmentShellSupport(roof, node, box(0, 0), nodes).status).toBe('supported')
    } finally {
      restore()
    }
  })
})

describe('roof scope and native intersection policy', () => {
  test('a native-dispatched sibling still cuts a valid host when its own parent field is stale', () => {
    const node = segment({ width: 4, depth: 4 })
    const cutter = segment({
      id: 'rseg_stale_cutter',
      parentId: 'roof_stale_origin',
      width: 10,
      depth: 10,
      wallHeight: 5,
    })
    const declaredParent = RoofNode.parse({
      id: 'roof_stale_origin',
      position: [100, 0, 0],
      children: [cutter.id],
    })
    const { roof, nodes } = scene(node, [cutter, declaredParent], {
      children: [node.id, cutter.id],
    })
    const before = structuredClone({ roof, nodes })
    freeze({ roof, nodes })
    // Native collectSiblingRoofEntries follows roof.children, without filtering parentId.
    // Its cutter transform uses the CONTAINING roof, not the stale parent 100 metres away.
    for (const read of readers) {
      expectUnmeasured(read(roof, node, [0, 0], nodes), 'roof-intersection', [cutter.id])
      // Requested hosts remain reciprocal: this does not authorize borrowing the stale sibling.
      expect(read(roof, cutter, [0, 0], nodes)).toEqual({
        status: 'miss',
        reason: 'invalid-host',
      })
    }
    expectUnmeasured(
      getRoofSegmentShellSupport(roof, node, box(0, 0), nodes),
      'roof-intersection',
      [cutter.id],
    )
    expect(getRoofSegmentShellSupport(roof, cutter, box(0, 0), nodes)).toEqual({
      status: 'miss',
      reason: 'invalid-host',
    })
    // The stale higher sibling is a native cutter, never an eligible picked host.
    expectUnmeasured(pickRoofCoveringSeat(roof, [0, 0], nodes), 'roof-intersection', [cutter.id])
    expect({ roof, nodes }).toEqual(before)
  })

  test('native interior expansion follows the relative geometry transform, including translation', () => {
    const node = segment()
    const cutter = segment({
      id: 'rseg_translated_cutter',
      width: 10,
      depth: 10,
      wallThickness: 0.25,
      wallHeight: 5,
      position: [-4.875, 0, 0],
    })
    const { roof, nodes } = scene(node, [cutter])
    freeze({ roof, nodes })
    // Native inner geometry has half-width (10-.25)/2=4.875. It receives the relative
    // transform BEFORE innerBrush.scale=(1+.002/9.75,1,1+.002/9.75). Its right edge
    // is therefore (4.875-4.875)*scale=0, not 4.875*scale-4.875=.001.
    expectSeat(
      getRoofSegmentShellSeat(roof, node, [0.0005, 0], nodes),
      node,
      [0.0005, 0],
      2,
      [0, 1, 0],
    )
    expectUnmeasured(
      getRoofSegmentShellSeat(roof, node, [-0.0005, 0], nodes),
      'roof-intersection',
      [cutter.id],
    )
    const clear: Point[] = [
      [0.0004, -0.1],
      [0.0006, -0.1],
      [0.0006, 0.1],
      [0.0004, 0.1],
    ]
    const result = getRoofSegmentShellSupport(roof, node, clear, nodes)
    expect(result.status).toBe('supported')
    if (result.status !== 'supported') throw new Error(JSON.stringify(result))
    expect(result.value.plane).toEqual([0, 0, 2])
    expect(result.value.normal).toEqual([0, 1, 0])
    const projectedArea = result.value.triangles.reduce(
      (sum, { vertices: [a, b, c] }) =>
        sum + Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])) / 2,
      0,
    )
    expect(projectedArea).toBeCloseTo(0.00004, 8)
    expectUnmeasured(
      getRoofSegmentShellSupport(
        roof,
        node,
        clear.map(([x, z]): Point => [-x, z]),
        nodes,
      ),
      'roof-intersection',
      [cutter.id],
    )
    // The upper covering still overhangs this inner boundary; exposure is a separate guard.
    expectUnmeasured(
      getRoofSegmentCoveringSeat(roof, node, [0.0005, 0], nodes),
      'roof-intersection',
      [cutter.id],
    )
  })

  test('a larger non-shed interior cutter blocks unresolved lower support, but distant roofs do not', () => {
    const node = segment({ width: 4, depth: 4 })
    const upper = segment({
      id: 'rseg_owner',
      roofType: 'gable',
      width: 10,
      depth: 10,
      wallHeight: 5,
    })
    const { roof, nodes } = scene(node, [upper])
    for (const read of readers)
      expectUnmeasured(read(roof, node, [0, 0], nodes), 'roof-intersection', [upper.id])
    expectUnmeasured(
      getRoofSegmentShellSupport(roof, node, box(0, 0), nodes),
      'roof-intersection',
      [upper.id],
    )
    const distant = { ...upper, position: [100, 0, 0] as [number, number, number] }
    const next = scene(node, [distant])
    for (const read of readers)
      expectSeat(
        read(next.roof, node, [0, 0], next.nodes),
        node,
        [0, 0],
        read === getRoofSegmentShellSeat ? 2 : 2.25,
      )
  })

  test('an upper shed hides named lower covering without cutting its structural support', () => {
    const node = segment({ width: 4, depth: 4 })
    const upper = segment({
      id: 'rseg_upper_shed',
      roofType: 'shed',
      pitch: 0,
      width: 10,
      depth: 10,
      wallHeight: 5,
    })
    const { roof, nodes } = scene(node, [upper])
    expectUnmeasured(getRoofSegmentCoveringSeat(roof, node, [0, 0], nodes), 'roof-intersection', [
      upper.id,
    ])
    expectSeat(getRoofSegmentShellSeat(roof, node, [0, 0], nodes), node, [0, 0], 2)
    expect(getRoofSegmentShellSupport(roof, node, box(0, 0), nodes).status).toBe('supported')
  })

  test('overlapping segments on another parent level do not poison this roof', () => {
    const node = segment({ width: 4, depth: 4 })
    const upper = segment({
      id: 'rseg_foreign',
      parentId: 'roof_foreign',
      roofType: 'gable',
      width: 10,
      depth: 10,
      wallHeight: 5,
    })
    const foreign = RoofNode.parse({
      id: 'roof_foreign',
      parentId: 'level_foreign',
      children: [upper.id],
    })
    const ownLevel = LevelNode.parse({ id: 'level_own', children: [rootId] })
    const otherLevel = LevelNode.parse({ id: 'level_foreign', children: [foreign.id] })
    const { roof, nodes } = scene(node, [upper, foreign, ownLevel, otherLevel], {
      parentId: ownLevel.id,
    })
    for (const read of readers)
      expectSeat(
        read(roof, node, [0, 0], nodes),
        node,
        [0, 0],
        read === getRoofSegmentShellSeat ? 2 : 2.25,
      )
    expect(getRoofSegmentShellSupport(roof, node, box(0, 0), nodes).status).toBe('supported')
  })

  test('an owning roof sharing the same parent level can cut across roof-container boundaries', () => {
    const node = segment({ width: 4, depth: 4 })
    const owner = segment({
      id: 'rseg_other_owner',
      parentId: 'roof_other_owner',
      roofType: 'gable',
      width: 10,
      depth: 10,
      wallHeight: 5,
    })
    const other = RoofNode.parse({
      id: 'roof_other_owner',
      parentId: 'level_shared',
      children: [owner.id],
    })
    const level = LevelNode.parse({ id: 'level_shared', children: [rootId, other.id] })
    const { roof, nodes } = scene(node, [owner, other, level], { parentId: level.id })
    for (const read of readers)
      expectUnmeasured(read(roof, node, [0, 0], nodes), 'roof-intersection', [owner.id])
    expectUnmeasured(
      getRoofSegmentShellSupport(roof, node, box(0, 0), nodes),
      'roof-intersection',
      [owner.id],
    )
  })

  test('a smaller non-owning interior does not erase the larger roof structural surface', () => {
    const node = segment()
    const smaller = segment({
      id: 'rseg_nonowner',
      roofType: 'gable',
      width: 4,
      depth: 4,
      wallHeight: 5,
    })
    const { roof, nodes } = scene(node, [smaller])
    expectSeat(getRoofSegmentShellSeat(roof, node, [0, 0], nodes), node, [0, 0], 2)
    expect(getRoofSegmentShellSupport(roof, node, box(0, 0), nodes).status).toBe('supported')
  })
})

describe('covering picking in level plan coordinates', () => {
  test('applies both roof and segment turns/translations but returns segment-local position and normal', () => {
    const node = segment({ position: [2, 3, 4], rotation: Math.PI / 2 })
    const { roof, nodes } = scene(node, [], { position: [10, 7, 20], rotation: Math.PI / 2 })
    const before = structuredClone({ roof, nodes })
    // Local (1,2) -> segment (4,3) -> level (13,16); local height remains 2.25, not 12.25.
    expectSeat(
      pickRoofCoveringSeat(freeze(roof), freeze([13, 16] as Point), freeze(nodes)),
      node,
      [1, 2],
      2.25,
      [0, 1, 0],
    )
    expect({ roof, nodes }).toEqual(before)
  })

  test('orders actual level heights including segment elevation, not local surface heights', () => {
    const lower = segment({ id: 'rseg_lower', roofType: 'shed', pitch: 0, wallHeight: 5 })
    const upper = segment({
      id: 'rseg_upper',
      roofType: 'shed',
      pitch: 0,
      wallHeight: 1,
      position: [0, 10, 0],
    })
    const { roof, nodes } = scene(lower, [upper], { position: [0, 7, 0] })
    expectSeat(pickRoofCoveringSeat(roof, [0, 0], nodes), upper, [0, 0], 1.25, [0, 1, 0])
  })

  test('exact-height ties preserve roof.children order, not node-map insertion order', () => {
    const a = segment({ id: 'rseg_tie_a', roofType: 'shed', pitch: 0 })
    const b = segment({ id: 'rseg_tie_b', roofType: 'shed', pitch: 0 })
    for (const ordered of [
      [a, b],
      [b, a],
    ]) {
      const { roof, nodes } = scene(a, [b], { children: ordered.map((node) => node.id) })
      expectSeat(pickRoofCoveringSeat(roof, [0, 0], nodes), ordered[0]!, [0, 0], 2.25)
    }
  })

  test('unlisted, missing and mistyped entries cannot become picked roof candidates', () => {
    const node = segment({ roofType: 'shed', pitch: 0 })
    const notSegment = LevelNode.parse({
      id: 'level_not_a_segment',
      parentId: rootId,
    })
    const unlisted = segment({
      id: 'rseg_unlisted_pick',
      roofType: 'shed',
      pitch: 0,
      wallHeight: 200,
    })
    const { roof, nodes } = scene(node, [notSegment, unlisted], {
      children: ['rseg_missing_pick', notSegment.id, node.id],
    })
    expectSeat(pickRoofCoveringSeat(roof, [0, 0], nodes), node, [0, 0], 2.25)
  })

  test('a listed stale-parent shed is ineligible for picking but still hides lower covering', () => {
    const node = segment({ roofType: 'shed', pitch: 0 })
    const foreign = segment({
      id: 'rseg_foreign_pick',
      parentId: 'roof_elsewhere',
      roofType: 'shed',
      pitch: 0,
      wallHeight: 100,
    })
    const { roof, nodes } = scene(node, [foreign], { children: [foreign.id, node.id] })
    // Native merged rendering follows listed roof-segment children without a parentId filter.
    // This shed is not an interior cutter, but its actual higher covering still occludes the host.
    expectUnmeasured(pickRoofCoveringSeat(roof, [0, 0], nodes), 'roof-intersection', [foreign.id])
    expect(getRoofSegmentCoveringSeat(roof, foreign, [0, 0], nodes)).toEqual({
      status: 'miss',
      reason: 'invalid-host',
    })
    expectSeat(getRoofSegmentShellSeat(roof, node, [0, 0], nodes), node, [0, 0], 2)
  })

  test('an unresolved higher cut blocks silently picking a lower supported roof', () => {
    const lower = segment({ id: 'rseg_pick_lower', roofType: 'shed', pitch: 0 })
    const upper = segment({
      id: 'rseg_pick_upper',
      roofType: 'shed',
      pitch: 0,
      wallHeight: 5,
      children: ['dormer_pick_cut'],
    })
    const dormer = DormerNode.parse({
      id: 'dormer_pick_cut',
      parentId: upper.id,
      roofSegmentId: upper.id,
      roofType: 'flat',
      width: 1,
      depth: 1,
      height: 1,
      roofHeight: 0,
      wallSkirtHeight: 1,
      position: [0, 5.1, 0],
    })
    const { roof, nodes } = scene(lower, [upper, dormer])
    expectUnmeasured(pickRoofCoveringSeat(roof, [0, 0], nodes), 'accessory-cut', [dormer.id])
    expectSeat(pickRoofCoveringSeat(roof, [2, 0], nodes), upper, [2, 0], 5.25)
  })

  test('a provably lower unresolved cut does not block the measured upper winner', () => {
    const lower = segment({
      id: 'rseg_lower_cut',
      roofType: 'shed',
      pitch: 0,
      children: ['dormer_lower_cut'],
    })
    const upper = segment({ id: 'rseg_upper_clear', roofType: 'shed', pitch: 0, wallHeight: 5 })
    const dormer = DormerNode.parse({
      id: 'dormer_lower_cut',
      parentId: lower.id,
      roofSegmentId: lower.id,
      roofType: 'flat',
      width: 1,
      depth: 1,
      height: 1,
      roofHeight: 0,
      wallSkirtHeight: 1,
      position: [0, 2.1, 0],
    })
    const { roof, nodes } = scene(lower, [upper, dormer])
    expectSeat(pickRoofCoveringSeat(roof, [0, 0], nodes), upper, [0, 0], 5.25)
  })

  test('unmeasured equal-height candidates respect the same child-order precedence as supported ties', () => {
    const cutHost = segment({
      id: 'rseg_tie_cut',
      roofType: 'shed',
      pitch: 0,
      children: ['dormer_tie_cut'],
    })
    const clear = segment({ id: 'rseg_tie_clear', roofType: 'shed', pitch: 0 })
    const dormer = DormerNode.parse({
      id: 'dormer_tie_cut',
      parentId: cutHost.id,
      roofSegmentId: cutHost.id,
      roofType: 'flat',
      width: 1,
      depth: 1,
      height: 1,
      roofHeight: 0,
      wallSkirtHeight: 1,
      position: [0, 2.1, 0],
    })
    const first = scene(cutHost, [clear, dormer])
    expectUnmeasured(pickRoofCoveringSeat(first.roof, [0, 0], first.nodes), 'accessory-cut', [
      dormer.id,
    ])
    const second = scene(cutHost, [clear, dormer], { children: [clear.id, cutHost.id] })
    expectSeat(pickRoofCoveringSeat(second.roof, [0, 0], second.nodes), clear, [0, 0], 2.25)
  })

  test('outside and invalid picker queries do not snap to a roof edge', () => {
    const node = segment()
    const { roof, nodes } = scene(node)
    expect(pickRoofCoveringSeat(roof, [100, 100], nodes)).toEqual({
      status: 'miss',
      reason: 'outside-surface',
    })
    expect(pickRoofCoveringSeat(roof, [Number.NaN, 0], nodes)).toEqual({
      status: 'miss',
      reason: 'invalid-query',
    })
  })
})
