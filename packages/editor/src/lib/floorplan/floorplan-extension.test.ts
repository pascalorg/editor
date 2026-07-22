import { describe, expect, test } from 'bun:test'
import type { GeometryContext } from '@pascal-app/core'
import {
  createFloorplanContextExtensions,
  normalizeFloorplanWallDimensionReference,
  readFloorplanContext,
} from './floorplan-extension'

function context(extensions?: Readonly<Record<string, unknown>>): GeometryContext {
  return {
    resolve: () => undefined,
    children: [],
    siblings: [],
    parent: null,
    extensions,
  }
}

describe('floor-plan context extensions', () => {
  test('defaults wall dimensions to finished faces', () => {
    expect(readFloorplanContext(context()).wallDimensionReference).toBe('finished-faces')
  })

  test('carries the selected centerline or stud-face reference', () => {
    for (const wallDimensionReference of ['centerline', 'stud-faces'] as const) {
      const extensions = createFloorplanContextExtensions({ wallDimensionReference })
      expect(readFloorplanContext(context(extensions)).wallDimensionReference).toBe(
        wallDimensionReference,
      )
    }
  })

  test('normalizes stale persisted references to the finished-face default', () => {
    expect(normalizeFloorplanWallDimensionReference('unknown')).toBe('finished-faces')
    expect(normalizeFloorplanWallDimensionReference(null)).toBe('finished-faces')
  })
})
