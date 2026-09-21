import { expect, test } from 'bun:test'
import { Matrix4, Ray, Vector3 } from 'three'
import {
  createSpatialDragPlane,
  intersectSpatialDragPlane,
  spatialDragLocalY,
} from './spatial-drag-plane'

test('controller translation follows the grabbed plane', () => {
  const start = new Vector3(2, 2.4, 1)
  const ray = new Ray(new Vector3(2, 3.4, 2), new Vector3(0, -1, -1).normalize())
  const plane = createSpatialDragPlane(start, ray)
  const moved = ray.clone()
  moved.origin.z += 0.5
  expect(intersectSpatialDragPlane(moved, plane, new Vector3())?.toArray()).toEqual([2, 2.4, 1.5])
})

test('height drag measures model units under XR scene scaling', () => {
  const frame = new Matrix4().makeScale(0.2, 0.2, 0.2)
  const inverse = frame.clone().invert()
  const start = new Vector3(0, 2.5, 0).applyMatrix4(frame)
  const moved = start.clone().add(new Vector3(0, 0.2, 0))
  expect(spatialDragLocalY(moved, inverse) - spatialDragLocalY(start, inverse)).toBeCloseTo(1)
})
