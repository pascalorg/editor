// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { applyWallBatchGroups, buildWallBatch, type WallBatchSource } from './wall-batch'

/** One triangle per material index, laid out the way a wall arrives: non-indexed, groups sorted. */
function wallLike(materialIndices: number[], offsetX: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(materialIndices.length * 9)
  const normals = new Float32Array(materialIndices.length * 9)
  const uvs = new Float32Array(materialIndices.length * 6)

  for (let triangle = 0; triangle < materialIndices.length; triangle += 1) {
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const base = triangle * 9 + vertex * 3
      positions[base] = offsetX + triangle
      positions[base + 1] = vertex
      normals[base] = 1
    }
    geometry.addGroup(triangle * 3, 3, materialIndices[triangle] as number)
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geometry
}

function source(
  nodeId: string,
  materialIndices: number[],
  offsetX: number,
  moveX = 0,
): WallBatchSource {
  return {
    nodeId,
    geometry: wallLike(materialIndices, offsetX),
    matrix: new THREE.Matrix4().makeTranslation(moveX, 0, 0),
  }
}

function groupsOf(geometry: THREE.BufferGeometry) {
  return geometry.groups.map((group) => [group.start, group.count, group.materialIndex])
}

describe('buildWallBatch', () => {
  test('collapses every source into one run per material index', () => {
    const batch = buildWallBatch([
      source('a', [0, 1, 2], 0),
      source('b', [0, 1, 2], 10),
      source('c', [0, 1, 2], 20),
    ])

    expect(batch).not.toBeNull()
    expect(batch?.runs.map((run) => run.materialIndex)).toEqual([0, 1, 2])
    expect(groupsOf(batch?.geometry as THREE.BufferGeometry)).toEqual([
      [0, 9, 0],
      [9, 9, 1],
      [18, 9, 2],
    ])
  })

  test('bakes each source matrix into the merged positions', () => {
    const batch = buildWallBatch([source('a', [0], 0), source('b', [0], 0, 5)])
    const positions = batch?.geometry.getAttribute('position') as THREE.BufferAttribute

    expect(positions.getX(0)).toBeCloseTo(0)
    expect(positions.getX(3)).toBeCloseTo(5)
  })

  test('keeps only the attributes every source carries', () => {
    const bare = source('b', [0], 0)
    bare.geometry.deleteAttribute('uv')

    const batch = buildWallBatch([source('a', [0], 0), bare])

    expect(batch?.geometry.getAttribute('position')).toBeDefined()
    expect(batch?.geometry.getAttribute('normal')).toBeDefined()
    expect(batch?.geometry.getAttribute('uv')).toBeUndefined()
  })

  test('records a slice per source inside every run', () => {
    const batch = buildWallBatch([source('a', [0, 1], 0), source('b', [0, 1], 10)])
    const firstRun = batch?.runs[0]

    expect(firstRun?.slices.map((slice) => slice.nodeId)).toEqual(['a', 'b'])
    expect(firstRun?.slices.map((slice) => slice.count)).toEqual([3, 3])
  })
})

describe('applyWallBatchGroups', () => {
  test('cuts a hidden wall out of every run without touching the buffers', () => {
    const batch = buildWallBatch([
      source('a', [0, 1], 0),
      source('b', [0, 1], 10),
      source('c', [0, 1], 20),
    ])
    if (!batch) throw new Error('batch expected')

    const positions = batch.geometry.getAttribute('position')
    applyWallBatchGroups(batch, new Set(['b']))

    expect(groupsOf(batch.geometry)).toEqual([
      [0, 3, 0],
      [6, 3, 0],
      [9, 3, 1],
      [15, 3, 1],
    ])
    expect(batch.geometry.getAttribute('position')).toBe(positions)
  })

  test('restores the full runs once nothing is hidden', () => {
    const batch = buildWallBatch([source('a', [0], 0), source('b', [0], 10)])
    if (!batch) throw new Error('batch expected')

    applyWallBatchGroups(batch, new Set(['a']))
    applyWallBatchGroups(batch, new Set())

    expect(groupsOf(batch.geometry)).toEqual([[0, 6, 0]])
  })
})

/**
 * The guard for the merge itself: these numbers must not follow the wall count.
 * Drop the batching and every wall goes back to owning its own draw range, so
 * the run and group counts below jump from three to a thousand and this fails.
 */
describe('draw call budget', () => {
  const MATERIALS = [0, 1, 2]

  function floor(wallCount: number): WallBatchSource[] {
    return Array.from({ length: wallCount }, (_, index) =>
      source(`wall_${index}`, MATERIALS, 0, index * 4),
    )
  }

  test('holds one draw range per material however many walls the floor has', () => {
    for (const wallCount of [1, 10, 100, 1000]) {
      const batch = buildWallBatch(floor(wallCount))
      if (!batch) throw new Error('batch expected')

      expect(batch.runs.length).toBe(MATERIALS.length)
      expect(batch.geometry.groups.length).toBe(MATERIALS.length)
      expect(batch.runs[0]?.slices.length).toBe(wallCount)
    }
  })

  test('keeps every wall addressable inside the collapsed ranges', () => {
    const batch = buildWallBatch(floor(1000))
    if (!batch) throw new Error('batch expected')

    for (const run of batch.runs) {
      expect(new Set(run.slices.map((slice) => slice.nodeId)).size).toBe(1000)
      expect(run.count).toBe(3000)
    }
  })

  test('spends draw ranges on the holes, not on the floor', () => {
    const batch = buildWallBatch(floor(1000))
    if (!batch) throw new Error('batch expected')
    const positions = batch.geometry.getAttribute('position')

    applyWallBatchGroups(batch, new Set(['wall_500']))
    expect(batch.geometry.groups.length).toBe(MATERIALS.length * 2)

    applyWallBatchGroups(batch, new Set(['wall_100', 'wall_500', 'wall_900']))
    expect(batch.geometry.groups.length).toBe(MATERIALS.length * 4)

    applyWallBatchGroups(batch, new Set())
    expect(batch.geometry.groups.length).toBe(MATERIALS.length)
    expect(batch.geometry.getAttribute('position')).toBe(positions)
  })
})
