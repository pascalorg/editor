import { expect, test } from 'bun:test'
import { commitTerrainField, createTerrainField, FLAT_GROUND_Y, SiteNode } from '@pascal-app/core'
import { PerspectiveCamera } from 'three'
import { lawnPointerPoint } from './tool-ground'

const canvas = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 400 }) }
const pointer = { clientX: 110, clientY: 220 }
const camera = () => {
  const camera = new PerspectiveCamera(60, 0.5, 0.1, 1000)
  camera.position.set(0, 10, 5)
  camera.lookAt(10, 0, 5)
  camera.updateMatrixWorld(true)
  return camera
}

test('raised-floor grid hits do not shift an oblique lawn pointer away from Site ground', () => {
  const raisedFloorEvent = { position: [7, 3, 5], nativeEvent: pointer }
  const upperFloorEvent = { position: [4, 6, 5], nativeEvent: pointer }
  const site = SiteNode.parse({ id: 'site_lawn_pointer_ground' })
  const view = camera()
  const raised = lawnPointerPoint(raisedFloorEvent.nativeEvent, view, canvas, site)
  const upper = lawnPointerPoint(upperFloorEvent.nativeEvent, view, canvas, site)
  expect(raised?.[0]).toBeCloseTo(10 - FLAT_GROUND_Y, 6)
  expect(raised?.[1]).toBeCloseTo(5, 6)
  expect(upper).toEqual(raised)
  expect(raised?.[0]).not.toBe(raisedFloorEvent.position[0])
})

test('the same oblique pointer intersects the owning Site terrain rather than any active level plane', () => {
  const field = createTerrainField({ cols: 33, rows: 33, spacing: 1, step: 0.01 })
  const heights = new Int16Array(field.heights.length)
  for (let row = 0; row < field.rows; row++)
    for (let col = 0; col < field.cols; col++) heights[row * field.cols + col] = col * 100
  const site = SiteNode.parse({
    id: 'site_lawn_slope',
    terrain: commitTerrainField({ ...field, heights }),
  })
  const point = lawnPointerPoint(pointer, camera(), canvas, site)
  // Ray y = 10 - x, terrain y = x: their intersection is x = 5, independently of floor height.
  expect(point?.[0]).toBeCloseTo(5, 4)
  expect(point?.[1]).toBeCloseTo(5, 6)
})

test('a pointer without a forward Site-ground intersection does not place an area point', () => {
  const view = camera()
  view.lookAt(10, 20, 5)
  view.updateMatrixWorld(true)
  expect(lawnPointerPoint(pointer, view, canvas, null)).toBeNull()
})

test('an oblique pointer outside the field intersects the clamped elevated edge, not the flat datum', () => {
  const field = createTerrainField({ cols: 33, rows: 33, spacing: 1, step: 0.01 })
  const heights = new Int16Array(field.heights.length)
  for (let row = 0; row < field.rows; row++)
    for (let col = 0; col < field.cols; col++) heights[row * field.cols + col] = 400 + row * 50
  const site = SiteNode.parse({
    id: 'site_lawn_edge',
    terrain: commitTerrainField({ ...field, heights }),
  })
  const view = camera()
  view.position.set(-10, 10, 0)
  view.lookAt(0, 0, 10)
  view.updateMatrixWorld(true)
  const point = lawnPointerPoint(pointer, view, canvas, site)
  // Outside x < 0, the edge extends as y = 4 + z/2. Along this ray, z = 10 - y.
  expect(point?.[0]).toBeCloseTo(-6, 5)
  expect(point?.[1]).toBeCloseTo(4, 5)
})

test('a clamped corner stays at its elevated height beyond both field axes', () => {
  const field = createTerrainField({ cols: 33, rows: 33, spacing: 1, step: 0.01 })
  const site = SiteNode.parse({
    id: 'site_lawn_corner',
    terrain: commitTerrainField({
      ...field,
      heights: new Int16Array(field.heights.length).fill(400),
    }),
  })
  const view = camera()
  view.position.set(-10, 10, -10)
  view.lookAt(0, 0, 0)
  view.updateMatrixWorld(true)
  const point = lawnPointerPoint(pointer, view, canvas, site)
  expect(point?.[0]).toBeCloseTo(-4, 5)
  expect(point?.[1]).toBeCloseTo(-4, 5)
})

test('an edge-extension hit in front of the field wins over a later interior intersection', () => {
  const field = createTerrainField({ cols: 33, rows: 33, spacing: 1, step: 0.01 })
  const heights = new Int16Array(field.heights.length).fill(-1000)
  for (let row = 0; row < field.rows; row++) heights[row * field.cols] = 600
  const site = SiteNode.parse({
    id: 'site_lawn_nearest',
    terrain: commitTerrainField({ ...field, heights }),
  })
  const view = camera()
  view.position.set(-10, 10, 5)
  view.lookAt(0, 0, 5)
  view.updateMatrixWorld(true)
  const point = lawnPointerPoint(pointer, view, canvas, site)
  expect(point?.[0]).toBeCloseTo(-6, 5)
  expect(point?.[1]).toBeCloseTo(5, 5)
})
