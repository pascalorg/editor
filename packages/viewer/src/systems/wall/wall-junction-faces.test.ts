// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { calculateLevelMiters, sceneRegistry, WallNode } from '@pascal-app/core'
import * as THREE from 'three'
import { generateExtrudedWall } from './wall-system'

const wall = (
  id: string,
  start: [number, number],
  end: [number, number],
  backSide: 'interior' | 'exterior' = 'exterior',
) =>
  WallNode.parse({
    id,
    parentId: 'level_f',
    start,
    end,
    height: 2.5,
    frontSide: 'interior',
    backSide,
  })

/**
 * A small room set into a larger one's side: the larger room's side wall runs on past the
 * partition as a short nub at each end, and the small room's walls meet it in T-junctions.
 * With the partition interior on both sides, the north nub starts at a junction whose closing
 * path has two points (the south nub's two-point junction is at its end).
 */
const walls = [
  wall('wall_south_nub', [7.5, 7], [7.5, 8]),
  wall('wall_partition', [7.5, 8], [7.5, 10.5], 'interior'),
  wall('wall_north_nub', [7.5, 10.5], [7.5, 11]),
  wall('wall_small_s', [7.5, 8], [10, 8]),
  wall('wall_small_e', [10, 8], [10, 10.5]),
  wall('wall_small_n', [10, 10.5], [7.5, 10.5]),
  wall('wall_big_s', [0, 7], [7.5, 7]),
  wall('wall_big_n', [7.5, 11], [0, 11]),
  wall('wall_big_w', [0, 11], [0, 7]),
]

function frontFaceTriangles(target: WallNode) {
  const mesh = new THREE.Mesh()
  sceneRegistry.nodes.set(target.id, mesh)
  let geometry: THREE.BufferGeometry
  try {
    geometry = generateExtrudedWall(target, [], calculateLevelMiters(walls), 0, 0)
  } finally {
    sceneRegistry.nodes.delete(target.id)
  }
  const position = geometry.getAttribute('position')
  const index = geometry.index
  const out: { normal: THREE.Vector3; area: number }[] = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  for (const group of geometry.groups) {
    if (group.materialIndex !== 1) continue
    for (let k = group.start; k < group.start + group.count; k += 3) {
      a.fromBufferAttribute(position, index ? index.getX(k) : k)
      b.fromBufferAttribute(position, index ? index.getX(k + 1) : k + 1)
      c.fromBufferAttribute(position, index ? index.getX(k + 2) : k + 2)
      const cross = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a))
      out.push({ normal: cross.clone().normalize(), area: cross.length() / 2 })
    }
  }
  return out
}

describe('wall face materials at T-junctions', () => {
  test('the front finish covers the front side of a wall that starts at a two-point junction', () => {
    for (const id of ['wall_south_nub', 'wall_north_nub']) {
      const target = walls.find((w) => w.id === id)!
      const front = frontFaceTriangles(target)
      expect(front.length).toBeGreaterThan(0)
      // Wall-local x runs along the wall: the front side faces across it, never along it (a cap).
      for (const { normal } of front) expect(Math.abs(normal.x)).toBeLessThan(1e-3)
      // The whole front side (its length between the miters × the wall height) takes the finish.
      const area = front.reduce((sum, t) => sum + t.area, 0)
      expect(area).toBeGreaterThan(0.4 * 2.4)
    }
  })
})
