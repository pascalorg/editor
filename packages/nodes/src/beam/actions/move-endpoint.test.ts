import { beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BeamNode,
  BuildingNode,
  clearSceneHistory,
  createDragSession,
  createSceneApi,
  LevelNode,
  useScene,
} from '@pascal-app/core'
import { moveBeamEndpointDragAction } from './move-endpoint'

type RafFn = (cb: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (cb) => {
  cb(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const BEAM = BeamNode.parse({ id: 'beam_a', parentId: 'level_g', start: [0, 0], end: [3, 0] })
// Alt: the end goes where the pointer is, whatever the snapping mode.
const free = { shift: false, alt: true, ctrl: false, meta: false }

beforeEach(() => {
  const building = BuildingNode.parse({ id: 'building_a', children: ['level_g'] })
  const level = LevelNode.parse({
    id: 'level_g',
    parentId: building.id,
    level: 0,
    children: [BEAM.id],
  })
  const nodes = Object.fromEntries([building, level, BEAM].map((node) => [node.id, node]))
  useScene.getState().setScene(nodes as Record<AnyNodeId, AnyNode>, [building.id as AnyNodeId], {
    installedPlugins: [],
    hasExplicitPluginInstallState: false,
  })
  clearSceneHistory()
})

const beam = () => useScene.getState().nodes[BEAM.id as AnyNodeId] as BeamNode

test('a dragged end follows the pointer, the other stays, and the drag is one undo step', () => {
  const session = createDragSession(moveBeamEndpointDragAction, createSceneApi(useScene))
  session.start({ node: BEAM, handleId: 'end', point: [3, 0] })
  session.move([4, 1], free)
  expect(beam().end).toEqual([4, 1])
  session.move([5, 2], free)
  expect(session.commit()).toBe(true)
  expect(beam()).toMatchObject({ start: [0, 0], end: [5, 2] })
  useScene.temporal.getState().undo()
  expect(beam()).toMatchObject({ start: [0, 0], end: [3, 0] })
})

test('the start drags too, and a beam too short to draw is put back', () => {
  const session = createDragSession(moveBeamEndpointDragAction, createSceneApi(useScene))
  session.start({ node: BEAM, handleId: 'start', point: [0, 0] })
  session.move([2.998, 0], free)
  expect(session.commit()).toBe(false)
  expect(beam()).toMatchObject({ start: [0, 0], end: [3, 0] })
})

test('Esc puts the beam back', () => {
  const session = createDragSession(moveBeamEndpointDragAction, createSceneApi(useScene))
  session.start({ node: BEAM, handleId: 'start', point: [0, 0] })
  session.move([-1, 1], free)
  session.cancel()
  expect(beam()).toMatchObject({ start: [0, 0], end: [3, 0] })
})
