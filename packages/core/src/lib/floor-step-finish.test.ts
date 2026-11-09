import { afterEach, describe, expect, test } from 'bun:test'
import { setZoneIntent } from '../commands/structure/set-zone-intent'
import { type AnyNode, type AnyNodeId, BuildingNode, SeparatorNode, type ZoneNode } from '../schema'
import useScene, { clearSceneHistory } from '../store/use-scene'
import { doorwayStepsFixture } from '../systems/slab/__fixtures__/doorway-steps'
import { reconcileStructureWithStableIds } from '../utils/structure-id'
import {
  floorStepRole,
  floorStepRoleCovers,
  parseFloorStepRole,
  remapFloorStepOverrideKeys,
  resolveFloorStepFinish,
  withFloorStepOverride,
  withoutFloorStepOverrideKeys,
} from './floor-step-finish'
import { computePlateSurfacePartition, floorStepKeysOf, plateLevelContext } from './plate-surface'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const RED = 'library:preset-red'
const BLUE = 'library:preset-blue'
const zonesOf = (nodes: Record<string, AnyNode>) =>
  Object.values(nodes).filter((node): node is ZoneNode => node.type === 'zone')
const zone = (nodes: Record<string, AnyNode>, id: string) => nodes[id] as ZoneNode
const finishOf = (nodes: Record<string, AnyNode>, owner: string, key: string) =>
  resolveFloorStepFinish(zone(nodes, owner), key, null, zonesOf(nodes))
const withZone = (nodes: Record<string, AnyNode>, id: string, data: Partial<ZoneNode>) => ({
  ...nodes,
  [id]: { ...nodes[id], ...data } as AnyNode,
})
/** Re-derive the floors after a floor edit, keeping the room's paint. */
const relevel = (nodes: Record<string, AnyNode>, id: string, elevation: number) =>
  reconcileStructureWithStableIds({
    nodes: withZone(nodes, id, { floor: { ...zone(nodes, id).floor, elevation } }),
  }).nodes as Record<string, AnyNode>

describe('step roles', () => {
  test('round-trip and coverage', () => {
    expect(floorStepRole('zone_b')).toBe('step:zone_b')
    expect(floorStepRole('zone_b', 'door_ab')).toBe('step:zone_b/door_ab')
    expect(parseFloorStepRole('step:zone_b/door_ab#2')).toEqual({
      zoneId: 'zone_b',
      key: 'door_ab',
      step: 2,
    })
    expect(parseFloorStepRole('edge:zone_b')).toBeNull()
    expect(floorStepRoleCovers('step:zone_b', 'step:zone_b/door_ab')).toBe(true)
    expect(floorStepRoleCovers('step:zone_b/door_ab', 'step:zone_b/door_ab#1')).toBe(true)
    expect(floorStepRoleCovers('step:zone_b/door_ab', 'step:zone_b/door_bc')).toBe(false)
    expect(floorStepRoleCovers('step:zone_b', 'step:zone_a/door_ab')).toBe(false)
  })
})

describe('override bookkeeping', () => {
  const owner = {
    id: 'zone_b',
    parentId: 'level_row',
    floorStepOverrides: [
      { key: 'door_ab', finish: RED },
      { key: 'zone_old', finish: BLUE },
      { key: 'zone_new', step: 0, finish: RED },
    ],
  }
  test('a deleted key goes, the rest stay', () => {
    expect(withoutFloorStepOverrideKeys(owner, new Set(['door_ab']))?.floorStepOverrides).toEqual(
      owner.floorStepOverrides.slice(1),
    )
    expect(withoutFloorStepOverrideKeys(owner, new Set(['door_zz']))).toBeNull()
  })
  test('a retired room key is renamed to its survivor; the room never keys itself', () => {
    expect(
      remapFloorStepOverrideKeys(owner, new Map([['zone_old', 'zone_new']]))?.floorStepOverrides,
    ).toEqual([
      { key: 'door_ab', finish: RED },
      { key: 'zone_new', finish: BLUE },
      { key: 'zone_new', step: 0, finish: RED },
    ])
    expect(
      remapFloorStepOverrideKeys(owner, new Map([['zone_old', 'zone_b']]))?.floorStepOverrides,
    ).toEqual([owner.floorStepOverrides[0], owner.floorStepOverrides[2]])
  })
})

describe('step keys', () => {
  test('a raised room owns one keyed step per door, every riser piece included', () => {
    const nodes = doorwayStepsFixture()
    expect(floorStepKeysOf(nodes, 'level_row', 'zone_b')).toEqual(['door_ab', 'door_bc'])
    expect(floorStepKeysOf(nodes, 'level_row', 'zone_a')).toEqual([])
    const context = plateLevelContext(nodes.level_row!, (id) => nodes[id])
    for (const plate of context.slabs) {
      const sides = computePlateSurfacePartition(plate, context)?.sides ?? []
      for (const side of sides.filter((side) => side.role === 'riser' && side.zoneId))
        expect(['door_ab', 'door_bc']).toContain(side.stepKey!)
    }
  })

  test('a step with no door is keyed by the lower room it looks at', () => {
    const nodes = doorwayStepsFixture(undefined, true)
    expect(floorStepKeysOf(nodes, 'level_row', 'zone_b')).toEqual(['door_ab', 'zone_c'])
  })
})

