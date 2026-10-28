import { expect, test } from 'bun:test'
import type { FoundationMember } from '@pascal-app/core'
import { buildDesignedFoundationMesh, buildFoundationMesh } from './generic-foundation-geometry'

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

/** Each triangle of a convex solid faces away from its centre. */
function facesOut(mesh: NonNullable<ReturnType<typeof buildDesignedFoundationMesh>>) {
  const count = mesh.positions.length / 3
  const centre = [0, 1, 2].map((k) => {
    let sum = 0
    for (let i = 0; i < count; i++) sum += mesh.positions[i * 3 + k] as number
    return sum / count
  })
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
    const middle = [0, 1, 2].map((k) => (a[k]! + b[k]! + c[k]!) / 3)
    const away = middle.map((value, k) => value - centre[k]!)
    expect(
      winding[0]! * away[0]! + winding[1]! * away[1]! + winding[2]! * away[2]!,
    ).toBeGreaterThan(0)
  }
}

test('a pile is a closed cylinder standing on its point, facing out', () => {
  const mesh = buildDesignedFoundationMesh([
    run({ kind: 'pile', from: [2, 3], to: [2, 3], width: 0.3, bottomY: -3, topY: -0.5 }),
  ])
  if (!mesh) throw new Error('no mesh')
  facesOut(mesh)
  const xs = Array.from(mesh.positions).filter((_, index) => index % 3 === 0)
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.3, 6)
})

test('a slab is its outline, top and bottom capped, facing out either way it winds', () => {
  const square: Array<[number, number]> = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ]
  for (const outline of [square, [...square].reverse()]) {
    const mesh = buildDesignedFoundationMesh([
      run({ kind: 'slab', outline, bottomY: -0.1, topY: 0 }),
    ])
    if (!mesh) throw new Error('no mesh')
    facesOut(mesh)
  }
})

test('a turned-down edge is swept along its run, its outer face on the run line facing out of the building', () => {
  const section: Array<[number, number]> = [
    [0, -0.4],
    [0.3, -0.4],
    [0.6, -0.1],
    [0.6, 0],
    [0.15, 0],
    [0.15, 0.05],
    [0, 0.05],
  ]
  const mesh = buildDesignedFoundationMesh([
    run({ kind: 'turndown', from: [0, 0], to: [5, 0], section }),
  ])
  if (!mesh) throw new Error('no mesh')
  // The building is to the run's left (+z here); its outer face, on z = 0, faces -z.
  const zs = Array.from(mesh.positions).filter((_, index) => index % 3 === 2)
  expect(Math.min(...zs)).toBeCloseTo(0, 9)
  expect(Math.max(...zs)).toBeCloseTo(0.6, 6)
  let outer = 0
  for (let i = 0; i < mesh.positions.length / 3; i++)
    if (
      Math.abs(mesh.positions[i * 3 + 2] as number) < 1e-9 &&
      (mesh.normals[i * 3 + 2] as number) < -0.99
    )
      outer += 1
  expect(outer).toBe(4)
})
