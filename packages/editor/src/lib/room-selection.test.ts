import { afterEach, describe, expect, jest, spyOn, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  type AnyNode,
  BuildingNode,
  CeilingNode,
  createRoomTopologyIndex,
  emitter,
  getWallCurveFrameAt,
  ItemNode,
  LevelNode,
  type NodeEvent,
  reconcileLevelStructure,
  SlabNode,
  SpawnNode,
  StairNode,
  sceneRegistry,
  useScene,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { migrateCeilingRoomLinks, migrateRoomZones } from '@pascal-app/core/scene-migrations'
import { useViewer } from '@pascal-app/viewer'
import { _roots, act } from '@react-three/fiber'
import { createElement } from 'react'
import { Group, type LineSegments } from 'three'
import { SelectionManager } from '../components/editor/selection-manager'
import { cancelActiveTool, runHistoryShortcut } from '../hooks/use-keyboard'
import { resolvePlanRoomHit, roomPickingEnabled, useSelectedRoom } from '../hooks/use-selected-room'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import useSessionGroups from '../store/use-session-groups'
import { withSelectionHarness } from '../test-utils/selection-harness'
import { startRoomDivide } from './room-divide-session'
import { runRoomHandleDrag } from './room-handle-drag'
import {
  type RoomKey,
  RoomSelectionIndex,
  resolveRoomHit,
  shouldSelectRoom,
} from './room-selection'
import { selectRoom, selectRoomFromHit, shouldInterceptRoom } from './room-selection-commands'

const levelId = 'level_room_selection'
const buildingId = 'building_room_selection'
const plain = { alt: false, shift: false, ctrl: false, meta: false }
function wall(id: string, start: [number, number], end: [number, number], extra = {}) {
  return WallNode.parse({
    id: `wall_${id}`,
    parentId: levelId,
    start,
    end,
    thickness: 0.2,
    ...extra,
  })
}
function fixture(
  extra: AnyNode[] = [],
  walls = [
    wall('south', [0, 0], [8, 0]),
    wall('east', [8, 0], [8, 4]),
    wall('north', [8, 4], [0, 4]),
    wall('west', [0, 4], [0, 0]),
    wall('shared', [4, 0], [4, 4]),
  ],
) {
  const rawNodes = Object.fromEntries(
    [
      BuildingNode.parse({ id: buildingId, children: [levelId] }),
      LevelNode.parse({
        id: levelId,
        parentId: buildingId,
        children: [...walls, ...extra].map((node) => node.id),
      }),
      ...walls,
      ...extra,
    ].map((node) => [node.id, node]),
  )
  const nodes = migrateCeilingRoomLinks(migrateRoomZones(rawNodes).nodes).nodes as Record<
    string,
    AnyNode
  >
  const index = createRoomTopologyIndex()
  index.rebuild(nodes)
  return { nodes, index, shared: walls[4]!, south: walls[0]! }
}

afterEach(() => {
  jest.useRealTimers()
  useEditor.getState().clearRoom()
  useInteractionScope.getState().end()
})

describe('room hit resolution', () => {
  test('shared wall faces and 2D cursor sides resolve different rooms', () => {
    const { index, shared } = fixture()
    const left = index.roomAtPoint(levelId, [2, 2])!
    const right = index.roomAtPoint(levelId, [6, 2])!
    expect(left.id).not.toBe(right.id)
    for (const view of ['2d', '3d'] as const) {
      expect(resolveRoomHit(index, levelId, shared, [3.9, 2], view)?.id).toBe(left.id)
      expect(resolveRoomHit(index, levelId, shared, [4.1, 2], view)?.id).toBe(right.id)
    }
  })
  test('slabs, ceilings and floor points resolve rooms', () => {
    const { index, south } = fixture()
    const polygon: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ]
    const slab = SlabNode.parse({ polygon, parentId: levelId })
    const ceiling = CeilingNode.parse({ polygon, parentId: levelId })
    for (const node of [null, slab, ceiling]) {
      expect(resolveRoomHit(index, levelId, node, [2, 2])?.id).toBe(
        index.roomAtPoint(levelId, [2, 2])!.id,
      )
      expect(resolveRoomHit(index, levelId, node, [12, 2])).toBeNull()
    }
  })
  test('a wall bounding one room resolves that room from either face', () => {
    const { index, nodes } = fixture()
    const cache = new RoomSelectionIndex(levelId)
    cache.update(nodes)
    const west = nodes.wall_west as WallNode
    const east = nodes.wall_east as WallNode
    const left = index.roomAtPoint(levelId, [2, 2])!
    const right = index.roomAtPoint(levelId, [6, 2])!
    for (const view of ['2d', '3d'] as const) {
      for (const x of [-0.1, 0.1]) {
        expect(resolveRoomHit(index, levelId, west, [x, 2], view)?.id).toBe(left.id)
        expect(resolveRoomHit(cache, levelId, west, [x, 2], view)?.id).toBe(left.id)
        expect(resolveRoomHit(index, levelId, east, [8 + x, 2], view)?.id).toBe(right.id)
      }
    }
  })
  test('exterior faces of a wall spanning two rooms resolve the room behind the hit', () => {
    const { index, south } = fixture()
    for (const view of ['2d', '3d'] as const) {
      expect(resolveRoomHit(index, levelId, south, [2, -0.1], view)?.id).toBe(
        index.roomAtPoint(levelId, [2, 2])!.id,
      )
      expect(resolveRoomHit(index, levelId, south, [6, -0.1], view)?.id).toBe(
        index.roomAtPoint(levelId, [6, 2])!.id,
      )
    }
  })
  test("a wall's only room resolves past the stretch it bounds", () => {
    const long = wall('long', [0, 0], [8, 0])
    const { index, nodes } = fixture(
      [],
      [
        long,
        wall('right', [4, 0], [4, 3]),
        wall('top', [4, 3], [0, 3]),
        wall('left', [0, 3], [0, 0]),
      ],
    )
    const cache = new RoomSelectionIndex(levelId)
    cache.update(nodes)
    const room = index.roomAtPoint(levelId, [2, 1])!
    for (const view of ['2d', '3d'] as const) {
      for (const z of [-0.1, 0.1]) {
        expect(resolveRoomHit(index, levelId, long, [6, z], view)?.id).toBe(room.id)
        expect(resolveRoomHit(cache, levelId, long, [6, z], view)?.id).toBe(room.id)
      }
    }
  })
  test('T-junction splits host spans and both T-stem faces', () => {
    const stem = wall('stem', [4, 2], [8, 2])
    const { index, shared } = fixture([stem])
    const lower = index.roomAtPoint(levelId, [6, 1])!
    const upper = index.roomAtPoint(levelId, [6, 3])!
    expect(resolveRoomHit(index, levelId, shared, [4.1, 1])?.id).toBe(lower.id)
    expect(resolveRoomHit(index, levelId, shared, [4.1, 3])?.id).toBe(upper.id)
    expect(resolveRoomHit(index, levelId, stem, [6, 1.9])?.id).toBe(lower.id)
    expect(resolveRoomHit(index, levelId, stem, [6, 2.1])?.id).toBe(upper.id)
  })
  test('dangling stems and free walls fall through', () => {
    const stem = wall('stem', [2, 0], [2, 1])
    const free = wall('free', [10, 0], [10, 3])
    const { index } = fixture([stem, free])
    for (const view of ['2d', '3d'] as const) {
      for (const x of [1.9, 2.1]) {
        expect(resolveRoomHit(index, levelId, stem, [x, 0.5], view)).toBeNull()
        expect(resolveRoomHit(index, levelId, free, [x + 8, 1], view)).toBeNull()
      }
    }
  })
  test('justified 3D faces use the body frame; 2D uses the reference side', () => {
    const { index, nodes, shared } = fixture()
    const justified = { ...shared, justification: 'a' as const }
    index.rebuild({ ...nodes, [shared.id]: justified })
    expect(resolveRoomHit(index, levelId, justified, [4, 2], '3d')?.id).toBe(
      index.roomAtPoint(levelId, [6, 2])!.id,
    )
    expect(resolveRoomHit(index, levelId, justified, [3.8, 2], '3d')?.id).toBe(
      index.roomAtPoint(levelId, [2, 2])!.id,
    )
    expect(resolveRoomHit(index, levelId, justified, [4.01, 2], '2d')?.id).toBe(
      index.roomAtPoint(levelId, [6, 2])!.id,
    )
  })
  test('curved faces use the arc normal and topology chord station', () => {
    const { index, nodes, shared } = fixture()
    const curved = { ...shared, curveOffset: 0.5 }
    index.rebuild({ ...nodes, [shared.id]: curved })
    const frame = getWallCurveFrameAt(curved, 0.3)
    for (const sign of [-1, 1]) {
      const hit: [number, number] = [
        frame.point.x + sign * 0.1 * frame.normal.x,
        frame.point.y + sign * 0.1 * frame.normal.y,
      ]
      const face = sign > 0 ? 'a' : 'b'
      const expected = index.roomAtPoint(levelId, sign > 0 ? [2, 2] : [6, 2])!
      expect(index.roomForWallHit(levelId, curved.id, face, hit[1] / 4)?.id).toBe(expected.id)
      for (const view of ['2d', '3d'] as const)
        expect(resolveRoomHit(index, levelId, curved, hit, view)?.id).toBe(expected.id)
    }
  })
  test('records use the persistent zone id, name and area', () => {
    const polygon: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ]
    const slab = SlabNode.parse({ polygon, parentId: levelId, autoFromWalls: true, name: 'Oak' })
    const ceiling = CeilingNode.parse({
      polygon,
      parentId: levelId,
      autoFromWalls: true,
      name: 'Plaster',
    })
    const zone = ZoneNode.parse({ polygon, parentId: levelId, name: 'Kitchen' })
    const { index, nodes } = fixture([slab, ceiling, zone])
    const room = new RoomSelectionIndex(levelId)
      .update(nodes)
      .find((record) => record.id === index.roomAtPoint(levelId, [2, 2])!.id)!
    expect(room).toMatchObject({
      name: 'Kitchen',
      slabId: slab.id,
      ceilingId: ceiling.id,
      zoneId: zone.id,
    })
    expect(room.area).toBe(16)
    expect(room.boundaryWallIds).toHaveLength(4)
    expect(room.key).toEqual({ levelId, zoneId: zone.id })
  })
  // Prod "Wawa House": hand-drawn zones, some walls a few centimetres short of their corners.
  test('hovering a hand-drawn zone resolves the room it became, by its own id and name', () => {
    const source = JSON.parse(
      readFileSync(
        new URL(
          '../../../core/src/utils/__fixtures__/project_hrY3qVVq16yo5Out.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as Record<string, AnyNode>
    const nodes = migrateRoomZones(source).nodes as Record<string, AnyNode>
    const level = 'level_49wv4wg9qwu8cdk9'
    const index = new RoomSelectionIndex(level)
    const records = index.update(nodes)
    for (const name of ['Living Room', 'Master Bedroom', 'Entrance', 'Bathroom']) {
      const zone = Object.values(source).find(
        (node): node is ZoneNode => node.type === 'zone' && node.name === name,
      )!
      const room = nodes[zone.id] as ZoneNode
      const hit = index.roomAtPoint(level, room.seed!)
      expect(hit?.key, name).toEqual({ levelId: level, zoneId: zone.id })
      expect(records.find((record) => record.zoneId === zone.id)?.name).toBe(name)
    }
    expect(records.filter((record) => record.name === 'Room').length).toBe(
      records.filter((record) => !(nodes[record.zoneId] as ZoneNode).name).length,
    )
    expect(new Set(records.map((record) => record.zoneId)).size).toBe(records.length)
  })
  test('room area subtracts holes from the authoritative zone polygon', () => {
    const inner: [number, number][] = [
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3],
    ]
    const { nodes } = fixture(
      inner.map((start, i) => wall(`inner_${i}`, start, inner[(i + 1) % 4]!)),
    )
    const records = new RoomSelectionIndex(levelId).update(nodes)
    const outer = records.find((room) => room.holes.length === 1)!
    expect(outer.area).toBe(12)
    expect(outer.key).toEqual({ levelId, zoneId: outer.zoneId })
    expect(nodes[outer.zoneId]?.type).toBe('zone')
  })
  test('unrelated node-map edits preserve records; surface metadata preserves geometry', () => {
    const slab = SlabNode.parse({
      id: 'slab_auto',
      parentId: levelId,
      autoFromWalls: true,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      name: 'Old floor',
    })
    const { nodes } = fixture([slab])
    const cache = new RoomSelectionIndex(levelId)
    const records = cache.update(nodes)
    const room = records.find((record) => record.slabId === slab.id)!
    const delta = spyOn(cache.topology, 'applyWallDelta')
    const metadata = { ...nodes, [buildingId]: { ...nodes[buildingId]!, name: 'Renamed' } }
    expect(cache.update(metadata)).toBe(records)
    expect(
      cache.update({
        ...metadata,
        wall_shared: { ...(nodes.wall_shared as WallNode), name: 'Renamed wall' },
      }),
    ).toBe(records)
    expect(delta).not.toHaveBeenCalled()
    const renamed = cache
      .update({ ...nodes, [slab.id]: { ...slab, name: 'New floor' } })
      .find((record) => record.slabId === slab.id)!
    expect(renamed.slabName).toBe('New floor')
    expect(renamed.geometry).toBe(room.geometry)
    expect(renamed.clearPolygon).toBe(room.clearPolygon)
    expect(cache.roomAtPoint(levelId, [2, 2])?.id).toBe(room.id)
    const removed = { ...nodes }
    delete removed[slab.id]
    expect(
      cache.update(removed).find((record) => record.key.zoneId === room.key.zoneId)?.slabId,
    ).toBeNull()
    delta.mockRestore()
  })
  test('hover queries reuse topology; edits use an incremental delta', () => {
    const { nodes, shared } = fixture()
    const cache = new RoomSelectionIndex(levelId)
    const records = cache.update(nodes)
    const rebuild = spyOn(cache.topology, 'rebuildLevel')
    const delta = spyOn(cache.topology, 'applyWallDelta')
    for (let i = 0; i < 100; i++) {
      expect(cache.update(nodes)).toBe(records)
      resolveRoomHit(cache.topology, levelId, shared, [3.9, 2])
    }
    expect(rebuild).not.toHaveBeenCalled()
    cache.update({ ...nodes, [shared.id]: { ...shared, thickness: 0.3 } })
    expect(delta).toHaveBeenCalledTimes(1)
    expect(rebuild).not.toHaveBeenCalled()
    rebuild.mockRestore()
    delta.mockRestore()
  })
})

async function withRooms(
  run: (harness: {
    click: (
      id: string,
      point: [number, number],
      modifiers?: Partial<typeof plain>,
      options?: {
        grid?: boolean
        handle?: boolean
        handleBehind?: boolean
        event?: 'click' | 'enter' | 'move' | 'pointerdown'
      },
    ) => Promise<boolean>
    left: RoomKey
    right: RoomKey
    nodes: Record<string, AnyNode>
    selectedRoom: () => ReturnType<typeof useSelectedRoom>
    /** Whether the purple room highlight (its outline) is mounted. */
    highlighted: () => boolean
  }) => Promise<void>,
) {
  await withSelectionHarness(async ({ render, canvas }) => {
    const polygon: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ]
    const { index, nodes } = fixture([
      SlabNode.parse({ id: 'slab_test', parentId: levelId, polygon }),
      CeilingNode.parse({ id: 'ceiling_test', parentId: levelId, polygon }),
      wall('free', [10, 0], [10, 3]),
    ])
    useScene.setState({ nodes })
    useViewer.setState({
      selection: { buildingId, levelId, zoneId: null, selectedIds: [] },
      inputDragging: false,
      focusedUnitId: null,
    })
    useEditor.setState({
      phase: 'building',
      mode: 'select',
      toolMode: { mode: 'select' },
      room: null,
      hoveredRoom: null,
    })
    useInteractionScope.getState().end()
    useSessionGroups.getState().clearGroups()
    sceneRegistry.nodes.set(levelId, new Group())
    let selected: ReturnType<typeof useSelectedRoom> = null
    function Observer() {
      selected = useSelectedRoom()
      return null
    }
    try {
      await render(
        createElement('group', null, createElement(SelectionManager), createElement(Observer)),
      )
      const click = async (
        id: string,
        point: [number, number],
        modifiers: Partial<typeof plain> = {},
        options: {
          grid?: boolean
          handle?: boolean
          /** An editor handle's hit area lies further along the same ray. */
          handleBehind?: boolean
          event?: 'click' | 'enter' | 'move' | 'pointerdown'
        } = {},
      ) => {
        const node = useScene.getState().nodes[id as AnyNode['id']]!
        let stopped = false
        const object = new Group()
        object.name = options.grid ? 'ceiling-grid' : 'surface'
        const event = {
          node,
          object,
          position: [point[0], 0, point[1]],
          localPosition: [point[0], 0, point[1]],
          viaHandle: options.handle,
          stopPropagation: () => {
            stopped = true
          },
          nativeEvent: {
            object,
            intersections: options.handleBehind
              ? [{ object }, { object: { userData: { editorHandleHitArea: true } } }]
              : [{ object }],
            altKey: false,
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
            button: 0,
            ...Object.fromEntries(
              Object.entries(modifiers).map(([key, value]) => [`${key}Key`, value]),
            ),
          },
        } as unknown as NodeEvent
        await act(async () =>
          emitter.emit(
            `${node.type}:${options.event ?? 'click'}` as 'wall:click',
            event as NodeEvent<WallNode>,
          ),
        )
        return stopped
      }
      await run({
        click,
        nodes,
        left: new RoomSelectionIndex(levelId)
          .update(nodes)
          .find((room) => room.id === index.roomAtPoint(levelId, [2, 2])!.id)!.key,
        right: new RoomSelectionIndex(levelId)
          .update(nodes)
          .find((room) => room.id === index.roomAtPoint(levelId, [6, 2])!.id)!.key,
        selectedRoom: () => selected,
        highlighted: () => {
          let found = false
          _roots
            .get(canvas)!
            .store.getState()
            .scene.traverse((object) => {
              if ((object as LineSegments).isLineSegments) found = true
            })
          return found
        },
      })
    } finally {
      await render(null)
      sceneRegistry.nodes.delete(levelId)
    }
  })
}

