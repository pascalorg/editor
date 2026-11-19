import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  createSceneApi,
  RockNode,
  rockCurrentGen,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import { addRock } from '@pascal-app/core/agent-operations'
import { rockParametrics } from './parametrics'
import { placeRock } from './placement'

const initial = useScene.getState()
const history = useScene.temporal.getState()
afterEach(() => {
  useScene.setState(initial, true)
  useScene.temporal.setState(history)
})

const upgrade = () => {
  const action = rockParametrics.actions?.find((entry) => entry.label === 'Upgrade to gen 2')
  if (!action) throw new Error('Missing generation upgrade action')
  return action
}

test('a rock placed by hand has the current generator, like one made by the agent operation', () => {
  const site = SiteNode.parse({})
  useScene.setState({
    nodes: { [site.id]: site },
    rootNodeIds: [site.id],
    dirtyNodes: new Set(),
    readOnly: false,
  })
  let placed: AnyNodeId | null = null
  placeRock(createSceneApi(useScene), [3, 4], (id) => (placed = id), site.id)
  if (!placed) throw new Error('The rock was not placed')
  const byHand = useScene.getState().nodes[placed] as RockNode
  const byAgent = addRock(
    useScene.getState().nodes,
    { at: [8, 8], size: 2, siteId: site.id },
    {
      activeLevelId: null,
    },
  ).changes?.create?.[0]?.node as RockNode
  expect(byHand.gen).toBe(rockCurrentGen())
  expect(byHand.gen).toBe(byAgent.gen)
  // Nothing to upgrade on it: the action is not offered.
  expect(upgrade().visibleIf?.(byHand)).toBe(false)
})

test('the generator upgrade is offered on a legacy rock only', () => {
  const polygon: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]
  const legacy = RockNode.parse({ polygon })
  const stored = RockNode.parse({ polygon, gen: 1 })
  const current = RockNode.parse({ polygon, gen: 2 })
  expect(upgrade().visibleIf?.(legacy)).toBe(true)
  expect(upgrade().visibleIf?.(stored)).toBe(true)
  expect(upgrade().enabledIf?.(stored)).toBe(true)
  expect(upgrade().visibleIf?.(current)).toBe(false)
})
