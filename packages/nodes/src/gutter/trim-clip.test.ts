import { describe, expect, test } from 'bun:test'
import type { GutterNode, RoofSegmentNode } from '@pascal-app/core'
import { segmentForGutterTrimClip } from './trim-clip'

describe('gutter segment trim clipping', () => {
  test('does not apply straight trim planes to a curved gutter', () => {
    const gutter = {
      arc: { centerX: 0, centerZ: -9.548, radius: 7.25 },
    } as Pick<GutterNode, 'arc'>
    const segment = {
      arc: { centerX: 0, centerZ: -8.438, radius: 7.25 },
      trim: { back: 0.002 },
    } as RoofSegmentNode

    expect(segmentForGutterTrimClip(gutter, segment)).toBeUndefined()
  })

  test('keeps trim clipping for a straight gutter', () => {
    const gutter = { arc: undefined } as Pick<GutterNode, 'arc'>
    const segment = { arc: undefined, trim: { back: 0.2 } } as RoofSegmentNode

    expect(segmentForGutterTrimClip(gutter, segment)).toBe(segment)
  })
})
