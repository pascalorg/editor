import { describe, expect, test } from 'bun:test'
import type { WallNode } from '../../schema'
import type { WallAssembly } from '../../schema/nodes/wall'
import {
  assemblyThickness,
  BRICK_AIR_SPACE,
  BRICK_VENEER,
  calculateLevelLayerMiters,
  GYPSUM_HALF,
  getWallAssemblyPreset,
  getWallLayerPolylines,
  resolveWallAssembly,
  resolveWallExteriorSide,
  STUD_2X4,
  STUD_2X6,
  WALL_ASSEMBLY_PRESETS,
  WSP_SHEATHING,
  wallAssemblyPatch,
  wallLayerBoundaryOffsets,
} from './wall-assembly'
import { calculateLevelMiters } from './wall-mitering'

const IN = 0.0254

function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  extra: Partial<WallNode> = {},
): WallNode {
  return {
    id: id as WallNode['id'],
    type: 'wall',
    children: [],
    start,
    end,
    frontSide: 'exterior',
    backSide: 'interior',
    thickness: 0.2,
    ...extra,
  } as WallNode
}

const EXT_2X6: WallAssembly = {
  preset: 'exterior-2x6-siding',
  exterior: { finish: 'siding', thickness: 0.75 * IN },
  sheathing: { material: 'osb', thickness: WSP_SHEATHING },
  framing: { kind: 'wood', depth: STUD_2X6 },
  interior: { finish: 'drywall', thickness: GYPSUM_HALF },
}

const PARTITION_2X4: WallAssembly = {
  preset: 'interior-2x4-drywall',
  framing: { kind: 'wood', depth: STUD_2X4 },
  interior: { finish: 'drywall', thickness: GYPSUM_HALF },
}

// ---------------------------------------------------------------------------
// assemblyThickness
// ---------------------------------------------------------------------------

describe('assemblyThickness', () => {
  test('envelope stack sums exterior + sheathing + framing + interior', () => {
    // 3/4 + 7/16 + 5-1/2 + 1/2 = 7-3/16 in
    expect(assemblyThickness(EXT_2X6)).toBeCloseTo(7.1875 * IN, 12)
  })

  test('partition applies the interior finish to both faces (bones: 4.5 in on 2x4)', () => {
    expect(assemblyThickness(PARTITION_2X4)).toBeCloseTo(4.5 * IN, 12)
  })

  test("'none' layers contribute nothing", () => {
    expect(
      assemblyThickness({
        exterior: { finish: 'none', thickness: 0.3 },
        sheathing: { material: 'none', thickness: 0.3 },
        framing: { kind: 'wood', depth: STUD_2X4 },
        interior: { finish: 'none', thickness: 0.3 },
      }),
    ).toBeCloseTo(STUD_2X4, 12)
  })

  test('every shipped preset has a total equal to the sum of its resolved layers', () => {
    for (const preset of WALL_ASSEMBLY_PRESETS) {
      const resolved = resolveWallAssembly({
        assembly: preset.assembly,
        thickness: undefined,
        frontSide: 'exterior',
        backSide: 'interior',
      })
      const sum = resolved.layers.reduce((acc, layer) => acc + layer.thickness, 0)
      expect(sum).toBeCloseTo(assemblyThickness(preset.assembly), 12)
      expect(resolved.total).toBeCloseTo(assemblyThickness(preset.assembly), 12)
    }
  })

  test('wallAssemblyPatch derives thickness from the assembly', () => {
    const patch = wallAssemblyPatch(EXT_2X6)
    expect(patch.thickness).toBeCloseTo(assemblyThickness(EXT_2X6), 12)
    expect(patch.assembly).toBe(EXT_2X6)
  })
})

// ---------------------------------------------------------------------------
// resolveWallAssembly
// ---------------------------------------------------------------------------

