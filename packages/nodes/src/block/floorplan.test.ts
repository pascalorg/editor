import { describe, expect, test } from 'bun:test'
import type { BlockNode, GeometryContext } from '@pascal-app/core'
import {
  BlockNode as BlockNodeSchema,
  type FloorplanGeometry,
  type FloorplanPoint,
  pointInPolygon2D,
} from '@pascal-app/core'
import { createFloorplanContextExtensions } from '@pascal-app/editor'
import { buildBlockFloorplan, isOverheadBlock, PLAN_CUT_HEIGHT } from './floorplan'

/** A box block `w` × `h` × `d` with its bottom at local y = 0, placed at `y`. */
function block(y: number, w = 4, h = 0.2, d = 3): BlockNode {
  const p = (x: number, yy: number, z: number) => [x, yy, z] as [number, number, number]
  const corners = [
    p(-w / 2, 0, -d / 2),
    p(w / 2, 0, -d / 2),
    p(w / 2, 0, d / 2),
    p(-w / 2, 0, d / 2),
    p(-w / 2, h, -d / 2),
    p(w / 2, h, -d / 2),
    p(w / 2, h, d / 2),
    p(-w / 2, h, d / 2),
  ]
  return {
    id: 'block_1',
    type: 'block',
    position: [1, y, 2],
    rotation: 0,
    topology: {
      vertices: corners.map((position, i) => ({ id: `v${i}`, position })),
      edges: [],
      faces: [],
    },
  } as unknown as BlockNode
}

const ctxFor = (drafting: boolean, selected = false): GeometryContext =>
  ({
    viewState: { selected },
    extensions: createFloorplanContextExtensions({ purpose: 'document', drafting }),
  }) as unknown as GeometryContext

describe('buildBlockFloorplan — overhead trim stays off a drafted sheet', () => {
  test('a fascia block at roof height is overhead; a cabinet on the floor is not', () => {
    expect(isOverheadBlock(block(2.6))).toBe(true)
    expect(isOverheadBlock(block(0))).toBe(false)
    expect(isOverheadBlock(block(PLAN_CUT_HEIGHT - 0.05))).toBe(false)
  })

  test('on a sheet an overhead block draws nothing; a floor block prints as an outline', () => {
    expect(buildBlockFloorplan(block(2.6), ctxFor(true))).toBeNull()
    const floor = buildBlockFloorplan(block(0), ctxFor(true))
    expect(floor?.kind).toBe('group')
    const poly = floor?.kind === 'group' ? floor.children[0] : null
    expect(poly?.kind).toBe('polygon')
    if (poly?.kind === 'polygon') {
      expect(poly.fill).toBe('none')
      expect(poly.stroke).toBe('#111827')
    }
  })

  test('without drafting every block keeps its wash, overhead or not', () => {
    for (const y of [0, 2.6]) {
      const g = buildBlockFloorplan(block(y), ctxFor(false))
      const poly = g?.kind === 'group' ? g.children[0] : null
      expect(poly?.kind).toBe('polygon')
      if (poly?.kind === 'polygon') {
        expect(poly.fill).toBe('#cbd5e1')
        expect(poly.strokeDasharray).toBeUndefined()
      }
    }
  })
})

type Point = [number, number, number]

/** A prism over a plan outline (one or more rings) from y 0 to 1. */
function prism(outlines: [number, number][][]) {
  const vertices: { id: string; position: Point }[] = []
  const faces: { id: string; vertexIds: string[]; materialSlot: string }[] = []
  for (const [ring, outline] of outlines.entries()) {
    const ids = outline.map((_, i) => [`v${ring}-${i}-b`, `v${ring}-${i}-t`] as const)
    outline.forEach(([x, z], i) => {
      vertices.push(
        { id: ids[i]![0], position: [x, 0, z] },
        { id: ids[i]![1], position: [x, 1, z] },
      )
      const j = (i + 1) % outline.length
      faces.push({
        id: `f${ring}-${i}`,
        vertexIds: [ids[i]![0], ids[j]![0], ids[j]![1], ids[i]![1]],
        materialSlot: 'body',
      })
    })
    faces.push(
      { id: `f${ring}-top`, vertexIds: ids.map(([, top]) => top).reverse(), materialSlot: 'body' },
      { id: `f${ring}-bottom`, vertexIds: ids.map(([bottom]) => bottom), materialSlot: 'body' },
    )
  }
  const edges = new Map<string, { id: string; vertexIds: [string, string] }>()
  for (const face of faces) {
    face.vertexIds.forEach((id, i) => {
      const next = face.vertexIds[(i + 1) % face.vertexIds.length]!
      const key = [id, next].sort().join('|')
      if (!edges.has(key)) edges.set(key, { id: `e${edges.size}`, vertexIds: [id, next] })
    })
  }
  return BlockNodeSchema.parse({
    name: 'Plan probe',
    topology: { vertices, edges: [...edges.values()], faces },
  })
}

/** Whether the drawn plan fills a point, honouring evenodd holes. */
function fills(geometry: FloorplanGeometry | null, point: FloorplanPoint): boolean {
  if (geometry?.kind !== 'group') return false
  let crossings = 0
  for (const child of geometry.children) {
    if (child.kind === 'polygon') {
      if (pointInPolygon2D(point as [number, number], child.points as [number, number][]))
        crossings++
    } else if (child.kind === 'path') {
      expect(child.fillRule).toBe('evenodd')
      for (const ring of child.d.split('Z').filter((part) => part.includes('M'))) {
        const points = [...ring.matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map(
          (match) => [Number(match[1]), Number(match[2])] as [number, number],
        )
        if (pointInPolygon2D(point as [number, number], points)) crossings++
      }
    }
  }
  return crossings % 2 === 1
}

describe('buildBlockFloorplan', () => {
  test('draws an L-shaped block as the L, not its convex hull', () => {
    const plan = buildBlockFloorplan(
      prism([
        [
          [0, 0],
          [2, 0],
          [2, 1],
          [1, 1],
          [1, 2],
          [0, 2],
        ],
      ]),
    )
    expect(fills(plan, [0.5, 0.5])).toBe(true)
    expect(fills(plan, [1.5, 0.5])).toBe(true)
    expect(fills(plan, [0.5, 1.5])).toBe(true)
    // The notch stays empty.
    expect(fills(plan, [1.5, 1.5])).toBe(false)
  })

  test('draws a ring-shaped block with its hole and separate parts apart', () => {
    const square = (x: number, z: number, size: number): [number, number][] => [
      [x, z],
      [x + size, z],
      [x + size, z + size],
      [x, z + size],
    ]
    // A 1 m wide frame around a 2 m opening, built from four bars, plus a detached post.
    const plan = buildBlockFloorplan(
      prism([
        [
          [0, 0],
          [4, 0],
          [4, 1],
          [0, 1],
        ],
        [
          [0, 3],
          [4, 3],
          [4, 4],
          [0, 4],
        ],
        [
          [0, 1],
          [1, 1],
          [1, 3],
          [0, 3],
        ],
        [
          [3, 1],
          [4, 1],
          [4, 3],
          [3, 3],
        ],
        square(6, 0, 0.5),
      ]),
    )
    expect(fills(plan, [0.5, 2])).toBe(true)
    expect(fills(plan, [2, 0.5])).toBe(true)
    expect(fills(plan, [6.25, 0.25])).toBe(true)
    // The opening and the gap between the parts stay empty.
    expect(fills(plan, [2, 2])).toBe(false)
    expect(fills(plan, [5, 0.25])).toBe(false)
  })
})