describe('what a step draws', () => {
  test('its doorway override, else the room steps, else the room floor', () => {
    let nodes = doorwayStepsFixture()
    nodes = withZone(nodes, 'zone_b', {
      floor: { ...zone(nodes, 'zone_b').floor, finish: 'library:oak' },
    })
    expect(finishOf(nodes, 'zone_b', 'door_ab')).toBe('library:oak')
    nodes = withZone(nodes, 'zone_b', { floorStepFinish: BLUE })
    nodes = withZone(nodes, 'zone_b', { floorStepOverrides: [{ key: 'door_bc', finish: RED }] })
    expect(finishOf(nodes, 'zone_b', 'door_bc')).toBe(RED)
    expect(finishOf(nodes, 'zone_b', 'door_ab')).toBe(BLUE)
    // An exact step index beats the whole doorway.
    nodes = withZone(nodes, 'zone_b', {
      floorStepOverrides: [
        { key: 'door_bc', finish: RED },
        { key: 'door_bc', step: 1, finish: BLUE },
      ],
    })
    expect(resolveFloorStepFinish(zone(nodes, 'zone_b'), 'door_bc', 1, zonesOf(nodes))).toBe(BLUE)
    expect(resolveFloorStepFinish(zone(nodes, 'zone_b'), 'door_bc', 0, zonesOf(nodes))).toBe(RED)
  })

  test('a painted door step keeps its colour when the room across rises above', () => {
    let nodes = doorwayStepsFixture()
    nodes = withZone(nodes, 'zone_b', { floorStepOverrides: [{ key: 'door_bc', finish: RED }] })
    nodes = relevel(nodes, 'zone_c', 0.5)
    // C now owns the step at door_bc; the paint is read through from B.
    expect(floorStepKeysOf(nodes, 'level_row', 'zone_c')).toEqual(['door_bc'])
    expect(finishOf(nodes, 'zone_c', 'door_bc')).toBe(RED)
    // The step at door_ab is still B's and unpainted.
    expect(finishOf(nodes, 'zone_b', 'door_ab')).toBeUndefined()
  })

  test('a painted open step keeps its colour when the room across rises above', () => {
    let nodes = doorwayStepsFixture(undefined, true)
    nodes = withZone(nodes, 'zone_b', { floorStepOverrides: [{ key: 'zone_c', finish: RED }] })
    nodes = relevel(nodes, 'zone_c', 0.5)
    expect(floorStepKeysOf(nodes, 'level_row', 'zone_c')).toEqual(['zone_b'])
    expect(finishOf(nodes, 'zone_c', 'zone_b')).toBe(RED)
  })

  test('painting or erasing a swapped step moves or clears the one doorway colour', () => {
    let nodes = doorwayStepsFixture()
    nodes = withZone(nodes, 'zone_b', {
      floorStepOverrides: [
        { key: 'door_bc', finish: RED },
        { key: 'door_ab', finish: RED },
      ],
    })
    const zones = zonesOf(nodes)
    const painted = withFloorStepOverride(zone(nodes, 'zone_c'), 'door_bc', null, BLUE, zones)
    expect(Object.fromEntries(painted.map((z) => [z.id, z.floorStepOverrides]))).toEqual({
      zone_b: [{ key: 'door_ab', finish: RED }],
      zone_c: [{ key: 'door_bc', finish: BLUE }],
    })
    const erased = withFloorStepOverride(zone(nodes, 'zone_c'), 'door_bc', null, undefined, zones)
    expect(erased.map((z) => [z.id, z.floorStepOverrides])).toEqual([
      ['zone_b', [{ key: 'door_ab', finish: RED }]],
    ])
  })
})

