// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { Group } from 'three'
import { type GeometryBuildCacheEntry, shouldReuseGeometryBuild } from './geometry-system'

describe('shouldReuseGeometryBuild', () => {
  test('rebuilds when the same node id remounts into a new group with the same key', () => {
    const cache = new Map<string, GeometryBuildCacheEntry>()
    const firstGroup = new Group()
    const remountedGroup = new Group()

    expect(shouldReuseGeometryBuild(cache, 'duct_1', firstGroup, 'same-key')).toBe(false)
    expect(shouldReuseGeometryBuild(cache, 'duct_1', firstGroup, 'same-key')).toBe(true)
    expect(shouldReuseGeometryBuild(cache, 'duct_1', remountedGroup, 'same-key')).toBe(false)
  })
})
