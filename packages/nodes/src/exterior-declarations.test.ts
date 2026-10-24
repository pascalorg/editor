import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  DoorNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '@pascal-app/core'
import { builtinPlugin } from './index'

// What the built-in kinds declare for hosts that follow a change from outside (`capabilities.exterior`)
// and for the construction reveal's room-by-room layout (`capabilities.revealLayout`). Hosts read the
// registry and name no kind, so what these kinds say is all they know.

let restore: () => void = () => {}
beforeAll(() => {
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
  for (const definition of builtinPlugin.nodes ?? []) registerNode(definition)
})
afterAll(() => restore())

const capabilitiesOf = (kind: string) => nodeRegistry.get(kind)?.capabilities
const exteriorOf = (kind: string, node: AnyNode, nodes: Record<string, AnyNode> = {}) => {
  const exterior = capabilitiesOf(kind)?.exterior
  return typeof exterior === 'function' ? exterior(node, nodes) : exterior
}

describe('what is seen from outside', () => {
  test.each([
    'roof',
    'roof-segment',
    'dormer',
    'skylight',
    'chimney',
    'cupola',
    'solar-panel',
    'gutter',
    'downspout',
    'eyebrow-vent',
    'ridge-vent',
    'turbine-vent',
    'box-vent',
    'lean-to-extension',
    'fence',
    'fence-gate',
    'fence-opening',
    'site',
  ])('%s always stands outdoors', (kind) => {
    expect(capabilitiesOf(kind)?.exterior).toBe(true)
  })

  test.each(['level', 'building', 'zone'])(
    '%s never does, and holds what is looked at through a cutaway',
    (kind) => {
      expect(capabilitiesOf(kind)?.exterior).toBe(false)
    },
  )

  test.each(['item', 'slab', 'ceiling', 'stair', 'column', 'unit'])(
    '%s says nothing: what holds it decides',
    (kind) => {
      expect(capabilitiesOf(kind)?.exterior).toBeUndefined()
    },
  )

  test('a wall is outdoors with an exterior face, on either side', () => {
    const wall = (frontSide: string, backSide: string) =>
      WallNode.parse({ start: [0, 0], end: [4, 0], frontSide, backSide })
    expect(exteriorOf('wall', wall('interior', 'exterior'))).toBe(true)
    expect(exteriorOf('wall', wall('exterior', 'interior'))).toBe(true)
    expect(exteriorOf('wall', wall('interior', 'interior'))).toBe(false)
    expect(exteriorOf('wall', wall('unknown', 'unknown'))).toBe(false)
  })

  test('a door or a window is outdoors in a roof segment or in a wall with an exterior face', () => {
    const outer = WallNode.parse({
      id: 'wall_out',
      start: [0, 0],
      end: [4, 0],
      frontSide: 'interior',
      backSide: 'exterior',
    })
    const inner = WallNode.parse({
      id: 'wall_in',
      start: [0, 3],
      end: [4, 3],
      frontSide: 'interior',
      backSide: 'interior',
    })
    const nodes = { [outer.id]: outer, [inner.id]: inner } as Record<string, AnyNode>
    for (const [kind, schema] of [
      ['door', DoorNode],
      ['window', WindowNode],
    ] as const) {
      const on = (wall: typeof outer) => schema.parse({ parentId: wall.id, wallId: wall.id })
      expect(exteriorOf(kind, on(outer), nodes)).toBe(true)
      expect(exteriorOf(kind, on(inner), nodes)).toBe(false)
      expect(exteriorOf(kind, schema.parse({ roofSegmentId: 'rseg_x' }), nodes)).toBe(true)
      expect(exteriorOf(kind, schema.parse({ parentId: 'wall_gone' }), nodes)).toBe(false)
    }
  })
})

describe('what lays a floor out room by room', () => {
  test('only the zone outlines a room and only the wall stands on a line', () => {
    const declaring = (builtinPlugin.nodes ?? [])
      .filter((definition) => definition.capabilities?.revealLayout)
      .map((definition) => definition.kind)
      .sort()
    expect(declaring).toEqual(['wall', 'zone'])
  })

  test("a zone's room is its polygon, a wall's line its two ends", () => {
    const level = LevelNode.parse({ id: 'level_x', level: 0 })
    const polygon: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 3],
    ]
    const zone = ZoneNode.parse({ parentId: level.id, name: 'Room', polygon })
    const wall = WallNode.parse({ parentId: level.id, start: [1, 2], end: [5, 2] })
    expect(capabilitiesOf('zone')?.revealLayout?.room?.(zone)).toEqual(polygon)
    expect(capabilitiesOf('zone')?.revealLayout?.room?.(wall)).toBeNull()
    expect(capabilitiesOf('wall')?.revealLayout?.line?.(wall)).toEqual([
      [1, 2],
      [5, 2],
    ])
    expect(capabilitiesOf('wall')?.revealLayout?.line?.(zone)).toBeNull()
  })
})
