// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { RoofSegmentNode } from '@pascal-app/core'
import * as THREE from 'three'
import { generateRoofSegmentGeometry, getRoofSegmentUndersidePolygons } from './roof-system'

/** An L: the 10 × 8 rectangle without its +x / +z quarter (x > 2, z > 1). */
const L: [number, number][] = [
  [-5, -4],
  [5, -4],
  [5, 1],
  [2, 1],
  [2, 4],
  [-5, 4],
]

function segment(footprint?: [number, number][]) {
  return RoofSegmentNode.parse({
    type: 'roof-segment',
    roofType: 'gable',
    width: 10,
    depth: 8,
    wallHeight: 0,
    pitch: 30,
    overhang: 0.5,
    wallThickness: 0.2,
    footprint,
  })
}

function hitsAt(geometry: THREE.BufferGeometry, x: number, z: number) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  return new THREE.Raycaster(
    new THREE.Vector3(x, 50, z),
    new THREE.Vector3(0, -1, 0),
  ).intersectObject(mesh).length
}

describe('roof segment cut to a footprint', () => {
  test('nothing over the cut-away corner, the roof everywhere else', () => {
    const geometry = generateRoofSegmentGeometry(segment(L))
    expect(hitsAt(geometry, 4, 3)).toBe(0)
    expect(hitsAt(geometry, -3, 3)).toBeGreaterThan(0)
    expect(hitsAt(geometry, 4, -3)).toBeGreaterThan(0)
    // Within the overhang beyond the inner walls, the eave still reaches.
    expect(hitsAt(geometry, 2.3, 3)).toBeGreaterThan(0)
    expect(hitsAt(geometry, 3, 1.3)).toBeGreaterThan(0)
    geometry.dispose()
  })

  test('without a footprint the rectangle stays whole', () => {
    const geometry = generateRoofSegmentGeometry(segment())
    expect(hitsAt(geometry, 4, 3)).toBeGreaterThan(0)
    geometry.dispose()
  })

  test('the underside stops at the outline plus overhang', () => {
    const polygons = getRoofSegmentUndersidePolygons(segment(L))!
    const inside = (x: number, z: number) =>
      polygons.some((polygon) => {
        let hit = false
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
          const a = polygon[i]!
          const b = polygon[j]!
          if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) hit = !hit
        }
        return hit
      })
    expect(inside(4, 3)).toBe(false)
    expect(inside(-3, 3)).toBe(true)
    expect(inside(4, -3)).toBe(true)
  })

  test('the gable stands inside the outline, flush with its face', () => {
    const geometry = generateRoofSegmentGeometry(segment(L))
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    // Under the slope at z = -2 the gable is 2 tan 30° ≈ 1.15 m tall at x = 5.
    const hit = new THREE.Raycaster(
      new THREE.Vector3(9, 0.8, -2),
      new THREE.Vector3(-1, 0, 0),
    ).intersectObject(mesh)[0]
    expect(hit?.point.x).toBeCloseTo(5, 3)
    geometry.dispose()
  })
})
