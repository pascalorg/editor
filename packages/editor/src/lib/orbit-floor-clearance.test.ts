import { expect, test } from 'bun:test'
import {
  DIVE_DEPTH,
  DIVE_MARGIN,
  diveFloorY,
  floorLimitAt,
  glideFloorLimit,
  LOOK_UP_PITCH_GAIN,
  LOOK_UP_PUSH_HALF_ANGLE,
  MAX_ORBIT_POLAR_ANGLE,
  ORBIT_FLOOR_CLEARANCE,
  ORBIT_TARGET_HEIGHT,
  OVERVIEW_GROUND_CLEARANCE,
  orbitAngleBelowFloor,
  orbitCameraAboveFloor,
  orbitFloorMinY,
  overviewEyeY,
} from './orbit-floor-clearance'

type Vec3 = { x: number; y: number; z: number }

const FLOOR_Y = 3
const MIN_Y = FLOOR_Y + ORBIT_FLOOR_CLEARANCE
const target: Vec3 = { x: 1, y: FLOOR_Y, z: -2 }

// camera-controls' orbit: polar 0 looks straight down, PI/2 is level with the target.
function orbit(distance: number, polar: number, azimuth = 0.4): Vec3 {
  return {
    x: target.x + distance * Math.sin(polar) * Math.sin(azimuth),
    y: target.y + distance * Math.cos(polar),
    z: target.z + distance * Math.sin(polar) * Math.cos(azimuth),
  }
}

function present(position: Vec3) {
  const out = { x: Number.NaN, y: Number.NaN, z: Number.NaN }
  const polar = orbitCameraAboveFloor(out, position, target, MIN_Y)
  return { grounded: out.y === MIN_Y && position.y < MIN_Y, out, polar }
}

const horizontalDistance = (p: Vec3) => Math.hypot(p.x - target.x, p.z - target.z)
const DEGREE = Math.PI / 180

test('an orbit above the clearance is drawn exactly where it is', () => {
  const position = orbit(10, Math.PI / 3)
  const { grounded, out, polar } = present(position)
  expect(grounded).toBe(false)
  expect(out).toEqual(position)
  expect(polar).toBeCloseTo(Math.PI / 3, 9)
})

test('tilting past the horizon keeps the camera on the floor clearance', () => {
  for (const distance of [2, 8, 40]) {
    for (const polar of [Math.PI / 2, 0.6 * Math.PI, 0.75 * Math.PI, Math.PI - 0.05]) {
      const position = orbit(distance, polar)
      const { grounded, out } = present(position)
      expect(grounded).toBe(true)
      expect(out.y).toBeCloseTo(MIN_Y, 9)
    }
  }
})

test('past the clearance the view pitches up faster than the drag and stops at straight up', () => {
  for (const distance of [2.2, 8, 40]) {
    const contactPolar = Math.acos(ORBIT_FLOOR_CLEARANCE / distance)
    for (let past = 0; past <= 60 * DEGREE; past += DEGREE) {
      const { polar } = present(orbit(distance, contactPolar + past))
      expect(polar).toBeCloseTo(
        Math.min(contactPolar + past * LOOK_UP_PITCH_GAIN, MAX_ORBIT_POLAR_ANGLE),
        9,
      )
    }
    // From level to (almost) straight up within ~40° of drag.
    const straightUp = (MAX_ORBIT_POLAR_ANGLE - contactPolar) / LOOK_UP_PITCH_GAIN
    expect(straightUp).toBeLessThan(95 * DEGREE)
    // And stops there: more drag changes nothing.
    const atTop = present(orbit(distance, contactPolar + straightUp))
    const beyond = present(orbit(distance, contactPolar + straightUp + 5 * DEGREE))
    expect(beyond.polar).toBeCloseTo(MAX_ORBIT_POLAR_ANGLE, 9)
    expect(horizontalDistance(beyond.out)).toBeCloseTo(horizontalDistance(atTop.out), 9)
  }
})

test('past the clearance the camera closes on its target gently, at the half-angle rate', () => {
  for (const distance of [2.2, 8, 40]) {
    const contactPolar = Math.acos(ORBIT_FLOOR_CLEARANCE / distance)
    const contactReach = horizontalDistance(present(orbit(distance, contactPolar)).out)
    let previous = contactReach
    const straightUp = (MAX_ORBIT_POLAR_ANGLE - contactPolar) / LOOK_UP_PITCH_GAIN
    for (let polar = contactPolar + 0.01; polar <= contactPolar + straightUp; polar += 0.01) {
      const position = orbit(distance, polar)
      expect(orbitAngleBelowFloor(position, target, MIN_Y)).toBeCloseTo(polar - contactPolar, 9)
      const reach = horizontalDistance(present(position).out)
      expect(reach).toBeCloseTo(
        contactReach * 0.5 ** ((polar - contactPolar) / LOOK_UP_PUSH_HALF_ANGLE),
        9,
      )
      expect(reach).toBeLessThan(previous)
      previous = reach
    }
    // By the time the view looks straight up it has closed at most ~25% of the way.
    const there = horizontalDistance(present(orbit(distance, contactPolar + straightUp)).out)
    expect(1 - there / contactReach).toBeLessThan(0.75)
    expect(1 - there / contactReach).toBeGreaterThan(0.35)
  }
})

test('crossing the clearance is continuous, so orbiting back up has no jump', () => {
  const distance = 6
  // The polar angle at which the orbit itself touches the clearance.
  const contact = Math.acos(ORBIT_FLOOR_CLEARANCE / distance)
  const before = present(orbit(distance, contact - 1e-6)).out
  const after = present(orbit(distance, contact + 1e-6)).out
  expect(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z)).toBeLessThan(1e-4)
})

