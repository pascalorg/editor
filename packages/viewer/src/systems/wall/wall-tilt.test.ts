// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { wallTiltShear } from './wall-tilt'

describe('wallTiltShear', () => {
  test('an upright wall has no shear', () => {
    expect(wallTiltShear(undefined)).toBeNull()
    expect(wallTiltShear(0)).toBeNull()
  })

  test('leans across the thickness by height, keeping the base and the run', () => {
    const shear = wallTiltShear(Math.PI / 4)!
    const base = new THREE.Vector3(2, 0, 0.1).applyMatrix4(shear)
    expect(base.toArray()).toEqual([2, 0, 0.1])
    const top = new THREE.Vector3(2, 3, 0.1).applyMatrix4(shear)
    expect(top.x).toBeCloseTo(2)
    expect(top.y).toBeCloseTo(3)
    expect(top.z).toBeCloseTo(3.1)
  })

  test('the inverse takes a leaned point back upright', () => {
    const tilt = -0.3
    const point = new THREE.Vector3(1, 2.5, -0.05)
    const back = point
      .clone()
      .applyMatrix4(wallTiltShear(tilt)!)
      .applyMatrix4(wallTiltShear(tilt, true)!)
    expect(back.distanceTo(point)).toBeLessThan(1e-9)
  })
})
