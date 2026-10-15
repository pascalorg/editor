import { describe, expect, test } from 'bun:test'
import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D } from 'three'
import {
  COVER_MAX_ROWS,
  COVER_MIN_ROWS,
  clearRevealWipe,
  coverShareAt,
  coverSweepOf,
  planCoverRows,
  revealWipeLevelOf,
  setRevealWipe,
} from './reveal-wipe'

const box = (min: [number, number, number], max: [number, number, number]) => ({
  min: { x: min[0], y: min[1], z: min[2] },
  max: { x: max[0], y: max[1], z: max[2] },
})

describe('the sweep of a covering', () => {
  test('a pitched roof sweeps along its height, from its eave to its ridge', () => {
    expect(coverSweepOf(box([0, 3, 0], [8, 5.4, 6]))).toEqual({ axis: 'y', from: 3, to: 5.4 })
  })

  test('a flat roof sweeps along its longer plan side', () => {
    expect(coverSweepOf(box([0, 3, 0], [8, 3.2, 5]))).toEqual({ axis: 'x', from: 0, to: 8 })
    expect(coverSweepOf(box([0, 3, 0], [4, 3.2, 9]))).toEqual({ axis: 'z', from: 0, to: 9 })
  })
})

describe('the rows of a covering', () => {
  const sweep = { axis: 'y', from: 3, to: 5.4 } as const

  test('start in order from the eave, the first at once and the last before the end', () => {
    const rows = planCoverRows(sweep, 3000)
    expect(rows.length).toBeGreaterThanOrEqual(COVER_MIN_ROWS)
    expect(rows[0]?.atMs).toBe(0)
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]!.atMs).toBeGreaterThan(rows[i - 1]!.atMs)
      expect(rows[i]!.upTo).toBeGreaterThan(rows[i - 1]!.upTo)
    }
    expect(rows.at(-1)?.upTo).toBe(1)
    expect(rows.at(-1)!.atMs).toBeLessThan(3000)
  })

  test('their count follows the sweep, within bounds', () => {
    expect(planCoverRows({ axis: 'y', from: 0, to: 0.7 }, 2000)).toHaveLength(COVER_MIN_ROWS)
    expect(planCoverRows({ axis: 'x', from: 0, to: 40 }, 2000)).toHaveLength(COVER_MAX_ROWS)
  })

  test('the covering closes row by row, never going back', () => {
    const rows = planCoverRows(sweep, 3000)
    let last = 0
    for (let at = -1; at <= 3000; at += 50) {
      const share = coverShareAt(rows, at)
      expect(share).toBeGreaterThanOrEqual(last)
      last = share
    }
    expect(coverShareAt(rows, -1)).toBe(0)
    expect(coverShareAt(rows, 3000)).toBe(1)
  })

  test('a slower time stretches the rows, it does not change their order', () => {
    const quick = planCoverRows(sweep, 1000)
    const slow = planCoverRows(sweep, 4000)
    expect(slow.map((row) => row.upTo)).toEqual(quick.map((row) => row.upTo))
    expect(slow[3]!.atMs).toBeCloseTo(quick[3]!.atMs * 4, 6)
  })
})

describe('the wipe on a drawn node', () => {
  function drawn() {
    const root = new Object3D()
    const material = new MeshBasicMaterial()
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), material)
    mesh.castShadow = true
    root.add(mesh)
    return { root, mesh, material }
  }

  test('dresses the meshes in clones, never the shared material, and gives them back', () => {
    const { root, mesh, material } = drawn()
    setRevealWipe(root, { axis: 'y', from: 0, to: 2 }, 0.5)
    expect(mesh.material).not.toBe(material)
    expect(mesh.castShadow).toBe(false)
    expect(revealWipeLevelOf(root)).toBe(0.5)
    setRevealWipe(root, { axis: 'y', from: 0, to: 2 }, 1.2)
    expect(revealWipeLevelOf(root)).toBe(1.2)
    clearRevealWipe(root)
    expect(mesh.material).toBe(material)
    expect(mesh.castShadow).toBe(true)
    expect(revealWipeLevelOf(root)).toBeNull()
  })

  test('a mesh whose renderer put its own material back is dressed again', () => {
    const { root, mesh } = drawn()
    setRevealWipe(root, { axis: 'y', from: 0, to: 2 }, 0.5)
    const fresh = new MeshBasicMaterial()
    mesh.material = fresh
    setRevealWipe(root, { axis: 'y', from: 0, to: 2 }, 0.8)
    expect(mesh.material).not.toBe(fresh)
    clearRevealWipe(root)
    expect(mesh.material).toBe(fresh)
  })
})
