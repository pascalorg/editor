import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  clearSceneHistory,
  type GeometryContext,
  getEffectiveNode,
  LawnNode,
  SiteNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { createLawnBrushStroke } from './brush'
import { buildLawnFloorplan } from './floorplan'

const outline: [number, number][] = [
  [0, 0],
  [12, 0],
  [12, 12],
  [0, 12],
]
const site = SiteNode.parse({
  id: 'site_plan',
  children: ['lawn_plan'],
  polygon: { type: 'polygon', points: outline },
})
const lawn = LawnNode.parse({ id: 'lawn_plan', parentId: site.id, outline })
let savedScene: ReturnType<typeof useScene.getState>
let savedOverrides: ReturnType<typeof useLiveNodeOverrides.getState>
beforeEach(() => {
  savedScene = useScene.getState()
  savedOverrides = useLiveNodeOverrides.getState()
  useScene.setState({ nodes: { [site.id]: site, [lawn.id]: lawn }, rootNodeIds: [site.id] })
  useLiveNodeOverrides.getState().clearAll()
  clearSceneHistory()
})
afterEach(() => {
  useScene.setState(savedScene)
  useLiveNodeOverrides.setState(savedOverrides)
  clearSceneHistory()
})

function plan() {
  const nodes: Record<string, AnyNode> = useScene.getState().nodes
  const resolve: GeometryContext['resolve'] = <N = AnyNode>(id: string) =>
    nodes[id] as N | undefined
  const node = nodes[lawn.id]
  if (node?.type !== 'lawn') throw new Error('Expected the lawn')
  return buildLawnFloorplan(getEffectiveNode(node), { parent: site, sceneNodes: nodes, resolve })
}

test('the plan keeps its marks while a stroke is painted and redraws them at release', () => {
  const before = plan()
  const stroke = createLawnBrushStroke(lawn, { radiusM: 3, effect: 'bare', strength: 1 }, [3, 3])
  if (!stroke) throw new Error('Expected a stroke')
  // One drawing for the stroke: later samples do not run the generator again for the plan.
  const first = plan()
  stroke.move([6, 6])
  stroke.move([9, 9])
  expect(plan()).toEqual(first)
  expect(stroke.commit()).toBe(true)
  const released = plan()
  expect(released).not.toEqual(first)
  expect(released).not.toEqual(before)
  // The released plan is the plan of the saved lawn, as any later drawing gives it.
  expect(plan()).toEqual(released)
})
