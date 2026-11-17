import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { addDormerTool, isAgentRefusal } from '../agent-tools'
import {
  type AnyNode,
  BuildingNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SkylightNode,
  SlabNode,
  ZoneNode,
} from '../schema'
import { withIdAllocator } from '../schema/base'
import { type AddDormerInput, AGENT_OPERATIONS, addDormer } from './index'

function fixture() {
  const building = BuildingNode.parse({
    id: 'building_b',
    position: [100, 9, -200],
    rotation: [0, 0.3, 0],
    children: ['level_l'],
  })
  const level = LevelNode.parse({ id: 'level_l', parentId: building.id, children: ['roof_r'] })
  const roof = RoofNode.parse({ id: 'roof_r', parentId: level.id, children: ['rseg_s'] })
  const segment = RoofSegmentNode.parse({
    id: 'rseg_s',
    parentId: roof.id,
    roofType: 'gable',
    width: 12,
    depth: 8,
    pitch: 45,
    wallHeight: 2,
    wallThickness: 0,
    deckThickness: 0.1,
    shingleThickness: 0.05,
    overhang: 0,
    gableOverhang: 0,
    children: [],
  })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [building, level, roof, segment].map((node) => [node.id, node]),
  )
  return { nodes, building, level, roof, segment }
}

function run(f: ReturnType<typeof fixture>, input: AddDormerInput) {
  const before = structuredClone(f.nodes)
  const outcome = addDormer(f.nodes, input, { activeLevelId: null })
  expect(f.nodes).toEqual(before)
  expect(outcome.changes?.create).toHaveLength(2)
  expect(outcome.changes?.update ?? []).toEqual([])
  expect(outcome.changes?.delete ?? []).toEqual([])
  const dormerEntry = outcome.changes!.create!.find((entry) => entry.node.type === 'dormer')
  const windowEntry = outcome.changes!.create!.find((entry) => entry.node.type === 'window')
  if (dormerEntry?.node.type !== 'dormer' || windowEntry?.node.type !== 'window')
    throw new Error('An operation must atomically plan one dormer and its real native window')
  const dormer = dormerEntry.node,
    window = windowEntry.node
  expect(dormerEntry.parentId).toBe(dormer.roofSegmentId)
  expect(dormer.parentId).toBe(dormer.roofSegmentId)
  expect(windowEntry.parentId).toBe(dormer.id)
  expect(window).toMatchObject({ parentId: dormer.id, dormerId: dormer.id })
  expect(dormer.children).toEqual([window.id])
  expect(outcome.result).toMatchObject({
    dormerId: dormer.id,
    windowId: window.id,
    segmentId: dormer.parentId,
  })
  return { ...outcome, dormer, window }
}

function refusal(f: ReturnType<typeof fixture>, input: AddDormerInput) {
  const before = structuredClone(f.nodes)
  try {
    addDormer(f.nodes, input, { activeLevelId: null })
  } catch (error) {
    expect(f.nodes).toEqual(before)
    if (isAgentRefusal(error)) return error
    throw error
  }
  throw new Error('Expected an atomic semantic refusal')
}

