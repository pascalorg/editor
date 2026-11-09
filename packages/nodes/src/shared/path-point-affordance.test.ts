import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  DuctFittingNode,
  DuctSegmentNode,
  LevelNode,
  LinesetNode,
  nodeRegistry,
  registerNode,
  useScene,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { ductFittingDefinition } from '../duct-fitting/definition'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import { ductSegmentDefinition } from '../duct-segment/definition'
import { linesetDefinition } from '../lineset/definition'

type Point = [number, number, number]

let restore: ReturnType<typeof nodeRegistry._snapshot>
let previous: ReturnType<typeof useScene.getState>['nodes']
let gridSnapStep: number
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  registerNode(linesetDefinition)
  registerNode(ductSegmentDefinition)
  registerNode(ductFittingDefinition)
  previous = useScene.getState().nodes
  gridSnapStep = useEditor.getState().gridSnapStep
  useEditor.setState({ gridSnapStep: 0.5 })
})
afterEach(() => {
  useScene.setState({ nodes: previous })
  useEditor.setState({ gridSnapStep })
  restore()
})

const level = LevelNode.parse({})
const held = (altKey: boolean) => ({ altKey, ctrlKey: false, metaKey: false, shiftKey: false })
const current = <N extends AnyNode>(node: N) => useScene.getState().nodes[node.id] as N

function scene(...nodes: AnyNode[]) {
  const all = Object.fromEntries([level, ...nodes].map((node) => [node.id, node])) as Record<
    AnyNodeId,
    AnyNode
  >
  useScene.setState({ nodes: all })
  return all
}

test('a plan-view end drag puts the joined lineset back on a frame that leaves it out', () => {
  const first = LinesetNode.parse({
    parentId: level.id,
    path: [
      [0, 1, 0],
      [2, 1, 0],
    ],
  })
  const second = LinesetNode.parse({
    parentId: level.id,
    path: [
      [2, 1, 0],
      [4, 1, 0],
    ],
  })
  const session = linesetDefinition.floorplanAffordances!['move-path-point']!.start({
    node: first,
    nodes: scene(first, second),
    payload: { pointIndex: 1 },
    initialPlanPoint: [2, 0],
    gridSnapStep: 0.5,
  })
  const followed = [
    [3, 1, 0],
    [4, 1, 0],
  ]

  session.apply({ planPoint: [3, 0], modifiers: held(false) })
  expect(current(second).path).toEqual(followed)
  session.apply({ planPoint: [3.5, 0], modifiers: held(true) })
  expect(current(first).path).toEqual([
    [0, 1, 0],
    [3.5, 1, 0],
  ])
  expect(current(second).path).toEqual(second.path)

  session.apply({ planPoint: [3, 0], modifiers: held(false) })
  expect(current(second).path).toEqual(followed)
  // Back on the start point the delta is zero, which connectivity leaves unwritten.
  session.apply({ planPoint: [2, 0], modifiers: held(false) })
  expect(current(first).path).toEqual(first.path)
  expect(current(second).path).toEqual(second.path)
})

test('a plan-view end drag puts a re-aimed elbow back when Alt detaches the run', () => {
  const elbow = DuctFittingNode.parse({
    ...ductFittingDefinition.defaults(),
    parentId: level.id,
    fittingType: 'elbow',
    position: [4, 1, 0],
  })
  const inlet = getDuctFittingPorts(elbow).find((port) => port.id === 'inlet')!
  const collar: Point = [...inlet.position]
  const far: Point = [
    collar[0] + inlet.direction[0] * 3,
    collar[1],
    collar[2] + inlet.direction[2] * 3,
  ]
  const run = DuctSegmentNode.parse({
    ...ductSegmentDefinition.defaults(),
    parentId: level.id,
    path: [far, collar],
  })
  const session = ductSegmentDefinition.floorplanAffordances!['move-path-point']!.start({
    node: run,
    nodes: scene(run, elbow),
    payload: { pointIndex: 0 },
    initialPlanPoint: [far[0], far[2]],
    gridSnapStep: 0,
  })
  const aside: [number, number] = [
    far[0] - inlet.direction[2] * 0.5,
    far[2] + inlet.direction[0] * 0.5,
  ]

  session.apply({ planPoint: aside, modifiers: held(false) })
  expect(current(elbow)).not.toEqual(elbow)
  session.apply({ planPoint: aside, modifiers: held(true) })
  expect(current(elbow)).toEqual(elbow)
  expect(current(run).path[1]).toEqual(collar)
})
