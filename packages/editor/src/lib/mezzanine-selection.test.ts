import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  createMezzanine,
  createZone,
  deleteZone,
  generateId,
  initSpaceDetectionSync,
  LevelNode,
  type SlabNode,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { deleteConfirmationContent } from '../components/editor/delete-confirmation-dialog'
import { resolveFloorRegionRoom } from '../components/editor/floor-region-controls'
import { MEZZANINE_GESTURE_HINTS, mezzanineGesture } from '../components/ui/helpers/helper-manager'
import {
  MEZZANINE_EDGE_DRAG_LABEL,
  mezzanineElevationBounds,
  ROOM_ELEVATION_DRAG_LABEL,
} from './room-handle-drag'
import { RoomSelectionIndex, resolveRoomHit } from './room-selection'
import { applyRoomPlan } from './room-structure-commands'
import { ROOM_MOVE_DRAG_LABEL } from './room-transform-session'
import { zoneAtLevelPoint } from './units'

const LEVEL = 'level_mezzanine_selection'
let hostId = '' as ZoneNode['id']
let mezzanineId = '' as ZoneNode['id']
let stop = () => {}
const savedRaf = globalThis.requestAnimationFrame
const savedCaf = globalThis.cancelAnimationFrame

beforeEach(() => {
  globalThis.requestAnimationFrame ??= ((callback: (time: number) => void) => {
    callback(0)
    return 0
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame ??= (() => {}) as typeof cancelAnimationFrame
  const building = BuildingNode.parse({ id: 'building_mezzanine_selection', children: [LEVEL] })
  const level = LevelNode.parse({ id: LEVEL, parentId: building.id, height: 5 })
  useScene.setState({
    nodes: { [building.id]: building, [level.id]: level },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    materials: {},
    collections: {},
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  stop = initSpaceDetectionSync(useScene, { getState: () => ({ spaces: {}, setSpaces: () => {} }) })
  const host = createZone(useScene.getState().nodes, {
    levelId: LEVEL,
    polygon: [
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ],
    enclose: true,
    mintId: generateId,
  })
  applyRoomPlan(host)
  hostId = host.zoneId as ZoneNode['id']
  const mezzanine = createMezzanine(useScene.getState().nodes, {
    hostZoneId: hostId,
    polygon: [
      [0.5, 0.5],
      [4, 0.5],
      [4, 3],
      [0.5, 3],
    ],
    mintId: generateId,
  })
  expect(mezzanine.conflicts ?? []).toEqual([])
  applyRoomPlan(mezzanine)
  mezzanineId = mezzanine.zoneId as ZoneNode['id']
  useViewer.getState().setSelection({ buildingId: building.id, levelId: LEVEL, selectedIds: [] })
  clearSceneHistory()
})

afterEach(() => stop())

afterAll(() => {
  globalThis.requestAnimationFrame = savedRaf
  globalThis.cancelAnimationFrame = savedCaf
})

const nodes = () => useScene.getState().nodes as Record<string, AnyNode>

describe('mezzanine selection', () => {
  test('the room index lists the mezzanine as its own room beside the untouched host', () => {
    const index = new RoomSelectionIndex(LEVEL)
    const records = index.update(nodes())
    const host = records.find((room) => room.zoneId === hostId)!
    const mezzanine = records.find((room) => room.zoneId === mezzanineId)!
    expect(host.mezzanine).toBeNull()
    expect(host.area).toBeCloseTo(48, 0)
    expect(mezzanine.mezzanine).toEqual({ hostZoneId: hostId })
    expect(mezzanine.name).toBe('Mezzanine')
    expect(mezzanine.area).toBeCloseTo(8.75)
    expect(mezzanine.spans).toEqual([])
    expect(mezzanine.boundaryWallIds).toEqual([])
    const plate = nodes()[mezzanine.slabId as AnyNodeId] as SlabNode
    expect(plate.support).toBe('open')
    expect(host.slabId).not.toBe(mezzanine.slabId)
  })

  test('the mezzanine plate and railing pick the mezzanine; the host floor under it picks the host', () => {
    const index = new RoomSelectionIndex(LEVEL)
    const records = index.update(nodes())
    const mezzanine = records.find((room) => room.zoneId === mezzanineId)!
    const host = records.find((room) => room.zoneId === hostId)!
    const plate = nodes()[mezzanine.slabId as AnyNodeId]!
    const hostFloor = nodes()[host.slabId as AnyNodeId]!
    // Anywhere on the mezzanine plate — its top, underside or a railing post.
    expect(resolveRoomHit(index, LEVEL, plate, [2, 1.5], '3d')?.key.zoneId).toBe(mezzanineId)
    expect(resolveRoomHit(index, LEVEL, plate, [3.99, 2.99], '3d')?.key.zoneId).toBe(mezzanineId)
    // The host floor under the mezzanine, and a point-only (plan) hit there.
    expect(resolveRoomHit(index, LEVEL, hostFloor, [2, 1.5], '3d')?.key.zoneId).toBe(hostId)
    expect(resolveRoomHit(index, LEVEL, null, [2, 1.5])?.key.zoneId).toBe(hostId)
    expect(resolveRoomHit(index, LEVEL, hostFloor, [6, 4], '3d')?.key.zoneId).toBe(hostId)
  })

  test('units pick the zone by the hit height: on the mezzanine or under it', () => {
    const elevation = (nodes()[mezzanineId as AnyNodeId] as ZoneNode).floor!.elevation!
    expect(elevation).toBeCloseTo(2.5)
    expect(zoneAtLevelPoint(2, 1.5, elevation)?.id).toBe(mezzanineId)
    expect(zoneAtLevelPoint(2, 1.5, elevation - 0.2)?.id).toBe(mezzanineId)
    expect(zoneAtLevelPoint(2, 1.5, 0.05)?.id).toBe(hostId)
    expect(zoneAtLevelPoint(6, 4, elevation)?.id).toBe(hostId)
    // No height (the plan, from above): the mezzanine on top.
    expect(zoneAtLevelPoint(2, 1.5)?.id).toBe(mezzanineId)
  })

  test('the elevation handle stays inside the heights core accepts', () => {
    expect(mezzanineElevationBounds(nodes(), hostId)).toBeNull()
    const bounds = mezzanineElevationBounds(nodes(), mezzanineId)!
    expect(bounds.min).toBeCloseTo(0.21)
    expect(bounds.max).toBeCloseTo(4.7)
  })

  test('a mezzanine covering its whole host still wins on its plate (units)', () => {
    // Stretch the mezzanine over the host's whole footprint: same area, host listed first.
    const hostPolygon = (nodes()[hostId as AnyNodeId] as ZoneNode).polygon
    useScene.getState().updateNode(mezzanineId as AnyNodeId, { polygon: hostPolygon } as never)
    const elevation = (nodes()[mezzanineId as AnyNodeId] as ZoneNode).floor!.elevation!
    expect(zoneAtLevelPoint(2, 1.5, elevation)?.id).toBe(mezzanineId)
    expect(zoneAtLevelPoint(6, 4, elevation)?.id).toBe(mezzanineId)
    expect(zoneAtLevelPoint(6, 4)?.id).toBe(mezzanineId)
    expect(zoneAtLevelPoint(2, 1.5, 0.05)?.id).toBe(hostId)
  })

  test('plan-view floor drafts pick the topmost floor: the mezzanine over its host', () => {
    expect(resolveFloorRegionRoom(LEVEL, [2, 1.5])?.zoneId).toBe(mezzanineId)
    expect(resolveFloorRegionRoom(LEVEL, [6, 4])?.zoneId).toBe(hostId)
  })

  test('raising, resizing and moving a mezzanine are titled Mezzanine; a room keeps its HUDs', () => {
    const gesture = (nodeId: string, label: string) => mezzanineGesture({ nodeId, label }, nodes())
    expect(gesture(mezzanineId, ROOM_ELEVATION_DRAG_LABEL)).toBe('raise')
    expect(gesture(mezzanineId, MEZZANINE_EDGE_DRAG_LABEL)).toBe('resize')
    expect(gesture(mezzanineId, ROOM_MOVE_DRAG_LABEL)).toBe('move')
    expect(gesture(hostId, ROOM_ELEVATION_DRAG_LABEL)).toBeNull()
    expect(gesture(hostId, ROOM_MOVE_DRAG_LABEL)).toBeNull()
    expect(gesture(mezzanineId, 'height')).toBeNull()
    expect(mezzanineGesture(null, nodes())).toBeNull()
    expect(MEZZANINE_GESTURE_HINTS.move[0]!.label).toBe('Place inside the room')
  })

  test('the delete dialog speaks of the mezzanine, and of its items only when it has some', () => {
    const request = (contents: 'delete' | 'keep' = 'delete') => ({
      count: 1,
      room: deleteZone(nodes(), { zoneId: mezzanineId, contents }).payload,
      onConfirm: () => {},
      onKeepContents: () => {},
    })
    const empty = deleteConfirmationContent(request(), nodes())
    expect(empty.title).toBe('Delete Mezzanine?')
    expect(empty.description).toMatch(/^Removes the mezzanine floor/)
    expect(empty.description).not.toContain('item')
    expect(empty.keepLabel).toBeNull()
    const hasCeiling = Object.values(nodes()).some(
      (node) => node.type === 'ceiling' && node.zoneId === mezzanineId,
    )
    expect(empty.description.includes('ceiling')).toBe(hasCeiling)
    const withItems = request()
    withItems.room = { ...withItems.room, itemIds: ['item_a', 'item_b'] }
    const loaded = deleteConfirmationContent(withItems, nodes())
    expect(loaded.description).toContain('2 items are on it. Keep them on the floor below')
    expect(loaded.keepLabel).toBe('Keep items')
    // A room's dialog is unchanged.
    const room = deleteConfirmationContent(
      {
        count: 1,
        room: deleteZone(nodes(), { zoneId: hostId, contents: 'delete' }).payload,
        onConfirm: () => {},
      },
      nodes(),
    )
    expect(room.description).not.toContain('mezzanine')
  })
})
