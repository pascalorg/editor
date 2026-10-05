import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  createZone,
  divideZone,
  generateId,
  initSpaceDetectionSync,
  LevelNode,
  UnitNode,
  useScene,
  type ZoneNode,
  ZoneNode as ZoneNodeSchema,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { deleteSelection } from '../components/editor/group-actions'
import { getRoomSelectionIndex } from '../hooks/use-selected-room'
import useEditor from '../store/use-editor'
import { installImmediateAnimationFrames } from '../test-utils/immediate-animation-frames'
import { exitCeilingEditToRoom, startCeilingEdit } from './ceiling-edit-session'
import { applyRoomPlan } from './room-structure-commands'
import {
  captureElementActionOrigin,
  completeElementAction,
  roomKeyForZone,
  selectZoneOrRoom,
  zoneKindLabel,
} from './room-zone-routing'
import { addZoneToNewUnit, assignZoneToUnit, zoneUnits } from './units'

const LEVEL = 'level_zone_routing'
const BUILDING = 'building_zone_routing'
let zoneId: string
let stop = () => {}
let restoreFrames = () => {}

const nodes = () => useScene.getState().nodes
const zones = () => Object.values(nodes()).filter((n): n is ZoneNode => n.type === 'zone')
const roomWalls = (id: string) =>
  getRoomSelectionIndex(LEVEL)
    .update(nodes())
    .find((room) => room.key.zoneId === id)!.boundaryWallIds

beforeEach(() => {
  restoreFrames = installImmediateAnimationFrames()
  const building = BuildingNode.parse({ id: BUILDING, children: [LEVEL] })
  const level = LevelNode.parse({ id: LEVEL, parentId: building.id })
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
  const plan = createZone(nodes(), {
    levelId: LEVEL,
    polygon: [
      [0, 0],
      [8, 0],
      [8, 4],
      [0, 4],
    ],
    enclose: true,
    mintId: generateId,
  })
  applyRoomPlan(plan)
  zoneId = plan.zoneId
  useViewer.getState().setFocusedUnit(null)
  useViewer
    .getState()
    .setSelection({ buildingId: building.id, levelId: level.id, selectedIds: [], zoneId: null })
  useEditor.setState({ phase: 'structure', mode: 'select', room: null, hoveredRoom: null })
  clearSceneHistory()
})
afterEach(() => {
  stop()
  restoreFrames()
})

describe('a room is the room from every route (point 1)', () => {
  test('an enclosed room selected from a list or label becomes the room selection', () => {
    expect(selectZoneOrRoom(zoneId)).toBe('room')
    expect(useEditor.getState().room).toEqual({ levelId: LEVEL, zoneId })
    expect(useViewer.getState().selection.zoneId).toBeNull()
  })

  test('a generic zone and an open room stay zones', () => {
    const lawn = ZoneNodeSchema.parse({
      parentId: LEVEL,
      name: 'Lawn',
      polygon: [
        [20, 0],
        [24, 0],
        [24, 4],
      ],
    })
    const open = ZoneNodeSchema.parse({
      parentId: LEVEL,
      name: 'Porch',
      spaceRole: 'room',
      enclosureStatus: 'open',
      polygon: [
        [30, 0],
        [34, 0],
        [34, 4],
      ],
    })
    useScene.getState().createNodes([
      { node: lawn, parentId: LEVEL as AnyNodeId },
      { node: open, parentId: LEVEL as AnyNodeId },
    ])
    for (const zone of [lawn, open]) {
      useEditor.getState().selectRoom({ levelId: LEVEL, zoneId })
      expect(roomKeyForZone(zone.id)).toBeNull()
      expect(selectZoneOrRoom(zone.id)).toBe('zone')
      expect(useViewer.getState().selection.zoneId).toBe(zone.id)
      expect(useEditor.getState().room).toBeNull()
    }
    expect(zoneKindLabel(lawn)).toBe('Zone')
    expect(zoneKindLabel(open)).toBe('Room')
  })

  test('while a unit is focused, a room stays a zone so arranging the unit keeps working', () => {
    const unit = UnitNode.parse({ name: 'Flat A' })
    useScene.getState().createNode(unit, BUILDING as AnyNodeId)
    useViewer.getState().setFocusedUnit(unit.id)
    expect(selectZoneOrRoom(zoneId)).toBe('zone')
    expect(useEditor.getState().room).toBeNull()
  })

  test('the room panel unit row reads, changes and clears membership (§13 Q7)', () => {
    expect(zoneUnits(nodes(), zoneId)).toMatchObject({ buildingId: BUILDING, current: null })
    const created = addZoneToNewUnit(zoneId as ZoneNode['id'])!
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(zoneUnits(nodes(), zoneId).current?.id).toBe(created)
    expect(zoneUnits(nodes(), zoneId).current?.name).toBe('Unit 1')
    const other = UnitNode.parse({ name: 'Flat B' })
    useScene.getState().createNode(other, BUILDING as AnyNodeId)
    assignZoneToUnit(zoneId as ZoneNode['id'], other.id)
    expect(zoneUnits(nodes(), zoneId).current?.id).toBe(other.id)
    expect(zoneUnits(nodes(), zoneId).units.map((u) => u.id)).toEqual([created, other.id])
    assignZoneToUnit(zoneId as ZoneNode['id'], null)
    expect(zoneUnits(nodes(), zoneId).current).toBeNull()
  })
})

