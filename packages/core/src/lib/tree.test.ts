import { describe, expect, test } from 'bun:test'
import { buildTree, estimateTree } from './tree-build'
import {
  TREE_FAR_MAX_TRIANGLES,
  TREE_FORMS,
  TREE_MAX_TRIANGLES,
  type TreeParameters,
} from './tree-form'

const tree = (extra: Partial<TreeParameters> = {}): TreeParameters => ({
  form: 'round',
  heightM: 8,
  spreadM: 6.4,
  foliage: '#609343',
  density: 0.85,
  seed: 19,
  gen: 1,
  ...extra,
})

describe('procedural tree geometry', () => {
  test('identical fields give identical attribute bytes at both levels', () => {
    const first = buildTree(tree())
    const second = buildTree(tree())
    for (const level of ['near', 'far'] as const)
      for (const attribute of ['position', 'normal', 'color', 'index'] as const)
        expect(new Uint8Array(first[level][attribute].buffer)).toEqual(
          new Uint8Array(second[level][attribute].buffer),
        )
    expect(buildTree(tree({ seed: 20 })).near.position).not.toEqual(first.near.position)
  })

  test.each(TREE_FORMS)('%s stays within both triangle caps at every supported size', (form) => {
    for (const heightM of [2, 4, 8, 14, 25])
      for (const density of [0, 0.15, 0.85, 1]) {
        const input = tree({ form, heightM, spreadM: heightM, density })
        const estimate = estimateTree(input)
        const mesh = buildTree(input)
        expect(mesh.near.index.length / 3).toBe(estimate.triangles)
        expect(mesh.far.index.length / 3).toBe(estimate.farTriangles)
        expect(estimate.triangles).toBeLessThanOrEqual(TREE_MAX_TRIANGLES)
        expect(estimate.farTriangles).toBeLessThanOrEqual(TREE_FAR_MAX_TRIANGLES)
        for (const level of [mesh.near, mesh.far]) {
          expect(level.position.every(Number.isFinite)).toBe(true)
          expect(level.normal.every(Number.isFinite)).toBe(true)
          expect(level.color.every((channel) => channel >= 0 && channel <= 1)).toBe(true)
          expect(level.index.every((index) => index < level.position.length / 3)).toBe(true)
        }
      }
  })

  test('winter retains its branching wood but has no foliage', () => {
    const bare = estimateTree(tree({ density: 0 }))
    expect(bare.leaves).toBe(0)
    expect(bare.triangles).toBe(bare.woodTriangles)
    expect(bare.triangles).toBeGreaterThan(1000)
    expect(bare.triangles).toBeLessThan(estimateTree(tree()).triangles)
  })

  test('an eight metre broadleaf uses the requested near-detail range', () => {
    const count = estimateTree(tree()).triangles
    expect(count).toBeGreaterThanOrEqual(6000)
    expect(count).toBeLessThanOrEqual(12000)
  })
})
