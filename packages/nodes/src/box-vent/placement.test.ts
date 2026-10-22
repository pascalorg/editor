import { expect, test } from 'bun:test'
import { RoofNode, RoofSegmentNode } from '@pascal-app/core'
import { getRoofOuterSurfaceFrameAtPoint } from '@pascal-app/viewer'
import { BoxVentNode, boxVentDefinition, resolveBoxVentPlacement } from './index'

const segment = RoofSegmentNode.parse({ width: 8, depth: 6, roofType: 'gable' })
const vent = BoxVentNode.parse(boxVentDefinition.defaults())

test('placement snaps both coordinates and seats the vent on the finished roof', () => {
  const placed = resolveBoxVentPlacement(segment, vent, 0.13, 1.37, {
    gridStep: 0.25,
    alignDownslope: true,
  })
  expect(placed.position[0]).toBe(0.25)
  expect(placed.position[2]).toBe(1.25)
  expect(placed.position[1]).toBeCloseTo(
    getRoofOuterSurfaceFrameAtPoint(segment, 0.25, 1.25).point.y,
  )
  expect(placed.valid).toBe(true)
  expect(resolveBoxVentPlacement(segment, vent, 0.13, 1.37).position[0]).toBe(0.13)
})

test('vents face downslope on opposite faces while moves preserve a custom rotation and roof offset', () => {
  const front = resolveBoxVentPlacement(segment, vent, 0, 1, { alignDownslope: true })
  const back = resolveBoxVentPlacement(segment, vent, 0, -1, { alignDownslope: true })
  expect(Math.abs(front.rotation - back.rotation)).toBeCloseTo(Math.PI)
  const moved = resolveBoxVentPlacement(segment, { ...vent, rotation: 0.7 }, 1, 2, {
    roofOffset: 0.1,
  })
  expect(moved.rotation).toBe(0.7)
  expect(moved.position[1]).toBeCloseTo(
    getRoofOuterSurfaceFrameAtPoint(segment, 1, 2).point.y + 0.1,
  )
})

test('the whole flashing footprint must fit, including ridges, eaves and trimmed edges', () => {
  expect(resolveBoxVentPlacement(segment, vent, 0, 0).valid).toBe(false)
  expect(resolveBoxVentPlacement(segment, vent, 0, 3.5).valid).toBe(false)
  const trimmed = RoofSegmentNode.parse({ ...segment, trim: { right: 2 } })
  expect(resolveBoxVentPlacement(trimmed, vent, 1.9, 1).valid).toBe(false)
  expect(resolveBoxVentPlacement(trimmed, vent, 1.5, 1).valid).toBe(true)
  const flat = RoofSegmentNode.parse({
    roofType: 'flat',
    width: 8,
    depth: 6,
    overhang: 0,
    gableOverhang: 0,
    wallThickness: 0,
  })
  expect(resolveBoxVentPlacement(flat, { ...vent, flashingWidth: 0 }, 3.7, 0).valid).toBe(true)
  expect(resolveBoxVentPlacement(flat, { ...vent, flashingWidth: 0.2 }, 3.7, 0).valid).toBe(false)
})

test('the 2D footprint includes the same flashing extent as the model', () => {
  const roof = RoofNode.parse({})
  const host = RoofSegmentNode.parse({ parentId: roof.id, roofType: 'flat' })
  const geometry = boxVentDefinition.floorplan!(vent, {
    parent: host,
    children: [],
    siblings: [],
    resolve: () => roof as never,
  })
  expect(geometry?.kind).toBe('group')
  if (geometry?.kind !== 'group') throw new Error('Missing floorplan')
  const plate = geometry.children[0]!
  if (plate.kind !== 'polygon') throw new Error('Missing flashing footprint')
  const expected = vent.width / 2 + vent.hoodOverhang + (vent.flashingWidth ?? 0)
  expect(Math.max(...plate.points.map((point) => point[0]))).toBeCloseTo(expected)
})
