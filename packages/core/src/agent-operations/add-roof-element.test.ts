import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { addRoofElementTool, isAgentRefusal } from '../agent-tools'
import {
  type AnyNode,
  BuildingNode,
  LevelNode,
  RoofGlazing,
  RoofNode,
  RoofSegmentNode,
  SkylightNode,
} from '../schema'
import { type AddRoofElementInput, AGENT_OPERATIONS, addRoofElement } from './index'

const context = { activeLevelId: null }
const kinds = [
  'chimney',
  'skylight',
  'solar-panel',
  'cupola',
  'box-vent',
  'ridge-vent',
  'turbine-vent',
  'eyebrow-vent',
] as const

function fixture(segmentData: Partial<RoofSegmentNode> = {}, roofData: Partial<RoofNode> = {}) {
  const building = BuildingNode.parse({
    id: 'building_b',
    children: ['level_l'],
    position: [100, 8, -200],
    rotation: [0, 0.7, 0],
  })
  const level = LevelNode.parse({ id: 'level_l', parentId: building.id, children: ['roof_r'] })
  const roof = RoofNode.parse({
    id: 'roof_r',
    parentId: level.id,
    children: ['rseg_a'],
    ...roofData,
  })
  const segment = RoofSegmentNode.parse({
    id: 'rseg_a',
    parentId: roof.id,
    roofType: 'flat',
    width: 12,
    depth: 8,
    pitch: 45,
    wallHeight: 2,
    wallThickness: 0,
    deckThickness: 0.25,
    shingleThickness: 0.05,
    overhang: 0,
    gableOverhang: 0,
    children: [],
    ...segmentData,
  })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [building, level, roof, segment].map((node) => [node.id, node]),
  )
  return { nodes, building, level, roof, segment }
}

function run(nodes: Record<string, AnyNode>, input: AddRoofElementInput) {
  const before = structuredClone(nodes)
  const outcome = addRoofElement(nodes, input, context)
  expect(nodes).toEqual(before)
  expect(outcome.changes?.create).toHaveLength(1)
  expect(outcome.changes?.update ?? []).toEqual([])
  expect(outcome.changes?.delete ?? []).toEqual([])
  expect(outcome.afterReconcile).toBeUndefined()
  const entry = outcome.changes!.create![0]!
  expect(entry.node.parentId).toBe(entry.parentId)
  expect(outcome.result).toMatchObject({ ok: true, id: entry.node.id, kind: entry.node.type })
  return { ...outcome, node: entry.node }
}

function refusal(nodes: Record<string, AnyNode>, input: unknown) {
  const before = structuredClone(nodes)
  try {
    addRoofElement(nodes, input as AddRoofElementInput, context)
  } catch (error) {
    expect(nodes).toEqual(before)
    if (isAgentRefusal(error)) return error
    throw error
  }
  throw new Error('Expected a semantic refusal, not a successful or empty write')
}

function input(id: string, point: number[] = [1, 1]): AddRoofElementInput {
  return { kind: 'chimney', id, point }
}

function roofElement(node: AnyNode) {
  if (!('roofSegmentId' in node) || !('position' in node)) throw new Error('Expected roof element')
  return node
}

function addCut(f: ReturnType<typeof fixture>, at: [number, number, number] = [0, 2.3, 0]) {
  const skylight = SkylightNode.parse({
    id: 'skylight_cut',
    parentId: f.segment.id,
    roofSegmentId: f.segment.id,
    position: at,
    width: 1,
    height: 1,
  })
  f.nodes[skylight.id] = skylight
  f.nodes[f.segment.id] = { ...f.segment, children: [skylight.id] }
  return skylight
}

