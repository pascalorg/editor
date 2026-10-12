// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { RoofSegmentNode } from '@pascal-app/core'
import * as THREE from 'three'
import { generateRoofSegmentGeometry, offsetPlanRing } from './roof-system'

type Point = [number, number]

function crosses(a: Point, b: Point, c: Point, d: Point) {
  const side = (p: Point, q: Point, r: Point) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}

function selfCrossings(ring: Point[]) {
  let count = 0
  for (let i = 0; i < ring.length; i++) {
    for (let j = i + 2; j < ring.length; j++) {
      if (i === 0 && j === ring.length - 1) continue
      if (crosses(ring[i]!, ring[(i + 1) % ring.length]!, ring[j]!, ring[(j + 1) % ring.length]!)) {
        count++
      }
    }
  }
  return count
}

describe('roof outline robustness', () => {
  test('repeated points do not upset the offset', () => {
    const ring: Point[] = [
      [0, 0],
      [4, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]
    const out = offsetPlanRing(ring, 0.5)
    expect(out).toHaveLength(4)
    expect(selfCrossings(out)).toBe(0)
  })

  test('an L-shaped gable has no slivers torn out of its soffit and deck', () => {
    const L: Point[] = [
      [-5, -2.96],
      [3.4, -2.96],
      [3.4, 1.19],
      [5, 1.19],
      [5, 5.41],
      [0.3, 5.41],
      [0.3, 3.91],
      [-5, 3.91],
    ]
    const node = RoofSegmentNode.parse({
      type: 'roof-segment',
      roofType: 'gable',
      width: 10,
      depth: 10.82,
      pitch: 30,
      ridgeOffset: 4,
      wallHeight: 0.5,
      overhang: 0.5,
      wallThickness: 0.1,
      deckThickness: 0.1,
      shingleThickness: 0.05,
      footprint: L,
    })
    const geometry = generateRoofSegmentGeometry(node)
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    // from below, every ray meets the soffit (facing down) before anything facing up
    let torn = 0
    for (let x = box.min.x + 0.01; x < box.max.x; x += 0.1) {
      for (let z = box.min.z + 0.003; z < box.max.z; z += 0.006) {
        const hit = new THREE.Raycaster(new THREE.Vector3(x, -30, z), new THREE.Vector3(0, 1, 0))
          .intersectObject(mesh)
          .at(0)
        if (hit && hit.face!.normal.y > 0.05) torn++
      }
    }
    expect(torn).toBe(0)
    geometry.dispose()
  }, 60000)
})
