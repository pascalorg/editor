import { expect, test } from 'bun:test'
import { Matrix4, Ray, Vector3 } from 'three'
import { createSpatialDragPlane, intersectSpatialDragPlane, spatialDragLocalY } from './spatial-drag-plane'

test('controller translation gives continuous motion at the grabbed height', () => {
  const start = new Vector3(2, 2.4, 1)
  const ray = new Ray(new Vector3(2, 3.4, 2), new Vector3(0, -1, -1).normalize())
  const plane = createSpatialDragPlane(start, ray)
  for (let step = 0; step <= 10; step++) {
    const moved = ray.clone()
    moved.origin.z += step / 10
    const hit = intersectSpatialDragPlane(moved, plane, new Vector3())!
    expect(hit.x).toBeCloseTo(2)
    expect(hit.y).toBeCloseTo(2.4)
    expect(hit.z).toBeCloseTo(1 + step / 10)
  }
})

test('horizontal rays use a stable facing plane and grazing rays are ignored', () => {
  const ray = new Ray(new Vector3(0, 1, 2), new Vector3(0, 0, -1))
  const plane = createSpatialDragPlane(new Vector3(0, 1, 0), ray)
  ray.origin.x = 0.1
  expect(intersectSpatialDragPlane(ray, plane, new Vector3())?.x).toBeCloseTo(0.1)
  ray.direction.set(1, 0, -0.001).normalize()
  expect(intersectSpatialDragPlane(ray, plane, new Vector3())).toBeNull()
})

test('drag plane follows a rotated, scaled building frame', () => {
  const transform = new Matrix4().makeRotationZ(Math.PI / 4).scale(new Vector3(0.2, 0.2, 0.2))
  const point = new Vector3(0, 2, 0).applyMatrix4(transform)
  const up = new Vector3(0, 1, 0).transformDirection(transform)
  const ray = new Ray(point.clone().add(up), up.clone().negate())
  const plane = createSpatialDragPlane(point, ray, transform)
  expect(intersectSpatialDragPlane(ray, plane, new Vector3())?.distanceTo(point)).toBeLessThan(1e-8)
})

 test('height drag uses model metres at human and miniature scales without an initial jump', () => {
  for (const scale of [1, 0.2, 2]) {
    const frame = new Matrix4().makeRotationY(0.7).scale(new Vector3(scale, scale, scale))
    frame.setPosition(2, 4, -3)
    const inverse = frame.clone().invert()
    const start = new Vector3(1, 2.5, 3).applyMatrix4(frame)
    const initialY = spatialDragLocalY(start, inverse)
    for (let step = 0; step <= 10; step++) {
      const moved = start.clone().add(new Vector3(0, scale * step / 10, 0))
      expect(2.5 + spatialDragLocalY(moved, inverse) - initialY).toBeCloseTo(2.5 + step / 10)
    }
  }
})
