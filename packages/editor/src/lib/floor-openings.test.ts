import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  createMezzanine,
  createZone,
  type FloorOpeningNode,
  generateId,
  initSpaceDetectionSync,
  LevelNode,
  structureChangeBatch,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../store/use-editor'
import { installImmediateAnimationFrames } from '../test-utils/immediate-animation-frames'
import {
  deleteFloorOpening,
  finishFloorEdit,
  finishFloorOpening,
  roomSurfaceOpenings,
  startFloorEdit,
  useFloorEditSession,
} from './floor-edit-session'
import {
  cancelOpeningDraft,
  describeOpeningHost,
  OPENING_OUTSIDE_MESSAGE,
  OPENING_TOO_SMALL_MESSAGE,
  openingDraftActive,
  planFloorOpening,
  startOpeningDraft,
  useOpeningDraft,
} from './floor-opening-draft'
import { applyRoomPlan } from './room-structure-commands'

const GROUND = 'level_openings_ground'
const UPPER = 'level_openings_upper'
let stop = () => {}
let restoreFrames = () => {}
const nodes = () => useScene.getState().nodes as Record<string, AnyNode>
const history = () => useScene.temporal.getState().pastStates.length
const groundCeilingHoles = () =>
  Object.values(nodes()).flatMap((n) =>
    n.type === 'ceiling' && n.parentId === GROUND ? (n.holes ?? []) : [],
  )
const upperPlateHoles = () =>
  Object.values(nodes()).flatMap((n) =>
    n.type === 'slab' && n.parentId === UPPER ? (n.holes ?? []) : [],
  )
const openings = () =>
  Object.values(nodes()).filter((n): n is FloorOpeningNode => n.type === 'floor-opening')

const rect = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]
const room = (levelId: string, name: string) => {
  const plan = createZone(nodes(), {
    levelId,
    polygon: rect(0, 0, 8, 5),
    enclose: true,
    mintId: generateId,
    name,
  })
  applyRoomPlan(plan)
  return plan.zoneId
}

let groundRoom: string
let upperRoom: string

