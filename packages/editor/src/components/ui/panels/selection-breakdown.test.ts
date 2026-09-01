import { describe, expect, test } from 'bun:test'
import { type Translator } from './node-display'
import { formatSelectionBreakdown } from './selection-breakdown'

// Mirror the `panel.nodeType.*` keys so the breakdown keeps its lowercase +
// `+s` shape for English; Chinese is the same string repeated (no plural
// inflection). Un-translated kinds echo the key back, which the function
// detects to fall back to the humanized type id.
const en: Translator = (key) => {
  if (key === 'panel.nodeType.slab') return 'Slab'
  if (key === 'panel.nodeType.stair') return 'Stair'
  if (key === 'panel.nodeType.fence') return 'Fence'
  if (key === 'panel.nodeType.fence_plural') return 'Fences'
  if (key === 'panel.nodeType.wall') return 'Wall'
  if (key === 'panel.nodeType.roofSegment') return 'Roof segment'
  if (key === 'panel.nodeType.roofSegment_plural') return 'Roof segments'
  return key
}

describe('formatSelectionBreakdown', () => {
  test('counts per type in first-appearance order, pluralizing with +s', () => {
    expect(formatSelectionBreakdown(['slab', 'stair', 'fence', 'fence'], en)).toBe(
      '1 slab · 1 stair · 2 fences',
    )
  })

  test('humanizes hyphenated kinds', () => {
    expect(
      formatSelectionBreakdown(['roof-segment', 'roof-segment', 'wall'], en),
    ).toBe('2 roof segments · 1 wall')
  })

  test('skips missing nodes', () => {
    expect(formatSelectionBreakdown(['wall', undefined, null], en)).toBe('1 wall')
  })

  test('empty selection formats to an empty string', () => {
    expect(formatSelectionBreakdown([], en)).toBe('')
  })
})