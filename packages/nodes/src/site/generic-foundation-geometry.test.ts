import { expect, test } from 'bun:test'
import type { FoundationMember } from '@pascal-app/core'
import { buildFoundationMesh } from './generic-foundation-geometry'

const run = (over: Partial<FoundationMember> = {}): FoundationMember => ({
  kind: 'stem',
  levelId: 'level_g',
  from: [0, 0],
  to: [4, 0],
  width: 0.2,
  bottomY: -0.5,
  topY: 0.25,
  ...over,
})

test('a run is a closed box: eight corners over six faces, twelve triangles', () => {
  const mesh = buildFoundationMesh([run()], 'stem')
  expect(mesh?.positions.length).toBe(24 * 3)
  expect(mesh?.indices.length).toBe(12 * 3)
})

test('the box spans the run, its width and its height', () => {
  const mesh = buildFoundationMesh([run()], 'stem')
  const axis = (offset: number) =>
    Array.from(mesh?.positions ?? []).filter((_, index) => index % 3 === offset)
  const [xs, ys, zs] = [axis(0), axis(1), axis(2)]
  expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 4])
  expect([Math.min(...ys), Math.max(...ys)]).toEqual([-0.5, 0.25])
  const [lowZ, highZ] = [Math.min(...zs), Math.max(...zs)]
  expect(highZ - lowZ).toBeCloseTo(0.2, 6)
})

test('every triangle winds outward, as its own normal says', () => {
  const mesh = buildFoundationMesh([run({ from: [1, 1], to: [-2, 3.5] })], 'stem')
  if (!mesh) throw new Error('no mesh')
  const point = (i: number) => [0, 1, 2].map((k) => mesh.positions[i * 3 + k] as number)
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => point(mesh.indices[t + k] as number)) as number[][]
    const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!]
    const ac = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!]
    const winding = [
      ab[1]! * ac[2]! - ab[2]! * ac[1]!,
      ab[2]! * ac[0]! - ab[0]! * ac[2]!,
      ab[0]! * ac[1]! - ab[1]! * ac[0]!,
    ]
    const i = mesh.indices[t] as number
    const normal = [0, 1, 2].map((k) => mesh.normals[i * 3 + k] as number)
    expect(
      winding[0]! * normal[0]! + winding[1]! * normal[1]! + winding[2]! * normal[2]!,
    ).toBeGreaterThan(0)
  }
})

test('the distance along the run follows the wall, from its start', () => {
  const mesh = buildFoundationMesh([run()], 'stem')
  expect(Math.max(...(mesh?.along ?? []))).toBeCloseTo(4, 6)
  expect(Math.min(...(mesh?.along ?? []))).toBe(0)
})

test('a kind with no runs has no mesh, and a run with no height draws nothing', () => {
  expect(buildFoundationMesh([run()], 'footing')).toBeNull()
  expect(buildFoundationMesh([run({ topY: -0.5 })], 'stem')).toBeNull()
})

test('runs of the same kind join into one mesh', () => {
  const mesh = buildFoundationMesh([run(), run({ from: [4, 0], to: [4, 3] })], 'stem')
  expect(mesh?.indices.length).toBe(2 * 12 * 3)
})
