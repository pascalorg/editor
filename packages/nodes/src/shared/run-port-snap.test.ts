import { expect, test } from 'bun:test'
import { PerspectiveCamera, Vector3 } from 'three'
import type { ScenePort } from './ports'
import { findScreenPort } from './run-port-snap'

const low: ScenePort = {
  nodeId: 'pipe-segment_low',
  id: 'end',
  position: [0, 0, 0],
  direction: [1, 0, 0],
}
const high: ScenePort = {
  nodeId: 'duct-segment_high',
  id: 'start',
  position: [0, 3, 0],
  direction: [1, 0, 0],
}
const camera = new PerspectiveCamera(50, 1, 0.1, 100)
camera.position.set(0, 2, 10)
camera.lookAt(0, 2, 0)
camera.updateMatrixWorld()
const project = (point: ScenePort['position']) => {
  const projected = new Vector3(...point).project(camera)
  if (projected.z < -1 || projected.z > 1) return null
  return { x: (projected.x + 1) * 400, y: (1 - projected.y) * 400, depth: projected.z }
}

test('picks an elevated socket under the pointer independently of the drawing plane', () => {
  const screen = project(high.position)!
  const hit = findScreenPort([low, high], [screen.x + 5, screen.y - 3], project, null)
  expect(hit?.port).toBe(high)
  expect(hit?.port.position).toEqual([0, 3, 0])
})

test('uses a pixel threshold rather than attracting distant sockets', () => {
  const screen = project(high.position)!
  expect(findScreenPort([high], [screen.x + 17, screen.y], project, null)).toBeNull()
})

test('excludes the source before ranking and keeps other sockets on that item eligible', () => {
  const other = { ...high, id: 'end' }
  const screen = project(high.position)!
  expect(findScreenPort([high, other], [screen.x, screen.y], project, high)?.port).toBe(other)
})

test('ignores occluded, clipped and invalid projections', () => {
  const behind = { ...high, position: [0, 2, 20] as const }
  expect(findScreenPort([behind], [400, 400], project, null)).toBeNull()
  expect(findScreenPort([high], [400, 400], () => null, null)).toBeNull()
  expect(findScreenPort([high], [NaN, NaN], project, null)).toBeNull()
})

test('chooses the front socket when projected points coincide', () => {
  const far = { ...high, id: 'far' }
  const near = { ...high, position: [0, 3, 1] as const }
  expect(
    findScreenPort(
      [far, near],
      [10, 10],
      (point) => ({
        x: 10,
        y: 10,
        depth: point[2] === 1 ? 1 : 5,
      }),
      null,
    )?.port,
  ).toBe(near)
})

test('supports a rotated and zoomed floorplan projection while retaining socket elevation', () => {
  const planProject = (point: ScenePort['position']) => ({
    x: -point[2] * 40 + 300,
    y: point[0] * 40 + 200,
    depth: 0,
  })
  expect(findScreenPort([high], [302, 203], planProject, null)?.port.position[1]).toBe(3)
})