describe('strict native roof element operation', () => {
  test('registers the same operation used by direct callers', () => {
    expect(AGENT_OPERATIONS.add_roof_element).toBe(addRoofElement)
  })

  for (const kind of kinds) {
    test(`${kind} plans one native creation on an explicitly named host`, () => {
      const f = fixture({ roofType: kind === 'ridge-vent' ? 'gable' : 'flat' })
      const outcome = run(f.nodes, { kind, id: f.segment.id, point: [1, 1] })
      const node = roofElement(outcome.node)
      expect(node).toMatchObject({
        parentId: f.segment.id,
        roofSegmentId: f.segment.id,
        type: kind,
      })
      expect(outcome.result).toMatchObject({ roofId: f.roof.id, segmentId: f.segment.id })
      const expected = kind === 'ridge-vent' ? [1, 0, 0] : [1, 2.3, 1]
      ;(node.position as number[]).forEach((value, i) => {
        expect(value).toBeCloseTo(expected[i]!, 9)
      })
      expect(outcome.result.localPosition).toEqual(expected)
      expect(outcome.result.planPoint).toEqual(kind === 'ridge-vent' ? [1, 0] : [1, 1])
    })
  }

  test('uses level-plan coordinates, both nested yaw transforms and full-precision covering height', () => {
    const f = fixture(
      { roofType: 'gable', position: [2, 4, 1], rotation: -Math.PI / 2 },
      { position: [7, 3, -5], rotation: Math.PI / 2 },
    )
    // Ry(+pi/2) * ( [2,4,1] + Ry(-pi/2)*[1.125,y,1] ) + [7,3,-5]
    // has level-plan [9.125,-6]. Building translation/yaw is deliberately irrelevant.
    const outcome = run(f.nodes, {
      kind: 'solar-panel',
      id: f.segment.id,
      point: [9.125, -6],
      rows: 1,
      columns: 20,
      name: 'Array',
    })
    const node = roofElement(outcome.node)
    // Native 45-degree covering: wall 2 + rise 4 - z 1 + normal layer thickness .30/cos(45).
    const y = 5 + 0.3 * Math.SQRT2
    expect(node).toMatchObject({ rows: 1, columns: 20, name: 'Array' })
    const position = node.position as number[]
    expect(position[0]).toBeCloseTo(1.125, 9)
    expect(position[1]).toBeCloseTo(y, 9)
    expect(position[2]).toBeCloseTo(1, 9)
    expect(position[1]).not.toBe(Math.round(y * 1000) / 1000)
    expect(outcome.result.localPosition).toEqual([1.125, Math.round(y * 1000) / 1000, 1])
    expect(outcome.result.planPoint).toEqual([9.125, -6])
  })

  test('reports the transformed achieved ridge position, not the original cursor point', () => {
    const f = fixture(
      { roofType: 'gable', position: [2, 4, 1], rotation: -Math.PI / 2 },
      { position: [7, 3, -5], rotation: Math.PI / 2 },
    )
    const result = run(f.nodes, { kind: 'ridge-vent', id: f.roof.id, point: [9.125, -6] })
    const position = roofElement(result.node).position as number[]
    position.forEach((value, i) => {
      expect(value).toBeCloseTo([1.125, 0, 0][i]!, 9)
    })
    expect(result.result.planPoint).toEqual([9.125, -7])
    expect(result.result.localPosition).toEqual([1.125, 0, 0])
  })

  test('a configured odd-facet barrel uses the physical crown chord, not an ideal circular apex', () => {
    const f = fixture({ roofType: 'barrel', barrelRise: 2, barrelSegments: 7 })
    const outcome = run(f.nodes, input(f.segment.id, [0, 0]))
    // Span 8, rise 2: circle radius (4²+2²)/(2*2)=5, half-angle=2*atan(1/2).
    // Seven bays put the crown inside the middle chord, not at an authored apex vertex.
    const expectedY = 2 + 2 - 5 + 5 * Math.cos((2 * Math.atan(0.5)) / 7)
    expect((roofElement(outcome.node).position as number[])[1]).toBeCloseTo(expectedY, 9)
    expect(expectedY).toBeLessThan(4)
  })

  test('roof targeting chooses the highest supported owner; a named segment never borrows another', () => {
    const f = fixture()
    const upper = RoofSegmentNode.parse({
      ...f.segment,
      id: 'rseg_upper',
      width: 8,
      position: [0, 3, 0],
    })
    f.nodes[upper.id] = upper
    f.nodes[f.roof.id] = { ...f.roof, children: [f.segment.id, upper.id] }
    expect(run(f.nodes, input(f.roof.id)).result.segmentId).toBe(upper.id)
    // Naming a host does not waive the existing strict covering-exposure guard.
    const hidden = refusal(f.nodes, input(f.segment.id))
    expect(hidden.code).toBe('roof_surface_unmeasured')
    expect(hidden.details).toEqual({
      id: f.segment.id,
      reason: 'roof-intersection',
      nodeIds: [upper.id],
    })
    // Outside the narrower upper roof, the same named lower host is exposed.
    expect(run(f.nodes, input(f.segment.id, [5, 1])).result.segmentId).toBe(f.segment.id)
    const narrow = { ...f.segment, width: 2 }
    f.nodes[f.segment.id] = narrow
    expect(refusal(f.nodes, input(f.segment.id, [3, 1])).code).toBe('roof_point_outside_segment')
    expect(run(f.nodes, input(f.roof.id, [3, 1])).result.segmentId).toBe(upper.id)
  })

  test('an exact-height tie follows roof child order, not object insertion order', () => {
    const f = fixture()
    const second = RoofSegmentNode.parse({ ...f.segment, id: 'rseg_second' })
    f.nodes[second.id] = second
    f.nodes[f.roof.id] = { ...f.roof, children: [second.id, f.segment.id] }
    expect(run(f.nodes, input(f.roof.id)).result.segmentId).toBe(second.id)
    const reordered = Object.fromEntries(Object.entries(f.nodes).reverse())
    expect(run(reordered, input(f.roof.id)).result.segmentId).toBe(second.id)
  })

  test('edge and diagonal trims refuse actual missing covering rather than a nearest face', () => {
    const edge = fixture({ trim: { ...RoofSegmentNode.parse({}).trim, right: 2 } })
    expect(refusal(edge.nodes, input(edge.segment.id, [5, 1])).code).toBe(
      'roof_point_outside_segment',
    )
    expect(run(edge.nodes, input(edge.segment.id, [3, 1])).result.ok).toBe(true)
    const corner = fixture({
      trim: { ...RoofSegmentNode.parse({}).trim, frontRightX: 1, frontRightZ: 1 },
    })
    expect(refusal(corner.nodes, input(corner.segment.id, [5.8, 3.8])).code).toBe(
      'roof_point_outside_segment',
    )
    expect(run(corner.nodes, input(corner.segment.id, [5.2, 3.2])).result.ok).toBe(true)
  })

  test('an empty glazed bay refuses while its real perimeter frame remains support', () => {
    const f = fixture({
      roofType: 'gable',
      roofSystem: 'glazed',
      glazing: RoofGlazing.parse({
        across: { layout: 'count', count: 1 },
        along: { layout: 'count', count: 1 },
        panelType: 'empty',
        glazedEnds: false,
      }),
    })
    const missing = refusal(f.nodes, input(f.segment.id, [0, 1]))
    expect(missing.code).toBe('roof_point_outside_segment')
    expect(missing.details).toMatchObject({ reason: 'outside-surface', point: [0, 1] })
    const frame = run(f.nodes, input(f.segment.id, [-5.99, 1]))
    expect((roofElement(frame.node).position as number[])[1]).toBeCloseTo(5, 8)
  })

  test('an unknown upper accessory cut never silently selects the lower roof seat', () => {
    const f = fixture({ position: [0, 3, 0] })
    const cut = addCut(f)
    const lower = RoofSegmentNode.parse({
      ...f.segment,
      id: 'rseg_lower',
      position: [0, 0, 0],
      children: [],
    })
    f.nodes[lower.id] = lower
    f.nodes[f.roof.id] = { ...f.roof, children: [lower.id, f.segment.id] }
    const error = refusal(f.nodes, input(f.roof.id, [0, 0]))
    expect(error.code).toBe('roof_surface_unmeasured')
    expect(error.details).toEqual({ id: f.roof.id, reason: 'accessory-cut', nodeIds: [cut.id] })
    expect(run(f.nodes, input(f.roof.id, [3, 1])).result.segmentId).toBe(f.segment.id)
  })

  test('rechecks support at the achieved ridge snap rather than only at the valid cursor seat', () => {
    const f = fixture({ roofType: 'gable' })
    const cut = addCut(f, [0, 6, 0])
    expect(run(f.nodes, input(f.segment.id, [0, 2])).result.ok).toBe(true)
    const error = refusal(f.nodes, { kind: 'ridge-vent', id: f.segment.id, point: [0, 2] })
    expect(error.code).toBe('roof_surface_unmeasured')
    expect(error.details).toEqual({ id: f.segment.id, reason: 'accessory-cut', nodeIds: [cut.id] })
  })

  test('a nominal shed high-edge snap outside its authored piece reports the achieved missing point', () => {
    const f = fixture({
      roofType: 'shed',
      width: 8,
      depth: 6,
      managedByParent: false,
      shedFootprintPieces: [
        [
          [-4, -1],
          [4, -1],
          [4, 3],
          [-4, 3],
        ],
      ],
    })
    // The physical stored rectangle starts at z=-1. Native shed snapping still
    // targets the nominal high eave z=-depth/2=-3; the cursor z=1 is supported.
    expect(run(f.nodes, input(f.segment.id, [0.5, 1])).result.ok).toBe(true)
    const error = refusal(f.nodes, { kind: 'ridge-vent', id: f.segment.id, point: [0.5, 1] })
    expect(error.code).toBe('roof_point_outside_segment')
    expect(error.details).toEqual({
      id: f.segment.id,
      segmentId: f.segment.id,
      point: [0.5, -3],
      reason: 'outside-surface',
    })
  })

  test('a named lower covering does not pretend a higher sibling shed is absent', () => {
    const f = fixture()
    const upperRoof = RoofNode.parse({
      id: 'roof_upper',
      parentId: f.level.id,
      position: [0, 1, 0],
      children: ['rseg_shed'],
    })
    const upper = RoofSegmentNode.parse({
      ...f.segment,
      id: 'rseg_shed',
      parentId: upperRoof.id,
      roofType: 'shed',
      width: 4,
      depth: 4,
    })
    f.nodes[upperRoof.id] = upperRoof
    f.nodes[upper.id] = upper
    f.nodes[f.level.id] = { ...f.level, children: [f.roof.id, upperRoof.id] }
    const error = refusal(f.nodes, input(f.segment.id, [0, 1]))
    expect(error.code).toBe('roof_surface_unmeasured')
    expect(error.details).toEqual({
      id: f.segment.id,
      reason: 'roof-intersection',
      nodeIds: [upper.id],
    })
    expect(run(f.nodes, input(f.segment.id, [4, 1])).result.segmentId).toBe(f.segment.id)
  })

  for (const roofType of ['flat', 'conical'] as const) {
    test(`${roofType} refuses a ridge vent without inventing a line`, () => {
      const f = fixture({ roofType })
      const error = refusal(f.nodes, { kind: 'ridge-vent', id: f.segment.id, point: [1, 1] })
      expect(error.code).toBe('roof_no_ridge_line')
      expect(error.details).toEqual({ segmentId: f.segment.id })
    })
  }
})

