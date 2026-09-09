import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { nodeRegistry } from '../registry'
import {
  type AnyNode,
  CeilingNode,
  DoorNode,
  ItemNode,
  LevelNode,
  SlabNode,
  WallNode,
  WindowNode,
} from '../schema'
import { getHistoryDirtyNodeIds } from './history-invalidation'
import useScene, { clearSceneHistory } from './use-scene'

const level = LevelNode.parse({ id: 'level_history' })
const wall = WallNode.parse({ id: 'wall_changed', parentId: level.id, start: [0, 0], end: [4, 0] })
const remote = WallNode.parse({
  id: 'wall_remote',
  parentId: level.id,
  start: [20, 0],
  end: [24, 0],
})
const nodes = (...entries: AnyNode[]) => Object.fromEntries(entries.map((node) => [node.id, node]))
const ids = (before: Record<string, AnyNode>, after: Record<string, AnyNode>) =>
  [...getHistoryDirtyNodeIds(before, after)].sort()
const asset = { id: 'test', name: 'test', category: 'test', thumbnail: '', src: '/test.glb' }

describe('history dependency closure', () => {
  test.each([
    'corner',
    'tee',
    'reverse tee',
    'curve',
  ])('wall body move disconnects and restores a %s in both directions, only on its level', (junction) => {
    const changed = junction === 'curve' ? { ...wall, curveOffset: 1 } : wall
    const adjacent = WallNode.parse({
      id: 'wall_adjacent',
      parentId: level.id,
      start:
        junction === 'corner'
          ? [4, 0]
          : junction === 'tee'
            ? [2, 0]
            : junction === 'curve'
              ? [4, 0]
              : [4, -2],
      end: junction === 'reverse tee' ? [4, 2] : [2, -3],
    })
    const otherLevel = { ...adjacent, id: 'wall_other_level', parentId: 'level_other' } as WallNode
    const before = nodes(level, changed, adjacent, remote, otherLevel)
    const after = {
      ...before,
      [changed.id]: { ...changed, start: [8, 8], end: [12, 8] } as WallNode,
    }
    expect(ids(before, after)).toEqual([level.id, adjacent.id, changed.id].sort())
    expect(ids(after, before)).toEqual(ids(before, after))
  })

  test('endpoint move includes former and new neighbours without following a junction transitively', () => {
    const old = WallNode.parse({ id: 'wall_old', parentId: level.id, start: [4, 0], end: [4, 4] })
    const next = WallNode.parse({ id: 'wall_next', parentId: level.id, start: [6, 0], end: [6, 4] })
    const beyond = WallNode.parse({
      id: 'wall_beyond',
      parentId: level.id,
      start: [6, 4],
      end: [8, 4],
    })
    const before = nodes(level, wall, old, next, beyond, remote)
    const after = { ...before, [wall.id]: { ...wall, end: [6, 0] } as WallNode }
    expect(ids(before, after)).toEqual([level.id, wall.id, old.id, next.id].sort())
  })

  test.each([
    { thickness: 0.4 },
    { height: 4 },
    { curveOffset: 0.8 },
  ])('host shape change %j includes opening proxies and wall-side items', (patch) => {
    const door = DoorNode.parse({ parentId: wall.id })
    const window = WindowNode.parse({ parentId: wall.id })
    const item = ItemNode.parse({ parentId: wall.id, asset: { ...asset, attachTo: 'wall-side' } })
    const other = DoorNode.parse({ parentId: remote.id })
    const before = nodes(level, wall, remote, door, window, item, other)
    const after = { ...before, [wall.id]: { ...wall, ...patch } }
    expect(ids(before, after)).toEqual([level.id, wall.id, door.id, window.id, item.id].sort())
    expect(ids(after, before)).toEqual(ids(before, after))
  })

  test.each([
    DoorNode,
    WindowNode,
  ])('opening add/remove/move/resize/reparent marks surviving hosts', (schema) => {
    const opening = schema.parse({ parentId: wall.id })
    const before = nodes(level, wall, remote, opening)
    for (const patch of [{ position: [1, 1, 0] }, { width: 2 }, { parentId: remote.id }]) {
      const after = { ...before, [opening.id]: { ...opening, ...patch } as AnyNode }
      expect(ids(before, after)).toEqual(
        [opening.id, wall.id, ...('parentId' in patch ? [remote.id] : [])].sort(),
      )
    }
    const absent = nodes(level, wall, remote)
    expect(ids(absent, before)).toEqual([opening.id, wall.id].sort())
    expect(ids(before, absent)).toEqual([wall.id])
  })

  test.each([
    'floor',
    'wall host',
    'elevated slab',
  ])('item move on %s marks the item and parent, preserving its asset', (support) => {
    const item = ItemNode.parse({
      parentId: support === 'wall host' ? wall.id : level.id,
      supportSlabId: support === 'elevated slab' ? 'slab_deck' : undefined,
      asset,
    })
    const before = nodes(level, wall, remote, item)
    const moved = { ...item, position: [3, 0, 2], rotation: [0, 1, 0] } as AnyNode
    const after = { ...before, [item.id]: moved }
    expect(ids(before, after)).toEqual([item.id, item.parentId!].sort())
    expect((moved as ItemNode).asset).toBe(item.asset)
  })

  test.each([
    SlabNode,
    CeilingNode,
  ])('surface polygon/holes/elevation marks the surface; subscribers own support dependencies', (schema) => {
    const surface = schema.parse({
      parentId: level.id,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    })
    const before = nodes(level, wall, remote, surface)
    for (const patch of [
      {
        polygon: [
          [0, 0],
          [8, 0],
          [8, 4],
          [0, 4],
        ],
      },
      schema === SlabNode ? { elevation: 1 } : { height: 4 },
      {
        holes: [
          [
            [1, 1],
            [2, 1],
            [2, 2],
          ],
        ],
      },
    ]) {
      expect(ids(before, { ...before, [surface.id]: { ...surface, ...patch } as AnyNode })).toEqual(
        [surface.id, level.id].sort(),
      )
    }
  })

  test('level height leaves descendant invalidation to the spatial subscription', () => {
    const before = nodes(level, wall, remote)
    expect(ids(before, { ...before, [level.id]: { ...level, height: 4 } })).toEqual([level.id])
  })

  test('subtree delete/restore filters missing ids and preserves the deletion sibling rule', () => {
    const door = DoorNode.parse({ parentId: wall.id })
    const full = nodes(
      { ...level, children: [wall.id, remote.id] },
      { ...wall, children: [door.id] },
      remote,
      door,
    )
    const removed = nodes({ ...level, children: [remote.id] }, remote)
    expect(ids(full, removed)).toEqual([level.id, remote.id].sort())
    expect(ids(removed, full)).toEqual([level.id, wall.id, door.id].sort())
    expect(ids(full, full)).toEqual([])
  })
  test('wall reparent includes neighbours on the old and new levels', () => {
    const upper = LevelNode.parse({ id: 'level_upper_history' })
    const old = WallNode.parse({
      id: 'wall_old_level',
      parentId: level.id,
      start: [4, 0],
      end: [4, 4],
    })
    const next = { ...old, id: 'wall_new_level', parentId: upper.id } as WallNode
    const before = nodes(level, upper, wall, old, next, remote)
    const after = { ...before, [wall.id]: { ...wall, parentId: upper.id } }
    expect(ids(before, after)).toEqual([level.id, upper.id, wall.id, old.id, next.id].sort())
  })

  test('thickness rebuilds a joined corner and T junction without dirtying a disconnected wall', () => {
    const corner = WallNode.parse({
      id: 'wall_corner',
      parentId: level.id,
      start: [4, 0],
      end: [4, 4],
    })
    const tee = WallNode.parse({ id: 'wall_tee', parentId: level.id, start: [2, 0], end: [2, -4] })
    const before = nodes(level, wall, corner, tee, remote)
    expect(ids(before, { ...before, [wall.id]: { ...wall, thickness: 0.5 } })).toEqual(
      [level.id, wall.id, corner.id, tee.id].sort(),
    )
  })

  test('same-count subtree replacement restores original identities and excludes deleted ids', () => {
    const door = DoorNode.parse({ parentId: wall.id })
    const replacement = DoorNode.parse({ parentId: remote.id })
    const before = nodes(level, { ...wall, children: [door.id] }, remote, door)
    const after = nodes(
      level,
      { ...wall, children: [] },
      { ...remote, children: [replacement.id] },
      replacement,
    )
    const dirty = getHistoryDirtyNodeIds(after, before)
    expect(dirty.has(door.id)).toBe(true)
    expect(dirty.has(replacement.id)).toBe(false)
    expect(dirty.has(wall.id)).toBe(true)
    expect(dirty.has(remote.id)).toBe(true)
  })
})

