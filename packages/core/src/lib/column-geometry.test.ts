import { expect, test } from 'bun:test'
import { columnIBeamOutline, columnIBeamSection } from './column-geometry'

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
