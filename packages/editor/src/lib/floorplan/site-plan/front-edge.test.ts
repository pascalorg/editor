import { describe, expect, test } from 'bun:test'
import { detectFrontEdgeFromRoads, streetCore } from './front-edge'
import type { Pt } from './geometry'

// 20 m × 30 m lot centred on the origin, y south. Edge 0 = north side,
// 1 = east, 2 = south, 3 = west.
const LOT: Pt[] = [
  [-10, -15],
  [10, -15],
  [10, 15],
  [-10, 15],
]
const road = (name: string, ...pts: Pt[]) => ({ name, centerline: pts })

describe('streetCore', () => {
  test('drops the number, the direction and the suffix', () => {
    expect(streetCore('2600 Castro Way')).toBe('castro')
    expect(streetCore('S Castro')).toBe('castro')
    expect(streetCore('W Cass St.')).toBe('cass')
    expect(streetCore('1200 W Cass St')).toBe('cass')
    expect(streetCore('North Troy Street')).toBe('troy')
    // OSM spells the quadrant out
    expect(streetCore('Northeast 109th Street')).toBe('109th')
    expect(streetCore('1247 NE 109th St')).toBe('109th')
    expect(streetCore('')).toBe('')
    expect(streetCore(null)).toBe('')
  })
})

describe('detectFrontEdgeFromRoads', () => {
  test('the nearest parallel street on the outside picks its edge', () => {
    const roads = [road('Castro Way', [-60, -25], [60, -25])]
    const m = detectFrontEdgeFromRoads(LOT, roads)
    expect(m?.index).toBe(0)
    expect(m?.name).toBe('Castro Way')
    expect(m?.distance).toBeCloseTo(10, 9)
    expect(m?.named).toBe(false)
  })

  test('a road perpendicular to an edge never fronts it', () => {
    // runs north-south past the middle of the north edge, 25 m out
    const roads = [road('Stab St', [0, -60], [0, -25])]
    expect(detectFrontEdgeFromRoads(LOT, roads)).toBeNull()
  })

  test('a road through the lot (inside the edge) is rejected', () => {
    const roads = [road('Driveway', [-60, -5], [60, -5])]
    expect(detectFrontEdgeFromRoads(LOT, roads)).toBeNull()
  })

  test('corner lot: the addressed street wins over a closer cross street', () => {
    const roads = [
      road('Castro Way', [-60, -30], [60, -30]), // north, 15 m off
      road('Elm St', [18, -60], [18, 60]), // east, 8 m off — closer
    ]
    expect(detectFrontEdgeFromRoads(LOT, roads)?.index).toBe(1) // closest wins with no address
    const named = detectFrontEdgeFromRoads(LOT, roads, '2600 Castro Way')
    expect(named?.index).toBe(0)
    expect(named?.named).toBe(true)
    // an address on a street that is not mapped falls back to the closest
    expect(detectFrontEdgeFromRoads(LOT, roads, '9 Nowhere Ln')?.index).toBe(1)
  })

  test('a bent road counts by its nearest segment; slight skew within 30° passes', () => {
    const roads = [road('Bend Rd', [-80, -40], [-30, -26], [30, -24], [80, -40])]
    expect(detectFrontEdgeFromRoads(LOT, roads)?.index).toBe(0)
  })

  test('winding does not matter', () => {
    const cw = [...LOT].reverse() as Pt[]
    const roads = [road('Castro Way', [-60, -25], [60, -25])]
    const m = detectFrontEdgeFromRoads(cw, roads)
    // reversed ring: the north edge is now points[2] → points[3]
    expect(m?.index).toBe(2)
  })

  test('no roads, no answer', () => {
    expect(detectFrontEdgeFromRoads(LOT, [])).toBeNull()
    expect(
      detectFrontEdgeFromRoads(
        [
          [0, 0],
          [1, 0],
        ],
        [road('x', [0, -5], [1, -5])],
      ),
    ).toBeNull()
  })
})