describe('strict ownership and runtime validation', () => {
  test('non-horizontal building frames refuse rather than misinterpreting plan coordinates', () => {
    const f = fixture()
    f.nodes[f.building.id] = { ...f.building, rotation: [0.2, 0.7, 0] }
    expect(refusal(f.nodes, input(f.segment.id)).code).toBe('roof_transform_unsupported')
  })

  test('requires reciprocal roof membership and an actual owning level', () => {
    for (const fault of ['unlisted', 'wrong-parent', 'missing-roof', 'missing-level'] as const) {
      const f = fixture()
      if (fault === 'unlisted') f.nodes[f.roof.id] = { ...f.roof, children: [] }
      if (fault === 'wrong-parent')
        f.nodes[f.segment.id] = { ...f.segment, parentId: 'roof_foreign' }
      if (fault === 'missing-roof') delete f.nodes[f.roof.id]
      if (fault === 'missing-level') delete f.nodes[f.level.id]
      expect(refusal(f.nodes, input(f.segment.id)).code).toBe(
        fault === 'missing-level' ? 'roof_level_missing' : 'roof_parent_missing',
      )
    }
  })

  test('does not borrow a foreign segment merely listed under a different roof', () => {
    const f = fixture()
    const foreignRoof = RoofNode.parse({
      id: 'roof_foreign',
      parentId: f.level.id,
      children: [f.segment.id],
    })
    f.nodes[foreignRoof.id] = foreignRoof
    f.nodes[f.segment.id] = { ...f.segment, parentId: foreignRoof.id }
    const error = refusal(f.nodes, input(f.roof.id))
    expect(error.code).toBe('roof_parent_missing')
  })

  test('distinguishes absent and wrong-kind targets', () => {
    const f = fixture()
    expect(refusal(f.nodes, input('rseg_missing')).code).toBe('node_not_found')
    expect(refusal(f.nodes, input(f.level.id)).code).toBe('roof_target_invalid')
    expect(refusal(f.nodes, input('')).code).toBe('roof_target_invalid')
  })

  for (const point of [
    [],
    [1],
    [1, 2, 3],
    [Number.NaN, 1],
    [1, Number.POSITIVE_INFINITY],
    ['1', 1],
  ]) {
    test(`direct finite two-dimensional point validation: ${String(point)}`, () => {
      const f = fixture()
      expect(refusal(f.nodes, { ...input(f.segment.id), point }).code).toBe('roof_point_invalid')
      expect(
        z.object(addRoofElementTool.input).safeParse({ ...input(f.segment.id), point }).success,
      ).toBe(false)
    })
  }

  for (const invalid of [
    { kind: 'dormer' },
    { name: '' },
    { name: 12 },
    { rows: 0 },
    { rows: 21 },
    { rows: 1.5 },
    { rows: Number.NaN },
    { columns: 0 },
    { columns: 21 },
    { columns: 1.5 },
    { columns: '2' },
  ]) {
    test(`validates known options even for non-solar calls: ${JSON.stringify(invalid)}`, () => {
      const f = fixture()
      const value = { ...input(f.segment.id), ...invalid }
      expect(refusal(f.nodes, value).code).toBe('roof_element_options_invalid')
      expect(z.object(addRoofElementTool.input).safeParse(value).success).toBe(false)
    })
  }
})
