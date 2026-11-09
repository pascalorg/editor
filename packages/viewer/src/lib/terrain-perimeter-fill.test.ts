import { expect, test } from 'bun:test'
import { buildTerrainPerimeterFillGeometry } from './terrain-perimeter-fill'

test('foundation U continues by arc length across corners and terrain subdivisions', () => {
  const geometry = buildTerrainPerimeterFillGeometry(
    [
      { x: 4, z: 2 },
      { x: 5, z: 2 },
      { x: 7, z: 2 },
      { x: 7, z: 4 },
      { x: 4, z: 4 },
    ],
    [0, 0.1, 0.2, 0, -0.1],
    0.5,
  )!
  const position = geometry.getAttribute('position'),
    uv = geometry.getAttribute('uv')
  const expected = new Map([
    ['4,2', 0],
    ['5,2', 1],
    ['7,2', 3],
    ['7,4', 5],
    ['4,4', 8],
  ])
  for (let i = 0; i < 30; i++) {
    const key = `${position.getX(i)},${position.getZ(i)}`
    expect(uv.getX(i)).toBeCloseTo(key === '4,2' && i >= 24 ? 10 : expected.get(key)!)
    expect(uv.getY(i)).toBeCloseTo(position.getY(i))
  }
  geometry.dispose()
})
