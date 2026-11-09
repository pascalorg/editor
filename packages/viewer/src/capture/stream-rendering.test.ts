import { describe, expect, test } from 'bun:test'
import { isCaptureStreamRenderable } from './stream-rendering'

describe('isCaptureStreamRenderable', () => {
  test('renders completed generated models while withholding failed and pending results', () => {
    const stream = {
      id: 'generated',
      kind: 'spaceform-scene',
      artifact: { id: 'generated', mediaType: 'model/gltf-binary', uri: '/scene.glb' },
    }
    expect(isCaptureStreamRenderable({ ...stream, availability: 'ready' })).toBe(true)
    for (const availability of ['pending', 'failed'] as const) {
      expect(isCaptureStreamRenderable({ ...stream, availability })).toBe(false)
    }
    expect(isCaptureStreamRenderable({ id: stream.id, kind: stream.kind })).toBe(false)
    expect(
      isCaptureStreamRenderable({
        ...stream,
        artifact: { id: 'unsupported', mediaType: 'application/json', uri: '/scene.json' },
      }),
    ).toBe(false)
  })

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
    expect(
      isCaptureStreamRenderable({
        id: 'inline-points',
        kind: 'point-cloud',
        role: 'pointCloud',
        availability: 'ready',
        inline: {
          coordinateSystem: 'arkit-world',
          positions: [0, 0, 0, 1, 1, 1],
        },
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

  test('renders extracted JSON preview artifacts', () => {
    for (const [kind, role] of [
      ['surface-mesh', 'surfaceMesh'],
      ['point-cloud', 'pointCloud'],
      ['device-motion', 'deviceMotion'],
    ] as const) {
      expect(
        isCaptureStreamRenderable({
          id: kind,
          kind,
          role,
          availability: 'ready',
          artifact: {
            id: `preview-${kind}`,
            mediaType: 'application/json',
            uri: `/api/captures/c/archive/sessions/s/artifacts/preview-${kind}`,
          },
        }),
      ).toBe(true)
    }
  })

  test('renders a valid inline color surface mesh', () => {
    expect(
      isCaptureStreamRenderable({
        id: 'surface-mesh',
        kind: 'surface-mesh',
        role: 'surfaceMesh',
        availability: 'ready',
        inline: {
          version: 1,
          coordinateSystem: 'arkit-world',
          representation: 'quantized-indexed-triangle-mesh',
          appearance: 'camera-vertex-color',
          vertexCount: 3,
          faceCount: 1,
          boundsMin: [0, 0, 0],
          boundsMax: [1, 1, 0],
          positionEncoding: 'uint16x3-base64-little-endian',
          colorEncoding: 'uint8x3-base64-srgb',
          indexEncoding: 'uint16x3-base64-little-endian',
          positions: 'AAAAAAAAAAAAAAAAAAAAAAAA',
          colors: '////////////',
          indices: 'AAABAAIA',
        },
      }),
    ).toBe(true)
  })
})
