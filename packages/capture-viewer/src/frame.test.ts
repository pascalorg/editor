import { describe, expect, test } from 'bun:test'
import type { CaptureSessionDescriptor } from '@pascal-app/capture-protocol'
import { Vector3 } from 'three'
import { resolveCaptureFrameMatrix } from './frame'

const descriptor: CaptureSessionDescriptor = {
  schemaVersion: 2,
  sessionId: 'capture_123',
  state: 'ready',
  clocks: [],
  coordinateFrames: [
    {
      id: 'world',
      convention: 'right-handed-y-up',
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1],
    },
    {
      id: 'sensor',
      parentId: 'world',
      convention: 'arkit-camera',
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 2, 0, 1],
    },
  ],
  streams: [],
}

describe('resolveCaptureFrameMatrix', () => {
  test('composes local-to-parent transforms into session space', () => {
    const position = new Vector3(0, 0, 0).applyMatrix4(
      resolveCaptureFrameMatrix(descriptor, 'sensor')!,
    )
    expect(position.toArray()).toEqual([10, 2, 0])
  })

  test('returns null for missing or cyclic frame chains', () => {
    expect(resolveCaptureFrameMatrix(descriptor, 'missing')).toBeNull()
    expect(
      resolveCaptureFrameMatrix(
        {
          ...descriptor,
          coordinateFrames: [
            { id: 'a', parentId: 'b', convention: 'test' },
            { id: 'b', parentId: 'a', convention: 'test' },
          ],
        },
        'a',
      ),
    ).toBeNull()
  })
})