test('zooming in while grounded still moves the camera toward the target', () => {
  const polar = 0.8 * Math.PI
  let previous = Number.POSITIVE_INFINITY
  for (let distance = 40; distance >= 2; distance -= 2) {
    const reach = horizontalDistance(present(orbit(distance, polar)).out)
    expect(reach).toBeLessThan(previous)
    previous = reach
  }
})

test('with the pivot at standing height, a close orbit looks around before the floor stops it', () => {
  const pivot = { x: 0, y: FLOOR_Y + ORBIT_TARGET_HEIGHT, z: 0 }
  const distance = 2
  const at = (polar: number) => ({
    x: distance * Math.sin(polar),
    y: pivot.y + distance * Math.cos(polar),
    z: 0,
  })
  // Level with the pivot and a little past it: a free orbit at about eye
  // height, already looking up, nothing pushed.
  for (const polar of [Math.PI / 2, 100 * DEGREE, 105 * DEGREE]) {
    const out = { x: 0, y: 0, z: 0 }
    expect(orbitCameraAboveFloor(out, at(polar), pivot, MIN_Y)).toBeCloseTo(polar, 9)
    expect(out).toEqual(at(polar))
  }
  // The clearance takes over only where the orbit would reach it.
  const contact = Math.acos((MIN_Y - pivot.y) / distance)
  expect(contact).toBeGreaterThan(105 * DEGREE)
  const out = { x: 0, y: 0, z: 0 }
  orbitCameraAboveFloor(out, at(contact + 5 * DEGREE), pivot, MIN_Y)
  expect(out.y).toBeCloseTo(MIN_Y, 9)
})

test('the floor limit sits the clearance above the surface under the camera, or the level floor', () => {
  // A raised platform 0.45 m above a level at 2.71.
  expect(floorLimitAt(3.16, 2.71)).toBeCloseTo(3.16 + ORBIT_FLOOR_CLEARANCE, 9)
  // A sunken floor below the level's own floor.
  expect(floorLimitAt(2.21, 2.71)).toBeCloseTo(2.21 + ORBIT_FLOOR_CLEARANCE, 9)
  // Nothing under the camera (outside, no terrain): the level floor, never 0.
  expect(floorLimitAt(null, 2.71)).toBeCloseTo(2.71 + ORBIT_FLOOR_CLEARANCE, 9)
  expect(floorLimitAt(null, 0)).toBe(ORBIT_FLOOR_CLEARANCE)
})

test('a change in floor height is glided over, never popped', () => {
  expect(glideFloorLimit(null, 1, 1 / 60)).toBe(1)
  let limit = 0.3
  let previous = limit
  for (let frame = 0; frame < 120; frame++) {
    limit = glideFloorLimit(limit, 0.75, 1 / 60)
    expect(limit).toBeGreaterThan(previous)
    expect(limit - previous).toBeLessThan(0.07)
    previous = limit
  }
  expect(limit).toBeCloseTo(0.75, 6)
})

test('a pivot sent four storeys down keeps the eye where it was, over the ground; a diver stays under', () => {
  // Eye 12 m up over a pivot at 1.1; the pivot goes to -12: the move alone would put the eye at -0.1.
  expect(overviewEyeY(12 - 13.1, 12, -0.05, false)).toBe(12)
  // An eye that was already low is brought up to the clearance.
  expect(overviewEyeY(-9, 0.5, -0.05, false)).toBe(-0.05 + OVERVIEW_GROUND_CLEARANCE)
  // The move leaves it high enough: it goes with the pivot, as always.
  expect(overviewEyeY(20, 25, -0.05, false)).toBe(20)
  // The person is under the ground: the move is theirs.
  expect(overviewEyeY(-8, 12, -0.05, true)).toBe(-8)
})

test('the dive floor sits 3 m under the lowest ground, or 1 m under the deepest drawn thing when that is deeper', () => {
  // A house at grade: nothing drawn is deeper than the ground's 3 m.
  expect(diveFloorY(-0.05, -0.36)).toBeCloseTo(-0.05 - DIVE_DEPTH, 9)
  expect(diveFloorY(-0.05, null)).toBeCloseTo(-0.05 - DIVE_DEPTH, 9)
  // The villa's basement footing at -3.83 goes a metre deeper.
  expect(diveFloorY(-0.05, -3.83)).toBeCloseTo(-3.83 - DIVE_MARGIN, 9)
})

test('the eye may sit the clearance over the dive floor from any storey, over the level floor otherwise', () => {
  const dive = diveFloorY(-0.05, null)
  // The ground floor, and a storey four metres up: both dive to the same floor.
  expect(orbitFloorMinY(0, dive)).toBeCloseTo(dive + ORBIT_FLOOR_CLEARANCE, 9)
  expect(orbitFloorMinY(4, dive)).toBeCloseTo(dive + ORBIT_FLOOR_CLEARANCE, 9)
  // No dive (Solid): the level's floor, as before.
  expect(orbitFloorMinY(4, null)).toBeCloseTo(4 + ORBIT_FLOOR_CLEARANCE, 9)
  // A basement deeper than the dive floor keeps its own floor: the dive never lifts the limit.
  expect(orbitFloorMinY(-12, dive)).toBeCloseTo(-12 + ORBIT_FLOOR_CLEARANCE, 9)
})
