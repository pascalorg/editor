import { describe, expect, test } from 'bun:test'
import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D } from 'three'
import {
  clearRevealWipe,
  coverDurationMs,
  coverShareAt,
  coverSweepOf,
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

  test('a node with nothing drawn has an empty sweep, not a broken one', () => {
    const empty = box(
      [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
      [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
    )
    expect(coverSweepOf(empty)).toEqual({ axis: 'y', from: 0, to: 0 })
  })

  test('a flat roof sweeps along its longer plan side', () => {
    expect(coverSweepOf(box([0, 3, 0], [8, 3.2, 5]))).toEqual({ axis: 'x', from: 0, to: 8 })
    expect(coverSweepOf(box([0, 3, 0], [4, 3.2, 9]))).toEqual({ axis: 'z', from: 0, to: 9 })
  })
})

describe('how long a covering takes', () => {
  const range = { perMeterMs: 800, minMs: 2400, maxMs: 7000 }
  const over = (length: number) => ({ axis: 'y', from: 3, to: 3 + length }) as const

  test('follows the size of what it covers', () => {
    expect(coverDurationMs(over(4), range)).toBe(3200)
    expect(coverDurationMs(over(6), range)).toBe(4800)
    expect(coverDurationMs(over(6), range)).toBeGreaterThan(coverDurationMs(over(4), range))
  })

  test('never crawls on a small roof and never flashes or drags on the others', () => {
    expect(coverDurationMs(over(0.7), range)).toBe(2400)
    expect(coverDurationMs(over(0), range)).toBe(2400)
    expect(coverDurationMs(over(40), range)).toBe(7000)
  })
})

describe('the covering closes continuously', () => {
  const duration = 3000

  test('is exactly open at the start and closed at the end', () => {
    expect(coverShareAt(0, duration)).toBe(0)
    expect(coverShareAt(duration, duration)).toBe(1)
    expect(coverShareAt(-50, duration)).toBe(0)
    expect(coverShareAt(duration + 50, duration)).toBe(1)
  })

  test('moves with every frame: strictly increasing at 60 Hz, with no plateau', () => {
    let last = -1
    for (let at = 0; at <= duration; at += 1000 / 60) {
      const share = coverShareAt(at, duration)
      expect(share).toBeGreaterThan(last)
      last = share
    }
  })

  test('eases in and out: the first and last frames move less than the middle ones', () => {
    const step = 1000 / 60
    const first = coverShareAt(step, duration) - coverShareAt(0, duration)
    const middle =
      coverShareAt(duration / 2 + step, duration) - coverShareAt(duration / 2, duration)
    const last = coverShareAt(duration, duration) - coverShareAt(duration - step, duration)
    expect(first).toBeLessThan(middle / 3)
    expect(last).toBeLessThan(middle / 3)
  })

  test('a covering with no time is closed', () => {
    expect(coverShareAt(0, 0)).toBe(1)
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
