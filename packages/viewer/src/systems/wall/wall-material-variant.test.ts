import { describe, expect, test } from 'bun:test'
import { resolveWallMaterialVariant } from './wall-material-variant'

// Truth table for WallCutout's per-wall material choice. The new arm: a
// HIDDEN wall hovered in select mode glows (hover-invisible) — QA f2 found
// hidden walls were hover targets with NO visible affordance, so the only
// thing lighting up on hover was the furniture behind them.

const base = {
  translucentMode: false,
  hidden: false,
  deleteHighlighted: false,
  selectionHighlighted: false,
  hoverHighlighted: false,
}

describe('resolveWallMaterialVariant', () => {
  test('base variants by display mode', () => {
    expect(resolveWallMaterialVariant(base)).toBe('visible')
    expect(resolveWallMaterialVariant({ ...base, hidden: true })).toBe('invisible')
    expect(resolveWallMaterialVariant({ ...base, translucentMode: true })).toBe('translucent')
    // translucent mode overrides the hide state (matches getWallHideState use)
    expect(resolveWallMaterialVariant({ ...base, translucentMode: true, hidden: true })).toBe(
      'translucent',
    )
  })

  test('hovered hidden wall glows — the X-ray hover affordance', () => {
    expect(resolveWallMaterialVariant({ ...base, hidden: true, hoverHighlighted: true })).toBe(
      'hover-invisible',
    )
  })

  test('hover never restyles visible or translucent walls (outline pass owns those)', () => {
    expect(resolveWallMaterialVariant({ ...base, hoverHighlighted: true })).toBe('visible')
    expect(
      resolveWallMaterialVariant({ ...base, translucentMode: true, hoverHighlighted: true }),
    ).toBe('translucent')
  })

  test('selection outranks hover; delete outranks both', () => {
    expect(
      resolveWallMaterialVariant({
        ...base,
        hidden: true,
        selectionHighlighted: true,
        hoverHighlighted: true,
      }),
    ).toBe('selection-invisible')
    expect(
      resolveWallMaterialVariant({
        ...base,
        hidden: true,
        deleteHighlighted: true,
        selectionHighlighted: true,
        hoverHighlighted: true,
      }),
    ).toBe('delete-invisible')
  })

  test('delete and selection variants track the display mode', () => {
    expect(resolveWallMaterialVariant({ ...base, deleteHighlighted: true })).toBe('delete-visible')
    expect(
      resolveWallMaterialVariant({ ...base, translucentMode: true, deleteHighlighted: true }),
    ).toBe('delete-translucent')
    expect(resolveWallMaterialVariant({ ...base, selectionHighlighted: true })).toBe(
      'selection-visible',
    )
    expect(
      resolveWallMaterialVariant({ ...base, translucentMode: true, selectionHighlighted: true }),
    ).toBe('selection-translucent')
    expect(resolveWallMaterialVariant({ ...base, hidden: true, selectionHighlighted: true })).toBe(
      'selection-invisible',
    )
  })
})
