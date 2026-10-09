import { expect, test } from 'bun:test'
import {
  columnIBeamOutline,
  columnIBeamSection,
  columnLean,
  columnPlanLeanOffset,
  sweptPlanFootprint,
} from './column-geometry'

test('i-beam plates scale with the section and keep a minimum thickness', () => {
  expect(columnIBeamSection(0.3, 0.4)).toEqual({
    flangeThickness: expect.closeTo(0.04, 9),
    webThickness: expect.closeTo(0.03, 9),
  })
  expect(columnIBeamSection(0.05, 0.05)).toEqual({ flangeThickness: 0.01, webThickness: 0.01 })
})

test('i-beam outline spans the section with a web narrower than the flanges', () => {
  const outline = columnIBeamOutline(0.3, 0.4)
  expect(outline).toHaveLength(12)
  const xs = outline.map(([x]) => x)
  const zs = outline.map(([, z]) => z)
  expect(Math.min(...xs)).toBeCloseTo(-0.15)
  expect(Math.max(...xs)).toBeCloseTo(0.15)
  expect(Math.min(...zs)).toBeCloseTo(-0.2)
  expect(Math.max(...zs)).toBeCloseTo(0.2)
  // The web edge sits half a web thickness off the axis.
  expect(outline[3]).toEqual([expect.closeTo(0.015, 9), expect.closeTo(-0.16, 9)])
  // Shoelace area: two flanges plus the web.
  const area =
    Math.abs(
      outline.reduce((sum, [x, z], i) => {
        const [nx, nz] = outline[(i + 1) % outline.length]!
        return sum + x * nz - nx * z
      }, 0),
    ) / 2
  expect(area).toBeCloseTo(2 * 0.3 * 0.04 + 0.03 * 0.32, 9)
})

test('a leaning column shears its section by height, in the yawed plan frame', () => {
  const tilt = Math.PI / 8
  expect(columnLean({ tiltX: tilt })).toEqual([0, expect.closeTo(Math.tan(tilt), 12)])
  expect(columnLean({ tiltZ: tilt })).toEqual([expect.closeTo(-Math.tan(tilt), 12), 0])
  expect(columnPlanLeanOffset({ tiltX: tilt, rotation: 0 }, 0)).toEqual([0, 0])
  const [x, z] = columnPlanLeanOffset({ tiltX: tilt, rotation: Math.PI / 2 }, 2)
  // Local +Z turns to plan +X under a quarter turn of yaw.
  expect(x).toBeCloseTo(2 * Math.tan(tilt), 12)
  expect(z).toBeCloseTo(0, 12)
})

test('a swept footprint covers the base, the top and the band between', () => {
  const square: [number, number][] = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ]
  expect(sweptPlanFootprint(square, [0, 0])).toEqual(square)
  const swept = sweptPlanFootprint(square, [2, 0])
  const xs = swept.map(([px]) => px)
  expect(Math.min(...xs)).toBeCloseTo(-0.5)
  expect(Math.max(...xs)).toBeCloseTo(2.5)
  const diagonal = sweptPlanFootprint(square, [1, 1])
  // A square swept along its diagonal is a hexagon.
  expect(diagonal).toHaveLength(6)
})
