import { describe, expect, test } from 'bun:test'
import { getLibraryMaterialIdFromRef, getSceneMaterialIdFromRef } from './material-library'

describe('material references', () => {
  test('rejects malformed runtime values instead of calling string methods', () => {
    const malformedRefs: unknown[] = [42, true, {}, []]

    for (const ref of malformedRefs) {
      expect(getLibraryMaterialIdFromRef(ref as string)).toBeNull()
      expect(getSceneMaterialIdFromRef(ref as string)).toBeNull()
    }
  })
})
