import { describe, expect, test } from 'bun:test'
import type { BlockNode, GeometryContext } from '@pascal-app/core'
import { createFloorplanContextExtensions } from '@pascal-app/editor'
import { buildBlockFloorplan, isOverheadBlock, PLAN_CUT_HEIGHT } from './floorplan'

/** A box block `w` × `h` × `d` with its bottom at local y = 0, placed at `y`. */
function block(y: number, w = 4, h = 0.2, d = 3): BlockNode {
  const p = (x: number, yy: number, z: number) => [x, yy, z] as [number, number, number]
  const corners = [p(-w / 2, 0, -d / 2), p(w / 2, 0, -d / 2), p(w / 2, 0, d / 2), p(-w / 2, 0, d / 2), p(-w / 2, h, -d / 2), p(w / 2, h, -d / 2), p(w / 2, h, d / 2), p(-w / 2, h, d / 2)]
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

const ctxFor = (purpose: 'edit' | 'document', selected = false): GeometryContext =>
  ({
    viewState: { selected },
    extensions: createFloorplanContextExtensions({ purpose }),
  }) as unknown as GeometryContext

describe('buildBlockFloorplan — overhead trim stays off the plan (2026-09-09)', () => {
  test('a fascia block at roof height is overhead; a cabinet on the floor is not', () => {
    expect(isOverheadBlock(block(2.6))).toBe(true)
    expect(isOverheadBlock(block(0))).toBe(false)
    expect(isOverheadBlock(block(PLAN_CUT_HEIGHT - 0.05))).toBe(false)
  })

  test('on paper an overhead block draws nothing; a floor block prints as an outline', () => {
    expect(buildBlockFloorplan(block(2.6), ctxFor('document'))).toBeNull()
    const floor = buildBlockFloorplan(block(0), ctxFor('document'))
    expect(floor?.kind).toBe('group')
    const poly = floor?.kind === 'group' ? floor.children[0] : null
    expect(poly?.kind).toBe('polygon')
    if (poly?.kind === 'polygon') {
      expect(poly.fill).toBe('none')
      expect(poly.stroke).toBe('#111827')
    }
  })

  test('in the editor an overhead block is a faint dashed outline with an invisible fill, still clickable', () => {
    const g = buildBlockFloorplan(block(2.6), ctxFor('edit'))
    const poly = g?.kind === 'group' ? g.children[0] : null
    expect(poly?.kind).toBe('polygon')
    if (poly?.kind === 'polygon') {
      expect(poly.fillOpacity).toBe(0)
      expect(poly.strokeDasharray).toBeDefined()
      expect(poly.pointerEvents).toBe('all')
    }
    // a floor block keeps its wash in the editor
    const f = buildBlockFloorplan(block(0), ctxFor('edit'))
    const fp = f?.kind === 'group' ? f.children[0] : null
    if (fp?.kind === 'polygon') expect(fp.fill).toBe('#cbd5e1')
  })
})
