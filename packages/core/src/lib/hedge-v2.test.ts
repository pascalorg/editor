import { describe, expect, test } from 'bun:test'
import {
  buildHedge,
  FLAT_GROUND,
  HEDGE_LIMITS,
  HEDGE_MAX_TRIANGLES,
  type HedgeMesh,
  HedgeNode,
  planHedge,
} from '../index'
import { hedgeBufferHashes, hedgeV1Cases } from './__fixtures__/hedge-v1-cases'
import frozen from './__fixtures__/hedge-v1-hashes.json'

const node = (extra: Partial<HedgeNode> = {}) =>
  HedgeNode.parse({
    id: 'hedge_acceptance',
    path: [
      [0, 0],
      [12, 0],
    ],
    seed: 7,
    gen: 2,
    ...extra,
  })
const count = (meshes: HedgeMesh[]) => meshes.reduce((sum, mesh) => sum + mesh.index.length / 3, 0)

// Provenance: stored generator IDs are a byte-level compatibility contract. The fixture was
// captured by the parent from v1 dependencies verified unchanged against the original revision.
describe('saved generator 1 gardens', () => {
  test.each(Object.entries(hedgeV1Cases))('%s keeps every buffer byte', (name, input) => {
    expect(hedgeBufferHashes(buildHedge(node({ ...input, gen: 1 }), FLAT_GROUND).meshes)).toEqual(
      frozen.cases[name as keyof typeof frozen.cases],
    )
  })
  test('loading a pre-versioned node still chooses generator 1', () => {
    expect(
      HedgeNode.parse({
        path: [
          [0, 0],
          [4, 0],
        ],
      }).gen,
    ).toBe(1)
  })
})

// These are geometry/byte properties, not image similarity. The sketch comparisons remain
// a real rasterization and human appearance gate; no screenshot was used as a numerical oracle.
describe('generator 2', () => {
  test.each([0, 0.5, 1])(
    'clip %s is deterministic, and estimate matches all emitted buffers',
    (clip) => {
      const input = node({ clip })
      const { plan, meshes } = buildHedge(input, FLAT_GROUND)
      expect(plan.form.gen).toBe(2)
      expect(hedgeBufferHashes(meshes)).toEqual(
        hedgeBufferHashes(buildHedge(input, FLAT_GROUND).meshes),
      )
      expect(hedgeBufferHashes(meshes)).not.toEqual(
        hedgeBufferHashes(buildHedge(node({ clip, seed: 8 }), FLAT_GROUND).meshes),
      )
      expect(hedgeBufferHashes(meshes)).toEqual(
        hedgeBufferHashes(buildHedge({ ...input, id: 'hedge_other' }, FLAT_GROUND).meshes),
      )
      expect(count(meshes)).toBe(plan.estimate.triangles)
      expect(meshes.reduce((sum, mesh) => sum + mesh.position.length / 3, 0)).toBe(
        plan.estimate.vertices,
      )
      expect(meshes.reduce((sum, mesh) => sum + mesh.bodyIndexCount / 3, 0)).toBe(
        plan.estimate.bodyTriangles,
      )
      expect(meshes.length).toBe(plan.estimate.meshes)
      for (const mesh of meshes) {
        expect(mesh.position.every(Number.isFinite)).toBe(true)
        expect(mesh.normal.every(Number.isFinite)).toBe(true)
        expect(
          mesh.color.every((value) => Number.isFinite(value) && value >= 0 && value <= 1.0001),
        ).toBe(true)
        expect(mesh.index.every((index) => index < mesh.position.length / 3)).toBe(true)
        for (let i = 0; i < mesh.normal.length; i += 3)
          expect(Math.hypot(mesh.normal[i]!, mesh.normal[i + 1]!, mesh.normal[i + 2]!)).toBeCloseTo(
            1,
            4,
          )
      }
    },
  )

  test('uses the sketch-scale density, rather than merely enlarging the old leaves', () => {
    const first = planHedge(
      node({
        gen: 1,
        path: [
          [0, 0],
          [20, 0],
        ],
      }),
      FLAT_GROUND,
    )
    const second = planHedge(
      node({
        path: [
          [0, 0],
          [20, 0],
        ],
      }),
      FLAT_GROUND,
    )
    // Brief's reference is ~3,800 triangles/metre: ±20% permits craft without accepting v1 density.
    expect(second.estimate.triangles / 20).toBeGreaterThan(3040)
    expect(second.estimate.triangles / 20).toBeLessThan(4560)
    expect(second.estimate.leaves).toBeGreaterThan(first.estimate.leaves)
    const meanLeafArea = (gen: number) => {
      let area = 0,
        triangles = 0
      for (const mesh of buildHedge(node({ gen }), FLAT_GROUND).meshes)
        for (let i = mesh.bodyIndexCount; i < mesh.index.length; i += 3) {
          const [a, b, c] = [mesh.index[i]! * 3, mesh.index[i + 1]! * 3, mesh.index[i + 2]! * 3]
          const [ux, uy, uz] = [0, 1, 2].map((k) => mesh.position[b + k]! - mesh.position[a + k]!)
          const [vx, vy, vz] = [0, 1, 2].map((k) => mesh.position[c + k]! - mesh.position[a + k]!)
          area +=
            Math.hypot(uy! * vz! - uz! * vy!, uz! * vx! - ux! * vz!, ux! * vy! - uy! * vx!) / 2
          triangles++
        }
      return area / triangles
    }
    expect(meanLeafArea(2)).toBeLessThan(meanLeafArea(1))
  })

  test('loose foliage breaks both the top and side silhouette, not just its colour', () => {
    const envelope = (clip: number) => {
      let top = -Infinity,
        side = 0
      for (const mesh of buildHedge(node({ clip }), FLAT_GROUND).meshes)
        for (let i = 0; i < mesh.position.length; i += 3) {
          if (mesh.position[i]! < 2 || mesh.position[i]! > 10) continue
          top = Math.max(top, mesh.position[i + 1]!)
          side = Math.max(side, Math.abs(mesh.position[i + 2]!))
        }
      return { top, side }
    }
    const clipped = envelope(1),
      loose = envelope(0)
    expect(loose.top).toBeGreaterThan(clipped.top + 0.1)
    expect(loose.side).toBeGreaterThan(clipped.side + 0.05)
  })

  test('the largest valid line thins instead of exceeding the per-node cap or truncating the run', () => {
    const far = HEDGE_LIMITS.maxCoordinate
    const input = node({
      path: Array.from({ length: 64 }, (_, i) => [i % 2 ? far : -far, (i * far) / 63]),
      height: HEDGE_LIMITS.maxHeight,
      width: HEDGE_LIMITS.maxWidth,
      leafSize: HEDGE_LIMITS.minLeafSize,
      clip: 0,
    })
    const { plan, meshes } = buildHedge(input, FLAT_GROUND)
    expect(plan.withinBudget).toBe(true)
    expect(count(meshes)).toBeGreaterThan(0)
    expect(count(meshes)).toBeLessThanOrEqual(HEDGE_MAX_TRIANGLES)
    expect(count(meshes)).toBe(plan.estimate.triangles)
    expect(plan.line.runs.at(-1)?.to).toBeCloseTo(plan.line.length, 3)
  })
})
