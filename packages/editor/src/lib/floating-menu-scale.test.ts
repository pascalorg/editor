import { describe, expect, test } from 'bun:test'
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import { getFloatingMenuScale } from './floating-menu-scale'

describe('getFloatingMenuScale', () => {
  test('uses the standard orthographic zoom scale and clamps its range', () => {
    const camera = new OrthographicCamera()
    const anchor = new Vector3()

    camera.zoom = 15
    expect(getFloatingMenuScale(camera, anchor)).toBe(0.75)
    camera.zoom = 2
    expect(getFloatingMenuScale(camera, anchor)).toBe(0.5)
    camera.zoom = 40
    expect(getFloatingMenuScale(camera, anchor)).toBe(1)
  })

  test('uses inverse perspective-camera distance and clamps its range', () => {
    const camera = new PerspectiveCamera()
    const anchor = new Vector3()

    camera.position.set(0, 0, 16)
    expect(getFloatingMenuScale(camera, anchor)).toBe(0.75)
    camera.position.set(0, 0, 48)
    expect(getFloatingMenuScale(camera, anchor)).toBe(0.5)
    camera.position.set(0, 0, 6)
    expect(getFloatingMenuScale(camera, anchor)).toBe(1)
  })
})
