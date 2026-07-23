import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  ConstructionDimensionNode,
  nodeRegistry,
  registerNode,
  useLiveNodeOverrides,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { wallDefinition } from '../wall/definition'
import { moveConstructionDimensionWitnessAffordance } from './floorplan-affordances'

type RafFn = (cb: (t: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= ((
  cb: (t: number) => void,
) => {
  cb(0)
  return 0
}) as RafFn
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const MODIFIERS = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }

function seedScene() {
  const levelId = 'level_construction-dimension-affordance' as AnyNodeId
  const wall = WallNode.parse({
    id: 'wall_dimension-target',
    start: [0, 0],
    end: [4, 0],
    parentId: levelId,
  })
  const dimension = ConstructionDimensionNode.parse({
    id: 'construction-dimension_drag-witness',
    parentId: levelId,
    anchors: [
      {
        kind: 'feature',
        reference: {
          nodeId: wall.id,
          featureId: 'wall:centerline',
          parameters: { t: 0.25 },
        },
        fallback: [1, 0, 0],
      },
      [4, 0, 0],
    ],
  })
  const level = {
    id: levelId,
    type: 'level',
    object: 'node',
    visible: true,
    name: '',
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    level: 0,
    parentId: null,
    children: [wall.id, dimension.id],
  } as unknown as AnyNode
  const nodes = { [levelId]: level, [wall.id]: wall, [dimension.id]: dimension } as Record<
    AnyNodeId,
    AnyNode
  >

  useScene.setState({ nodes: nodes as never })
  return { dimension, nodes, wall }
}

describe('moveConstructionDimensionWitnessAffordance', () => {
  beforeEach(() => {
    nodeRegistry._reset()
    registerNode(wallDefinition)
    useLiveNodeOverrides.getState().clearAll()
  })

  afterEach(() => {
    useLiveNodeOverrides.getState().clearAll()
    nodeRegistry._reset()
  })

  test('reassociates a dragged witness to a nearby semantic wall feature', () => {
    const { dimension, nodes, wall } = seedScene()
    const session = moveConstructionDimensionWitnessAffordance.start({
      node: dimension,
      payload: { witnessIndex: 0 },
      nodes,
      initialPlanPoint: [1, 0],
      gridSnapStep: 0.1,
    })

    session.apply({ planPoint: [3, 0.04], modifiers: MODIFIERS })
    expect(session.canCommit()).toBe(true)
    session.commit?.()

    const updated = useScene.getState().nodes[dimension.id] as typeof dimension
    const anchor = updated.anchors[0]
    expect(Array.isArray(anchor)).toBe(false)
    if (!Array.isArray(anchor)) {
      expect(anchor.reference.nodeId).toBe(wall.id)
      expect(anchor.reference.featureId).toMatch(/^wall:/)
      expect(anchor.fallback[0]).toBeCloseTo(3)
    }
  })

  test('detaches a dragged witness as an explicit free point when Alt bypasses association', () => {
    const { dimension, nodes } = seedScene()
    const session = moveConstructionDimensionWitnessAffordance.start({
      node: dimension,
      payload: { witnessIndex: 0 },
      nodes,
      initialPlanPoint: [1, 0],
      gridSnapStep: 0.1,
    })

    session.apply({ planPoint: [3, 2], modifiers: { ...MODIFIERS, altKey: true } })
    expect(session.canCommit()).toBe(true)
    session.commit?.()

    const updated = useScene.getState().nodes[dimension.id] as typeof dimension
    expect(updated.anchors[0]).toEqual([3, 0, 2])
  })
})
