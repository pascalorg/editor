import { describe, expect, test } from 'bun:test'
import { isCaptureStreamRenderable } from './stream-rendering'

describe('isCaptureStreamRenderable', () => {
  test('only advertises point-cloud formats handled by the reference renderer', () => {
    expect(
      isCaptureStreamRenderable({
        id: 'points',
        kind: 'point-cloud',
        role: 'pointCloud',
        availability: 'ready',
        artifact: { id: 'points', mediaType: 'application/vnd.las', uri: '/points.las' },
      }),
    ).toBe(false)
    expect(
      isCaptureStreamRenderable({
        id: 'points',
        kind: 'point-cloud',
        role: 'pointCloud',
        availability: 'ready',
        artifact: { id: 'points', mediaType: 'application/ply', uri: '/points.ply' },
      }),
    ).toBe(true)
  })

  test('allows a host renderer to claim an otherwise unknown stream', () => {
    expect(
      isCaptureStreamRenderable(
        { id: 'splat', kind: 'gaussian-splat', availability: 'ready' },
        new Set(['gaussian-splat']),
      ),
    ).toBe(true)
  })
})