describe('selective add_dormer operation', () => {
  test('registers the shared operation and uses native segment-default placement', () => {
    const f = fixture()
    expect(AGENT_OPERATIONS.add_dormer).toBe(addDormer)
    const outcome = run(f, { segmentId: f.segment.id })
    // Segment-local default is [0,depth/4]=[0,2]. Bare shell h=2+4-z=4,
    // neither deck-top nor covering-top lift belongs to native dormer seating.
    outcome.dormer.position.forEach((value, i) => {
      expect(value).toBeCloseTo([0, 4, 2][i]!, 9)
    })
    expect(outcome.result).toMatchObject({
      roofId: f.roof.id,
      segmentId: f.segment.id,
      atticRoomId: null,
      windowSillAboveAtticFloorM: null,
    })
    expect(outcome.result).not.toHaveProperty('seat')
  })

  test('plan coordinates and returned footprint use both roof/segment transforms, not world', () => {
    const f = fixture()
    f.nodes[f.roof.id] = { ...f.roof, position: [7, 3, -5], rotation: Math.PI / 2 }
    f.nodes[f.segment.id] = { ...f.segment, position: [2, 4, 1], rotation: -Math.PI / 2 }
    const result = run(f, {
      segmentId: f.segment.id,
      at: [8, -5],
      width: 1.2,
      depth: 2,
      wallHeight: 0.6,
      roofType: 'gable',
    })
    result.dormer.position.forEach((value, i) => {
      expect(value).toBeCloseTo([0, 4, 2][i]!, 9)
    })
    expect(result.dormer).toMatchObject({ width: 1.2, depth: 2, height: 0.6, roofType: 'gable' })
    const footprint = result.result.footprint as [number, number][]
    expect(footprint).toHaveLength(4)
    for (const [x, z] of [
      [7.4, -6],
      [8.6, -6],
      [8.6, -4],
      [7.4, -4],
    ])
      expect(footprint.some(([a, b]) => Math.abs(a - x!) < 1e-8 && Math.abs(b - z!) < 1e-8)).toBe(
        true,
      )
  })

  test('roof-wide selection keeps the actual highest supported segment', () => {
    const f = fixture()
    const upper = RoofSegmentNode.parse({ ...f.segment, id: 'rseg_upper', position: [0, 3, 0] })
    f.nodes[upper.id] = upper
    f.nodes[f.roof.id] = { ...f.roof, children: [f.segment.id, upper.id] }
    expect(run(f, { roofId: f.roof.id, at: [0, 2] }).dormer.parentId).toBe(upper.id)
  })

  test('an equal-height roof tie follows child order rather than record insertion order', () => {
    const f = fixture()
    // Coincident gables have native interior cutters and are not guaranteed
    // supported ties. Sheds share this plane without cutting each other's shell.
    f.nodes[f.segment.id] = { ...f.segment, roofType: 'shed' }
    const second = RoofSegmentNode.parse({ ...f.segment, id: 'rseg_second', roofType: 'shed' })
    f.nodes[second.id] = second
    f.nodes[f.roof.id] = { ...f.roof, children: [second.id, f.segment.id] }
    expect(run(f, { roofId: f.roof.id, at: [0, 2] }).dormer.parentId).toBe(second.id)
    f.nodes = Object.fromEntries(Object.entries(f.nodes).reverse())
    expect(run(f, { roofId: f.roof.id, at: [0, 2] }).dormer.parentId).toBe(second.id)
  })

  test('an unknown seat refuses rather than selecting a lower candidate or nominal slope', () => {
    const f = fixture()
    const cut = SkylightNode.parse({
      id: 'skylight_cut',
      parentId: f.segment.id,
      roofSegmentId: f.segment.id,
      position: [0, 4, 2],
    })
    f.nodes[cut.id] = cut
    f.nodes[f.segment.id] = { ...f.segment, children: [cut.id] }
    const error = refusal(f, { segmentId: f.segment.id, at: [0, 2] })
    expect(error.code).toBe('dormer_geometry_unmeasured')
    expect(error.details).toMatchObject({ reason: 'accessory-cut' })
    expect(error.details.nodeIds).toContain(cut.id)
    const lower = RoofSegmentNode.parse({
      ...f.segment,
      id: 'rseg_lower',
      position: [0, -3, 0],
      children: [],
    })
    f.nodes[lower.id] = lower
    f.nodes[f.roof.id] = { ...f.roof, children: [lower.id, f.segment.id] }
    const roofError = refusal(f, { roofId: f.roof.id, at: [0, 2] })
    expect(roofError.code).toBe('dormer_geometry_unmeasured')
    expect(roofError.details.nodeIds).toContain(cut.id)
  })

  test('missing/ambiguous host requests refuse without constructing partial children', () => {
    const f = fixture()
    expect(refusal(f, {}).code).toBe('roof_host_required')
    expect(refusal(f, { roofId: f.roof.id }).code).toBe('position_required')
    expect(refusal(f, { segmentId: 'rseg_missing' }).code).toBe('invalid_roof_host')
    expect(refusal(f, { segmentId: f.segment.id, roofId: 'roof_wrong' }).code).toBe(
      'invalid_roof_host',
    )
    expect(refusal(f, { segmentId: f.level.id }).code).toBe('invalid_roof_host')
    expect(run(f, { segmentId: f.segment.id, roofId: f.roof.id }).dormer.parentId).toBe(
      f.segment.id,
    )
  })

  test('flat hosts and true ridge crossings return planning refusals with structured diagnostics', () => {
    const f = fixture()
    const ridge = refusal(f, { segmentId: f.segment.id, at: [0, 0.2], depth: 2 })
    expect(ridge.code).toBe('too_wide')
    expect(ridge.details).toMatchObject({ reason: 'architectural-break' })
    f.nodes[f.segment.id] = { ...f.segment, roofType: 'flat' }
    const flat = refusal(f, { segmentId: f.segment.id })
    expect(flat.code).toBe('not_on_slope')
    expect(flat.details).toMatchObject({ reason: 'insufficient-slope' })
  })

  test('a ten-metre window cannot publish a native pair or consume IDs outside its own wall', () => {
    const f = fixture()
    const allocated: string[] = []
    const error = withIdAllocator(
      (prefix) => {
        allocated.push(prefix)
        return `${prefix}_unexpected`
      },
      () => refusal(f, { segmentId: f.segment.id, windowHeight: 10 }),
    )
    expect(error.code).toBe('window_does_not_fit')
    expect(error.details).toMatchObject({ reason: 'window-fit' })
    expect(allocated).toEqual([])
  })

  test('selective tool schema exposes conical own roof but no freeform/code/seat or rotation control', () => {
    const schema = z.object(addDormerTool.input)
    for (const roofType of [
      'hip',
      'gable',
      'shed',
      'gambrel',
      'dutch',
      'mansard',
      'flat',
      'conical',
    ]) {
      expect(schema.safeParse({ segmentId: 'rseg_s', roofType, width: 1.2 }).success).toBe(true)
    }
    for (const roofType of ['freeform', 'swept', 'barrel'])
      expect(schema.safeParse({ segmentId: 'rseg_s', roofType }).success).toBe(false)
    for (const key of ['rotation', 'seat', 'nodeId', 'code', 'freeform'])
      expect(key in addDormerTool.input).toBe(false)
    for (const invalid of [
      { width: 0 },
      { depth: -1 },
      { wallHeight: -1 },
      { roofHeight: -1 },
      { windowHeight: 0 },
      { at: [1] },
      { at: [1, 2, 3] },
    ])
      expect(schema.safeParse({ segmentId: 'rseg_s', ...invalid }).success).toBe(false)
  })

  for (const mode of ['known-floor', 'no-floor', 'floor-hole', 'no-room', 'non-attic'] as const) {
    test(`attic facts use the actual window and slab top: ${mode}`, () => {
      const f = fixture()
      f.nodes[f.roof.id] = { ...f.roof, position: [7, 3, -5], rotation: Math.PI / 2 }
      f.nodes[f.segment.id] = { ...f.segment, position: [2, 4, 1], rotation: -Math.PI / 2 }
      const polygon: [number, number][] = [
        [6, -7],
        [10, -7],
        [10, -3],
        [6, -3],
      ]
      const room = ZoneNode.parse({
        id: 'zone_attic',
        parentId: f.level.id,
        name: 'Attic room',
        spaceRole: 'room',
        polygon,
      })
      const slab = SlabNode.parse({
        id: 'slab_floor',
        parentId: f.level.id,
        polygon,
        elevation: 0.713,
        thickness: 0.2,
        // The actual default child has u=.02. This hole contains [8.02,-4.225]
        // but deliberately does NOT contain the nominal front-centre x=8.
        holes:
          mode === 'floor-hole'
            ? [
                [
                  [8.015, -4.3],
                  [8.025, -4.3],
                  [8.025, -4.15],
                  [8.015, -4.15],
                ],
              ]
            : [],
      })
      const children: string[] = [f.roof.id]
      if (mode !== 'no-room') {
        f.nodes[room.id] = room
        children.push(room.id)
      }
      if (mode !== 'no-floor') {
        f.nodes[slab.id] = slab
        children.push(slab.id)
      }
      f.nodes[f.level.id] = LevelNode.parse({
        ...f.level,
        children,
        metadata: mode === 'non-attic' ? {} : { attic: true },
      })
      const outcome = run(f, { segmentId: f.segment.id, at: [8, -5] })
      expect(outcome.result.atticRoomId).toBe(
        mode === 'no-room' || mode === 'non-attic' ? null : room.id,
      )
      // Full precision: roof3 + segment4 + bare shell4 - skirt/2(1.365)
      // + window offset .99 - half-height .34 - slab TOP .713 = 9.572m.
      // Avoid a half-cent rounding tie; slab underside .513 is not the datum.
      expect(outcome.result.windowSillAboveAtticFloorM).toBe(
        ['no-floor', 'floor-hole', 'non-attic'].includes(mode) ? null : 9.57,
      )
    })
  }
})
