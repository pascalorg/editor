import { expect, test } from 'bun:test'
import { ORBIT_FLOOR_CLEARANCE, orbitCameraAboveFloor } from './orbit-floor-clearance'

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
  const grounded = orbitCameraAboveFloor(out, position, target, MIN_Y)
  return { grounded, out }
}

const horizontalDistance = (p: Vec3) => Math.hypot(p.x - target.x, p.z - target.z)

test('an orbit above the clearance is drawn exactly where it is', () => {
  const position = orbit(10, Math.PI / 3)
  const { grounded, out } = present(position)
  expect(grounded).toBe(false)
  expect(out).toEqual(position)
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

test('the deeper the orbit dips, the further the camera is pushed toward the target', () => {
  let previous = Number.POSITIVE_INFINITY
  for (let polar = 0.5 * Math.PI; polar < Math.PI - 0.05; polar += 0.05) {
    const { out } = present(orbit(8, polar))
    const reach = horizontalDistance(out)
    expect(reach).toBeLessThan(previous)
    // Strictly in front of where the orbit alone would put it.
    expect(reach).toBeLessThan(horizontalDistance(orbit(8, polar)))
    previous = reach
  }
  // Far enough in to stand inside a 5 m room around a target 8 m away.
  expect(horizontalDistance(present(orbit(8, 0.75 * Math.PI)).out)).toBeLessThan(2.5)
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
