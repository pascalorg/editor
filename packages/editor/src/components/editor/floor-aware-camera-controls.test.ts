import { afterAll, beforeAll, expect, test } from 'bun:test'
import { CameraControlsImpl } from '@react-three/drei'
import * as THREE from 'three'
import {
  LOOK_UP_PITCH_GAIN,
  LOOK_UP_PUSH_HALF_ANGLE,
  MAX_ORBIT_POLAR_ANGLE,
  ORBIT_FLOOR_CLEARANCE,
  ORBIT_TARGET_HEIGHT,
} from '../../lib/orbit-floor-clearance'
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

// A drag: relative, like the pointer, to the orbit's own polar angle.
function orbitTo(controls: FloorAwareCameraControls, polarDegrees: number) {
  controls.rotate(0, degrees(polarDegrees) - controls.orbitPolarAngle, false)
  settle(controls)
}

test('orbiting past the horizon pitches the view up fast while the camera closes in gently', () => {
  const controls = groundFloorControls()
  const before = pose(controls)
  const startPolarDegrees = (controls.polarAngle * 180) / Math.PI
  const contactPolar = Math.acos(GROUND_MIN_Y / controls.distance)
  const contactReach = Math.sqrt(controls.distance ** 2 - GROUND_MIN_Y ** 2)
  const straightUp = (MAX_ORBIT_POLAR_ANGLE - contactPolar) / LOOK_UP_PITCH_GAIN

  let previousPitch = -Math.PI
  for (const polar of [95, 100, 110, 120, 130, 145, 160, 176]) {
    orbitTo(controls, polar)
    const grounded = pose(controls)
    const past = Math.min(degrees(polar) - contactPolar, straightUp)
    expect(grounded.drawn.y).toBeCloseTo(GROUND_MIN_Y, 6)
    // Pitch: LOOK_UP_PITCH_GAIN times the drag, stopping at straight up.
    const pitch = Math.asin(viewDirection(grounded).y)
    expect(pitch).toBeCloseTo(contactPolar + past * LOOK_UP_PITCH_GAIN - Math.PI / 2, 6)
    expect(pitch).toBeGreaterThanOrEqual(previousPitch - 1e-9)
    previousPitch = pitch
    // Push: gentle, at the half-angle rate.
    const reach = Math.hypot(grounded.drawn.x - ROOM_CENTRE.x, grounded.drawn.z - ROOM_CENTRE.z)
    expect(reach).toBeCloseTo(contactReach * 0.5 ** (past / LOOK_UP_PUSH_HALF_ANGLE), 6)
    // Every reader agrees with the drawn camera, so pan speed is calibrated on it.
    expectVectorClose(grounded.position, grounded.drawn)
    expect(grounded.position.distanceTo(grounded.target)).toBeCloseTo(controls.distance, 6)
  }
  // Straight up within ~80° of drag past the floor, and no further.
  expect(previousPitch).toBeCloseTo(MAX_ORBIT_POLAR_ANGLE - Math.PI / 2, 6)

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
  controls.setLookAt(0, 0.1, 6, 0, 2, 0, false)
  settle(controls)
  expectVectorClose(controls.camera.position, new THREE.Vector3(0, 0.1, 6))

  // Orbiting a little lower from there does not jump up to the clearance.
  controls.rotate(0, degrees(1), false)
  settle(controls)
  expect(controls.camera.position.y).toBeLessThan(0.1 + 1e-9)
  expect(controls.camera.position.y).toBeGreaterThan(0.05)

  // Rising past the clearance and restoring the same saved view honours it again.
  controls.rotateTo(controls.azimuthAngle, degrees(30), false)
  settle(controls)
  expect(controls.camera.position.y).toBeGreaterThan(GROUND_MIN_Y)
  controls.setLookAt(0, 0.1, 6, 0, 2, 0, false)
  settle(controls)
  expectVectorClose(controls.camera.position, new THREE.Vector3(0, 0.1, 6))
})

