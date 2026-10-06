import { afterAll, beforeAll, expect, test } from 'bun:test'
import { CameraControlsImpl } from '@react-three/drei'
import * as THREE from 'three'
import { ORBIT_FLOOR_CLEARANCE } from '../../lib/orbit-floor-clearance'
import { FloorAwareCameraControls } from './floor-aware-camera-controls'

// No DOM in this runner: camera-controls only constructs an empty DOMRect.
const scope = globalThis as Record<string, unknown>
const stubDomRect = !scope.DOMRect
beforeAll(() => {
  if (stubDomRect) scope.DOMRect = class {}
  CameraControlsImpl.install({ THREE })
})
afterAll(() => {
  if (stubDomRect) delete scope.DOMRect
})

const GROUND_MIN_Y = ORBIT_FLOOR_CLEARANCE
const ROOM_CENTRE = new THREE.Vector3(-2.25, 0, 3.25)
const degrees = (value: number) => (value * Math.PI) / 180

function groundFloorControls(
  camera: THREE.Camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 500),
) {
  const controls = new FloorAwareCameraControls(camera as THREE.PerspectiveCamera)
  controls.floorMinY = GROUND_MIN_Y
  controls.maxPolarAngle = Math.PI - 0.05
  // 6 m from the room centre, 45° down.
  controls.setLookAt(0.75, 4.2, 6.25, ROOM_CENTRE.x, ROOM_CENTRE.y, ROOM_CENTRE.z, false)
  settle(controls)
  return controls
}

function settle(controls: CameraControlsImpl) {
  for (let frame = 0; frame < 4; frame++) controls.update(1 / 60)
}

function pose(controls: CameraControlsImpl) {
  return {
    position: controls.getPosition(new THREE.Vector3(), false),
    target: controls.getTarget(new THREE.Vector3(), false),
    drawn: controls.camera.position.clone(),
  }
}

function viewDirection(p: { position: THREE.Vector3; target: THREE.Vector3 }) {
  return p.target.clone().sub(p.position).normalize()
}

function expectVectorClose(actual: THREE.Vector3, expected: THREE.Vector3, digits = 6) {
  expect(actual.x).toBeCloseTo(expected.x, digits)
  expect(actual.y).toBeCloseTo(expected.y, digits)
  expect(actual.z).toBeCloseTo(expected.z, digits)
}

function orbitTo(controls: CameraControlsImpl, polarDegrees: number) {
  controls.rotateTo(controls.azimuthAngle, degrees(polarDegrees), false)
  settle(controls)
}

test('orbiting past the horizon looks up from the floor clearance, and the state is the drawn pose', () => {
  const controls = groundFloorControls()
  const before = pose(controls)
  const startPolarDegrees = (controls.polarAngle * 180) / Math.PI

  orbitTo(controls, 135)
  const grounded = pose(controls)
  expect(grounded.drawn.y).toBeCloseTo(GROUND_MIN_Y, 6)
  // Pushed toward the room centre, not left 6 m out.
  expect(
    Math.hypot(grounded.drawn.x - ROOM_CENTRE.x, grounded.drawn.z - ROOM_CENTRE.z),
  ).toBeLessThan(2)
  // Looking up at 45°.
  expect(viewDirection(grounded).y).toBeCloseTo(Math.sin(degrees(45)), 6)
  // Every reader agrees with the drawn camera, so pan speed is calibrated on it.
  expectVectorClose(grounded.position, grounded.drawn)
  expect(grounded.position.distanceTo(grounded.target)).toBeCloseTo(controls.distance, 6)

  orbitTo(controls, startPolarDegrees)
  const back = pose(controls)
  expectVectorClose(back.position, before.position)
  expectVectorClose(back.target, before.target)
})

test('a captured grounded view replays as the same view', () => {
  const controls = groundFloorControls()
  orbitTo(controls, 135)
  const saved = pose(controls)

  const replay = groundFloorControls()
  replay.setLookAt(
    saved.position.x,
    saved.position.y,
    saved.position.z,
    saved.target.x,
    saved.target.y,
    saved.target.z,
    false,
  )
  settle(replay)
  const replayed = pose(replay)
  expectVectorClose(replayed.drawn, saved.drawn)
  expectVectorClose(viewDirection(replayed), viewDirection(saved))
})

test('a pose written under the clearance is shown exactly, then held without a jump', () => {
  const controls = groundFloorControls()
  controls.setLookAt(0, 0.6, 6, 0, 2, 0, false)
  settle(controls)
  expectVectorClose(controls.camera.position, new THREE.Vector3(0, 0.6, 6))

  // Orbiting a little lower from there does not jump up to the clearance.
  controls.rotate(0, degrees(1), false)
  settle(controls)
  expect(controls.camera.position.y).toBeLessThan(0.6 + 1e-9)
  expect(controls.camera.position.y).toBeGreaterThan(0.5)

  // Rising past the clearance and restoring the same saved view honours it again.
  controls.rotateTo(controls.azimuthAngle, degrees(30), false)
  settle(controls)
  expect(controls.camera.position.y).toBeGreaterThan(GROUND_MIN_Y)
  controls.setLookAt(0, 0.6, 6, 0, 2, 0, false)
  settle(controls)
  expectVectorClose(controls.camera.position, new THREE.Vector3(0, 0.6, 6))
})

