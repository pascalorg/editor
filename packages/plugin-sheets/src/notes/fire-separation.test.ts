import { describe, expect, test } from 'bun:test'
import fixture from '../__fixtures__/plancrafters-cottage.json'
import type { NodeMap } from '../model'
import { castToRing, fireSeparation, fireSeparationMarks, formatSeparation, lotEdgeRoles } from './fire-separation'

const FT = 0.3048
const COTTAGE: NodeMap = (fixture as unknown as { graph: { nodes: NodeMap } }).graph.nodes

/**
 * A 40 ft × 100 ft lot (site metres, x east, y south), the street along the
 * north edge, and a 30 ft × 40 ft house standing `westGap` metres off the
 * west line and 20 ft off the street, the way the generator places one:
 * level-local −z is the front, the building yawed `yaw`.
 */
function narrowLot(
  westGap: number,
  opts: { yaw?: number; window?: boolean; porch?: boolean; lotWidthFt?: number; centreFt?: [number, number] } = {},
): NodeMap {
  const lotW = (opts.lotWidthFt ?? 40) * FT
  const lotD = 100 * FT
  const W = 30 * FT
  const D = 40 * FT
  const t = 0.1397
  const yaw = opts.yaw ?? 0
  const nodes: NodeMap = {
    site_1: {
      id: 'site_1',
      type: 'site',
      name: 'Site',
      polygon: {
        type: 'polygon',
        points: [
          [0, 0],
          [lotW, 0],
          [lotW, lotD],
          [0, lotD],
        ],
      },
      frontEdge: 0,
      northRotation: 0,
      parcel: { source: 'gis-parcel', state: 'FL' },
      children: ['building_1'],
    },
    building_1: {
      id: 'building_1',
      type: 'building',
      name: 'House',
      parentId: 'site_1',
      position: opts.centreFt
        ? [opts.centreFt[0] * FT, 0, opts.centreFt[1] * FT]
        : [westGap + W / 2 + t / 2, 0, 20 * FT + D / 2 + t / 2],
      rotation: [0, yaw, 0],
      children: ['level_1'],
    },
    level_1: {
      id: 'level_1',
      type: 'level',
      name: 'Ground floor',
      parentId: 'building_1',
      level: 0,
      height: 2.7432,
      children: ['wall_n', 'wall_e', 'wall_s', 'wall_w', 'wall_p', 'slab_1', 'roof_1'],
    },
    slab_1: {
      id: 'slab_1',
      type: 'slab',
      name: 'Floor platform',
      parentId: 'level_1',
      polygon: [
        [-W / 2, -D / 2],
        [W / 2, -D / 2],
        [W / 2, D / 2],
        [-W / 2, D / 2],
      ],
      metadata: { floor: 'platform' },
    },
    roof_1: { id: 'roof_1', type: 'roof', name: 'Roof', parentId: 'level_1', children: ['rseg_1', ...(opts.porch ? ['rseg_p'] : [])] },
    rseg_1: {
      id: 'rseg_1',
      type: 'roof-segment',
      name: 'Main roof',
      parentId: 'roof_1',
      position: [0, 2.7432, 0],
      rotation: 0,
      width: W,
      depth: D,
      overhang: 0.4572, // 18 in
    },
    wall_n: wall('wall_n', [-W / 2, -D / 2], [W / 2, -D / 2], t, 'eave', opts.window ? ['win_n'] : []),
    wall_e: wall('wall_e', [W / 2, -D / 2], [W / 2, D / 2], t, 'gable-end'),
    wall_s: wall('wall_s', [W / 2, D / 2], [-W / 2, D / 2], t, 'eave'),
    wall_w: wall('wall_w', [-W / 2, D / 2], [-W / 2, -D / 2], t, 'gable-end', opts.window ? ['win_w'] : []),
    // a partition, never measured
    wall_p: { id: 'wall_p', type: 'wall', name: 'Partition', parentId: 'level_1', start: [0, -D / 2], end: [0, D / 2], thickness: 0.1143, metadata: { role: 'partition' }, children: [] },
  }
  if (opts.window) {
    nodes.win_w = { id: 'win_w', type: 'window', parentId: 'wall_w', position: [3, 1.5, 0], width: 1.2192, height: 1.524 }
    nodes.win_n = { id: 'win_n', type: 'window', parentId: 'wall_n', position: [3, 1.5, 0], width: 1.2192, height: 1.524 }
  }
  if (opts.porch) {
    // a 6 ft deep porch roof hung off the west wall, its ridge along the wall
    nodes.rseg_p = {
      id: 'rseg_p',
      type: 'roof-segment',
      name: 'Porch',
      parentId: 'roof_1',
      position: [-W / 2 - 3 * FT, 2.4, 0],
      rotation: Math.PI / 2,
      width: 12 * FT,
      depth: 6 * FT,
      overhang: 0.3,
      metadata: { roof: { role: 'porch', open: true } },
    }
  }
  return nodes
}

