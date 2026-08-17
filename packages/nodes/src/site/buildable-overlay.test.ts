import { describe, expect, test } from 'bun:test'
import { readSiteBuildable } from '@pascal-app/core'
import type { BufferGeometry } from 'three'
import { buildSetbackStripGeometry } from './buildable-overlay'

const SQUARE_20M: Array<[number, number]> = [
  [-10, -10],
  [10, -10],
  [10, 10],
  [-10, 10],
]

/** Summed triangle areas in world XZ — what the strip actually covers. */
function groundArea(geometry: BufferGeometry): number {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  if (!index) return 0
  let total = 0
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i)
    const b = index.getX(i + 1)
    const c = index.getX(i + 2)
    const ax = position.getX(a)
    const az = position.getZ(a)
    const bx = position.getX(b)
    const bz = position.getZ(b)
    const cx = position.getX(c)
    const cz = position.getZ(c)
    total += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2
  }
  return total
}

function yValues(geometry: BufferGeometry): number[] {
  const position = geometry.getAttribute('position')
  return Array.from({ length: position.count }, (_, i) => position.getY(i))
}

/**
 * The 3D half of the buildable overlay. The renderer feeds this the same
 * `readSiteBuildable` reading the sidebar and the floorplan read, so the thing
 * worth pinning is that the buildable ground really is punched out of the
 * strip — a mesh that quietly lost its hole covers the whole parcel and reads
 * as "nothing is buildable".
 */
describe('buildSetbackStripGeometry', () => {
  test('punches the buildable ring out of the parcel', () => {
    const reading = readSiteBuildable(SQUARE_20M, { defaultSetback: 3, setbacks: {} })
    expect(reading.rings).toHaveLength(1)

    const geometry = buildSetbackStripGeometry({
      parcel: SQUARE_20M,
      buildableRings: reading.rings,
      field: null,
      lift: 0.02,
    })

    // 20 m square minus the 14 m square the 3 m setback leaves.
    expect(geometry).not.toBeNull()
    expect(groundArea(geometry!)).toBeCloseTo(400 - 196, 1)
  })

  test('covers the whole parcel when the setbacks leave no buildable ground', () => {
    const reading = readSiteBuildable(SQUARE_20M, { defaultSetback: 20, setbacks: {} })
    expect(reading.rings).toHaveLength(0)

    const geometry = buildSetbackStripGeometry({
      parcel: SQUARE_20M,
      buildableRings: reading.rings,
      field: null,
      lift: 0.02,
    })
    expect(groundArea(geometry!)).toBeCloseTo(400, 1)
  })

  test('a per-edge setback moves the hole rather than resizing it uniformly', () => {
    // 5 m off one edge and 3 m off the rest: 14 wide by 12 deep.
    const reading = readSiteBuildable(SQUARE_20M, {
      defaultSetback: 3,
      setbacks: { '0': { role: 'road', distance: 5 } },
    })
    const geometry = buildSetbackStripGeometry({
      parcel: SQUARE_20M,
      buildableRings: reading.rings,
      field: null,
      lift: 0.02,
    })
    expect(groundArea(geometry!)).toBeCloseTo(400 - 14 * 12, 1)
  })

  test('sits at the lift above flat ground, so it does not z-fight the site', () => {
    const reading = readSiteBuildable(SQUARE_20M, { defaultSetback: 3, setbacks: {} })
    const geometry = buildSetbackStripGeometry({
      parcel: SQUARE_20M,
      buildableRings: reading.rings,
      field: null,
      lift: 0.02,
    })
    // Float32, so compare with a tolerance rather than by identity.
    const ys = yValues(geometry!)
    expect(ys.length).toBeGreaterThan(0)
    for (const y of ys) expect(y).toBeCloseTo(0.02, 5)
  })

  test('a degenerate parcel draws nothing at all', () => {
    expect(
      buildSetbackStripGeometry({
        parcel: [
          [0, 0],
          [1, 1],
        ],
        buildableRings: [],
        field: null,
        lift: 0.02,
      }),
    ).toBeNull()
  })
})
