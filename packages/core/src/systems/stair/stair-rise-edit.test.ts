import { describe, expect, it } from 'bun:test'
import {
  planStairFlightHeightEdit,
  planStairRiseEdit,
  StairNode,
  type StairNode as StairNodeType,
  StairSegmentNode,
  useScene,
} from '../../index'

describe('stair rise editing', () => {
  it('edits parent rise and child heights atomically and restores all of them with undo', () => {
    const first = StairSegmentNode.parse({ height: 1, stepCount: 5 })
    const landing = StairSegmentNode.parse({ segmentType: 'landing', height: 0, stepCount: 0 })
    const second = StairSegmentNode.parse({ height: 2, stepCount: 10 })
    const stair = StairNode.parse({ totalRise: 3, children: [first.id, landing.id, second.id] })
    for (const segment of [first, landing, second]) segment.parentId = stair.id
    const previous = useScene.getState()
    const originalRaf = globalThis.requestAnimationFrame
    const originalCancel = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = () => 1
    globalThis.cancelAnimationFrame = () => {}
    try {
      useScene.setState({
        nodes: Object.fromEntries([stair, first, landing, second].map((node) => [node.id, node])),
        rootNodeIds: [stair.id],
      })
      useScene.temporal.getState().clear()
      useScene.temporal.getState().resume()
      useScene.getState().updateNodes(planStairRiseEdit(stair, 6, useScene.getState().nodes))
      expect((useScene.getState().nodes[first.id] as StairSegmentNode).height).toBe(2)
      expect((useScene.getState().nodes[second.id] as StairSegmentNode).height).toBe(4)
      expect((useScene.getState().nodes[landing.id] as StairSegmentNode).height).toBe(0)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      useScene.temporal.getState().undo()
      expect((useScene.getState().nodes[stair.id] as StairNodeType).totalRise).toBe(3)
      expect((useScene.getState().nodes[first.id] as StairSegmentNode).height).toBe(1)
      expect((useScene.getState().nodes[second.id] as StairSegmentNode).height).toBe(2)
      useScene
        .getState()
        .updateNodes(planStairFlightHeightEdit(first, 1.5, useScene.getState().nodes))
      expect((useScene.getState().nodes[stair.id] as StairNodeType).totalRise).toBe(3.5)
    } finally {
      useScene.setState(previous)
      useScene.temporal.getState().clear()
      globalThis.requestAnimationFrame = originalRaf
      globalThis.cancelAnimationFrame = originalCancel
    }
  })
})

it('refuses a parent rise below positive landing elevations without mutating the scene', () => {
  const flight = StairSegmentNode.parse({ height: 1 })
  const landing = StairSegmentNode.parse({ segmentType: 'landing', height: 0.5 })
  const stair = StairNode.parse({ children: [flight.id, landing.id], totalRise: 1.5 })
  const nodes = Object.fromEntries([stair, flight, landing].map((node) => [node.id, node]))
  expect(() => planStairRiseEdit(stair, 0.5, nodes)).toThrow(RangeError)
  expect(nodes[flight.id]).toEqual(flight)
  expect(stair.totalRise).toBe(1.5)
})
