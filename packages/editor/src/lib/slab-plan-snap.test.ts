import { describe, expect, test } from 'bun:test'
import { type AnyNode, WallNode } from '@pascal-app/core'
import useWallSnapIndicator from '../store/use-wall-snap-indicator'
import { resolveSlabEdgeBandSnap } from './slab-plan-snap'

function sceneWithWall(thickness = 0.1) {
  const wall = WallNode.parse({ start: [0, 0], end: [4, 0], thickness })
  const nodes: Record<string, AnyNode> = { [wall.id]: wall }
  return { wall, nodes }
}

describe('resolveSlabEdgeBandSnap', () => {
  test('magnetic: an edge inside the wall band sticks to the centerline and shows the beacon', () => {
    const { wall, nodes } = sceneWithWall()
    useWallSnapIndicator.getState().clear()

    const snap = resolveSlabEdgeBandSnap({
      edge: [
        [0.5, 0.08],
        [3.5, 0.08],
      ],
      nodes,
      referencePoint: [1, 0.08],
      magnetic: true,
    })

    expect(snap).not.toBeNull()
    expect(snap!.wallId).toBe(wall.id)
    expect(snap!.edge[0][1]).toBeCloseTo(0)
    expect(snap!.edge[1][1]).toBeCloseTo(0)

    const beacon = useWallSnapIndicator.getState().point
    expect(beacon).not.toBeNull()
    expect(beacon!.kind).toBe('wall')
    expect(beacon!.wallIds).toEqual([wall.id])
    // Beacon hugs the reference point projected onto the snapped edge.
    expect(beacon!.x).toBeCloseTo(1)
    expect(beacon!.z).toBeCloseTo(0)
  })

  test('non-magnetic: only the tight connect stick remains', () => {
    const { nodes } = sceneWithWall()

    // 8cm off the centerline: inside the band but beyond the connect radius.
    expect(
      resolveSlabEdgeBandSnap({
        edge: [
          [0.5, 0.08],
          [3.5, 0.08],
        ],
        nodes,
        magnetic: false,
      }),
    ).toBeNull()
    expect(useWallSnapIndicator.getState().point).toBeNull()

    // 4cm: genuinely dropped on the wall — still sticks.
    expect(
      resolveSlabEdgeBandSnap({
        edge: [
          [0.5, 0.04],
          [3.5, 0.04],
        ],
        nodes,
        magnetic: false,
      }),
    ).not.toBeNull()
  })

  test('clears the beacon when the edge leaves every band', () => {
    const { nodes } = sceneWithWall()

    resolveSlabEdgeBandSnap({
      edge: [
        [0.5, 0.05],
        [3.5, 0.05],
      ],
      nodes,
      magnetic: true,
    })
    expect(useWallSnapIndicator.getState().point).not.toBeNull()

    resolveSlabEdgeBandSnap({
      edge: [
        [0.5, 1.5],
        [3.5, 1.5],
      ],
      nodes,
      magnetic: true,
    })
    expect(useWallSnapIndicator.getState().point).toBeNull()
  })
})
