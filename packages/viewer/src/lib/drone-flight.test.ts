import { describe, expect, test } from 'bun:test'
import { Object3D, Vector3 } from 'three'
import {
  createDroneInput,
  DRONE_RUN_MULTIPLIER,
  DRONE_SLOW_MULTIPLIER,
  DRONE_SPEED,
  readDroneInput,
  seedDroneLook,
  stepDroneFlight,
  turnFirstPersonLook,
} from './drone-flight'

function fly(held: string[], seconds: number, look = { yaw: 0, pitch: 0 }) {
  const camera = new Object3D()
  const velocity = new Vector3()
  const input = readDroneInput(new Set(held), createDroneInput())
  for (let t = 0; t < seconds; t += 1 / 60) stepDroneFlight(camera, look, input, velocity, 1 / 60)
  return { camera, velocity }
}

describe('drone flight', () => {
  test('cruises along the view direction, pitch included', () => {
    const { velocity } = fly(['KeyW'], 2, { yaw: 0, pitch: Math.PI / 4 })
    expect(velocity.length()).toBeCloseTo(DRONE_SPEED, 2)
    expect(velocity.y).toBeGreaterThan(0)
    expect(velocity.z).toBeLessThan(0)
  })

  test('rises and sinks along world Y whatever the pitch', () => {
    const up = fly(['Space'], 2, { yaw: 0, pitch: -1 }).velocity
    expect(up.y).toBeCloseTo(DRONE_SPEED, 2)
    expect(Math.hypot(up.x, up.z)).toBeCloseTo(0, 5)
    expect(fly(['KeyQ'], 2).velocity.y).toBeCloseTo(-DRONE_SPEED, 2)
  })

  test('Shift boosts and Alt slows, Alt winning', () => {
    expect(fly(['KeyW', 'ShiftLeft'], 2).velocity.length()).toBeCloseTo(
      DRONE_SPEED * DRONE_RUN_MULTIPLIER,
      2,
    )
    expect(fly(['KeyW', 'ShiftLeft', 'AltLeft'], 2).velocity.length()).toBeCloseTo(
      DRONE_SPEED * DRONE_SLOW_MULTIPLIER,
      2,
    )
  })

  test('eases to a stop once the keys are released', () => {
    const camera = new Object3D()
    const look = { yaw: 0, pitch: 0 }
    const velocity = new Vector3(DRONE_SPEED, 0, 0)
    for (let i = 0; i < 120; i++)
      stepDroneFlight(camera, look, createDroneInput(), velocity, 1 / 60)
    expect(velocity.length()).toBeLessThan(0.01)
  })

  test('a long frame moves the camera no further than a tenth of a second', () => {
    const camera = new Object3D()
    const velocity = new Vector3(0, 0, -DRONE_SPEED)
    const input = readDroneInput(new Set(['KeyW']), createDroneInput())
    stepDroneFlight(camera, { yaw: 0, pitch: 0 }, input, velocity, 5)
    expect(camera.position.length()).toBeLessThanOrEqual(DRONE_SPEED * 0.1 + 1e-9)
  })

  test('a control stays held while either of its keys is', () => {
    expect(readDroneInput(new Set(['Space']), createDroneInput()).up).toBe(true)
    expect(readDroneInput(new Set(['ControlLeft']), createDroneInput()).down).toBe(true)
    expect(readDroneInput(new Set(), createDroneInput()).up).toBe(false)
  })

  test('look seeds from the camera and pitch stops short of vertical', () => {
    const camera = new Object3D()
    camera.rotation.set(0.3, 1.2, 0, 'YXZ')
    const look = { yaw: 0, pitch: 0 }
    seedDroneLook(look, camera.quaternion)
    expect(look.yaw).toBeCloseTo(1.2, 5)
    expect(look.pitch).toBeCloseTo(0.3, 5)

    turnFirstPersonLook(look, 0, -100_000)
    expect(look.pitch).toBeLessThan(Math.PI / 2)
    expect(look.pitch).toBeGreaterThan(Math.PI / 2 - 0.1)
  })
})