test('a held low pose does not survive moving to another floor', () => {
  const controls = groundFloorControls()
  controls.setLookAt(0, 0.6, 6, 0, 2, 0, false)
  settle(controls)

  // The upper level is selected: its floor is 2.71 and the target follows it.
  controls.floorMinY = 2.71 + ORBIT_FLOOR_CLEARANCE
  const target = controls.getTarget(new THREE.Vector3())
  controls.moveTo(target.x, target.y + 2.71, target.z, false)
  settle(controls)
  expect(controls.camera.position.y).toBeCloseTo(2.71 + ORBIT_FLOOR_CLEARANCE, 6)
})

test('an orthographic camera is never moved by the floor', () => {
  const controls = groundFloorControls(new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 500))
  orbitTo(controls, 135)
  const orbit = pose(controls)
  expect(orbit.drawn.y).toBeLessThan(0)
  expectVectorClose(orbit.target, ROOM_CENTRE)
})

test('update listeners observe the grounded pose throughout damping and smooth time changes', () => {
  const controls = groundFloorControls()
  const before = pose(controls)
  const startPolar = controls.polarAngle
  orbitTo(controls, 135)
  let published = pose(controls)
  controls.addEventListener('update', () => {
    published = pose(controls)
  })
  controls.smoothTime = 0.5
  controls.rotatePolarTo(degrees(160), true)
  for (let frame = 0; frame < 180; frame++) {
    if (frame === 20) controls.smoothTime = 0.08
    controls.update(1 / 60)
    expectVectorClose(published.position, controls.camera.position)
    expect(published.position.y).toBeGreaterThanOrEqual(GROUND_MIN_Y - 1e-9)
  }
  controls.rotatePolarTo(startPolar, true)
  for (let frame = 0; frame < 180; frame++) controls.update(1 / 60)
  expectVectorClose(controls.camera.position, before.drawn)
  expectVectorClose(controls.getTarget(new THREE.Vector3(), false), before.target)
})

test('changing the floor while idle publishes the corrected pose in the same update', () => {
  const controls = groundFloorControls()
  orbitTo(controls, 135)
  let published: THREE.Vector3 | null = null
  controls.addEventListener('update', () => {
    published = controls.getPosition(new THREE.Vector3(), false)
  })
  controls.floorMinY = 3.91
  expect(controls.update(1 / 60)).toBe(true)
  expect(published).not.toBeNull()
  expectVectorClose(published!, controls.camera.position)
  expect(controls.camera.position.y).toBeCloseTo(3.91, 6)
})

test('fitting a box replaces a grounded target and keeps the box centred when orbiting back', () => {
  const controls = groundFloorControls()
  orbitTo(controls, 110)
  const box = new THREE.Box3(new THREE.Vector3(-3, 0, 2), new THREE.Vector3(-1, 3, 4))
  const centre = box.getCenter(new THREE.Vector3())
  controls.fitToBox(box, false)
  settle(controls)
  expectVectorClose(controls.getTarget(new THREE.Vector3(), false), centre)
  controls.rotatePolarTo(degrees(45), false)
  settle(controls)
  expectVectorClose(controls.getTarget(new THREE.Vector3(), false), centre)
})

test('relative navigation while grounded preserves its translation when orbiting back', () => {
  const controls = groundFloorControls()
  const startPolar = controls.polarAngle
  const expected = groundFloorControls()
  orbitTo(controls, 135)
  controls.truck(1, 0, false)
  controls.forward(2, false)
  controls.elevate(0.5, false)
  settle(controls)
  expected.truck(1, 0, false)
  expected.forward(2, false)
  expected.elevate(0.5, false)
  settle(expected)
  controls.rotatePolarTo(startPolar, false)
  settle(controls)
  expectVectorClose(controls.camera.position, expected.camera.position)
  expectVectorClose(
    controls.getTarget(new THREE.Vector3(), false),
    expected.getTarget(new THREE.Vector3(), false),
  )
})

test('switching floors from a grounded orbit preserves horizontal framing on the round trip', () => {
  const controls = groundFloorControls()
  orbitTo(controls, 135)
  const before = pose(controls)
  const target = new THREE.Vector3()
  for (const floorY of [2.71, 0]) {
    controls.floorMinY = floorY + GROUND_MIN_Y
    controls.getOrbitTarget(target)
    controls.moveTo(target.x, floorY, target.z, true)
    for (let frame = 0; frame < 180; frame++) controls.update(1 / 60)
    expect(controls.camera.position.y).toBeCloseTo(floorY + GROUND_MIN_Y, 6)
    expect(controls.camera.position.x).toBeCloseTo(before.drawn.x, 6)
    expect(controls.camera.position.z).toBeCloseTo(before.drawn.z, 6)
  }
  expectVectorClose(controls.getTarget(new THREE.Vector3(), false), before.target)
})
