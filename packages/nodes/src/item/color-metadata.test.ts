import { describe, expect, test } from 'bun:test'

import { isImportedGlbAsset } from './color-metadata'

describe('item color metadata', () => {
  test('treats Articraft generated GLBs as imported GLB assets', () => {
    expect(
      isImportedGlbAsset({
        asset: {
          id: 'articraft-rec_object_20260624_072524_144004_725b00b8',
          src: '/items/articraft-rec_object_20260624_072524_144004_725b00b8/model.glb',
          tags: ['floor', 'articraft', 'generated'],
        },
      }),
    ).toBe(true)
  })
})
