import { afterEach, expect, test } from 'bun:test'
import { cameraPoseStore, publishCameraPose } from '../store/camera-pose-store'
import { cameraFacingYaw } from './camera-facing'

afterEach(() => cameraPoseStore.setState({ pose: null }))

function viewFrom(x: number, z: number) {
  publishCameraPose({ position: [x, 8, z], target: [0, 0, 0], projection: 'perspective' })
}

test('a new item turns its front toward the camera, in quarter turns', () => {
  viewFrom(0, 10)
  expect(cameraFacingYaw()).toBe(0)
  viewFrom(10, 2)
  expect(cameraFacingYaw()).toBeCloseTo(Math.PI / 2)
  viewFrom(-1, -10)
  expect(cameraFacingYaw()).toBeCloseTo(Math.PI)
  viewFrom(-10, -3)
  expect(cameraFacingYaw()).toBeCloseTo((3 * Math.PI) / 2)
})

test('before any view is published the item keeps its authored front', () => {
  expect(cameraFacingYaw()).toBe(0)
})