describe('room drill-down state through the mounted selection manager', () => {
  test('plain clicks select a room, drill into its wall, and replace it with another room', async () => {
    await withRooms(async ({ click, left, right }) => {
      await click('wall_south', [2, 0.1])
      expect(useEditor.getState().room).toEqual(left)
      expect(useViewer.getState().selection.selectedIds).toEqual([])
      await click('wall_south', [2, 0.1])
      expect(useViewer.getState().selection.selectedIds).toEqual(['wall_south'])
      await click('wall_shared', [4.1, 2])
      expect(useEditor.getState().room).toEqual(right)
      expect(useViewer.getState().selection.selectedIds).toEqual([])
    })
  })
  test("a single-room wall's exterior face hovers and selects its room, then drills into the wall", async () => {
    await withRooms(async ({ click, left }) => {
      await click('wall_west', [-0.1, 2], {}, { event: 'enter' })
      expect(useEditor.getState().hoveredRoom).toEqual(left)
      expect(useViewer.getState().hoveredId).toBeNull()
      await click('wall_west', [-0.1, 2])
      expect(useEditor.getState().room).toEqual(left)
      expect(useViewer.getState().selection.selectedIds).toEqual([])
      await click('wall_west', [-0.1, 2])
      expect(useViewer.getState().selection.selectedIds).toEqual(['wall_west'])
      expect(useEditor.getState().room).toEqual(left)
    })
  })
  test('a stair flight hovers the same whole stair its click selects', async () => {
    await withRooms(async ({ click }) => {
      const stair = StairNode.parse({ id: 'stair_hover', parentId: levelId, position: [6, 0, 2] })
      const segment = {
        id: 'stair-segment_hover',
        type: 'stair-segment',
        parentId: stair.id,
      } as AnyNode
      await act(async () =>
        useScene.setState({
          nodes: { ...useScene.getState().nodes, [stair.id]: stair, [segment.id]: segment },
        }),
      )
      await click(segment.id, [6, 2], {}, { event: 'enter' })
      expect(useViewer.getState().hoveredId).toBe(stair.id)
      await click(segment.id, [6, 2])
      expect(useViewer.getState().selection.selectedIds).toEqual([stair.id])
    })
  })

  test('from site any hit on the house hovers and picks the building, then goes inside', async () => {
    for (const [id, point] of [
      ['wall_west', [-0.1, 2]],
      ['slab_test', [2, 2]],
      ['ceiling_test', [2, 2]],
    ] as const) {
      await withRooms(async ({ click, highlighted, left }) => {
        await act(async () => {
          useEditor.getState().setPhase('site')
          useViewer.getState().setSelection({ buildingId: null })
        })
        expect(await click(id, [...point], {}, { event: 'enter' })).toBe(true)
        expect(useViewer.getState().hoveredId).toBe(buildingId)
        expect(useEditor.getState().hoveredRoom).toBeNull()
        expect(highlighted()).toBe(false)
        expect(await click(id, [...point])).toBe(true)
        expect(useEditor.getState().phase).toBe('building')
        expect(useViewer.getState().selection.buildingId).toBe(buildingId)
        expect(useViewer.getState().selection.selectedIds).toEqual([])
        expect(useEditor.getState().room).toBeNull()
        // Inside, the same spot is room-first again.
        await click(id, [...point])
        expect(useEditor.getState().phase).toBe('building')
        expect(useEditor.getState().room).toEqual(left)
      })
    }
  })
  test('room clicks and the drill click into a wall never change the mode', async () => {
    await withRooms(async ({ click, left, right }) => {
      expect(await click('wall_south', [2, 0.1])).toBe(true)
      expect(useEditor.getState().phase).toBe('building')
      expect(useEditor.getState().room).toEqual(left)
      expect(useViewer.getState().selection.selectedIds).toEqual([])
      expect(await click('wall_shared', [4.1, 2])).toBe(true)
      expect(useEditor.getState().room).toEqual(right)
      // Drilling past the room selects the wall, the room stays its context, and
      // Escape climbs back to the room.
      await click('wall_shared', [4.1, 2])
      expect(useEditor.getState().phase).toBe('building')
      expect(useViewer.getState().selection.selectedIds).toEqual(['wall_shared'])
      expect(useEditor.getState().room).toEqual(right)
      await act(async () => cancelActiveTool())
      expect(useViewer.getState().selection.selectedIds).toEqual([])
      expect(useEditor.getState().room).toEqual(right)
    })
  })
  test('the Elements and Rooms tabs keep the room; site drops it', async () => {
    await withRooms(async ({ click, left }) => {
      await click('wall_south', [2, 0.1])
      await act(async () => useEditor.getState().setStructureLayer('zones'))
      expect(useEditor.getState().room).toEqual(left)
      await act(async () => useEditor.getState().setStructureLayer('elements'))
      expect(useEditor.getState().room).toEqual(left)
      await act(async () => useEditor.getState().setPhase('site'))
      expect(useEditor.getState().room).toBeNull()
    })
  })
  test('furniture, stairs, spawn and walls all select in place; furniture and ground end the room', async () => {
    jest.useFakeTimers()
    const chair = ItemNode.parse({
      id: 'item_chair',
      parentId: levelId,
      position: [2, 0, 2],
      asset: {
        id: 'asset:chair',
        category: 'furniture',
        name: 'Chair',
        thumbnail: '/chair.jpg',
        src: '/chair.glb',
      },
    })
    const stair = StairNode.parse({ id: 'stair_test', parentId: levelId, position: [6, 0, 2] })
    const spawn = SpawnNode.parse({ id: 'spawn_test', parentId: levelId, position: [1, 0, 1] })
    await withRooms(async ({ click, left }) => {
      await act(async () => {
        useScene.setState({
          nodes: {
            ...useScene.getState().nodes,
            [chair.id]: chair,
            [stair.id]: stair,
            [spawn.id]: spawn,
          },
        })
      })
      await click('wall_south', [2, 0.1])
      expect(useEditor.getState().room).toEqual(left)
      await click(chair.id, [2, 2])
      expect(useEditor.getState().phase).toBe('building')
      expect(useViewer.getState().selection.selectedIds).toEqual([chair.id])
      expect(useEditor.getState().room).toBeNull()

      jest.advanceTimersByTime(50)
      await click(stair.id, [6, 2])
      expect(useEditor.getState().phase).toBe('building')
      expect(useViewer.getState().selection.selectedIds).toEqual([stair.id])
      jest.advanceTimersByTime(50)
      await click(spawn.id, [1, 1])
      expect(useEditor.getState().phase).toBe('building')
      expect(useViewer.getState().selection.selectedIds).toEqual([spawn.id])

      jest.advanceTimersByTime(50)
      await click('wall_south', [2, 0.1])
      expect(useEditor.getState().phase).toBe('building')
      expect(useEditor.getState().room).toEqual(left)
      // The room click guards the same pointer's ground click for 50 ms.
      jest.advanceTimersByTime(50)
      await act(async () =>
        emitter.emit('grid:click', {
          position: [20, 0, 20],
          localPosition: [20, 0, 20],
          nativeEvent: {},
        } as never),
      )
      expect(useEditor.getState().room).toBeNull()
    })
  })
  test('plan and box furniture selections end the selected room', async () => {
    await withRooms(async ({ click, left }) => {
      const chair = ItemNode.parse({
        id: 'item_plan_chair',
        parentId: levelId,
        asset: {
          id: 'asset:chair',
          category: 'furniture',
          name: 'Chair',
          thumbnail: '/chair.jpg',
          src: '/chair.glb',
        },
      })
      await act(async () => {
        useScene.setState({ nodes: { ...useScene.getState().nodes, [chair.id]: chair } })
      })
      await click('wall_south', [2, 0.1])
      expect(useEditor.getState().room).toEqual(left)
      await act(async () => useViewer.getState().setSelection({ selectedIds: [chair.id] }))
      expect(useEditor.getState().room).toBeNull()
      expect(useViewer.getState().selection.selectedIds).toEqual([chair.id])
      await act(async () => cancelActiveTool())
      expect(useViewer.getState().selection.selectedIds).toEqual([])
      expect(useEditor.getState().room).toBeNull()
    })
  })
  test('arming furniture placement from a selected room leaves floor and wall clicks to the tool', async () => {
    await withRooms(async ({ click, left }) => {
      await click('wall_south', [2, 0.1])
      expect(useEditor.getState().room).toEqual(left)
      await act(async () => useEditor.getState().armToolMode({ mode: 'build', tool: 'item' }))
      expect(useEditor.getState().room).toBeNull()
      expect(await click('slab_test', [2, 2])).toBe(false)
      expect(await click('wall_south', [2, 0.1])).toBe(false)
      expect(useEditor.getState().phase).toBe('building')
      expect(useEditor.getState().tool).toBe('item')
      expect(useViewer.getState().selection.selectedIds).toEqual([])
    })
  })
  test('item placement owns floor and wall hits until the placement ends', async () => {
    for (const attachTo of ['floor', 'wall'] as const) {
      await withRooms(async ({ click, highlighted, left }) => {
        const item = ItemNode.parse({
          asset: {
            id: 'asset:placement',
            category: 'furniture',
            name: 'Placement item',
            thumbnail: '/item.jpg',
            src: '/item.glb',
            ...(attachTo === 'wall' ? { attachTo } : {}),
          },
        })
        await act(async () => {
          useInteractionScope.getState().begin({
            kind: 'placing',
            node: item,
            nodeId: item.id,
            nodeType: item.type,
            view: '3d',
            pressDrag: false,
            driver: 'registry-tool',
          })
        })
        const id = attachTo === 'floor' ? 'slab_test' : 'wall_west'
        const point: [number, number] = attachTo === 'floor' ? [2, 2] : [-0.1, 2]
        expect(await click(id, point, {}, { event: 'move' })).toBe(false)
        expect(await click(id, point, {}, { event: 'pointerdown' })).toBe(false)
        expect(await click(id, point)).toBe(false)
        expect(useEditor.getState().hoveredRoom).toBeNull()
        expect(useEditor.getState().room).toBeNull()
        expect(useEditor.getState().phase).toBe('building')
        expect(highlighted()).toBe(false)
        await act(async () => useInteractionScope.getState().end())
        await click(id, point, {}, { event: 'move' })
        expect(useEditor.getState().hoveredRoom).toEqual(left)
        expect(highlighted()).toBe(true)
      })
    }
  })
  test('room hover returns after paint Escape and after cancelling Divide with Escape or undo', async () => {
    await withRooms(async ({ click, left, right, highlighted }) => {
      await act(async () => useEditor.getState().armMaterialPaint())
      expect(highlighted()).toBe(false)
      await act(async () => cancelActiveTool())
      await click('wall_west', [-0.1, 2], {}, { event: 'move' })
      expect(useEditor.getState().hoveredRoom).toEqual(left)
      expect(highlighted()).toBe(true)
      await click('wall_west', [-0.1, 2])
      for (const cancel of [cancelActiveTool, () => runHistoryShortcut('undo')]) {
        await act(async () => startRoomDivide(left.zoneId, levelId))
        expect(useInteractionScope.getState().scope.kind).toBe('room-divide')
        expect(await click('wall_east', [7.9, 2], {}, { event: 'move' })).toBe(false)
        expect(highlighted()).toBe(false)
        await act(async () => cancel())
        expect(useInteractionScope.getState().scope.kind).toBe('idle')
        await click('wall_east', [7.9, 2], {}, { event: 'move' })
        expect(useEditor.getState().hoveredRoom).toEqual(right)
        expect(highlighted()).toBe(true)
      }
    })
  })
  test('room arrow release, cancel and undo restore hover picking', async () => {
    const withCursorDocument = (run: () => void) => {
      const previousDocument = globalThis.document
      globalThis.document ??= { body: { style: { cursor: '' } } } as unknown as Document
      try {
        run()
      } finally {
        globalThis.document = previousDocument
      }
    }
    for (const finish of [
      () => window.dispatchEvent(new Event('pointerup')),
      () => window.dispatchEvent(new Event('pointercancel')),
      () => window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' })),
      () => runHistoryShortcut('undo'),
    ]) {
      await withRooms(async ({ click, left, right, highlighted }) => {
        await click('wall_west', [-0.1, 2])
        await act(async () =>
          withCursorDocument(() => {
            runRoomHandleDrag({
              label: 'wall-push',
              nodeId: 'wall_west',
              zoneId: left.zoneId,
              levelId,
              requires: [left.zoneId, 'wall_west'],
              sample: () => 0,
              onValue: () => {},
              onCommit: () => {},
              onCancel: () => {},
            })
          }),
        )
        expect(useViewer.getState().inputDragging).toBe(true)
        expect(highlighted()).toBe(false)
        expect(await click('wall_east', [7.9, 2], {}, { event: 'move' })).toBe(false)
        await act(async () => {
          withCursorDocument(() => {
            finish()
          })
        })
        expect(useInteractionScope.getState().scope.kind).toBe('idle')
        expect(useViewer.getState().inputDragging).toBe(false)
        await click('wall_east', [7.9, 2], {}, { event: 'move' })
        expect(useEditor.getState().hoveredRoom).toEqual(right)
        expect(highlighted()).toBe(true)
      })
    }
  })
  test('a handle behind a wall owns the hover, as it owns the press', async () => {
    await withRooms(async ({ click, left }) => {
      // Without a handle the wall's exterior hover resolves its room and stops there.
      expect(await click('wall_west', [-0.1, 2], {}, { event: 'enter' })).toBe(true)
      expect(useEditor.getState().hoveredRoom).toEqual(left)
      // With a handle further along the ray: no stopPropagation (the handle hears
      // its enter) and the wall / room hover steps aside.
      expect(await click('wall_west', [-0.1, 2], {}, { event: 'move', handleBehind: true })).toBe(
        false,
      )
      expect(useEditor.getState().hoveredRoom).toBeNull()
      expect(useViewer.getState().hoveredId).toBeNull()
      expect(await click('wall_free', [9.9, 1], {}, { event: 'enter', handleBehind: true })).toBe(
        false,
      )
      expect(useViewer.getState().hoveredId).toBeNull()
    })
  })
  test('a wall bounding no room hovers and selects the wall directly', async () => {
    await withRooms(async ({ click }) => {
      await click('wall_free', [9.9, 1], {}, { event: 'enter' })
      expect(useEditor.getState().hoveredRoom).toBeNull()
      expect(useViewer.getState().hoveredId).toBe('wall_free')
      await click('wall_free', [9.9, 1])
      expect(useEditor.getState().room).toBeNull()
      expect(useViewer.getState().selection.selectedIds).toEqual(['wall_free'])
    })
  })
  test('the 2D plan resolves walls room-first and drills on the second click', async () => {
    await withRooms(async ({ left, right }) => {
      expect(resolvePlanRoomHit('wall_west', [-0.05, 2])).toEqual(left)
      expect(resolvePlanRoomHit('wall_shared', [3.95, 2])).toEqual(left)
      expect(resolvePlanRoomHit('wall_shared', [4.05, 2])).toEqual(right)
      expect(resolvePlanRoomHit('wall_free', [9.95, 1])).toBeNull()
      const hit = resolvePlanRoomHit('wall_west', [-0.05, 2])
      const select = async (modifiers = plain) => {
        let selected = false
        await act(async () => {
          selected = selectRoomFromHit(hit, modifiers, 'wall_west')
        })
        return selected
      }
      expect(await select()).toBe(true)
      expect(useEditor.getState().room).toEqual(left)
      expect(await select()).toBe(false)
      expect(await select({ ...plain, alt: true })).toBe(false)
    })
  })
  test('the 2D plan picks rooms inside the building, not in site', async () => {
    await withRooms(async () => {
      for (const [phase, enabled] of [
        ['building', true],
        ['site', false],
      ] as const) {
        await act(async () => useEditor.setState({ phase }))
        expect(roomPickingEnabled()).toBe(enabled)
      }
    })
  })
  test('Escape climbs from element to room to nothing in either layer', async () => {
    await withRooms(async ({ click, left }) => {
      for (const structureLayer of ['elements', 'zones'] as const) {
        await act(async () => useEditor.setState({ structureLayer }))
        await click('wall_south', [2, 0.1])
        await click('wall_south', [2, 0.1])
        await act(async () => cancelActiveTool())
        expect(useViewer.getState().selection.selectedIds).toEqual([])
        expect(useEditor.getState().room).toEqual(left)
        expect(useEditor.getState().structureLayer).toBe(structureLayer)
        await act(async () => cancelActiveTool())
        expect(useEditor.getState().room).toBeNull()
      }
    })
  })
  test('Alt bypass and toggles select elements while preserving room context', async () => {
    await withRooms(async ({ click, left, right }) => {
      await click('wall_south', [2, 0.1])
      await click('wall_shared', [4.1, 2], { alt: true })
      expect(useViewer.getState().selection.selectedIds).toEqual(['wall_shared'])
      expect(useEditor.getState().room).toEqual(left)
      for (const modifier of ['shift', 'ctrl', 'meta'] as const) {
        await click('wall_east', [7.9, 2], { [modifier]: true })
        expect(useViewer.getState().selection.selectedIds).toEqual(['wall_shared', 'wall_east'])
        await click('wall_east', [7.9, 2], { [modifier]: true })
        expect(useViewer.getState().selection.selectedIds).toEqual(['wall_shared'])
        expect(useEditor.getState().room).toEqual(left)
        expect(shouldSelectRoom(null, right, { ...plain, [modifier]: true })).toBe(false)
      }
      await act(async () => useEditor.getState().clearRoom())
      expect(useEditor.getState().room).toBeNull()
    })
  })
  test('moving the shared boundary widens the selected room without changing its key', async () => {
    await withRooms(async ({ click, left, nodes, selectedRoom }) => {
      await click('wall_south', [2, 0.1])
      const previous = selectedRoom()!
      const moved: Record<string, AnyNode> = {
        ...nodes,
        wall_shared: { ...(nodes.wall_shared as WallNode), start: [5, 0], end: [5, 4] } as WallNode,
      }
      const plan = reconcileLevelStructure({
        levelId,
        nodes: moved,
        mintId: (kind) => {
          if (kind === 'zone') throw new Error('Move must retain identity')
          return `${kind}_moved_preview`
        },
      })
      for (const patch of plan.patches)
        if (patch.op === 'update')
          moved[patch.id] = { ...moved[patch.id], ...patch.data } as AnyNode
      await act(async () => useScene.setState({ nodes: moved }))
      const widened = selectedRoom()!
      expect(useEditor.getState().room).toEqual(left)
      expect(widened.key).toEqual(left)
      expect(widened.id).not.toBe(previous.id)
      expect(widened.area).toBeGreaterThan(previous.area)
      expect(widened.geometry).not.toBe(previous.geometry)
    })
  })
  test('live session groups expand before room interception; Alt isolates and deleted peers are inert', async () => {
    await withRooms(async ({ click, left, nodes }) => {
      useSessionGroups
        .getState()
        .setGroups([{ id: 'group-test', label: 'Test', memberIds: ['wall_south', 'wall_north'] }])
      expect(shouldInterceptRoom(left, plain, 'wall_south')).toBe(false)
      expect(selectRoomFromHit(left, plain, 'wall_south')).toBe(false)
      await click('wall_south', [2, 0.1])
      expect(useEditor.getState().room).toBeNull()
      expect(useViewer.getState().selection.selectedIds).toEqual(['wall_south', 'wall_north'])
      await click('wall_south', [2, 0.1], { alt: true })
      expect(useViewer.getState().selection.selectedIds).toEqual(['wall_south'])
      await click('wall_south', [2, 0.1])
      expect(useViewer.getState().selection.selectedIds).toEqual(['wall_south', 'wall_north'])
      const { wall_north: _, ...remaining } = nodes
      await act(async () => useScene.setState({ nodes: remaining }))
      expect(shouldInterceptRoom(left, plain, 'wall_south')).toBe(true)
    })
  })
  test('ceiling grids pass through without propagation stops; real surfaces and handles select', async () => {
    await withRooms(async ({ click, left }) => {
      for (const event of ['click', 'enter', 'pointerdown'] as const) {
        expect(await click('ceiling_test', [2, 2], {}, { grid: true, event })).toBe(false)
        expect(useEditor.getState().room).toBeNull()
        expect(useViewer.getState().selection.selectedIds).toEqual([])
      }
      expect(await click('ceiling_test', [2, 2])).toBe(true)
      expect(useEditor.getState().room).toEqual(left)
      expect(await click('ceiling_test', [2, 2], {}, { handle: true })).toBe(true)
      expect(useViewer.getState().selection.selectedIds).toEqual(['ceiling_test'])
      expect(await click('ceiling_test', [2, 2], {}, { grid: true })).toBe(false)
      expect(await click('wall_south', [2, 0.1])).toBe(true)
      expect(useViewer.getState().selection.selectedIds).toEqual(['wall_south'])
    })
  })
})

test('room store setters only write editor state; the selection command owns cross-store updates', () => {
  const { index, nodes } = fixture()
  useScene.setState({ nodes })
  const key = new RoomSelectionIndex(levelId)
    .update(nodes)
    .find((room) => room.id === index.roomAtPoint(levelId, [2, 2])!.id)!.key
  const selection = useViewer.getState().selection
  useEditor.getState().selectRoom(key)
  expect(useEditor.getState().room).toEqual(key)
  expect(useViewer.getState().selection).toBe(selection)
  selectRoom(key)
  expect(useViewer.getState().selection).toMatchObject({
    buildingId,
    levelId,
    selectedIds: [],
    zoneId: null,
  })
  const nextSelection = useViewer.getState().selection
  useEditor.getState().clearRoom()
  expect(useEditor.getState().room).toBeNull()
  expect(useViewer.getState().selection).toBe(nextSelection)
})
