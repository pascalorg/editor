import { afterEach, expect, test } from 'bun:test'
import type { GroundBox } from '@pascal-app/core'
import { PerspectiveCamera, Vector3 } from 'three'
import {
  groundWindowBoxNow,
  groundWindowContains,
  groundWindowEnabledNode,
  groundWindowMaskNode,
  inGroundWindowNode,
  setGroundWindow,
  temporarilyGroundWindowForCapture,
} from './ground-window'

const BOX: GroundBox = { min: [-5, 0, -4], max: [5, 3, 4] }

afterEach(() => setGroundWindow(null))

test('the window opens for a box and closes without one', () => {
  expect(groundWindowBoxNow()).toBeNull()
  setGroundWindow(BOX)
  expect(groundWindowBoxNow()).toBe(BOX)
  setGroundWindow(null)
  expect(groundWindowBoxNow()).toBeNull()
})

test('the TSL nodes build: the window, its mask and its enabled word', () => {
  expect(inGroundWindowNode()).toBeTruthy()
  expect(groundWindowMaskNode()).toBeTruthy()
  expect(groundWindowEnabledNode()).toBeTruthy()
})

test("a capture with no ground in its way closes the person's window for the frame, then gives it back", () => {
  setGroundWindow(BOX)
  const camera = new PerspectiveCamera()
  camera.position.set(0, 7, -20)
  // No scene, no terrain: nothing can stand in the capture's way.
  const restore = temporarilyGroundWindowForCapture(camera, {})
  expect(groundWindowBoxNow()).toBeNull()
  restore()
  expect(groundWindowBoxNow()).toBe(BOX)
})

test('a pick on ground in front of the box falls in the window; beyond it does not', () => {
  const eye = new Vector3(0, 2, -20)
  expect(groundWindowContains(eye, new Vector3(0, 2, -10))).toBe(false)
  setGroundWindow(BOX)
  // Ground between the eye and the box, and ground inside the box: veiled.
  expect(groundWindowContains(eye, new Vector3(0, 2, -10))).toBe(true)
  expect(groundWindowContains(eye, new Vector3(0, 1, 0))).toBe(true)
  // Ground past the box, and a view from inside it: solid.
  expect(groundWindowContains(eye, new Vector3(0, 2, 10))).toBe(false)
  expect(groundWindowContains(new Vector3(0, 1, 0), new Vector3(0, 2, -10))).toBe(false)
  // A ray that misses the box entirely.
  expect(groundWindowContains(eye, new Vector3(20, 2, -10))).toBe(false)
})
