import { describe, expect, test } from 'bun:test'
import {
  CaptureSessionManifestV2Schema,
  captureLayerKey,
  normalizeCaptureSessionManifest,
} from './schema'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

describe('capture manifests', () => {
  test('normalizes the Community v1 manifest into extensible streams', () => {
    const descriptor = normalizeCaptureSessionManifest({
      schemaVersion: 1,
      sessionId: 'capture_123',
      projectId: 'project_123',
      streams: {
        roomModel: {
          kind: 'room-model',
          mediaType: 'model/vnd.usdz+zip',
          url: 'https://cdn.pascal.app/room.usdz',
        },
        deviceMotion: {
          kind: 'device-motion',
          trajectory: {
            coordinateSystem: 'arkit-world',
            samples: [
              { segment: 0, timestamp: 0, transform: identity },
              { segment: 0, timestamp: 1, transform: identity },
            ],
          },
        },
        pointCloud: {
          kind: 'point-cloud',
          points: {
            coordinateSystem: 'arkit-world',
            positions: [0, 0, 0, 1, 1, 1],
          },
        },
        surfaceMesh: {
          kind: 'surface-mesh',
          mesh: {
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
        },
      },
    })

    expect(descriptor.streams.map(captureLayerKey)).toEqual([
      'model',
      'deviceMotion',
      'pointCloud',
      'surfaceMesh',
    ])
    expect(descriptor.streams[0]?.artifact?.uri).toBe('https://cdn.pascal.app/room.usdz')
    expect(descriptor.streams[2]?.inline).toMatchObject({
      coordinateSystem: 'arkit-world',
      positions: [0, 0, 0, 1, 1, 1],
    })
    expect(descriptor.streams[3]?.inline).toMatchObject({
      appearance: 'camera-vertex-color',
      faceCount: 1,
    })
  })

  test('keeps unknown v2 stream kinds without a protocol release', () => {
    const manifest = CaptureSessionManifestV2Schema.parse({
      schemaVersion: 2,
      sessionId: 'capture_123',
      state: 'live',
      streams: [
        {
          id: 'wifi-rtt',
          kind: 'wifi-ranging',
          availability: 'live',
        },
      ],
    })

    expect(normalizeCaptureSessionManifest(manifest).streams[0]?.kind).toBe('wifi-ranging')
  })

  test('preserves the exact ARKit coordinate system required by v1', () => {
    expect(() =>
      normalizeCaptureSessionManifest({
        schemaVersion: 1,
        sessionId: 'capture_123',
        projectId: 'project_123',
        streams: {
          deviceMotion: {
            kind: 'device-motion',
            trajectory: {
              coordinateSystem: 'unknown',
              samples: [
                { segment: 0, timestamp: 0, transform: identity },
                { segment: 0, timestamp: 1, transform: identity },
              ],
            },
          },
        },
      }),
    ).toThrow()
  })

  test('rejects oversized or structurally inconsistent surface meshes', () => {
    const surfaceMesh = {
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
    }
    const manifest = (mesh: unknown) => ({
      schemaVersion: 1,
      sessionId: 'capture_123',
      projectId: 'project_123',
      streams: { surfaceMesh: { kind: 'surface-mesh', mesh } },
    })

    expect(() =>
      normalizeCaptureSessionManifest(manifest({ ...surfaceMesh, faceCount: 6_001 })),
    ).toThrow()
    expect(() =>
      normalizeCaptureSessionManifest(manifest({ ...surfaceMesh, positions: 'AAAA' })),
    ).toThrow('decoded bytes')
    expect(() =>
      normalizeCaptureSessionManifest(manifest({ ...surfaceMesh, indices: 'AAABAP//' })),
    ).toThrow('existing vertex')
  })

  test('rejects duplicate stream IDs and backwards time ranges', () => {
    expect(() =>
      normalizeCaptureSessionManifest({
        schemaVersion: 2,
        sessionId: 'capture_123',
        streams: [
          { id: 'points', kind: 'point-cloud' },
          { id: 'points', kind: 'point-cloud' },
        ],
      }),
    ).toThrow('Duplicate capture streams id')

    expect(() =>
      normalizeCaptureSessionManifest({
        schemaVersion: 2,
        sessionId: 'capture_123',
        streams: [
          {
            id: 'video',
            kind: 'video',
            artifact: {
              id: 'video',
              mediaType: 'video/mp4',
              timeRange: { start: 2, end: 1 },
            },
          },
        ],
      }),
    ).toThrow('must end at or after')
  })
})