describe('edits never repaint another doorway', () => {
  function load(nodes: Record<string, AnyNode>) {
    const building = BuildingNode.parse({ id: 'building_row', children: ['level_row'] })
    useScene.setState({
      nodes: {
        ...nodes,
        building_row: building,
        level_row: { ...nodes.level_row!, parentId: building.id } as AnyNode,
      } as Record<AnyNodeId, AnyNode>,
      rootNodeIds: [building.id as AnyNodeId],
      collections: {},
      materials: {},
      dirtyNodes: new Set(),
      readOnly: false,
    })
    useScene.temporal.getState().resume()
    clearSceneHistory()
  }
  const now = () => useScene.getState().nodes as Record<string, AnyNode>
  afterEach(() => {
    useScene.setState({ nodes: {}, rootNodeIds: [], dirtyNodes: new Set() })
    clearSceneHistory()
  })

  test('deleting a door drops only its own step paint, and undo brings it back', () => {
    const painted = [
      { key: 'door_ab', finish: RED },
      { key: 'door_bc', finish: BLUE },
    ]
    load(withZone(doorwayStepsFixture(), 'zone_b', { floorStepOverrides: painted }))
    useScene.getState().deleteNode('door_ab' as AnyNodeId)
    expect(zone(now(), 'zone_b').floorStepOverrides).toEqual([{ key: 'door_bc', finish: BLUE }])
    expect(finishOf(now(), 'zone_b', 'door_bc')).toBe(BLUE)
    useScene.temporal.getState().undo()
    expect(now().door_ab).toBeDefined()
    expect(zone(now(), 'zone_b').floorStepOverrides).toEqual(painted)
    useScene.temporal.getState().redo()
    expect(zone(now(), 'zone_b').floorStepOverrides).toEqual([{ key: 'door_bc', finish: BLUE }])
  })

  test('moving a door keeps its step paint', () => {
    load(
      withZone(doorwayStepsFixture(), 'zone_b', {
        floorStepOverrides: [{ key: 'door_bc', finish: RED }],
      }),
    )
    useScene.getState().updateNode('door_bc' as AnyNodeId, { position: [2.6, 1, 0] })
    expect(zone(now(), 'zone_b').floorStepOverrides).toEqual([{ key: 'door_bc', finish: RED }])
    const moved = reconcileStructureWithStableIds({ nodes: now() }).nodes as Record<string, AnyNode>
    expect(floorStepKeysOf(moved, 'level_row', 'zone_b')).toContain('door_bc')
    expect(finishOf(moved, 'zone_b', 'door_bc')).toBe(RED)
  })

  test('merging two rooms carries the retired room’s doorway paint and keys', () => {
    let nodes = doorwayStepsFixture([0.3, 0.3, 0.05], true)
    nodes = withZone(nodes, 'zone_b', { floorStepOverrides: [{ key: 'zone_c', finish: RED }] })
    nodes = withZone(nodes, 'zone_c', { floorStepOverrides: [{ key: 'zone_b', finish: RED }] })
    // Take the wall between A and B away: the rooms become one.
    const { wall_row_ab: _wall, door_ab: _door, ...rest } = nodes
    const level = rest.level_row as AnyNode & { children: string[] }
    nodes = reconcileStructureWithStableIds({
      nodes: {
        ...rest,
        level_row: {
          ...level,
          children: level.children.filter((id) => id !== 'wall_row_ab'),
        } as AnyNode,
      },
    }).nodes as Record<string, AnyNode>
    const rooms = zonesOf(nodes).filter((z) => z.id !== 'zone_c')
    expect(rooms).toHaveLength(1)
    const survivor = rooms[0]!
    // The survivor owns the open step toward C and keeps the colour painted there.
    expect(floorStepKeysOf(nodes, 'level_row', survivor.id)).toEqual(['zone_c'])
    expect(finishOf(nodes, survivor.id, 'zone_c')).toBe(RED)
    // C's dormant paint for the retired room now names the survivor.
    expect(zone(nodes, 'zone_c').floorStepOverrides).toEqual([{ key: survivor.id, finish: RED }])
  })

  test('dividing a room gives both halves its doorway paint', () => {
    let nodes = doorwayStepsFixture()
    nodes = withZone(nodes, 'zone_b', { floorStepOverrides: [{ key: 'door_bc', finish: RED }] })
    const separator = SeparatorNode.parse({
      id: 'separator_split',
      parentId: 'level_row',
      start: [4, 1],
      end: [8, 1],
    })
    const level = nodes.level_row as AnyNode & { children: string[] }
    nodes = reconcileStructureWithStableIds({
      nodes: {
        ...nodes,
        [separator.id]: separator,
        level_row: { ...level, children: [...level.children, separator.id] } as AnyNode,
      },
    }).nodes as Record<string, AnyNode>
    const halves = zonesOf(nodes).filter((z) => z.id !== 'zone_a' && z.id !== 'zone_c')
    expect(halves).toHaveLength(2)
    for (const half of halves)
      expect(half.floorStepOverrides).toEqual([{ key: 'door_bc', finish: RED }])
    const owner = halves.find((half) =>
      floorStepKeysOf(nodes, 'level_row', half.id).includes('door_bc'),
    )!
    expect(finishOf(nodes, owner.id, 'door_bc')).toBe(RED)
  })
})

test('room intent sets and clears the doorway step paint', () => {
  const nodes = doorwayStepsFixture()
  const painted = [{ key: 'door_bc', finish: RED }]
  expect(
    setZoneIntent(nodes, { zoneId: 'zone_b', patch: { floorStepOverrides: painted } }).changes,
  ).toEqual([{ op: 'update', id: 'zone_b', data: { floorStepOverrides: painted } }])
  expect(
    setZoneIntent(withZone(nodes, 'zone_b', { floorStepOverrides: painted }), {
      zoneId: 'zone_b',
      patch: { floorStepOverrides: null },
    }).changes,
  ).toEqual([{ op: 'update', id: 'zone_b', data: { floorStepOverrides: undefined } }])
})
