import { expect, test } from 'bun:test'
import { SNAPSHOT_CHANNEL_MIME_TYPES, SNAPSHOT_CHANNELS } from './snapshot-pipeline'

test('keeps render channels ordered and data channels lossless', () => {
  expect(SNAPSHOT_CHANNELS).toEqual(['color', 'albedo', 'normal', 'depth'])
  expect(SNAPSHOT_CHANNEL_MIME_TYPES).toEqual({
    color: 'image/webp',
    albedo: 'image/png',
    normal: 'image/png',
    depth: 'image/png',
  })
})