function wall(id: string, start: [number, number], end: [number, number], thickness: number, role: string, children: string[] = []) {
  return {
    id,
    type: 'wall',
    name: 'Exterior wall',
    parentId: 'level_1',
    start,
    end,
    thickness,
    metadata: { role: 'exterior', roof: { role } },
    children,
  }
}

const byId = (fs: ReturnType<typeof fireSeparation>, id: string) => fs.walls.find((w) => w.wallId === id)!

describe('the lot ring, measured', () => {
  test('a cast from inside the ring meets the nearest edge in that direction, and says which', () => {
    const ring = [
      [0, 0],
      [10, 0],
      [10, 30],
      [0, 30],
    ] as const
    expect(castToRing(ring, [3, 5], -1, 0)).toEqual({ distance: 3, edge: 3 })
    expect(castToRing(ring, [3, 5], 0, -1)).toEqual({ distance: 5, edge: 0 })
    expect(castToRing(ring, [3, 5], 1, 0)?.distance).toBeCloseTo(7)
    expect(castToRing(ring, [30, 5], 1, 0)).toBeNull()
  })

  test('the edges are the front, its opposite the rear, the others left and right of the front direction', () => {
    const ring = [
      [0, 0],
      [10, 0],
      [10, 30],
      [0, 30],
    ] as const
    expect(lotEdgeRoles(ring, 0)).toEqual(['front', 'right', 'rear', 'left'])
  })

  test('feet-inches round down: 4.99 ft is 4\'-11", the safe side of 5 ft', () => {
    expect(formatSeparation(-2.25 * FT)).toBe('−2\'-3"')
    expect(formatSeparation(5 * FT)).toBe('5\'-0"')
    expect(formatSeparation(4.99 * FT)).toBe('4\'-11"')
    expect(formatSeparation(3.2 * FT)).toBe('3\'-2"')
  })
})

