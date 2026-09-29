import { describe, expect, test } from 'bun:test'
import {
  type FloorplanGeometry,
  type GeometryContext,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { buildWindowFloorplan } from './floorplan'

const wall = WallNode.parse({ id: 'wall_window-plan', start: [0, 0], end: [4, 0], thickness: 0.2 })

function polygonSpans(values: Partial<WindowNode> = {}) {
  const window = WindowNode.parse({
    id: 'window_plan',
    parentId: wall.id,
    wallId: wall.id,
    position: [2, 1.5, 0],
    width: 1.2,
    ...values,
  })
  const geometry = buildWindowFloorplan(window, {
    children: [],
    parent: wall,
    resolve: () => undefined,
    siblings: [],
  } as GeometryContext)
  const children: FloorplanGeometry[] = geometry?.kind === 'group' ? geometry.children : []
  return children
    .filter((item) => item.kind === 'polygon')
    .map((item) => {
      const zs = item.points.map((point) => point[1])
      return { min: Math.min(...zs), max: Math.max(...zs) }
    })
}

describe('buildWindowFloorplan wall-local plane offset', () => {
  test('a centred window keeps its footprint in the wall cutout', () => {
    const [footprint] = polygonSpans()
    expect(footprint?.min).toBeCloseTo(-0.1, 9)
    expect(footprint?.max).toBeCloseTo(0.1, 9)
  })

  test('a frame standing proud of the wall draws outside that face, at its own depth', () => {
    const spans = polygonSpans({ position: [2, 1.5, -0.205], frameDepth: 0.2068 })
    expect(
      spans.some((span) => Math.abs(span.min + 0.1) < 1e-9 && Math.abs(span.max - 0.1) < 1e-9),
    ).toBe(true)
    const frame = spans.find((span) => Math.abs(span.min + 0.3084) < 1e-9)
    expect(frame).toBeDefined()
    expect(frame?.max).toBeCloseTo(-0.1016, 9)
  })
})
