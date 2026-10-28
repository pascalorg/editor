import { expect, test } from 'bun:test'
import { type AnyNodeId, FoundationNode, type GeometryContext, useScene } from '@pascal-app/core'
import { movedEdgeKeepingNeighbours } from '../shared/polygon-vertex-affordance'
import { buildFoundationFloorplan } from './floorplan'
import {
  foundationMoveEdgeAffordance,
  foundationMoveVertexAffordance,
  squareToNeighbours,
} from './floorplan-affordances'

globalThis.requestAnimationFrame ??= () => 1
globalThis.cancelAnimationFrame ??= () => {}

const BOX: Array<[number, number]> = [
  [0, 0],
  [10, 0],
  [10, 8],
  [0, 8],
]

test('a side pulled out keeps its square neighbours square: the box grows', () => {
  // The east side (1 → 2) out 2 m, along +x.
  expect(movedEdgeKeepingNeighbours(BOX, 1, [1, 0], 2)).toEqual([
    [0, 0],
    [12, 0],
    [12, 8],
    [0, 8],
  ])
})

test('pulling out one piece of a split side makes a square bump-out', () => {
  // The south side split at x 4: its east piece (1 → 2) out 1.5 m, to -z.
  const split: Array<[number, number]> = [
    [0, 0],
    [4, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ]
  expect(movedEdgeKeepingNeighbours(split, 1, [0, -1], 1.5)).toEqual([
    [0, 0],
    [4, 0],
    [4, -1.5],
    [10, -1.5],
    [10, 8],
    [0, 8],
  ])
})

test('a slanted neighbour keeps its angle, running on to meet the side', () => {
  // A trapezoid: the east side leans in; the north side pulled 1 m to +z.
  const trapezoid: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [8, 8],
    [0, 8],
  ]
  const [, , east, north] = movedEdgeKeepingNeighbours(trapezoid, 2, [0, 1], 1)
  expect(north).toEqual([0, 9])
  // On the same line as before, from (10, 0) through (8, 8): 1 m further, a quarter across.
  expect(east?.[0]).toBeCloseTo(7.75, 9)
  expect(east?.[1]).toBeCloseTo(9, 9)
})

test('a still side stays as it was, no hair-width jog', () => {
  const split: Array<[number, number]> = [
    [0, 0],
    [4, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ]
  expect(movedEdgeKeepingNeighbours(split, 1, [0, -1], 0.0004)).toEqual(split)
})

test('a dragged corner squares to its neighbours, and a straight pull stays straight', () => {
  // The corner (10, 0) pulled east and a little off: the south side stays square.
  expect(squareToNeighbours([12, 0.06], [12, 0.06], BOX, 1)).toEqual([12, 0])
  // Pulled straight south: it stays on its own x.
  expect(squareToNeighbours([10.08, -2], [10.08, -2], BOX, 1)).toEqual([10, -2])
  // Near both neighbours' lines at once: square to both.
  expect(squareToNeighbours([0.05, 7.9], [0.05, 7.9], BOX, 3)).toEqual([0, 8])
  // Well off square, the grid's point.
  expect(squareToNeighbours([13, 3], [13, 3], BOX, 1)).toEqual([13, 3])
})

test('a picked outline carries a push arrow out of each side', () => {
  const node = FoundationNode.parse({ parentId: 'level_a', polygon: BOX })
  const ctx = { viewState: { selected: true } } as unknown as GeometryContext
  const plan = buildFoundationFloorplan(node, ctx)
  const arrows = plan?.kind === 'group' ? plan.children.filter((c) => c.kind === 'move-arrow') : []
  expect(arrows).toHaveLength(4)
  const east = arrows.find(
    (arrow) =>
      arrow.kind === 'move-arrow' && (arrow.payload as { edgeIndex: number }).edgeIndex === 1,
  )
  // Out of the east side, pointing east, driving that side's push.
  expect(east).toMatchObject({ point: [10.3, 4], affordance: 'move-edge' })
  expect(east?.kind === 'move-arrow' && Math.abs(east.angle)).toBeCloseTo(0, 9)
})

test('in the plan a dragged corner lands square, and a piece of a split side pulls out square', () => {
  const previous = useScene.getState()
  try {
    const node = FoundationNode.parse({ id: 'foundation_drag', polygon: BOX })
    useScene.setState({ nodes: { [node.id]: node }, rootNodeIds: [] } as never)
    const modifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }
    const polygon = () =>
      (useScene.getState().nodes['foundation_drag' as AnyNodeId] as FoundationNode).polygon
    const corner = foundationMoveVertexAffordance.start({
      node,
      payload: { vertexIndex: 1 },
      nodes: useScene.getState().nodes,
      initialPlanPoint: [10, 0],
      gridSnapStep: 0,
    })
    corner.apply({ planPoint: [12.03, 0.07], modifiers } as never)
    expect(polygon()[1]).toEqual([12.03, 0])
    // Alt drags it free.
    corner.apply({ planPoint: [12.03, 0.07], modifiers: { ...modifiers, altKey: true } } as never)
    expect(polygon()[1]).toEqual([12.03, 0.07])

    const split = FoundationNode.parse({
      id: 'foundation_drag',
      polygon: [
        [0, 0],
        [4, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ],
    })
    useScene.setState({ nodes: { [split.id]: split } } as never)
    const side = foundationMoveEdgeAffordance.start({
      node: split,
      payload: { edgeIndex: 1 },
      nodes: useScene.getState().nodes,
      initialPlanPoint: [7, 0],
      gridSnapStep: 0,
    })
    side.apply({ planPoint: [7, -1.5], modifiers } as never)
    expect(polygon()).toEqual([
      [0, 0],
      [4, 0],
      [4, -1.5],
      [10, -1.5],
      [10, 8],
      [0, 8],
    ])
  } finally {
    useScene.setState(previous, true)
  }
})
