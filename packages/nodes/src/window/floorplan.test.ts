import { describe, expect, test } from 'bun:test'
import {
  type FloorplanGeometry,
  type GeometryContext,
  LevelNode,
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

  test('an offset auto-depth window is exactly as deep as its wall', () => {
    const spans = polygonSpans({ position: [2, 1.5, -0.205] })
    expect(
      spans.some((span) => Math.abs(span.min + 0.305) < 1e-9 && Math.abs(span.max + 0.105) < 1e-9),
    ).toBe(true)
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

describe('buildWindowFloorplan at a corner window', () => {
  // Two 0.2 m walls meeting at the origin, inside the corner toward +x and +z.
  const wallA = WallNode.parse({ id: 'wall_a', start: [4, 0], end: [0, 0], thickness: 0.2 })
  const wallB = WallNode.parse({ id: 'wall_b', start: [0, 0], end: [0, 3], thickness: 0.2 })
  const windowA = WindowNode.parse({
    id: 'window_a',
    parentId: wallA.id,
    wallId: wallA.id,
    position: [3.5, 1.5, 0],
    width: 1,
    corner: { end: 'end', partnerId: 'window_b', post: 'none' },
  })
  const windowB = WindowNode.parse({
    id: 'window_b',
    parentId: wallB.id,
    wallId: wallB.id,
    position: [0.5, 1.5, 0],
    width: 1,
    corner: { end: 'start', partnerId: 'window_a', post: 'none' },
  })
  const nodes: Record<string, unknown> = {
    [wallA.id]: wallA,
    [wallB.id]: wallB,
    [windowA.id]: windowA,
    [windowB.id]: windowB,
  }
  const footprint = (window: WindowNode) => {
    const geometry = buildWindowFloorplan(window, {
      children: [],
      parent: wallA,
      resolve: (id: string) => nodes[id],
      siblings: [],
    } as unknown as GeometryContext)
    const children: FloorplanGeometry[] = geometry?.kind === 'group' ? geometry.children : []
    const polygon = children.find((item) => item.kind === 'polygon')
    return polygon?.kind === 'polygon' ? polygon.points : []
  }
  const reaches = (points: readonly (readonly number[])[], [x, z]: [number, number]) =>
    points.some((point) => Math.hypot(point[0]! - x, point[1]! - z) < 1e-9)

  test('runs to the walls’ mitre, so the corner between the sides is glass, not wall', () => {
    const points = footprint(windowA)
    expect(reaches(points, [0.1, 0.1])).toBe(true)
    expect(reaches(points, [-0.1, -0.1])).toBe(true)
  })

  test('a window that is no corner pair stops square at its jambs', () => {
    const points = footprint({ ...windowA, corner: undefined })
    expect(reaches(points, [0, 0.1])).toBe(true)
    expect(reaches(points, [0, -0.1])).toBe(true)
  })
})

test('tilt-turn plan shows a tilt mark or an inward turn arc, following room topology', () => {
  const level = LevelNode.parse({ children: [] })
  const points: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ]
  const walls = points.map((start, i) =>
    WallNode.parse({ parentId: level.id, start, end: points[(i + 1) % 4] }),
  )
  level.children = walls.map((wall) => wall.id)
  const nodes = Object.fromEntries([level, ...walls].map((node) => [node.id, node]))
  for (const tiltTurnMode of ['tilt', 'turn'] as const) {
    for (const side of ['front', 'back'] as const) {
      const node = WindowNode.parse({
        parentId: walls[0]!.id,
        position: [2, 1.5, 0],
        windowType: 'tilt-turn',
        tiltTurnMode,
        side,
        rotation: [0, side === 'front' ? 0 : Math.PI, 0],
      })
      const geometry = buildWindowFloorplan(node, {
        parent: walls[0],
        children: [],
        siblings: [],
        resolve: (id: string) => nodes[id],
      } as unknown as GeometryContext)
      const children = geometry?.kind === 'group' ? geometry.children : []
      const symbol = children.find((child) => child.kind === 'path')
      expect(symbol?.kind).toBe('path')
      if (symbol?.kind !== 'path') throw Error('Missing window symbol')
      expect(symbol.d.includes(' A ')).toBe(tiltTurnMode === 'turn')
      // The final point is in the room (+z), for either placement face.
      const numbers = symbol.d.match(/-?[\d.]+/g)!.map(Number)
      if (tiltTurnMode === 'turn') expect(numbers.at(-1)!).toBeGreaterThan(0)
      else expect(numbers[3]!).toBeGreaterThan(0)
    }
  }
})
