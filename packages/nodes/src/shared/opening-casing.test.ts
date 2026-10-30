import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  DoorNode,
  type FloorplanGeometry,
  type GeometryContext,
  LevelNode,
  OPENING_CASING_PROUD,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { doorDefinition } from '../door/definition'
import { buildDoorFloorplan } from '../door/floorplan'
import { placedDoorFields } from '../door/placement'
import { windowDefinition } from '../window/definition'
import { buildWindowFloorplan } from '../window/floorplan'
import { placedWindowFields } from '../window/placement'
import { openingCasingFaceLabels } from './opening-casing'

const INCH = 0.0254
const CASING = 2 * INCH
const wall = WallNode.parse({ id: 'wall_casing-plan', start: [0, 0], end: [4, 0], thickness: 0.2 })
const context = { children: [], parent: wall, resolve: () => undefined, siblings: [] }

/**
 * The casing legs a plan draws, as along / across spans: the polygons of its nested group of
 * polygons (the opening's mark is a group too, of a line, a tag and its text).
 */
function casingLegs(geometry: FloorplanGeometry | null) {
  const children = geometry?.kind === 'group' ? geometry.children : []
  const casing = children.find(
    (child) => child.kind === 'group' && child.children.every((leg) => leg.kind === 'polygon'),
  )
  const legs = casing?.kind === 'group' ? casing.children : []
  return legs.flatMap((leg) => {
    if (leg.kind !== 'polygon') return []
    const xs = leg.points.map((point) => point[0])
    const zs = leg.points.map((point) => point[1])
    return [
      { along: [Math.min(...xs), Math.max(...xs)], across: [Math.min(...zs), Math.max(...zs)] },
    ]
  })
}

const windowPlan = (values: Partial<WindowNode> = {}) =>
  buildWindowFloorplan(
    WindowNode.parse({
      id: 'window_casing-plan',
      parentId: wall.id,
      wallId: wall.id,
      position: [2, 1.2, 0],
      width: 1.2,
      height: 1,
      casingFaceA: true,
      casingFaceB: true,
      ...values,
    }),
    context as GeometryContext,
  )

const doorPlan = (values: Partial<DoorNode> = {}) =>
  buildDoorFloorplan(
    DoorNode.parse({
      id: 'door_casing-plan',
      parentId: wall.id,
      wallId: wall.id,
      position: [2, 1.05, 0],
      width: 0.9,
      casingFaceA: true,
      casingFaceB: true,
      ...values,
    }),
    context as GeometryContext,
  )

describe('opening casing in plan', () => {
  test('a window shows its legs beside the cutout, standing proud of both faces', () => {
    const legs = casingLegs(windowPlan())
    expect(legs).toHaveLength(4)
    for (const leg of legs) {
      const besideStart = Math.abs(leg.along[1]! - 1.4) < 1e-9
      const besideEnd = Math.abs(leg.along[0]! - 2.6) < 1e-9
      expect(besideStart || besideEnd).toBe(true)
      expect(leg.along[1]! - leg.along[0]!).toBeCloseTo(CASING, 9)
      const onA = Math.abs(leg.across[0]! - 0.1) < 1e-9
      const onB = Math.abs(leg.across[1]! + 0.1) < 1e-9
      expect(onA || onB).toBe(true)
      expect(leg.across[1]! - leg.across[0]!).toBeCloseTo(OPENING_CASING_PROUD, 9)
    }
  })

  test('a door shows its legs too, and a face turned off shows none', () => {
    expect(casingLegs(doorPlan())).toHaveLength(4)
    const legs = casingLegs(doorPlan({ casingFaceA: false }))
    expect(legs).toHaveLength(2)
    for (const leg of legs) expect(leg.across[1]).toBeCloseTo(-0.1, 9)
    expect(casingLegs(doorPlan({ casingFaceA: false, casingFaceB: false }))).toHaveLength(0)
  })

  test('a wider casing draws wider legs', () => {
    for (const leg of casingLegs(windowPlan({ casingWidth: 3.5 * INCH })))
      expect(leg.along[1]! - leg.along[0]!).toBeCloseTo(3.5 * INCH, 9)
  })
})

describe('opening casing face names', () => {
  const grid: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ]
  const level = LevelNode.parse({ id: 'level_casing' })
  const walls = grid.map((start, i) =>
    WallNode.parse({
      id: `wall_casing${i}`,
      parentId: level.id,
      thickness: 0.2,
      start,
      end: grid[(i + 1) % 4]!,
    }),
  )
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, ...walls].map((node) => [node.id, node]),
  )

  test('an outside wall names its faces Exterior and Interior', () => {
    // Drawn anticlockwise, the room is on each wall's face a.
    expect(openingCasingFaceLabels(nodes, { parentId: walls[0]!.id })).toEqual({
      a: 'Interior',
      b: 'Exterior',
    })
  })

  test('a gable end is outside on face a; a lone wall keeps Side A and Side B', () => {
    expect(openingCasingFaceLabels(nodes, { parentId: 'rseg_x', roofSegmentId: 'rseg_x' })).toEqual(
      { a: 'Exterior', b: 'Interior' },
    )
    expect(openingCasingFaceLabels({ [wall.id]: wall }, { parentId: wall.id })).toEqual({
      a: 'Side A',
      b: 'Side B',
    })
  })
})

test('tools and preset defaults create cased openings while legacy openings stay uncased', () => {
  for (const [schema, fields, definition] of [
    [DoorNode, placedDoorFields(), doorDefinition],
    [WindowNode, placedWindowFields(), windowDefinition],
  ] as const) {
    const placed = schema.parse(fields)
    expect(placed.casingFaceA).toBe(true)
    expect(placed.casingFaceB).toBe(true)
    const preset = definition.defaults?.()
    expect(preset?.casingFaceA).toBe(true)
    expect(preset?.casingFaceB).toBe(true)
    const legacy = schema.parse({})
    const geometry =
      legacy.type === 'door'
        ? buildDoorFloorplan(legacy, context as GeometryContext)
        : buildWindowFloorplan(legacy, context as GeometryContext)
    expect(casingLegs(geometry)).toEqual([])
  }
})