describe('consecutive temporal wall moves', () => {
  let restore = () => {}

  beforeEach(() => {
    restore = nodeRegistry._snapshot()
    nodeRegistry._reset()
    clearSceneHistory()
  })

  afterEach(() => {
    clearSceneHistory()
    restore()
  })

  test('three undos and redos mark exactly the neighbours in each pre/post-jump layout', async () => {
    const neighbours = [0, 10, 20, 30].map((x, index) =>
      WallNode.parse({
        id: `wall_neighbour_${index}`,
        parentId: level.id,
        start: [x + 4, 0],
        end: [x + 4, 4],
      }),
    )
    const layouts = [0, 10, 20, 30].map(
      (x) =>
        ({
          ...wall,
          start: [x, 0],
          end: [x + 4, 0],
        }) as WallNode,
    )
    const unrelated = { ...remote, start: [100, 0], end: [104, 0] } as WallNode
    useScene.setState({
      nodes: nodes(level, layouts[0]!, ...neighbours, unrelated),
      rootNodeIds: [level.id],
      collections: {},
      installedPlugins: [],
      dirtyNodes: new Set(),
      readOnly: false,
    })
    clearSceneHistory()
    for (const moved of layouts.slice(1)) {
      useScene.setState({ nodes: { ...useScene.getState().nodes, [wall.id]: moved } })
    }
    expect(useScene.temporal.getState().pastStates).toHaveLength(3)

    for (const direction of ['undo', 'redo'] as const) {
      for (const beforeIndex of direction === 'undo' ? [3, 2, 1] : [0, 1, 2]) {
        const afterIndex = beforeIndex + (direction === 'undo' ? -1 : 1)
        useScene.getState().dirtyNodes.clear()
        useScene.temporal.getState()[direction]()
        await Promise.resolve()
        expect(useScene.getState().nodes[wall.id]).toBe(layouts[afterIndex])
        expect([...useScene.getState().dirtyNodes].sort()).toEqual(
          [level.id, wall.id, neighbours[beforeIndex]!.id, neighbours[afterIndex]!.id].sort(),
        )
      }
    }
  })
})