test('a held low pose does not survive moving to another floor', () => {
  const controls = groundFloorControls()
  controls.setLookAt(0, 0.1, 6, 0, 2, 0, false)
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

test('turning a quarter around the orbit while looking up keeps the look-up pitch', () => {
  const controls = groundFloorControls()
  orbitTo(controls, 110)
  const pitch = Math.asin(viewDirection(pose(controls)).y)
  // The 90° orbit shortcut: an absolute azimuth with the orbit's own polar angle.
  controls.rotateTo(controls.azimuthAngle + Math.PI / 2, controls.orbitPolarAngle, false)
  settle(controls)
  expect(Math.asin(viewDirection(pose(controls)).y)).toBeCloseTo(pitch, 6)
  expect(controls.camera.position.y).toBeCloseTo(GROUND_MIN_Y, 6)
})

test('a pivot at standing height: zoomed in, the orbit looks around at eye level and pans level', () => {
  const controls = groundFloorControls()
  const pivotY = ORBIT_TARGET_HEIGHT
  controls.setLookAt(-2.25, pivotY, 3.25 + 2, ROOM_CENTRE.x, pivotY, ROOM_CENTRE.z, false)
  settle(controls)
  // Turning around the room at eye height: the camera stays on its orbit.
  for (const azimuth of [0, Math.PI / 2, Math.PI]) {
    controls.rotateTo(azimuth, Math.PI / 2, false)
    settle(controls)
    expect(controls.camera.position.y).toBeCloseTo(pivotY, 6)
    expect(controls.camera.position.distanceTo(pose(controls).target)).toBeCloseTo(2, 6)
  }
  // Tilting to look 15° up keeps the camera above the clearance, unpushed.
  orbitTo(controls, 105)
  expect(controls.camera.position.y).toBeGreaterThan(GROUND_MIN_Y)
  expect(Math.asin(viewDirection(pose(controls)).y)).toBeCloseTo(degrees(15), 6)
  // Panning (the editor's level pan: truck sideways, forward) keeps the pivot height.
  controls.truck(1.5, 0, false)
  controls.forward(2, false)
  settle(controls)
  expect(controls.getOrbitTarget(new THREE.Vector3()).y).toBeCloseTo(pivotY, 6)
})

// A raised platform (top at 0.45) over the room's z > 3.5 half, floor elsewhere.
function platformSurface() {
  const surface = {
    revision: 0,
    rebuilding: false,
    topAt(_x: number, z: number) {
      if (surface.rebuilding) return null
      return z > 3.5 ? 0.45 : 0.05
    },
  }
  return surface
}

function settleLong(controls: CameraControlsImpl, frames = 90) {
  for (let frame = 0; frame < frames; frame++) controls.update(1 / 60)
}

test('the floor limit follows a raised slab under the camera, gliding at its edge', () => {
  const surface = platformSurface()
  const controls = groundFloorControls()
  controls.floorSurface = surface
  // Low over the platform, toward the wall on the +z side.
  controls.setLookAt(-2.25, 1.1, 5.25, -2.25, 1.1, 3.25, false)
  settleLong(controls)
  orbitTo(controls, 150)
  settleLong(controls)
  expect(controls.camera.position.y).toBeCloseTo(0.45 + GROUND_MIN_Y, 4)

  // Swing round to over the plain floor: the limit glides down, no pop.
  let previous = controls.camera.position.y
  controls.rotate(Math.PI, 0, false)
  for (let frame = 0; frame < 120; frame++) {
    controls.update(1 / 60)
    expect(Math.abs(controls.camera.position.y - previous)).toBeLessThan(0.07)
    previous = controls.camera.position.y
  }
  expect(controls.camera.position.z).toBeLessThan(3)
  expect(controls.camera.position.y).toBeCloseTo(0.05 + GROUND_MIN_Y, 4)
})

test('a slab missing for a moment while it is rebuilt does not drop the camera through it', () => {
  const surface = platformSurface()
  const controls = groundFloorControls()
  controls.floorSurface = surface
  controls.setLookAt(-2.25, 1.1, 5.25, -2.25, 1.1, 3.25, false)
  settleLong(controls)
  orbitTo(controls, 150)
  settleLong(controls)
  const y = controls.camera.position.y
  surface.rebuilding = true
  surface.revision += 1
  for (let frame = 0; frame < 4; frame++) {
    controls.update(1 / 60)
    expect(controls.camera.position.y).toBeCloseTo(y, 6)
  }
  surface.rebuilding = false
  settleLong(controls, 4)
  expect(controls.camera.position.y).toBeCloseTo(y, 6)
})

test('with nothing under the camera the limit is the level floor plus the clearance, never 0', () => {
  const controls = groundFloorControls()
  controls.floorMinY = 2.71 + GROUND_MIN_Y
  controls.floorSurface = { revision: 0, topAt: () => null }
  controls.setLookAt(-2.25, 3.81, 5.25, -2.25, 3.81, 3.25, false)
  settleLong(controls)
  orbitTo(controls, 150)
  settleLong(controls)
  expect(controls.camera.position.y).toBeCloseTo(2.71 + GROUND_MIN_Y, 6)
})

test('a pose written low over a raised slab is lifted out of the slab, then orbits above it', () => {
  const surface = platformSurface()
  const controls = groundFloorControls()
  controls.floorSurface = surface
  controls.setLookAt(-2.25, 1.1, 5.25, -2.25, 1.1, 3.25, false)
  settleLong(controls)
  // As a focus clamped to the level's floor would write it: under the platform top.
  controls.setLookAt(-2.25, GROUND_MIN_Y, 5.25, -2.25, 1.1, 3.25, false)
  settleLong(controls)
  expect(controls.camera.position.y).toBeGreaterThanOrEqual(0.45 - 1e-6)
  orbitTo(controls, 150)
  settleLong(controls)
  expect(controls.camera.position.y).toBeGreaterThanOrEqual(0.45 - 1e-6)
})

test('a camera that drops from high above straight under a raised floor is held above it at once', () => {
  const controls = groundFloorControls()
  // A 1 m platform everywhere: the level's own floor limit would be inside it.
  controls.floorSurface = { revision: 0, topAt: () => 1 }
  controls.setLookAt(-2.25, 9, 5.25, -2.25, 1.1, 3.25, false)
  settleLong(controls)
  // Every pose published, from the very first frame of one fast motion down.
  const published: number[] = []
  controls.addEventListener('update', () => published.push(controls.camera.position.y))
  controls.rotate(0, degrees(120), false)
  controls.dollyTo(2, false)
  controls.update(1 / 60)
  expect(published.length).toBeGreaterThan(0)
  for (const y of published) expect(y).toBeGreaterThan(1)
  expect(controls.camera.position.y).toBeGreaterThan(1)
  settleLong(controls)
  expect(controls.camera.position.y).toBeCloseTo(1 + GROUND_MIN_Y, 4)
})

test('over a hole in the floor the camera keeps the floor it came from, not the level below', () => {
  // A stair void over z < 3; a 0.5 m floor elsewhere.
  const controls = groundFloorControls()
  controls.floorSurface = { revision: 0, topAt: (_x: number, z: number) => (z < 3 ? null : 0.5) }
  controls.setLookAt(-2.25, 1.6, 5.25, -2.25, 1.6, 3.25, false)
  settleLong(controls)
  orbitTo(controls, 150)
  settleLong(controls)
  expect(controls.camera.position.y).toBeCloseTo(0.5 + GROUND_MIN_Y, 4)
  // Swing round over the void.
  controls.rotate(Math.PI, 0, false)
  settleLong(controls, 120)
  expect(controls.camera.position.z).toBeLessThan(3)
  expect(controls.camera.position.y).toBeCloseTo(0.5 + GROUND_MIN_Y, 4)
})

test('the orbit never aims below the level floor: a destination under it is lifted smoothly', () => {
  const controls = groundFloorControls()
  controls.floorMinY = 2.71 + GROUND_MIN_Y
  controls.moveTo(-2.25, 2.71 + 1.1, 3.25, false)
  settleLong(controls)
  // A move aimed through the floor, down to the level below.
  controls.moveTo(-2.25, 1.1, 3.25, true)
  let previous = controls.camera.position.y
  for (let frame = 0; frame < 120; frame++) {
    controls.update(1 / 60)
    // The destination is held at the floor; the drawn camera moves smoothly.
    expect(controls.getOrbitTarget(new THREE.Vector3()).y).toBeGreaterThanOrEqual(2.71 - 1e-6)
    expect(Math.abs(controls.camera.position.y - previous)).toBeLessThan(0.2)
    previous = controls.camera.position.y
  }
  expect(controls.camera.position.y).toBeGreaterThanOrEqual(2.71 + GROUND_MIN_Y - 1e-6)
})

test('once the user moves the camera, a written low pose eases up to the clearance', () => {
  const controls = groundFloorControls()
  controls.floorSurface = { revision: 0, topAt: () => 0.05 }
  controls.setLookAt(-2.25, 0.15, 5.25, -2.25, 1.1, 3.25, false)
  settleLong(controls)
  expect(controls.camera.position.y).toBeCloseTo(0.15, 6)
  controls.releaseWrittenPose()
  let previous = controls.camera.position.y
  for (let frame = 0; frame < 90; frame++) {
    controls.update(1 / 60)
    expect(controls.camera.position.y - previous).toBeLessThan(0.07)
    previous = controls.camera.position.y
  }
  expect(controls.camera.position.y).toBeCloseTo(0.05 + GROUND_MIN_Y, 4)
})
