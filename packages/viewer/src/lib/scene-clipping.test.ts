import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearSceneClippingPlanes,
  sceneClippingPlanes,
  setSceneClippingPlanes,
} from './scene-clipping'

afterEach(() => {
  clearSceneClippingPlanes()
})

describe('sceneClippingPlanes', () => {
  test('starts uncut', () => {
    expect(sceneClippingPlanes.length).toBe(0)
  })

  test('writes normal and constant through', () => {
    setSceneClippingPlanes([{ normal: [0, -1, 0], constant: 1.2 }])

    expect(sceneClippingPlanes.length).toBe(1)
    expect(sceneClippingPlanes[0].normal.toArray()).toEqual([0, -1, 0])
    expect(sceneClippingPlanes[0].constant).toBe(1.2)
  })

  test('reuses the same Plane instance across updates so a drag allocates nothing', () => {
    setSceneClippingPlanes([{ normal: [0, -1, 0], constant: 1 }])
    const first = sceneClippingPlanes[0]

    setSceneClippingPlanes([{ normal: [0, -1, 0], constant: 2 }])

    expect(sceneClippingPlanes[0]).toBe(first)
    expect(sceneClippingPlanes[0].constant).toBe(2)
  })

  test('the array identity is stable — ClippingGroup holds a reference to it', () => {
    const identity = sceneClippingPlanes
    setSceneClippingPlanes([{ normal: [1, 0, 0], constant: 0 }])
    clearSceneClippingPlanes()
    setSceneClippingPlanes([{ normal: [0, 0, 1], constant: 3 }])

    expect(sceneClippingPlanes).toBe(identity)
  })

  test('shrinks when fewer planes are supplied', () => {
    setSceneClippingPlanes([
      { normal: [0, -1, 0], constant: 1 },
      { normal: [1, 0, 0], constant: 2 },
    ])
    expect(sceneClippingPlanes.length).toBe(2)

    setSceneClippingPlanes([{ normal: [0, -1, 0], constant: 1 }])
    expect(sceneClippingPlanes.length).toBe(1)
  })

  test('clearing leaves the scene uncut', () => {
    setSceneClippingPlanes([{ normal: [0, -1, 0], constant: 1 }])
    clearSceneClippingPlanes()

    expect(sceneClippingPlanes.length).toBe(0)
  })
})
