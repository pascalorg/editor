import { describe, expect, test } from 'bun:test'
import {
  normalizeViewerStageModes,
  resolveMobileViewerStageMode,
  resolveViewerStageMode,
  viewerStageIncludes3D,
} from './viewer-stage-modes'

describe('viewer stage modes', () => {
  test('supports every ordered combination without duplicates', () => {
    expect(normalizeViewerStageModes(['split', '3d', 'split'])).toEqual(['3d', 'split'])
    expect(normalizeViewerStageModes(['2d'])).toEqual(['2d'])
    expect(normalizeViewerStageModes([])).toEqual(['3d'])
  })

  test('reuses normalized combinations across inline prop arrays', () => {
    expect(normalizeViewerStageModes(['split', '3d'])).toBe(
      normalizeViewerStageModes(['3d', 'split']),
    )
  })

  test('falls back to the first enabled mode', () => {
    expect(resolveViewerStageMode('split', ['3d', '2d'])).toBe('3d')
    expect(resolveViewerStageMode(undefined, ['2d', 'split'])).toBe('2d')
  })

  test('uses an enabled single-pane mode on mobile but preserves split-only embeds', () => {
    expect(resolveMobileViewerStageMode('split', ['3d', 'split'])).toBe('3d')
    expect(resolveMobileViewerStageMode('split', ['2d', 'split'])).toBe('2d')
    expect(resolveMobileViewerStageMode('split', ['split'])).toBe('split')
  })

  test('does not require a GPU canvas for a 2D-only embed', () => {
    expect(viewerStageIncludes3D(['2d'])).toBe(false)
    expect(viewerStageIncludes3D(['split'])).toBe(true)
    expect(viewerStageIncludes3D(['3d', '2d'])).toBe(true)
  })
})
