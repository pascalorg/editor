import { expect, test } from 'bun:test'
import { RoofSegmentNode } from '@pascal-app/core'
import { getRoofOuterSurfaceFrameAtPoint } from '@pascal-app/viewer'
import { EyebrowVentNode, eyebrowVentDefinition, resolveEyebrowVentPlacement } from './index'

const segment = RoofSegmentNode.parse({ width: 8, depth: 6, roofType: 'gable' })
const vent = EyebrowVentNode.parse(eyebrowVentDefinition.defaults())

test('placement snaps both coordinates and seats the vent on the finished roof', () => {
  const placed = resolveEyebrowVentPlacement(segment, vent, 0.13, 1.37, {
    gridStep: 0.25,
    alignDownslope: true,
  })
  expect(placed.position[0]).toBe(0.25)
  expect(placed.position[2]).toBe(1.25)
  expect(placed.position[1]).toBeCloseTo(
    getRoofOuterSurfaceFrameAtPoint(segment, 0.25, 1.25).point.y,
  )
  expect(placed.valid).toBe(true)
  expect(resolveEyebrowVentPlacement(segment, vent, 0.13, 1.37).position[0]).toBe(0.13)
})

test('vents face downslope on opposite faces while moves preserve a custom rotation and roof offset', () => {
  const front = resolveEyebrowVentPlacement(segment, vent, 0, 1, { alignDownslope: true })
  const back = resolveEyebrowVentPlacement(segment, vent, 0, -1, { alignDownslope: true })
  expect(Math.abs(front.rotation - back.rotation)).toBeCloseTo(Math.PI)
  const moved = resolveEyebrowVentPlacement(segment, { ...vent, rotation: 0.7 }, 1, 2, {
    roofOffset: 0.1,
  })
  expect(moved.rotation).toBe(0.7)
  expect(moved.position[1]).toBeCloseTo(
    getRoofOuterSurfaceFrameAtPoint(segment, 1, 2).point.y + 0.1,
  )
})

test('the whole hood footprint must fit, including ridges, eaves and trimmed edges', () => {
  expect(resolveEyebrowVentPlacement(segment, vent, 0, 0).valid).toBe(false)
  expect(resolveEyebrowVentPlacement(segment, vent, 0, 3.5).valid).toBe(false)
  const trimmed = RoofSegmentNode.parse({ ...segment, trim: { right: 2 } })
  expect(resolveEyebrowVentPlacement(trimmed, vent, 1.9, 1).valid).toBe(false)
  expect(resolveEyebrowVentPlacement(trimmed, vent, 1.5, 1).valid).toBe(true)
  const flat = RoofSegmentNode.parse({
    roofType: 'flat',
    width: 8,
    depth: 6,
    overhang: 0,
    gableOverhang: 0,
    wallThickness: 0,
  })
  expect(resolveEyebrowVentPlacement(flat, { ...vent, width: 0.5 }, 3.7, 0).valid).toBe(true)
  expect(resolveEyebrowVentPlacement(flat, { ...vent, width: 1 }, 3.7, 0).valid).toBe(false)
})