describe('finishing an action on a piece of a room returns to the room (point 3)', () => {
  test('only pieces of the selected room carry it as the origin', () => {
    const wallId = roomWalls(zoneId)[0]!
    expect(captureElementActionOrigin([wallId])).toBeNull()
    useEditor.getState().selectRoom({ levelId: LEVEL, zoneId })
    expect(captureElementActionOrigin([wallId])?.room).toEqual({ levelId: LEVEL, zoneId })
    expect(captureElementActionOrigin([wallId, 'wall_elsewhere'])).toBeNull()
  })

  test('completing lands on the origin room with nothing drilled', () => {
    useEditor.getState().selectRoom({ levelId: LEVEL, zoneId })
    const wallId = roomWalls(zoneId)[0]!
    useViewer.getState().setSelection({ selectedIds: [wallId as AnyNodeId] })
    const origin = captureElementActionOrigin([wallId])
    expect(completeElementAction(origin)).toBe(true)
    expect(useViewer.getState().selection.selectedIds).toEqual([])
    expect(useEditor.getState().room).toEqual({ levelId: LEVEL, zoneId })
  })

  test('without a room context the action keeps its own selection', () => {
    const wallId = roomWalls(zoneId)[0]!
    useViewer.getState().setSelection({ selectedIds: [wallId as AnyNodeId] })
    expect(completeElementAction(captureElementActionOrigin([wallId]))).toBe(false)
    expect(useViewer.getState().selection.selectedIds).toEqual([wallId])
  })

  test('a room that is gone hands over to the room now standing there, else to nothing', () => {
    const gone = { levelId: LEVEL, zoneId: 'zone_gone' }
    useEditor.getState().selectRoom(gone)
    expect(completeElementAction({ room: gone, point: [4, 2] })).toBe(true)
    expect(useEditor.getState().room).toEqual({ levelId: LEVEL, zoneId })
    useEditor.getState().selectRoom(gone)
    expect(completeElementAction({ room: gone, point: [40, 2] })).toBe(false)
    expect(useEditor.getState().room).toBeNull()
    expect(useViewer.getState().selection.selectedIds).toEqual([])
  })

  test('deleting a separator drilled from one side lands on the merged room', () => {
    const plan = divideZone(nodes(), {
      zoneId,
      cut: [
        [2, 0],
        [2, 4],
      ],
      mintId: generateId,
    })
    applyRoomPlan(plan)
    const sides = zones().map((z) => z.id as string)
    expect(sides).toHaveLength(2)
    // Drilled from the side Divide made, which merges back into the first room.
    const origin = sides.find((id) => id !== zoneId) ?? zoneId
    useEditor.getState().selectRoom({ levelId: LEVEL, zoneId: origin })
    useViewer.getState().setSelection({ selectedIds: [plan.separatorId as AnyNodeId] })
    expect(deleteSelection()).toBe(true)
    const [merged] = zones()
    expect(zones()).toHaveLength(1)
    expect(useEditor.getState().room).toEqual({ levelId: LEVEL, zoneId: merged!.id })
    expect(useViewer.getState().selection.selectedIds).toEqual([])
  })

  test('deleting a drilled wall lands back on its room (its edge stays open)', () => {
    useEditor.getState().selectRoom({ levelId: LEVEL, zoneId })
    const wallId = roomWalls(zoneId)[0]!
    useViewer.getState().setSelection({ selectedIds: [wallId as AnyNodeId] })
    expect(deleteSelection()).toBe(true)
    expect(nodes()[wallId as AnyNodeId]).toBeUndefined()
    expect(useEditor.getState().room).toEqual({ levelId: LEVEL, zoneId })
    expect(useViewer.getState().selection.selectedIds).toEqual([])
  })

  test('leaving Edit ceiling lands on the ceiling’s room', () => {
    useEditor.getState().selectRoom({ levelId: LEVEL, zoneId })
    expect(startCeilingEdit(zoneId)).not.toBe(false)
    expect(exitCeilingEditToRoom()).toBe(true)
    expect(useEditor.getState().room).toEqual({ levelId: LEVEL, zoneId })
    expect(useViewer.getState().selection.selectedIds).toEqual([])
  })
})
