import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  CEILING_BUILD_UP_PRESETS,
  CeilingNode,
  useScene,
} from '@pascal-app/core'
import { getNodePanelModel, type MultiPanelControl } from '@pascal-app/editor'
import { ceilingDefinition } from './definition'

globalThis.requestAnimationFrame ??= () => 0
globalThis.cancelAnimationFrame ??= () => {}

const originalState = useScene.getState()
afterEach(() => useScene.setState(originalState))

type Choice = Extract<MultiPanelControl, { options: unknown }>

const load = (nodes: AnyNode[]) => {
  useScene.setState({
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>,
    rootNodeIds: [],
  })
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
}
const current = <T extends AnyNode>(nodes: T[]) =>
  nodes.map((n) => useScene.getState().nodes[n.id as AnyNodeId] as T)

test('multi-selected ceilings take one layers preset; mixed reads as mixed', () => {
  const chosen = CEILING_BUILD_UP_PRESETS[0]!
  const ceilings = [
    CeilingNode.parse({ polygon: [] }),
    CeilingNode.parse({ polygon: [], buildUp: chosen.buildUp }),
  ]
  load(ceilings)
  const controls = () =>
    getNodePanelModel(ceilingDefinition)!.multiControls!({
      selection: current(ceilings),
      nodes: useScene.getState().nodes,
    }) as Choice[]
  expect(controls()[0]?.value).toBeNull()
  controls()[0]!.onChange(chosen.id)
  expect(current(ceilings).map((ceiling) => ceiling.buildUp)).toEqual([
    chosen.buildUp,
    chosen.buildUp,
  ])
  expect(controls()[0]?.value).toBe(chosen.id)
})
