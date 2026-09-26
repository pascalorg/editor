import { describe, expect, test } from 'bun:test'
import type { BlockNode, GeometryContext } from '@pascal-app/core'
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
