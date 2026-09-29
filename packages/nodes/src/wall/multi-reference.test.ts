import { afterEach, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, useScene, WallNode } from '@pascal-app/core'
import { getNodePanelModel } from '@pascal-app/editor'
import { wallDefinition } from './definition'

globalThis.requestAnimationFrame ??= () => 0
globalThis.cancelAnimationFrame ??= () => {}

const originalState = useScene.getState()
afterEach(() => useScene.setState(originalState))

const room = () => {
  const points: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ]
  return points.map((start, i) =>
    WallNode.parse({ start, end: points[(i + 1) % 4], thickness: 0.2 }),
  )
}

test('multi-select Reference: room labels, mixed shows no option, one step for every wall', () => {
  const walls = room()
  const nodes = Object.fromEntries(walls.map((w) => [w.id, w])) as Record<AnyNodeId, AnyNode>
  useScene.setState({ nodes, rootNodeIds: [] })
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
  const controls = (selection: WallNode[]) =>
    getNodePanelModel(wallDefinition)!.multiControls!({
      selection,
      nodes: useScene.getState().nodes,
    })
  const [reference] = controls(walls)
  expect(reference).toMatchObject({
    id: 'wall-reference',
    section: 'Dimensions',
    label: 'Reference',
  })
  expect(reference!.options.map((option) => option.label)).toEqual([
    'Outside face',
    'Center',
    'Inside face',
  ])
  expect(reference!.value).toBe('center')
  reference!.onChange('outside')
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  const after = walls.map((w) => useScene.getState().nodes[w.id as AnyNodeId] as WallNode)
  expect(controls(after)[0]!.value).toBe('outside')
  // Mixed: one wall back to centre.
  const mixed = [{ ...after[0]!, justification: undefined }, ...after.slice(1)] as WallNode[]
  expect(controls(mixed)[0]!.value).toBeNull()
})
