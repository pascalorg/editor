// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { calculateLevelMiters, WallNode } from '@pascal-app/core'
import * as THREE from 'three'
import { generateExtrudedWall } from './wall-system'

const IN = 0.0254

/** Whether a ray straight through the wall (across its thickness) at (x, y) hits the wall. */
function solidAt(geometry: THREE.BufferGeometry, x: number, y: number): boolean {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1))
  return ray.intersectObject(mesh).length > 0
}

const stemWall = (openings?: { u: number; width: number; top: number; bottom: number }[]) =>
  WallNode.parse({
    start: [0, 0],
    end: [6, 0],
    height: 2.5,
    thickness: 0.2,
    underpinning: { rim: 0.3, stem: 0.6, ...(openings ? { openings } : {}) },
  })

describe('wall underpinning openings', () => {
  test("a crawl space's vent and access go through the stem skirt, the stem around them stays", () => {
    const vent = { u: 1, width: 16 * IN, top: 0.33, bottom: 0.33 + 8 * IN }
    const access = { u: 4, width: 24 * IN, top: 0.33, bottom: 0.33 + 16 * IN }
    const wall = stemWall([vent, access])
    const geometry = generateExtrudedWall(wall, [], calculateLevelMiters([wall]))

    expect(solidAt(geometry, vent.u, -(vent.top + vent.bottom) / 2)).toBe(false)
    expect(solidAt(geometry, access.u, -(access.top + access.bottom) / 2)).toBe(false)
    // beside, above and below the openings the stem is solid concrete
    expect(solidAt(geometry, 2.5, -0.5)).toBe(true)
    expect(solidAt(geometry, vent.u, -vent.top + 0.01)).toBe(true)
    expect(solidAt(geometry, vent.u, -vent.bottom - 0.02)).toBe(true)
    expect(solidAt(geometry, access.u + access.width / 2 + 0.05, -0.5)).toBe(true)
    // the rim and the wall body above are untouched
    expect(solidAt(geometry, vent.u, -0.15)).toBe(true)
    expect(solidAt(geometry, vent.u, 1)).toBe(true)
    geometry.dispose()
  })

  test('a stem with no openings (a slab house) stays solid', () => {
    const wall = stemWall()
    const geometry = generateExtrudedWall(wall, [], calculateLevelMiters([wall]))
    for (const u of [1, 2.5, 4]) expect(solidAt(geometry, u, -0.5)).toBe(true)
    geometry.dispose()
  })
})
