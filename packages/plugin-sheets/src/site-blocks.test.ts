import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry } from '@pascal-app/core'
import { acceptsNodeForDrawing, chooseBarFeet, siteCornerBlocks } from './drawings'
import type { NodeMap } from './model'
import { worldToSheetInches } from './scale'
import { DEFAULT_VIEWPORT_LAYERS, ViewportNode } from './schema'

const vp = ViewportNode.parse({
  id: 'viewport_site',
  sheetId: 'sheet_1',
  kind: 'site-plan',
  x: 1,
  y: 1,
  w: 20,
  h: 14,
  scale: 240, // 1" = 20'
})

function texts(list: FloorplanGeometry[]): string[] {
  return list.filter((g) => g.kind === 'text').map((g) => (g as { text: string }).text)
}

describe('the site-plan corner block', () => {
  test('carries a north arrow and a graphic scale bar', () => {
    const drawn = siteCornerBlocks(vp, {}, 0)
    expect(texts(drawn)).toContain('N')
    expect(texts(drawn).some((t) => t.startsWith('FEET'))).toBe(true)
    // The bar is labelled 0 / half / full.
    expect(texts(drawn)).toContain('0')
  })

  test('sits inside the bottom-left corner of the viewport', () => {
    const drawn = siteCornerBlocks(vp, {}, 0)
    const box = drawn.find((g) => g.kind === 'rect') as { x: number; y: number; height: number }
    expect(box.x).toBeGreaterThanOrEqual(vp.x)
    expect(box.y + box.height).toBeLessThanOrEqual(vp.y + vp.h)
    // Bottom half of the viewport, left half of it.
    expect(box.y).toBeGreaterThan(vp.y + vp.h / 2)
    expect(box.x).toBeLessThan(vp.x + vp.w / 2)
  })

  test('the bar is a round number of feet that still fits the block', () => {
    const feet = chooseBarFeet(240, 2.0)
    expect([10, 20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400]).toContain(feet)
    expect(worldToSheetInches(feet * 0.3048, 240)).toBeLessThanOrEqual(2.0)
  })

  test('the legend lists only the utility kinds actually in the scene', () => {
    const withWater: NodeMap = {
      u1: { id: 'u1', type: 'utilities:water-line' },
      u2: { id: 'u2', type: 'utilities:utility-pole' },
    }
    const drawn = siteCornerBlocks(vp, withWater, 0)
    const labels = texts(drawn)
    expect(labels).toContain('UTILITIES LEGEND')
    expect(labels).toContain('WATER SERVICE')
    expect(labels).toContain('UTILITY POLE')
    expect(labels).not.toContain('SANITARY SEWER')
  })

  test('no utilities in the scene means no legend at all', () => {
    expect(texts(siteCornerBlocks(vp, {}, 0))).not.toContain('UTILITIES LEGEND')
  })
})

describe('the four yard dimension strings', () => {
  /**
   * WS1 emits them with `metadata.sitePlan === 'yard-dimension'` and no
   * `annotationRole` (`packages/editor/src/lib/floorplan/site-plan/build-site-plan-drawing.ts`,
   * the "Yard dimensions" block), so they ride the AUTOMATIC dimension switch.
   * That switch is on in the viewport defaults, which is what puts them on the
   * default site-plan sheet.
   */
  test('automatic dimensions are on by default, so the yard strings print', () => {
    expect(DEFAULT_VIEWPORT_LAYERS.automaticDimensions).toBe(true)
    expect(DEFAULT_VIEWPORT_LAYERS.manualDimensions).toBe(true)
    expect(DEFAULT_VIEWPORT_LAYERS.siteUtilities).toBe(true)
    expect(DEFAULT_VIEWPORT_LAYERS.terrain).toBe(true)
  })
})

describe('drawing-type filtering', () => {
  const L = DEFAULT_VIEWPORT_LAYERS

  test('a roof plan draws the roof and its penetrations, not the walls', () => {
    expect(acceptsNodeForDrawing(L, 'roof-segment', undefined, 'roof-plan')).toBe(true)
    expect(acceptsNodeForDrawing(L, 'skylight', undefined, 'roof-plan')).toBe(true)
    expect(acceptsNodeForDrawing(L, 'wall', undefined, 'roof-plan')).toBe(false)
    expect(acceptsNodeForDrawing(L, 'zone', undefined, 'roof-plan')).toBe(false)
  })

  test('a foundation plan draws the slab and what bears on it', () => {
    expect(acceptsNodeForDrawing(L, 'slab', undefined, 'foundation-plan')).toBe(true)
    expect(acceptsNodeForDrawing(L, 'wall', undefined, 'foundation-plan')).toBe(true)
    expect(acceptsNodeForDrawing(L, 'roof-segment', undefined, 'foundation-plan')).toBe(false)
  })

  test('a floor plan is unfiltered and still obeys the layer switches', () => {
    expect(acceptsNodeForDrawing(L, 'wall', undefined, 'floor-plan')).toBe(true)
    expect(acceptsNodeForDrawing(L, 'item', undefined, 'floor-plan')).toBe(false) // furniture off
    expect(acceptsNodeForDrawing({ ...L, furniture: true }, 'item', undefined, 'floor-plan')).toBe(
      true,
    )
  })

  test('bones devices ride the ELECTRICAL switch, not the framing one', () => {
    expect(acceptsNodeForDrawing(L, 'bones:device', undefined, 'floor-plan')).toBe(false)
    expect(
      acceptsNodeForDrawing({ ...L, electrical: true }, 'bones:device', undefined, 'floor-plan'),
    ).toBe(true)
    expect(
      acceptsNodeForDrawing({ ...L, electrical: true }, 'bones:service', undefined, 'floor-plan'),
    ).toBe(true)
    // …while framing stays on the framing switch.
    expect(
      acceptsNodeForDrawing({ ...L, electrical: true }, 'bones:framing', undefined, 'floor-plan'),
    ).toBe(false)
  })
})
