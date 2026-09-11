import { describe, expect, test } from 'bun:test'
import { buildSurfaceMeshData } from './layers/surface-mesh-layer'

describe('surface mesh layer', () => {
  test('decodes quantized positions, vertex colors, and triangle indices', () => {
    const positions = new Uint8Array([0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0])
    const colors = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255])
    const indices = new Uint8Array([0, 0, 1, 0, 2, 0])
    const data = buildSurfaceMeshData({
      version: 1,
      coordinateSystem: 'arkit-world',
      representation: 'quantized-indexed-triangle-mesh',
      appearance: 'camera-vertex-color',
      vertexCount: 3,
      faceCount: 1,
      boundsMin: [0, 0, 0],
      boundsMax: [2, 2, 0],
      positionEncoding: 'uint16x3-base64-little-endian',
      colorEncoding: 'uint8x3-base64-srgb',
      indexEncoding: 'uint16x3-base64-little-endian',
      positions: Buffer.from(positions).toString('base64'),
      colors: Buffer.from(colors).toString('base64'),
      indices: Buffer.from(indices).toString('base64'),
    })

    expect(Array.from(data?.positions ?? [])).toEqual([0, 0, 0, 2, 0, 0, 0, 2, 0])
    expect(Array.from(data?.indices ?? [])).toEqual([0, 1, 2])
    expect(Array.from(data?.colors ?? [])).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
  })

  test('rejects malformed buffers and out-of-range indices', () => {
    expect(
      buildSurfaceMeshData({
        version: 1,
        coordinateSystem: 'arkit-world',
        representation: 'quantized-indexed-triangle-mesh',
        appearance: 'camera-vertex-color',
        vertexCount: 1,
        faceCount: 1,
        boundsMin: [0, 0, 0],
        boundsMax: [1, 1, 1],
        positionEncoding: 'uint16x3-base64-little-endian',
        colorEncoding: 'uint8x3-base64-srgb',
        indexEncoding: 'uint16x3-base64-little-endian',
        positions: 'AA==',
        colors: 'AAAA',
        indices: 'AAABAAIA',
      }),
    ).toBeNull()
  })
})