beforeEach(() => {
  restoreFrames = installImmediateAnimationFrames()
  const building = BuildingNode.parse({ id: 'building_openings', children: [GROUND, UPPER] })
  const ground = LevelNode.parse({ id: GROUND, parentId: building.id, level: 0 })
  const upper = LevelNode.parse({ id: UPPER, parentId: building.id, level: 1 })
  useScene.setState({
    nodes: { [building.id]: building, [ground.id]: ground, [upper.id]: upper },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    materials: {},
    collections: {},
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  stop = initSpaceDetectionSync(useScene, { getState: () => ({ spaces: {}, setSpaces: () => {} }) })
  groundRoom = room(GROUND, 'Hall')
  upperRoom = room(UPPER, 'Landing')
  useScene.temporal.getState().clear()
  useEditor.setState({ phase: 'structure', mode: 'select', room: null })
  useViewer.getState().setSelection({ buildingId: building.id, levelId: UPPER, selectedIds: [] })
})
afterEach(() => {
  cancelOpeningDraft()
  finishFloorEdit()
  stop()
  restoreFrames()
})

const cutVoid = () => {
  const host = describeOpeningHost(nodes(), upperRoom, 'floor')!
  const result = planFloorOpening(nodes(), host, 'floor', rect(2, 1, 4, 2))
  if ('message' in result) throw Error(result.message)
  useScene.getState().applyNodeChanges(structureChangeBatch(result.plan.changes))
  return result.plan.openingIds[0]!
}

describe('Cut opening (point 8)', () => {
  test('an outline outside the room or too small is refused, in words', () => {
    const host = describeOpeningHost(nodes(), upperRoom, 'floor')!
    expect(planFloorOpening(nodes(), host, 'floor', rect(20, 20, 22, 22))).toEqual({
      message: OPENING_OUTSIDE_MESSAGE,
    })
    expect(planFloorOpening(nodes(), host, 'floor', rect(1, 1, 1.1, 1.1))).toEqual({
      message: OPENING_TOO_SMALL_MESSAGE,
    })
  })

  test('a floor opening over a room below also cuts its ceiling, in one undo step', () => {
    const id = cutVoid()
    expect(history()).toBe(1)
    const opening = nodes()[id] as FloorOpeningNode
    expect(opening).toMatchObject({ parentId: UPPER, drawnOn: 'floor', cutsAdjacent: true })
    expect(roomSurfaceOpenings(nodes(), upperRoom, 'floor').map((o) => o.id as string)).toEqual([
      id,
    ])
    expect(roomSurfaceOpenings(nodes(), groundRoom, 'ceiling').map((o) => o.id as string)).toEqual([
      id,
    ])
    expect(groundCeilingHoles()).toHaveLength(1)
    expect(upperPlateHoles()).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(openings()).toEqual([])
    expect(groundCeilingHoles()).toEqual([])
  })

  test('with its switch off, only the floor is cut', () => {
    const id = cutVoid()
    useScene.getState().updateNode(id as FloorOpeningNode['id'], { cutsAdjacent: false })
    expect(roomSurfaceOpenings(nodes(), upperRoom, 'floor')).toHaveLength(1)
    expect(roomSurfaceOpenings(nodes(), groundRoom, 'ceiling')).toEqual([])
    expect(groundCeilingHoles()).toEqual([])
  })

  test('a ceiling opening on the top storey cuts only the ceiling', () => {
    const host = describeOpeningHost(nodes(), upperRoom, 'ceiling')!
    const result = planFloorOpening(nodes(), host, 'ceiling', rect(2, 1, 4, 2))
    if ('message' in result) throw Error(result.message)
    useScene.getState().applyNodeChanges(structureChangeBatch(result.plan.changes))
    const [opening] = openings()
    expect(opening).toMatchObject({ drawnOn: 'ceiling', cutsAdjacent: false })
    expect(roomSurfaceOpenings(nodes(), upperRoom, 'ceiling')).toHaveLength(1)
  })

  test('a hatch in a mezzanine cuts only the mezzanine', () => {
    const plan = createMezzanine(nodes(), {
      hostZoneId: groundRoom,
      polygon: rect(1, 1, 5, 4),
      mintId: generateId,
    })
    applyRoomPlan(plan)
    const host = describeOpeningHost(nodes(), plan.zoneId, 'floor')!
    const result = planFloorOpening(nodes(), host, 'floor', rect(2, 2, 3, 3))
    if ('message' in result) throw Error(result.message)
    useScene.getState().applyNodeChanges(structureChangeBatch(result.plan.changes))
    const [hatch] = openings()
    expect(hatch).toMatchObject({ hostZoneId: plan.zoneId, cutsAdjacent: false })
    expect(roomSurfaceOpenings(nodes(), plan.zoneId, 'floor').map((o) => o.id)).toEqual([hatch!.id])
    expect(roomSurfaceOpenings(nodes(), groundRoom, 'floor')).toEqual([])
  })

  test('the shape is picked before drawing, not toggled during it', () => {
    expect(startOpeningDraft(upperRoom, 'floor', 'polygon')).toBe(true)
    expect(useOpeningDraft.getState().shape).toBe('polygon')
    cancelOpeningDraft()
    expect(startOpeningDraft(upperRoom, 'floor')).toBe(true)
    expect(useOpeningDraft.getState().shape).toBe('rectangle')
  })

  test('the tool arms on the room and drops cleanly on cancel, writing nothing', () => {
    expect(startOpeningDraft(upperRoom, 'floor')).toBe(true)
    expect(openingDraftActive()).toBe(true)
    cancelOpeningDraft()
    expect(openingDraftActive()).toBe(false)
    expect(history()).toBe(0)
  })
})

describe('Edit floor, Done and Delete return to the room', () => {
  test('Edit floor is a session on the room; Done ends it on the room', () => {
    useEditor.getState().selectRoom({ levelId: UPPER, zoneId: upperRoom })
    expect(startFloorEdit(upperRoom)).toBe(true)
    expect(useFloorEditSession.getState().session?.zoneId).toBe(upperRoom)
    expect(finishFloorEdit()).toBe(true)
    expect(useFloorEditSession.getState().session).toBeNull()
    expect(useEditor.getState().room).toEqual({ levelId: UPPER, zoneId: upperRoom })
  })

  test('Done in the opening panel and Delete both land on the room', () => {
    const id = cutVoid()
    useViewer.getState().setSelection({ selectedIds: [id as FloorOpeningNode['id']] })
    expect(finishFloorOpening(id)).toBe(true)
    expect(useViewer.getState().selection.selectedIds).toEqual([])
    expect(useEditor.getState().room).toEqual({ levelId: UPPER, zoneId: upperRoom })

    useViewer.getState().setSelection({ selectedIds: [id as FloorOpeningNode['id']] })
    const before = history()
    expect(deleteFloorOpening(id)).toBe(true)
    expect(openings()).toEqual([])
    expect(history()).toBe(before + 1)
    expect(useEditor.getState().room).toEqual({ levelId: UPPER, zoneId: upperRoom })
  })
})