describe('resolveWallAssembly', () => {
  test('orders layers outside -> inside with contiguous offsets', () => {
    const resolved = resolveWallAssembly(wall('w', [0, 0], [4, 0], { assembly: EXT_2X6 }))
    expect(resolved.kind).toBe('envelope')
    expect(resolved.layers.map((l) => l.role)).toEqual([
      'exterior-finish',
      'sheathing',
      'framing',
      'interior-finish',
    ])
    let cursor = 0
    for (const layer of resolved.layers) {
      expect(layer.offsetFromExteriorFace).toBeCloseTo(cursor, 12)
      cursor += layer.thickness
    }
    expect(cursor).toBeCloseTo(resolved.total, 12)
  })

  test('brick veneer splits into wythe + air space', () => {
    const resolved = resolveWallAssembly(
      wall('w', [0, 0], [4, 0], {
        assembly: {
          exterior: { finish: 'brick', thickness: BRICK_VENEER + BRICK_AIR_SPACE },
          sheathing: { material: 'osb', thickness: WSP_SHEATHING },
          framing: { kind: 'wood', depth: STUD_2X6 },
          interior: { finish: 'drywall', thickness: GYPSUM_HALF },
        },
      }),
    )
    expect(resolved.layers.map((l) => l.role)).toEqual([
      'exterior-finish',
      'air-gap',
      'sheathing',
      'framing',
      'interior-finish',
    ])
    expect(resolved.layers[0]!.thickness).toBeCloseTo(BRICK_VENEER, 12)
    expect(resolved.layers[1]!.thickness).toBeCloseTo(BRICK_AIR_SPACE, 12)
  })

  test('partition gets interior finish on both faces and no sheathing/cladding', () => {
    const resolved = resolveWallAssembly(
      wall('w', [0, 0], [4, 0], {
        assembly: PARTITION_2X4,
        frontSide: 'interior',
        backSide: 'interior',
      }),
    )
    expect(resolved.kind).toBe('partition')
    expect(resolved.layers.map((l) => l.role)).toEqual([
      'interior-finish',
      'framing',
      'interior-finish',
    ])
    expect(resolved.exteriorSide).toBeNull()
    expect(resolved.exteriorSideResolved).toBe(1)
  })

  test('a wall with no assembly resolves to one framing layer of its thickness', () => {
    const resolved = resolveWallAssembly(wall('w', [0, 0], [4, 0], { thickness: 0.15 }))
    expect(resolved.kind).toBe('unspecified')
    expect(resolved.layers).toHaveLength(1)
    expect(resolved.total).toBeCloseTo(0.15, 12)
  })

  test('exterior side comes from frontSide/backSide', () => {
    expect(resolveWallExteriorSide({ frontSide: 'exterior', backSide: 'interior' })).toBe(1)
    expect(resolveWallExteriorSide({ frontSide: 'interior', backSide: 'exterior' })).toBe(-1)
    expect(resolveWallExteriorSide({ frontSide: 'interior', backSide: 'interior' })).toBeNull()
    expect(resolveWallExteriorSide({ frontSide: 'exterior', backSide: 'exterior' })).toBeNull()
    expect(resolveWallExteriorSide({ frontSide: 'unknown', backSide: 'unknown' })).toBeNull()
  })

  test('flipping the exterior side mirrors the boundary offsets', () => {
    const front = wallLayerBoundaryOffsets(
      wall('w', [0, 0], [4, 0], { assembly: EXT_2X6, frontSide: 'exterior', backSide: 'interior' }),
    )
    const back = wallLayerBoundaryOffsets(
      wall('w', [0, 0], [4, 0], { assembly: EXT_2X6, frontSide: 'interior', backSide: 'exterior' }),
    )
    expect(front).toHaveLength(5)
    expect(back).toHaveLength(5)
    for (let i = 0; i < front.length; i++) {
      expect(back[i]!).toBeCloseTo(-front[front.length - 1 - i]!, 12)
    }
    // Descending from +normal, spanning the whole total.
    const total = assemblyThickness(EXT_2X6)
    expect(front[0]!).toBeCloseTo(total / 2, 12)
    expect(front[front.length - 1]!).toBeCloseTo(-total / 2, 12)
  })

  test('boundary offsets scale to an exaggerated drawn thickness', () => {
    const w = wall('w', [0, 0], [4, 0], { assembly: PARTITION_2X4 })
    const drawn = 0.2
    const offsets = wallLayerBoundaryOffsets(w, drawn)
    expect(offsets[0]!).toBeCloseTo(drawn / 2, 12)
    expect(offsets[offsets.length - 1]!).toBeCloseTo(-drawn / 2, 12)
  })

  test('the CMU preset is flagged unverified', () => {
    const preset = getWallAssemblyPreset('cmu-8-furred-drywall')
    expect(preset?.unverified).toBeTruthy()
    expect(getWallAssemblyPreset('exterior-2x6-siding')?.unverified).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Offset miter geometry
// ---------------------------------------------------------------------------

const TOL = 1e-6

function layerLinesFor(walls: WallNode[]) {
  const miters = calculateLevelMiters(walls)
  const layerMiters = calculateLevelLayerMiters(walls, miters, (w) => wallLayerBoundaryOffsets(w))
  return new Map(
    walls.map((w) => [w.id, getWallLayerPolylines(w, layerMiters, wallLayerBoundaryOffsets(w))]),
  )
}

/** Signed distance from `p` to the infinite line through `a` in direction `d`. */
function distanceToLine(
  p: { x: number; y: number },
  a: { x: number; y: number },
  d: [number, number],
) {
  const len = Math.hypot(d[0], d[1])
  return Math.abs((p.x - a.x) * (d[1] / len) - (p.y - a.y) * (d[0] / len))
}

describe('offset miters', () => {
  // At a corner made of wall A's END and wall B's START, A's +normal side is
  // contiguous with B's +normal side, so boundary index i of A pairs with
  // boundary index i of B (both lists are indexed from the +normal face).
  // These helpers assert the property that actually matters: every boundary
  // line of both walls terminates at ONE shared point per corner.

  function assertShared(ptsA: { x: number; y: number }[], ptsB: { x: number; y: number }[]) {
    for (const p of ptsA) {
      const nearest = ptsB.reduce(
        (best, q) => Math.min(best, Math.hypot(p.x - q.x, p.y - q.y)),
        Number.POSITIVE_INFINITY,
      )
      expect(nearest).toBeLessThan(TOL)
    }
    for (const q of ptsB) {
      const nearest = ptsA.reduce(
        (best, p) => Math.min(best, Math.hypot(p.x - q.x, p.y - q.y)),
        Number.POSITIVE_INFINITY,
      )
      expect(nearest).toBeLessThan(TOL)
    }
  }

  test('two identical walls at 90 degrees: every layer line meets at one point', () => {
    const assembly = EXT_2X6
    const total = assemblyThickness(assembly)
    // Exterior on the outside of the left turn for both walls.
    const a = wall('a', [0, 0], [5, 0], {
      assembly,
      thickness: total,
      frontSide: 'interior',
      backSide: 'exterior',
    })
    const b = wall('b', [5, 0], [5, 5], {
      assembly,
      thickness: total,
      frontSide: 'interior',
      backSide: 'exterior',
    })
    const lines = layerLinesFor([a, b])
    const la = lines.get('a')!
    const lb = lines.get('b')!
    expect(la).toHaveLength(5)
    expect(lb).toHaveLength(5)

    for (let i = 0; i < la.length; i++) {
      const pa = la[i]!.end
      const pb = lb[i]!.start
      expect(Math.hypot(pa.x - pb.x, pa.y - pb.y)).toBeLessThan(TOL)
      // The point sits exactly on both walls' boundary lines.
      expect(distanceToLine(pa, la[i]!.start, [1, 0])).toBeLessThan(TOL)
      expect(distanceToLine(pb, lb[i]!.end, [0, 1])).toBeLessThan(TOL)
    }
    assertShared(
      la.map((l) => l.end),
      lb.map((l) => l.start),
    )
  })

  test('two walls at 45 degrees still share one point per boundary', () => {
    const assembly = EXT_2X6
    const total = assemblyThickness(assembly)
    const a = wall('a', [0, 0], [5, 0], {
      assembly,
      thickness: total,
      frontSide: 'interior',
      backSide: 'exterior',
    })
    const b = wall('b', [5, 0], [8, 3], {
      assembly,
      thickness: total,
      frontSide: 'interior',
      backSide: 'exterior',
    })
    const lines = layerLinesFor([a, b])
    const la = lines.get('a')!
    const lb = lines.get('b')!
    for (let i = 0; i < la.length; i++) {
      const pa = la[i]!.end
      const pb = lb[i]!.start
      expect(Math.hypot(pa.x - pb.x, pa.y - pb.y)).toBeLessThan(TOL)
      expect(distanceToLine(pa, la[i]!.start, [1, 0])).toBeLessThan(TOL)
      expect(distanceToLine(pb, lb[i]!.end, [1, 1])).toBeLessThan(TOL)
    }
    // The joint is genuinely mitered: at 45 degrees the outer corner runs
    // further from the junction than a butt joint would.
    const outer = la[la.length - 1]!.end
    expect(Math.hypot(outer.x - 5, outer.y - 0)).toBeGreaterThan(total / 2)
  })

  test('walls with different assemblies still meet: pairing is by index from the shared face', () => {
    const thick = assemblyThickness(EXT_2X6)
    const thin = assemblyThickness(PARTITION_2X4)
    expect(thick).not.toBeCloseTo(thin, 6)
    const a = wall('a', [0, 0], [5, 0], {
      assembly: EXT_2X6,
      thickness: thick,
      frontSide: 'interior',
      backSide: 'exterior',
    })
    const b = wall('b', [5, 0], [5, 5], {
      assembly: PARTITION_2X4,
      thickness: thin,
      frontSide: 'interior',
      backSide: 'interior',
    })
    const lines = layerLinesFor([a, b])
    const la = lines.get('a')!
    const lb = lines.get('b')!
    expect(la).toHaveLength(5)
    expect(lb).toHaveLength(4)

    // Every line of both walls lands on its own centreline offset...
    for (const line of la) expect(distanceToLine(line.end, line.start, [1, 0])).toBeLessThan(TOL)
    for (const line of lb) expect(distanceToLine(line.start, line.end, [0, 1])).toBeLessThan(TOL)
    // ...and nothing dangles: every terminus lies exactly ON one of the
    // neighbour's real boundary lines (nearest-depth rule), so each layer dies
    // into the other wall's material rather than floating.
    const bLines = lb.map((l) => l.offset + 5) // wall b is the line x = 5 + offset
    for (const line of la) {
      const nearest = bLines.reduce(
        (best, x) => Math.min(best, Math.abs(line.end.x - x)),
        Number.POSITIVE_INFINITY,
      )
      expect(nearest).toBeLessThan(TOL)
    }
    const aLines = la.map((l) => l.offset) // wall a is the line y = offset
    for (const line of lb) {
      const nearest = aLines.reduce(
        (best, y) => Math.min(best, Math.abs(line.start.y - y)),
        Number.POSITIVE_INFINITY,
      )
      expect(nearest).toBeLessThan(TOL)
    }
    // The two OUTER faces are always mutual — this is the existing footprint
    // miter and must be bit-identical to it.
    expect(Math.hypot(la[0]!.end.x - lb[0]!.start.x, la[0]!.end.y - lb[0]!.start.y)).toBeLessThan(
      TOL,
    )
    expect(
      Math.hypot(
        la[la.length - 1]!.end.x - lb[lb.length - 1]!.start.x,
        la[la.length - 1]!.end.y - lb[lb.length - 1]!.start.y,
      ),
    ).toBeLessThan(TOL)
  })

  test('T-junction: the through wall runs unbroken, the stem terminates on it', () => {
    const total = assemblyThickness(EXT_2X6)
    const through = wall('through', [0, 0], [10, 0], { assembly: EXT_2X6, thickness: total })
    const stem = wall('stem', [5, 0], [5, 5], {
      assembly: PARTITION_2X4,
      thickness: assemblyThickness(PARTITION_2X4),
      frontSide: 'interior',
      backSide: 'interior',
    })
    const lines = layerLinesFor([through, stem])
    const lt = lines.get('through')!
    const ls = lines.get('stem')!

    // The through wall's boundaries are the plain straight offsets — the
    // junction changed nothing about them.
    for (const line of lt) {
      expect(line.start.x).toBeCloseTo(0, 12)
      expect(line.end.x).toBeCloseTo(10, 12)
      expect(line.start.y).toBeCloseTo(line.offset, 12)
      expect(line.end.y).toBeCloseTo(line.offset, 12)
    }

    // Every stem boundary stops on one of the through wall's boundary lines
    // (both walls are axis-aligned here, so that is a y-coordinate match).
    const throughYs = lt.map((l) => l.offset)
    for (const line of ls) {
      const nearest = throughYs.reduce(
        (best, y) => Math.min(best, Math.abs(line.start.y - y)),
        Number.POSITIVE_INFINITY,
      )
      expect(nearest).toBeLessThan(TOL)
    }
  })

  test('closed room: every corner resolves each boundary to a single point', () => {
    const total = assemblyThickness(EXT_2X6)
    const mk = (id: string, s: [number, number], e: [number, number]) =>
      wall(id, s, e, {
        assembly: EXT_2X6,
        thickness: total,
        frontSide: 'interior',
        backSide: 'exterior',
      })
    const walls = [
      mk('n', [0, 0], [6, 0]),
      mk('e', [6, 0], [6, 4]),
      mk('s', [6, 4], [0, 4]),
      mk('w', [0, 4], [0, 0]),
    ]
    const lines = layerLinesFor(walls)
    const chain: Array<[string, string]> = [
      ['n', 'e'],
      ['e', 's'],
      ['s', 'w'],
      ['w', 'n'],
    ]
    for (const [from, to] of chain) {
      const lf = lines.get(from)!
      const lto = lines.get(to)!
      expect(lf).toHaveLength(5)
      for (let i = 0; i < lf.length; i++) {
        const p = lf[i]!.end
        const q = lto[i]!.start
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(TOL)
      }
    }
  })
})
