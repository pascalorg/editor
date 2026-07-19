import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  SlabNode,
  type SlabNode as SlabNodeType,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { slabMoveEdgeAffordance } from '../floorplan-affordances'

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

/**
 * Level + one wall (centerline z=0, t=0.1) + one manual slab whose bottom
 * edge starts 0.5m away from the wall.
 */
function seedScene(autoFromWalls = false) {
  const levelId = 'level_slab-move-edge' as AnyNodeId
  const wall = WallNode.parse({
    start: [0, 0],
    end: [4, 0],
    thickness: 0.1,
    parentId: levelId,
  })
  const slab = SlabNode.parse({
    polygon: [
      [0, 0.5],
      [4, 0.5],
      [4, 3],
      [0, 3],
    ],
    autoFromWalls,
    parentId: levelId,
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
    children: [wall.id, slab.id],
  } as unknown as AnyNode

  useScene.setState({
    nodes: { [levelId]: level, [wall.id]: wall, [slab.id]: slab } as never,
  })
  return { slab }
}

describe('slabMoveEdgeAffordance', () => {
  test('commits the edge exactly on the wall centerline despite a grab offset', () => {
    const { slab } = seedScene()
    const nodes = useScene.getState().nodes

    const session = slabMoveEdgeAffordance.start({
      node: nodes[slab.id] as SlabNodeType,
      payload: { edgeIndex: 0 },
      nodes,
      // Grabbed 0.15m off the stored edge line — inside the wide screen-px
      // hit area. The old cursor-based snap baked this offset into the
      // commit, leaving the edge short of the wall by exactly 0.15.
      initialPlanPoint: [2, 0.65],
      gridSnapStep: 0.1,
    } as never)

    // Drop the candidate edge just next to the centerline (z≈0.04 before
    // any grid quantization) — inside the band / connect stick in every
    // snapping mode.
    session.apply({ planPoint: [2, 0.19], modifiers: MODIFIERS })

    const updated = useScene.getState().nodes[slab.id] as SlabNodeType
    expect(updated.polygon[0]![1]).toBeCloseTo(0, 5)
    expect(updated.polygon[1]![1]).toBeCloseTo(0, 5)
    // Tangential coordinates are untouched by the perpendicular edge drag.
    expect(updated.polygon[0]![0]).toBeCloseTo(0, 5)
    expect(updated.polygon[1]![0]).toBeCloseTo(4, 5)
    // The far edge never moves.
    expect(updated.polygon[2]![1]).toBeCloseTo(3, 5)
    expect(session.canCommit()).toBe(true)
  })

  test('a drag far from any wall keeps pure delta semantics', () => {
    const { slab } = seedScene()
    const nodes = useScene.getState().nodes

    const session = slabMoveEdgeAffordance.start({
      node: nodes[slab.id] as SlabNodeType,
      payload: { edgeIndex: 0 },
      nodes,
      initialPlanPoint: [2, 0.5],
      gridSnapStep: 0.1,
    } as never)

    // Move up 1m — nowhere near the wall band; the edge follows the
    // pointer delta (possibly grid-quantized, which 1.0 is invariant to).
    session.apply({ planPoint: [2, 1.5], modifiers: MODIFIERS })

    const updated = useScene.getState().nodes[slab.id] as SlabNodeType
    expect(updated.polygon[0]![1]).toBeCloseTo(1.5, 5)
    expect(updated.polygon[1]![1]).toBeCloseTo(1.5, 5)
  })

  test('editing an auto-generated outer boundary makes the slab manual', () => {
    const { slab } = seedScene(true)
    const nodes = useScene.getState().nodes

    const session = slabMoveEdgeAffordance.start({
      node: nodes[slab.id] as SlabNodeType,
      payload: { edgeIndex: 0 },
      nodes,
      initialPlanPoint: [2, 0.5],
      gridSnapStep: 0.1,
    } as never)

    session.apply({ planPoint: [2, 1.5], modifiers: MODIFIERS })

    const updated = useScene.getState().nodes[slab.id] as SlabNodeType
    expect(updated.autoFromWalls).toBe(false)
  })
})
