import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { RockNode } from '@pascal-app/core'
import { buildRockMesh } from './geometry'

// Captured at e2ca3a128 before candidate authorship, verified against the original byte hashes
// before quantizing. Fixture: 6 x 4 m rectangle, height 2.4, foot -0.3, top 2.4.
// One-micrometre position bins (0.000001 m) and 1e-6 unit-normal bins ignore platform
// trigonometry noise without hiding visible shape changes. Indices remain byte-exact.
const POSITION_STEP_METRES = 1e-6
const NORMAL_STEP = 1e-6
const fixtures = [
  [
    'faceted',
    1,
    '5b4199345120573737caabf2cb9c4500c7b67b5ef3aff2cf3fbb7b0138722710',
    '12258eb6c52cfc778fa4343e75da6919d036be24c7144e595110a2b401e8b0d2',
    null,
    2376,
  ],
  [
    'faceted',
    11,
    '8f7e1688b9cac5dfa00240b6e33d2ac649b6ed76e1357391054dba530df5c66e',
    '773f94d8808fa2bd8aa6a1ea32c08d0dc133949ccfcf52de8ddd68118ab316cc',
    null,
    2376,
  ],
  [
    'faceted',
    -7,
    '398d513571ef881705e1c2f3ac4da845adddbce6d1d4b072e4ed73360c60368f',
    '74a2f5e093246b1ac44d51bea83ecf8ca0fab4d07ff45b1aed93ee8af3631b84',
    null,
    2376,
  ],
  [
    'weathered',
    1,
    '859041935f636055d070a3ebe1e776f9e05f4619f9d9b21ffbd864aa5089558f',
    '27f0bb2a2b9b947b69c4e536d14c6f8d17b5c19849e07e25ffaf65a6c195be43',
    '008f1d81ab879cf0c03054e0d0e44a0f0b8db2383200865031f8e18ab358ddbe',
    398,
  ],
  [
    'weathered',
    11,
    '91e4640a68f2e8cc97fbc4668f36460fd70b54e66d80e0786e31dd1bf8f2cb6a',
    '240ff55690de3cb0c6668aa58920856e66638bceb14f5e15fb6c04bcb291b158',
    '008f1d81ab879cf0c03054e0d0e44a0f0b8db2383200865031f8e18ab358ddbe',
    398,
  ],
  [
    'weathered',
    -7,
    'c70ab8be8296c7562518e804e9bbbdf034ccbdb032c27ea1090b740d95d1e421',
    '7bc1b2a04d80f4eec216972bb978a68a7308af6fa92bd26989ee50d2feb98675',
    '008f1d81ab879cf0c03054e0d0e44a0f0b8db2383200865031f8e18ab358ddbe',
    398,
  ],
] as const

const hash = (array: ArrayBufferView) =>
  createHash('sha256')
    .update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength))
    .digest('hex')

const quantizedHash = (array: ArrayLike<number>, step: number) =>
  createHash('sha256')
    .update(JSON.stringify(Array.from(array, (value) => Math.round(value / step))))
    .digest('hex')

describe('the saved generation-1 mesh within a micrometre', () => {
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
          expect(quantizedHash(mesh.getAttribute('position').array, POSITION_STEP_METRES)).toBe(
            position,
          )
          expect(quantizedHash(mesh.getAttribute('normal').array, NORMAL_STEP)).toBe(normal)
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
