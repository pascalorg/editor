import { createHash } from 'node:crypto'
import type { HedgeMesh, HedgeNode } from '../../index'

// Saved gardens name generator 1. These cases are frozen independently of generator 2.
export const hedgeV1Cases: Record<string, Partial<HedgeNode>> = {
  clipped: { path: [[0, 0], [8, 0]], clip: 1, seed: 7 },
  loose: { path: [[0, 0], [8, 0]], clip: 0, seed: 7 },
  curved: { path: [[-3, 0], [-1, 1], [2, -0.5], [4, 1]], curve: true, seed: 19 },
  gatedRing: { path: [[0, 0], [8, 0], [8, 6], [0, 6]], closed: true, gaps: [{ at: 0.2, width: 1.5 }], seed: 31 },
  thinned: { path: [[0, 0], [200, 0]], height: 3, width: 1.6, clip: 0, leafSize: 0.03, seed: 2 },
}

export function hedgeBufferHashes(meshes: HedgeMesh[]) {
  return meshes.map((mesh) => ({
    bodyIndexCount: mesh.bodyIndexCount,
    buffers: (['position', 'normal', 'color', 'index'] as const).map((key) => {
      const array = mesh[key]
      return { key, type: array.constructor.name, bytes: array.byteLength,
        sha256: createHash('sha256').update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)).digest('hex') }
    }),
  }))
}
