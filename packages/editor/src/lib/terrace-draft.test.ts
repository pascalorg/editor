import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  clearSceneHistory,
  createZone,
  generateId,
  initSpaceDetectionSync,
  LevelNode,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import {
  moveFloorRegion,
  pressFloorRegion,
  releaseFloorRegion,
  useFloorRegionDraft,
} from './floor-region-session'
import type { FloorRegionPoint, FloorRegionSnapSettings } from './floor-region-snap'
import { liveGestureKinds } from './gesture-lifecycle'
import { applyRoomPlan } from './room-structure-commands'
import {
  cancelTerraceDraft,
  planTerrace,
  startTerraceDraft,
  useTerraceDraft,
} from './terrace-draft'

const LEVEL = 'level_terrace'
const OFF: FloorRegionSnapSettings = { mode: 'off', step: 0.5 }
let stop = () => {}
const nodes = () => useScene.getState().nodes as Record<string, AnyNode>
const history = () => useScene.temporal.getState().pastStates.length
const zones = () =>
  Object.values(nodes()).filter((n): n is ZoneNode => n.type === 'zone' && n.spaceRole === 'room')

function box(from: FloorRegionPoint, to: FloorRegionPoint) {
  const host = useTerraceDraft.getState().host!
  pressFloorRegion('rectangle', host, from, OFF, 0.2)
  moveFloorRegion(to, OFF, 0.2)
  releaseFloorRegion(0.2)
}

beforeEach(() => {
  globalThis.requestAnimationFrame ??= (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame ??= () => {}
  useInteractionScope.getState().end()
  const building = BuildingNode.parse({ id: 'building_terrace', children: [LEVEL] })
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
  applyRoomPlan(
    createZone(nodes(), {
      levelId: LEVEL,
      polygon: [
        [0, 0],
        [6, 0],
        [6, 5],
        [0, 5],
      ],
      enclose: true,
      name: 'Living room',
      mintId: generateId,
    }),
  )
  useViewer.getState().setSelection({ buildingId: building.id, levelId: LEVEL, selectedIds: [] })
  useEditor.setState({ phase: 'building', mode: 'select', room: null })
  useFloorRegionDraft.setState({ draft: null, hover: null })
  clearSceneHistory()
})
afterEach(() => {
  cancelTerraceDraft()
  stop()
  stop = () => {}
})

describe('terrace tool', () => {
  test('a terrace is an outdoor room: separators where no wall runs, no ceiling', () => {
    const walls = Object.values(nodes()).filter((n) => n.type === 'wall').length
    const result = planTerrace(nodes(), LEVEL, [
      [6, 0],
      [10, 0],
      [10, 5],
      [6, 5],
    ])
    expect('plan' in result).toBe(true)
    if (!('plan' in result)) return
    applyRoomPlan(result.plan)
    const terrace = nodes()[result.plan.zoneId] as ZoneNode
    expect(terrace).toMatchObject({ name: 'Terrace', spaceRole: 'room', hasCeiling: false })
    expect(Object.values(nodes()).filter((n) => n.type === 'wall')).toHaveLength(walls)
    // Three new sides are separators; the fourth is the house wall it shares.
    expect(Object.values(nodes()).filter((n) => n.type === 'separator')).toHaveLength(3)
    expect(
      Object.values(nodes()).some((n) => n.type === 'ceiling' && n.zoneId === terrace.id),
    ).toBe(false)
  })

  test('refuses an outline over a room', () => {
    expect(
      planTerrace(nodes(), LEVEL, [
        [4, 1],
        [8, 1],
        [8, 3],
        [4, 3],
      ]),
    ).toEqual({ message: 'The terrace overlaps Living room.' })
  })

  test('draws like the room tools: each outline one undo step, the tool stays armed', () => {
    expect(startTerraceDraft(LEVEL)).toBe(true)
    expect(liveGestureKinds()).toEqual(['terrace-draft'])
    box([7, 0], [11, 4])
    expect(
      zones()
        .map((zone) => zone.name)
        .sort(),
    ).toEqual(['Living room', 'Terrace'])
    expect(history()).toBe(1)
    expect(useTerraceDraft.getState().host).not.toBeNull()
    // An outline over the house is refused in place; nothing is written.
    box([2, 2], [4, 4])
    expect(useFloorRegionDraft.getState().draft).toMatchObject({
      refusal: 'The terrace overlaps Living room.',
    })
    expect(history()).toBe(1)
    cancelTerraceDraft()
    expect(useTerraceDraft.getState().host).toBeNull()
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  })
})
