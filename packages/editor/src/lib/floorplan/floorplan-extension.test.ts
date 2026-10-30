import { describe, expect, test } from 'bun:test'
import type { GeometryContext } from '@pascal-app/core'
import {
  createFloorplanContextExtensions,
  normalizeFloorplanWallDimensionFaces,
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
  test('measures walls to both faces by default', () => {
    expect(readFloorplanContext(context()).wallDimensionFaces).toBe('both')
  })

  test('carries the Measure walls choice', () => {
    for (const wallDimensionFaces of ['interior', 'exterior', 'both'] as const) {
      const extensions = createFloorplanContextExtensions({ wallDimensionFaces })
      expect(readFloorplanContext(context(extensions)).wallDimensionFaces).toBe(wallDimensionFaces)
    }
  })

  test('normalizes stale persisted values, including the retired references, to Both', () => {
    for (const stale of ['finished-faces', 'centerline', 'stud-faces', 'unknown', null]) {
      expect(normalizeFloorplanWallDimensionFaces(stale)).toBe('both')
    }
  })

  test('lets presentation code suppress automatic annotation construction', () => {
    expect(readFloorplanContext(context()).automaticDimensions).toBe(true)
    const extensions = createFloorplanContextExtensions({ automaticDimensions: false })
    expect(readFloorplanContext(context(extensions)).automaticDimensions).toBe(false)
  })
})
