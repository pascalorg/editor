import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { RockNode } from '@pascal-app/core'
import { buildRockMesh } from './geometry'

// Captured at e2ca3a128 before candidate authorship. These are a persisted gen-1 contract, not
// candidate-generated snapshots. Fixture: 6 x 4 m rectangle, height 2.4, foot -0.3, top 2.4.
const fixtures = [
  [
    'faceted',
    1,
    '96d07aa65e8f27f62c46eb085c382bf05133fa7d16825a176c88c8dfa499a1e7',
    '345cf54983089eb1663d59b074d678b6467b9b76714cc98eec30080dfaf141b0',
    null,
    2376,
  ],
  [
    'faceted',
    11,
    '90095d9f697811c5f6f4066f02bb8bc0307ec0aca7db4f9d27b7b5d6b9565fdc',
    'f3dd391877a64014f3f90aed6c71a840bce8b111717cf6ac84ce25f955624cc7',
    null,
    2376,
  ],
  [
    'faceted',
    -7,
    '58d3c281cc5cc409960a609d8dc8004963e48959328154c6056a27da2adf7b8a',
    '34dec3e5a9172f2a99818c9d3604fb73693049b2b1ea908d1b6ffd9027782a96',
    null,
    2376,
  ],
  [
    'weathered',
    1,
    'a35e22c3771786bb985ed0b1a4be93f99cbd076f83a92f6d296960677ede0ab6',
    'f168fa332005f2ed68aee6dae4e793ece899f07644099a6826cdeaaa4d34d677',
    '008f1d81ab879cf0c03054e0d0e44a0f0b8db2383200865031f8e18ab358ddbe',
    398,
  ],
  [
    'weathered',
    11,
    '3bcb41284063525ab021bdde1e3f44e03a9283bc43dc1133ba251d9a9e681b3d',
    '9304ffe212b4f6d3df9700c78f0077704e8fbf64b06ca17a578083e7ba897825',
    '008f1d81ab879cf0c03054e0d0e44a0f0b8db2383200865031f8e18ab358ddbe',
    398,
  ],
  [
    'weathered',
    -7,
    '87a7ca2463d452b22f2bbff62193209210e54530fb70febe618f19de314f0a30',
    '6d62ebac92aaf6f5c635244f1ae87745b7c7cc138a09e2228511e5671d446c98',
    '008f1d81ab879cf0c03054e0d0e44a0f0b8db2383200865031f8e18ab358ddbe',
    398,
  ],
] as const

const hash = (array: ArrayBufferView) =>
  createHash('sha256')
    .update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength))
    .digest('hex')

describe('the saved generation-1 mesh bytes', () => {
  for (const [form, seed, position, normal, index, vertices] of fixtures) {
    for (const gen of [undefined, 1]) {
      test(`${form}, seed ${seed}, ${gen === undefined ? 'old document' : 'explicit gen 1'}`, () => {
        const rock = RockNode.parse({
          polygon: [
            [-3, -2],
            [3, -2],
            [3, 2],
            [-3, 2],
          ],
          height: 2.4,
          seed,
          form,
          ...(gen === undefined ? {} : { gen }),
        })
        const mesh = buildRockMesh(rock, -0.3, 2.4)
        try {
          expect(rock.gen).toBe(1)
          expect(hash(mesh.getAttribute('position').array)).toBe(position)
          expect(hash(mesh.getAttribute('normal').array)).toBe(normal)
          expect(mesh.index ? hash(mesh.index.array) : null).toBe(index)
          expect(mesh.getAttribute('position').count).toBe(vertices)
          expect((mesh.index?.count ?? mesh.getAttribute('position').count) / 3).toBe(792)
        } finally {
          mesh.dispose()
        }
      })
    }
  }
})
