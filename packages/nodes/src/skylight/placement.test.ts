import { expect, test } from 'bun:test'
import { RoofSegmentNode } from '@pascal-app/core'
import { getRoofOuterSurfaceFrameAtPoint } from '@pascal-app/viewer'
import { resolveSkylightPlacement, SkylightNode } from './index'

const segment = RoofSegmentNode.parse({ width: 8, depth: 6, roofType: 'gable' })
const skylight = SkylightNode.parse({ rotation: 0.2 })

test('placement snaps on the finished roof while preserving rotation', () => {
  const placed = resolveSkylightPlacement(segment, skylight, 0.13, 1.37, { gridStep: 0.25 })
  expect(placed.position[0]).toBe(0.25)
  expect(placed.position[2]).toBe(1.25)
  expect(placed.rotation).toBe(0.2)
  expect(placed.position[1]).toBeCloseTo(
    getRoofOuterSurfaceFrameAtPoint(segment, 0.25, 1.25).point.y,
  )
  expect(placed.valid).toBe(true)
  expect(resolveSkylightPlacement(segment, skylight, 0.13, 1.37).position[0]).toBe(0.13)
})

test('the glass and flashing must fit inside one roof face and trimmed edges', () => {
  expect(resolveSkylightPlacement(segment, skylight, 0, 0).valid).toBe(false)
  expect(resolveSkylightPlacement(segment, skylight, 0, 3.5).valid).toBe(false)
  const trimmed = RoofSegmentNode.parse({ ...segment, trim: { right: 2 } })
  expect(resolveSkylightPlacement(trimmed, skylight, 1.9, 1.5).valid).toBe(false)
  expect(resolveSkylightPlacement(trimmed, skylight, 1, 1.5).valid).toBe(true)
  const flat = RoofSegmentNode.parse({
    roofType: 'flat',
    width: 8,
    depth: 6,
    overhang: 0,
    gableOverhang: 0,
    wallThickness: 0,
  })
  expect(
    resolveSkylightPlacement(flat, { ...skylight, rotation: 0, width: 0.5 }, 3.6, 0).valid,
  ).toBe(true)
  expect(resolveSkylightPlacement(flat, { ...skylight, rotation: 0, width: 1 }, 3.6, 0).valid).toBe(
    false,
  )
})
