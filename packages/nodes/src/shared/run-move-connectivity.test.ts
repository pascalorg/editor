import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  LevelNode,
  nodeRegistry,
  PipeFittingNode,
  PipeSegmentNode,
  registerNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { pipeFittingDefinition } from '../pipe-fitting/definition'
import { pipeSegmentDefinition } from '../pipe-segment/definition'
import { startRunMoveConnectivity } from './run-move-connectivity'

type Point = [number, number, number]

let restore: ReturnType<typeof nodeRegistry._snapshot>
let previous: ReturnType<typeof useScene.getState>['nodes']
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  registerNode(pipeSegmentDefinition)
  registerNode(pipeFittingDefinition)
  previous = useScene.getState().nodes
})
afterEach(() => {
  useLiveNodeOverrides.getState().clearAll()
  useScene.setState({ nodes: previous })
  restore()
})

/** A run whose end corner turns into a U that loops back to the corner at its start. */
function loopedRun() {
  const level = LevelNode.parse({})
  const run = PipeSegmentNode.parse({
    ...pipeSegmentDefinition.defaults(),
    parentId: level.id,
    path: [
      [0.07, 1, 0],
      [3.93, 1, 0],
    ],
  })
  const corner = (position: Point, rotationY: number) =>
    PipeFittingNode.parse({
      ...pipeFittingDefinition.defaults(),
      parentId: level.id,
      position,
      rotation: [0, rotationY, 0],
    })
  const u = PipeSegmentNode.parse({
    ...pipeSegmentDefinition.defaults(),
    parentId: level.id,
    path: [
      [4, 1, 0.07],
      [4, 1, 2],
      [0, 1, 2],
      [0, 1, 0.07],
    ],
  })
  const nodes = [level, run, corner([4, 1, 0], 0), u, corner([0, 1, 0], Math.PI / 2)]
  useScene.setState({
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node as AnyNode])),
  } as never)
  return run
}

test('a transform the followers cannot follow keeps the last preview and commits nothing', () => {
  const run = loopedRun()
  const connectivity = startRunMoveConnectivity(run as AnyNode)!
  const shifted = run.path.map(([x, y, z]) => [x, y, z + 0.2] as Point)
  const shown = connectivity.preview({ path: shifted })
  expect(shown).not.toBeNull()
  const overrides = new Map(useLiveNodeOverrides.getState().overrides)
  expect(overrides.size).toBeGreaterThan(0)

  // Stretching the end along the run would carry the U with it and drag the
  // start corner off the run's start.
  const stretched: Point[] = [run.path[0]!, [4.43, 1, 0]]
  expect(connectivity.preview({ path: stretched })).toBeNull()
  expect(new Map(useLiveNodeOverrides.getState().overrides)).toEqual(overrides)
  expect(connectivity.commitUpdates({ path: stretched })).toBeNull()
  expect(connectivity.commitUpdates({ path: shifted })).toEqual(shown!)
})
