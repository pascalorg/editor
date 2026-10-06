import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  clearSceneHistory,
  createSceneApi,
  getEffectiveNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  StairNode,
  StairSegmentNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { commitFreshPlacementSubtree, useEditor } from '@pascal-app/editor'
import { z } from 'zod'
import { stairDefinition } from './definition'

const originalRaf = globalThis.requestAnimationFrame
const originalCancelRaf = globalThis.cancelAnimationFrame
beforeEach(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
})

const initialScene = useScene.getState()
const initialEditor = useEditor.getState()
const modifiers = { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false }

afterEach(() => {
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancelRaf
  useLiveNodeOverrides.getState().clearAll()
  useScene.setState(initialScene, true)
  useEditor.setState(initialEditor, true)
  clearSceneHistory()
})

function setup() {
  if (!nodeRegistry.has('landscape:deck'))
    registerNode({
      kind: 'landscape:deck',
      schemaVersion: 1,
      schema: z.object({ type: z.literal('landscape:deck') }),
      category: 'site',
      defaults: () => ({}),
      capabilities: {
        surfaces: {
          top: {
            height: (raw: AnyNode) => (raw as unknown as { thickness: number }).thickness,
            boundary: () => [
              [-2, -1.5],
              [2, -1.5],
              [2, 1.5],
              [-2, 1.5],
            ],
          },
        },
      },
    } as AnyNodeDefinition)
  useEditor.setState({
    tool: 'stair',
    snappingModeByContext: {
      ...useEditor.getState().snappingModeByContext,
      item: 'lines',
    },
  })
  const level = LevelNode.parse({ id: 'level_landscape_move' })
  const flight = StairSegmentNode.parse({
    id: 'sseg_landscape_move',
    parentId: 'stair_landscape_move',
  })
  const stair = StairNode.parse({
    id: 'stair_landscape_move',
    parentId: level.id,
    children: [flight.id],
    position: [0, 0, -2],
  })
  const deck = {
    id: 'deck_landscape_move',
    type: 'landscape:deck',
    parentId: level.id,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    width: 4,
    depth: 3,
    thickness: 0.8,
    shape: 'rectangle',
  } as unknown as AnyNode
  const nodes = { [level.id]: level, [stair.id]: stair, [flight.id]: flight, [deck.id]: deck }
  useScene.setState({ nodes, rootNodeIds: [level.id], dirtyNodes: new Set() })
  useScene.temporal.getState().resume()
  clearSceneHistory()
  const session = stairDefinition.floorplanMoveTarget!({
    node: stair,
    nodes,
    sceneApi: createSceneApi(useScene),
  })
  return { stair, flight, deck, session }
}

test('2D landscape attachment previews without scene writes and commits the flight in one undo', () => {
  const { stair, flight, deck, session } = setup()
  const before = useScene.getState().nodes
  session.apply({ planPoint: [0, -2], modifiers })
  const previewStair = getEffectiveNode(stair)
  const previewFlight = getEffectiveNode(flight)
  expect(useScene.getState().nodes).toBe(before)
  expect(previewStair.landscapeSurfaceId).toBe(deck.id)
  expect(previewFlight.height).toBeCloseTo(previewStair.totalRise!)
  expect(previewFlight.stepCount).toBe(previewStair.stepCount)
  expect(session.canCommit()).toBe(true)
  session.commit!()
  expect(useScene.getState().nodes[stair.id]).toMatchObject({ landscapeSurfaceId: deck.id })
  expect(useScene.getState().nodes[flight.id]).toMatchObject({
    height: previewFlight.height,
    length: previewFlight.length,
  })
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[stair.id]).toEqual(stair)
  expect(useScene.getState().nodes[flight.id]).toEqual(flight)
})

test('Alt releases the landscape preview and commits the free position', () => {
  const { stair, flight, session } = setup()
  session.apply({ planPoint: [0, -2], modifiers })
  expect(getEffectiveNode(stair).landscapeSurfaceId).toBeDefined()
  session.apply({ planPoint: [0.13, -2.17], modifiers: { ...modifiers, altKey: true } })
  expect(getEffectiveNode(stair).landscapeSurfaceId).toBeUndefined()
  expect(getEffectiveNode(flight)).toEqual(flight)
  session.commit!()
  expect(useScene.getState().nodes[stair.id]).toMatchObject({ position: [0.13, 0, -2.17] })
})

test('fresh 2D stair replacement keeps the snapped flight preview', () => {
  const { stair, flight, deck, session } = setup()
  useScene.getState().updateNode(stair.id, { metadata: { isNew: true } })
  session.apply({ planPoint: [0, -2], modifiers })
  const expected = getEffectiveNode(flight)
  const id = commitFreshPlacementSubtree(stair.id, getEffectiveNode(stair))!
  const committed = useScene.getState().nodes[id] as StairNode
  const committedFlight = useScene.getState().nodes[committed.children[0]!] as StairSegmentNode
  expect(committed.landscapeSurfaceId).toBe(deck.id)
  expect(committedFlight.height).toBe(expected.height)
  expect(committedFlight.length).toBe(expected.length)
  expect(committedFlight.stepCount).toBe(expected.stepCount)
})