describe('a house on a narrow lot', () => {
  test('3 ft off the west line: the west wall is rated, the eave is too close, its window is not permitted; the others are clear', () => {
    const fs = fireSeparation(narrowLot(3 * FT, { window: true }))
    expect(fs.measured).toBe(true)
    expect(fs.walls).toHaveLength(4)
    const west = byId(fs, 'wall_w')
    expect(west.faces).toBe('W')
    expect(west.edge).toBe('left')
    expect(west.distance).toBeCloseTo(3 * FT, 3)
    expect(west.wallRule).toBe('rated')
    expect(west.openingRule).toBe('not-permitted')
    expect(west.openings).toBe(1)
    // 18 in eave leaves 1'-6" to the line: not a permitted projection
    expect(west.projectionDistance).toBeCloseTo(3 * FT - 0.4572, 3)
    expect(west.projectionKind).toBe('eave')
    expect(west.projectionRule).toBe('not-permitted')
    expect(west.issues.join(' ')).toContain('not permitted')
    expect(fs.rated).toEqual(new Set(['wall_w']))

    const east = byId(fs, 'wall_e')
    expect(east.faces).toBe('E')
    expect(east.distance).toBeCloseTo((40 - 3 - 30) * FT - 0.1397, 2)
    expect(east.wallRule).toBe('none')
    expect(east.openingRule).toBe('unlimited')

    const north = byId(fs, 'wall_n')
    expect(north.edge).toBe('front')
    expect(north.toStreet).toBe(true)
    expect(north.wallRule).toBe('none')
    expect(north.distance).toBeCloseTo(20 * FT, 2)

    const south = byId(fs, 'wall_s')
    expect(south.edge).toBe('rear')
    expect(south.distance).toBeCloseTo((100 - 20 - 40) * FT - 0.1397, 2)
    expect(south.wallRule).toBe('none')
  })

  test('4 ft off the line: rated, the eave at 2\'-6" is 1-hr on its underside, a window is within the 25% limit', () => {
    const fs = fireSeparation(narrowLot(4 * FT, { window: true }))
    const west = byId(fs, 'wall_w')
    expect(west.wallRule).toBe('rated')
    expect(west.projectionRule).toBe('rated-underside')
    expect(west.openingRule).toBe('limit-25')
    // 1.2192 × 1.524 = 1.86 m² of a 12.19 × 2.74 = 33.4 m² wall — 6%
    expect(west.openingArea / west.wallArea).toBeLessThan(0.25)
    expect(west.issues).toEqual([])
  })

  test('7 ft off the line of a 50 ft lot nothing is rated (the eave clears 5 ft) and the plan carries no mark', () => {
    const nodes = narrowLot(7 * FT, { window: true, lotWidthFt: 50 })
    const fs = fireSeparation(nodes)
    expect(fs.rated.size).toBe(0)
    expect(fs.walls.every((w) => w.wallRule === 'none' && w.projectionRule === 'none' && w.openingRule === 'unlimited')).toBe(true)
    expect(fireSeparationMarks(nodes, 'level_1')).toEqual([])
  })

  test('the plan mark sits just outside the rated face and names the distance', () => {
    const nodes = narrowLot(3 * FT)
    const marks = fireSeparationMarks(nodes, 'level_1')
    expect(marks).toHaveLength(2)
    const line = marks[0] as { kind: string; x1: number; x2: number; strokeDasharray?: string }
    expect(line.kind).toBe('line')
    // the west face is at x = −W/2 − t/2; the mark 0.3 m further out
    expect(line.x1).toBeCloseTo(-(15 * FT) - 0.1397 / 2 - 0.3, 3)
    expect(line.strokeDasharray).toBeTruthy()
    const label = marks[1] as { kind: string; transform: { rotate: number }; children: { text: string }[] }
    expect(label.kind).toBe('group')
    expect(label.children[0]!.text).toBe(`1-HR RATED WALL (R302.1) — 3'-0" TO LOT LINE`)
    // the west face runs start → end toward −z, straight up the paper: the label reads bottom-to-top
    // (−π/2 in the y-down frame); a half-turn of the sheet would print it downward, so it flips
    expect(label.transform.rotate).toBeCloseTo(-Math.PI / 2, 6)
    const turned = fireSeparationMarks(nodes, 'level_1', 180)[1] as { transform: { rotate: number } }
    expect(turned.transform.rotate).toBeCloseTo(Math.PI / 2, 6)
    // a quarter turn lays the wall flat, reading left-to-right: no flip needed for −90°, a flip for +90°
    const flat = fireSeparationMarks(nodes, 'level_1', 90)[1] as { transform: { rotate: number } }
    expect(flat.transform.rotate).toBeCloseTo(-Math.PI / 2, 6)
    const flipped = fireSeparationMarks(nodes, 'level_1', -90)[1] as { transform: { rotate: number } }
    expect(flipped.transform.rotate).toBeCloseTo(Math.PI / 2, 6)
  })

  test('a porch roof hung off the near wall is the projection that governs', () => {
    const fs = fireSeparation(narrowLot(10 * FT, { porch: true, lotWidthFt: 50 }))
    const west = byId(fs, 'wall_w')
    expect(west.wallRule).toBe('none')
    // 6 ft of porch + 0.3 m overhang past its edge, measured from the wall face
    expect(west.projection).toBeCloseTo(6 * FT + 0.3 - 0.1397 / 2, 3)
    // 10 ft − 6.75 ft = 3.25 ft to the line: 1-hr on the underside
    expect(west.projectionKind).toBe('porch')
    expect(west.projectionRule).toBe('rated-underside')
    expect(fs.caveats.join(' ')).toContain('porch roof counts as a projection')
  })

  test('a house turned on its lot measures square to its own faces', () => {
    // yawed 90° in the middle of a 100 ft square lot: level −z (the front)
    // now looks west, so the front wall's cast runs to the west line
    const fs = fireSeparation(narrowLot(0, { yaw: Math.PI / 2, lotWidthFt: 100, centreFt: [50, 50] }))
    expect(fs.measured).toBe(true)
    const faces = fs.walls.map((w) => w.faces).sort()
    expect(faces).toEqual(['E', 'N', 'S', 'W'])
    const front = byId(fs, 'wall_n')
    expect(front.faces).toBe('W')
    expect(front.edge).toBe('left')
    // the front face is 20 ft (half the depth) + half a wall from the centre, 50 ft from the west line
    expect(front.distance).toBeCloseTo(50 * FT - 20 * FT - 0.1397 / 2, 3)
    // local +x turns to plan up under a 90° yaw: the level's east wall looks north
    const side = byId(fs, 'wall_e')
    expect(side.faces).toBe('N')
    expect(side.distance).toBeCloseTo(50 * FT - 15 * FT - 0.1397 / 2, 3)
    for (const w of fs.walls) expect(w.wallRule).toBe('none')
  })
})

describe('scenes that cannot be measured', () => {
  test('no site ring: not measured, and the caveat says so', () => {
    const nodes = narrowLot(3 * FT)
    delete nodes.site_1
    const fs = fireSeparation(nodes)
    expect(fs.measured).toBe(false)
    expect(fs.caveats[0]).toContain('No lot ring')
  })

  test('the cottage stands well inside its Tampa lot: measured, nothing rated', () => {
    const fs = fireSeparation(COTTAGE)
    expect(fs.measured).toBe(true)
    expect(fs.walls.length).toBeGreaterThanOrEqual(4)
    expect(fs.rated.size).toBe(0)
    for (const w of fs.walls) {
      expect(w.distance).not.toBeNull()
      expect(w.distance!).toBeGreaterThan(5 * FT)
    }
  })
})

describe('a porch roof past the lot line', () => {
  test('is reported as crossing it, by how much', () => {
    const fs = fireSeparation(narrowLot(4 * FT, { porch: true, lotWidthFt: 50 }))
    const west = byId(fs, 'wall_w')
    expect(west.projectionKind).toBe('porch')
    expect(west.projectionDistance!).toBeLessThan(0)
    expect(west.projectionRule).toBe('not-permitted')
    expect(west.issues.join(' ')).toContain('crosses the lot line by')
  })
})
