import { expect, test } from 'bun:test'
import { createDormerDefaultWindow, RoofSegmentNode } from '@pascal-app/core'
import { getRoofOuterSurfaceFrameAtPoint } from '@pascal-app/viewer'
import { DormerNode, dormerDefinition, resolveDormerPlacement } from './index'

const segment = RoofSegmentNode.parse({ width: 8, depth: 6, roofType: 'gable' })
const dormer = DormerNode.parse(dormerDefinition.defaults())

test('dormers snap to the selected grid and preserve their elevation offset', () => {
  const placed = resolveDormerPlacement(segment, dormer, 0.13, 1.37, {
    gridStep: 0.25,
    surfaceOffset: 0.2,
  })
  expect(placed.position[0]).toBe(0.25)
  expect(placed.position[2]).toBe(1.25)
  expect(placed.position[1]).toBeCloseTo(
    getRoofOuterSurfaceFrameAtPoint(segment, 0.25, 1.25).point.y + 0.2,
  )
  expect(placed.valid).toBe(true)
  expect(resolveDormerPlacement(segment, dormer, 0.13, 1.37).position[0]).toBe(0.13)
})

test('the full dormer eave footprint fits on one face and inside trims', () => {
  expect(resolveDormerPlacement(segment, dormer, 0, 0).valid).toBe(false)
  expect(resolveDormerPlacement(segment, dormer, 0, 3).valid).toBe(false)
  const trimmed = RoofSegmentNode.parse({ ...segment, trim: { right: 2 } })
  expect(resolveDormerPlacement(trimmed, dormer, 1.8, 1.5).valid).toBe(false)
  expect(resolveDormerPlacement(trimmed, dormer, 1, 1.5).valid).toBe(true)
  expect(
    resolveDormerPlacement(segment, { ...dormer, width: 7, rotation: Math.PI / 2 }, 0, 1.5).valid,
  ).toBe(false)
})

test('new dormers expose a complete window above the roof datum without changing archive defaults', () => {
  const window = createDormerDefaultWindow(dormer, 'window_default')
  expect(window.position[1] - window.height / 2).toBeGreaterThanOrEqual(0)
  expect(window.position[1] + window.height / 2).toBeLessThanOrEqual(dormer.height)
  expect(window.sill).toBe(true)
  expect(DormerNode.parse({}).height).toBe(0)
})
