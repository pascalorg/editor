import { describe, expect, test } from 'bun:test'
import type { CameraPose } from '../events/bus'
import {
  nextSavedViewOrder,
  normalizeSavedViews,
  reorderSavedViews,
  type SavedView,
  type SavedViewId,
  sortSavedViews,
} from './saved-views'

const pose: CameraPose = {
  position: [10, 10, 10],
  target: [0, 0, 0],
  projection: 'perspective',
}

const view = (id: string, order: number, name = id): SavedView => ({
  id: id as SavedViewId,
  name,
  order,
  camera: pose,
})

const bag = (...views: SavedView[]): Record<SavedViewId, SavedView> =>
  Object.fromEntries(views.map((v) => [v.id, v])) as Record<SavedViewId, SavedView>

describe('sortSavedViews', () => {
  test('sorts by order', () => {
    const sorted = sortSavedViews(bag(view('c', 2), view('a', 0), view('b', 1)))
    expect(sorted.map((v) => v.id)).toEqual(['a', 'b', 'c'])
  })

  test('breaks order ties by id so the sort is total', () => {
    const sorted = sortSavedViews(bag(view('b', 0), view('a', 0)))
    expect(sorted.map((v) => v.id)).toEqual(['a', 'b'])
  })
})

describe('nextSavedViewOrder', () => {
  test('appends after the highest order', () => {
    expect(nextSavedViewOrder(bag(view('a', 0), view('b', 4)))).toBe(5)
  })

  test('starts at zero for an empty bag', () => {
    expect(nextSavedViewOrder({})).toBe(0)
  })
})

describe('reorderSavedViews', () => {
  const three = bag(view('a', 0), view('b', 1), view('c', 2))

  test('moves a view down and renumbers from zero', () => {
    const patches = reorderSavedViews(three, 0, 2)
    const next = { ...three }
    for (const patch of patches) {
      next[patch.id] = { ...next[patch.id]!, order: patch.order }
    }
    expect(sortSavedViews(next).map((v) => v.id)).toEqual(['b', 'c', 'a'])
  })

  test('moves a view up', () => {
    const patches = reorderSavedViews(three, 2, 0)
    const next = { ...three }
    for (const patch of patches) {
      next[patch.id] = { ...next[patch.id]!, order: patch.order }
    }
    expect(sortSavedViews(next).map((v) => v.id)).toEqual(['c', 'a', 'b'])
  })

  test('a drag that ends where it started writes nothing', () => {
    expect(reorderSavedViews(three, 1, 1)).toEqual([])
  })

  test('out-of-range indices write nothing', () => {
    expect(reorderSavedViews(three, -1, 1)).toEqual([])
    expect(reorderSavedViews(three, 0, 9)).toEqual([])
  })
})

describe('normalizeSavedViews', () => {
  test('keeps a well-formed view', () => {
    const result = normalizeSavedViews({
      v1: { id: 'v1', name: 'Entry', order: 3, camera: pose },
    })
    expect(result.v1 as SavedView | undefined).toMatchObject({ name: 'Entry', order: 3 })
  })

  test('drops a view whose camera cannot be restored', () => {
    expect(
      normalizeSavedViews({
        broken: { id: 'broken', name: 'x', order: 0, camera: { position: [1, 2] } },
        missing: { id: 'missing', name: 'x', order: 0 },
      }),
    ).toEqual({})
  })

  test('falls back on a missing name and order rather than dropping the view', () => {
    const result = normalizeSavedViews({ v1: { camera: pose } })
    expect(result.v1 as SavedView | undefined).toMatchObject({ name: 'View', order: 0 })
  })

  test('keys the result by the record key when the entry has no id', () => {
    const result = normalizeSavedViews({ v1: { camera: pose } })
    expect((result.v1 as SavedView | undefined)?.id).toBe('v1' as SavedViewId)
  })

  test('preserves an explicit null section plane, which means "no cut"', () => {
    const result = normalizeSavedViews({
      v1: { camera: pose, sectionPlaneId: null },
    })
    expect(result.v1 as SavedView | undefined).toHaveProperty('sectionPlaneId', null)
    // A view saved before section planes existed carries no key at all.
    const legacy = normalizeSavedViews({ v1: { camera: pose } })
    expect('sectionPlaneId' in (legacy.v1 as SavedView)).toBe(false)
  })

  test('keeps optional camera fields when finite and drops them otherwise', () => {
    const kept = normalizeSavedViews({
      v1: { camera: { ...pose, viewWidth: 12, fov: 50 } },
    })
    expect(kept.v1?.camera).toMatchObject({ viewWidth: 12, fov: 50 })

    const dropped = normalizeSavedViews({
      v1: { camera: { ...pose, viewWidth: Number.NaN } },
    })
    expect(dropped.v1?.camera.viewWidth).toBeUndefined()
  })

  test('carries the opaque presentation bag through untouched', () => {
    const result = normalizeSavedViews({
      v1: { camera: pose, presentation: { viewMode: 'split', anything: { nested: 1 } } },
    })
    expect(result.v1?.presentation).toEqual({ viewMode: 'split', anything: { nested: 1 } })
  })

  test('keeps only boolean collection flags', () => {
    const result = normalizeSavedViews({
      v1: {
        camera: pose,
        collectionStates: {
          collection_a: { visible: false, locked: true },
          collection_b: { visible: 'yes' },
        },
      },
    })
    expect(result.v1?.collectionStates).toEqual({
      collection_a: { visible: false, locked: true },
      collection_b: {},
    })
  })

  test('a non-object payload normalizes to an empty bag', () => {
    expect(normalizeSavedViews(undefined)).toEqual({})
    expect(normalizeSavedViews([1, 2])).toEqual({})
    expect(normalizeSavedViews('nope')).toEqual({})
  })
})
