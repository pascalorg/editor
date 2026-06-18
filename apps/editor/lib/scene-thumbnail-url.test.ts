import { describe, expect, test } from 'bun:test'
import { sceneThumbnailUrlSchema } from './scene-thumbnail-url'

describe('sceneThumbnailUrlSchema', () => {
  test('accepts external thumbnail URLs', () => {
    expect(sceneThumbnailUrlSchema.safeParse('https://example.com/thumb.png').success).toBe(true)
  })

  test('accepts local scene thumbnail URLs written by the thumbnail route', () => {
    expect(
      sceneThumbnailUrlSchema.safeParse('/scene-thumbnails/6ac5e5b79ff9.png?v=1780000000000')
        .success,
    ).toBe(true)
  })

  test('rejects arbitrary local paths', () => {
    expect(sceneThumbnailUrlSchema.safeParse('/items/model/thumbnail.png').success).toBe(false)
    expect(sceneThumbnailUrlSchema.safeParse('/scene-thumbnails/../secret.png').success).toBe(false)
  })
})
