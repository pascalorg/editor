import { describe, expect, test } from 'bun:test'
import { normalizeFalSam3DResponse } from './fal'

describe('normalizeFalSam3DResponse', () => {
  test('reads the combined model_glb output', () => {
    expect(
      normalizeFalSam3DResponse({
        model_glb: { url: 'https://example.com/model.glb' },
        metadata: [{ object_index: 0, scale: [[1, 2, 3]] }],
      }),
    ).toEqual({
      modelGlbUrl: 'https://example.com/model.glb',
      thumbnailUrl: undefined,
      metadata: [{ object_index: 0, scale: [[1, 2, 3]] }],
    })
  })

  test('falls back to individual GLB outputs', () => {
    expect(
      normalizeFalSam3DResponse({
        data: {
          individual_glbs: [{ url: 'https://example.com/part.glb' }],
          thumbnail: { url: 'https://example.com/thumb.png' },
        },
      }).modelGlbUrl,
    ).toBe('https://example.com/part.glb')
  })

  test('accepts string model URLs', () => {
    expect(
      normalizeFalSam3DResponse({ model_glb: 'https://example.com/model.glb' }).modelGlbUrl,
    ).toBe('https://example.com/model.glb')
  })

  test('throws when no model URL is present', () => {
    expect(() => normalizeFalSam3DResponse({ metadata: [] })).toThrow('GLB model URL')
  })
})
