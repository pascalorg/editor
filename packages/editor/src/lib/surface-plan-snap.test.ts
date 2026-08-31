import { describe, expect, test } from 'bun:test'
import type { AnyNode, WallNode } from '@pascal-app/core'
import { resolveSurfacePlanPointSnap } from './surface-plan-snap'

const wall = (id: string, start: [number, number], end: [number, number]): WallNode =>
  ({
    id,
    type: 'wall',
    start,
    end,
    visible: true,
  }) as WallNode

const nodesOf = (...walls: WallNode[]): Record<string, AnyNode> =>
  Object.fromEntries(walls.map((node) => [node.id, node as AnyNode]))

// The measurement tool passes `magnetic` explicitly so its snapping never
// depends on the construction snapping-mode chip (whose default 'grid' mode
// turns `isMagneticSnapActive()` off). These tests pin that seam.
describe('resolveSurfacePlanPointSnap magnetic override', () => {
  const walls = [wall('wall-a', [0, 0], [4, 0]), wall('wall-b', [0, 0], [0, 4])]
  const nodes = nodesOf(...walls)

  test('magnetic: true acquires a shared wall corner from the full endpoint radius', () => {
    const result = resolveSurfacePlanPointSnap({
      rawPoint: [0.3, 0.2],
      nodes,
      magnetic: true,
      align: false,
    })
    expect(result.point).toEqual([0, 0])
    expect(result.wallSnap).toBe('endpoint')
    expect(result.wallIds.sort()).toEqual(['wall-a', 'wall-b'])
  })

  test('magnetic: true acquires a T-junction crossing on a wall body', () => {
    const crossing = [wall('wall-a', [0, 0], [4, 0]), wall('wall-c', [3, -1], [3, 3])]
    const result = resolveSurfacePlanPointSnap({
      rawPoint: [3.05, 0.1],
      nodes: nodesOf(...crossing),
      magnetic: true,
      align: false,
    })
    expect(result.point).toEqual([3, 0])
    expect(result.wallSnap).toBe('intersection')
  })

  test('magnetic: false keeps the fallback point outside the tight connect radius', () => {
    const result = resolveSurfacePlanPointSnap({
      rawPoint: [0.3, 0.2],
      fallbackPoint: [0.3, 0.2],
      nodes,
      magnetic: false,
      align: false,
    })
    expect(result.point).toEqual([0.3, 0.2])
    expect(result.wallSnap).toBeNull()
  })

  test('magnetic: false still sticks within the connect radius so ends can meet', () => {
    const result = resolveSurfacePlanPointSnap({
      rawPoint: [0.03, 0.02],
      fallbackPoint: [0.03, 0.02],
      nodes,
      magnetic: false,
      align: false,
    })
    expect(result.point).toEqual([0, 0])
    expect(result.wallSnap).toBe('endpoint')
  })
})
