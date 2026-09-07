import { describe, expect, test } from 'bun:test'
import { Euler, Matrix4, Plane, Quaternion, Ray, Vector3 } from 'three'
import { applyXRReferenceSpaceRayToWorld, setObjectFloorPlane } from './reference-space-ray'

describe('applyXRReferenceSpaceRayToWorld', () => {
  test('moves and rotates a raw XR pose with the active XR origin', () => {
    const originMatrix = new Matrix4().compose(
      new Vector3(0, 4.5, 8),
      new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0)),
      new Vector3(2, 2, 2),
    )
    const rayOrigin = new Vector3(0.25, 1.5, -0.4)
    const rayDirection = new Vector3(0, 0, -1)

    applyXRReferenceSpaceRayToWorld(rayOrigin, rayDirection, originMatrix)

    expect(rayOrigin.x).toBeCloseTo(-0.8)
    expect(rayOrigin.y).toBeCloseTo(7.5)
    expect(rayOrigin.z).toBeCloseTo(7.5)
    expect(rayDirection.x).toBeCloseTo(-1)
    expect(rayDirection.y).toBeCloseTo(0)
    expect(rayDirection.z).toBeCloseTo(0)
  })

  test('intersects the transformed active-level floor instead of global Y zero', () => {
    const levelMatrix = new Matrix4().makeTranslation(0, 4.5, 0)
    const floor = new Plane()
    setObjectFloorPlane(floor, levelMatrix, new Vector3(), new Vector3())

    const ray = new Ray(new Vector3(0, 6, 8), new Vector3(-2.5, -1.5, -8).normalize())
    const hit = ray.intersectPlane(floor, new Vector3())

    expect(hit?.x).toBeCloseTo(-2.5)
    expect(hit?.y).toBeCloseTo(4.5)
    expect(hit?.z).toBeCloseTo(0)
  })
})
