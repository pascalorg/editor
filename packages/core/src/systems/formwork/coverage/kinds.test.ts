import { describe, expect, it } from 'bun:test'
import { ColumnNode } from '../../../schema/nodes/column'
import { SlabNode } from '../../../schema/nodes/slab'
import { WallNode } from '../../../schema/nodes/wall'
import type { AnyNode, AnyNodeId } from '../../../schema/types'
import { toCastableElement } from './elements'
import { classifyCoverage, coverageForElement } from './faces'
import type { FaceRole } from './types'

/**
 * Face sets by element kind. A wall has two sides and two ends; a rectangular
 * column four faces and a circular one a single wrapped shaft; a slab a soffit
 * and a rim. The formed/unformed question is then the same for all three, which
 * is why these tests assert the *set* and the *areas*, not the mechanism.
 */

function wall(overrides: Record<string, unknown> = {}) {
  return WallNode.parse({
    start: [0, 0],
    end: [6, 0],
    thickness: 0.3,
    height: 3,
    formworkType: 'plywood',
    ...overrides,
  })
}

function column(overrides: Record<string, unknown> = {}) {
  return ColumnNode.parse({
    position: [0, 0, 0],
    crossSection: 'square',
    width: 0.4,
    depth: 0.4,
    height: 3,
    formworkType: 'plywood',
    ...overrides,
  })
}

function slab(overrides: Record<string, unknown> = {}) {
  return SlabNode.parse({
    polygon: [
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ],
    thickness: 0.2,
    formworkType: 'plywood',
    ...overrides,
  })
}

function roles(nodes: AnyNode[], id: string): FaceRole[] {
  return (coverageForElement(id as AnyNodeId, nodes)?.faces ?? []).map((f) => f.role)
}

function formedRoles(nodes: AnyNode[], id: string): FaceRole[] {
  return (coverageForElement(id as AnyNodeId, nodes)?.faces ?? [])
    .filter((f) => f.formed)
    .map((f) => f.role)
}

function faceOf(nodes: AnyNode[], id: string, role: FaceRole) {
  return coverageForElement(id as AnyNodeId, nodes)?.faces.find((f) => f.role === role)
}

describe('a rectangular column', () => {
  it('forms four faces and neither the top nor the base', () => {
    const c = column()
    expect(formedRoles([c] as AnyNode[], c.id).sort()).toEqual([
      'column-face-1',
      'column-face-2',
      'column-face-3',
      'column-face-4',
    ])
  })

  it('measures each face by its own plan width — not the larger dimension twice', () => {
    const c = column({ crossSection: 'rectangular', width: 0.6, depth: 0.3 })
    const areas = (coverageForElement(c.id as AnyNodeId, [c] as AnyNode[])?.faces ?? [])
      .filter((f) => f.formed)
      .map((f) => f.physicalArea)
      .sort((x, y) => x - y)
    expect(areas).toHaveLength(4)
    expect(areas[0]).toBeCloseTo(0.9, 6)
    expect(areas[1]).toBeCloseTo(0.9, 6)
    expect(areas[2]).toBeCloseTo(1.8, 6)
    expect(areas[3]).toBeCloseTo(1.8, 6)
  })

  it('honours rotation — a turned column keeps its area, not its axis-aligned box', () => {
    const c = column({ crossSection: 'rectangular', width: 0.6, depth: 0.3, rotation: Math.PI / 5 })
    const total = coverageForElement(c.id as AnyNodeId, [c] as AnyNode[])?.physicalArea
    expect(total).toBeCloseTo(2 * (0.6 + 0.3) * 3, 6)
  })

  it('places the faces on the rotated lines, not the unrotated ones', () => {
    const plan = toCastableElement(column({ rotation: Math.PI / 4 }) as AnyNode)?.plan
    // A 0.4 square turned 45° reaches ±0.283 on each axis, not ±0.2.
    const reach = Math.max(...(plan?.outline ?? []).map((p) => Math.abs(p.x)))
    expect(reach).toBeCloseTo(0.4 / Math.SQRT2, 6)
  })
})

describe('a circular column', () => {
  it('forms one wrapped shaft rather than four flat faces', () => {
    const c = column({ crossSection: 'round', radius: 0.2 })
    expect(roles([c] as AnyNode[], c.id)).toEqual(['shaft', 'top', 'bottom'])
  })

  it('measures the shaft at pi x D x h, not the faceted perimeter', () => {
    const c = column({ crossSection: 'round', radius: 0.2 })
    expect(faceOf([c] as AnyNode[], c.id, 'shaft')?.physicalArea).toBeCloseTo(
      2 * Math.PI * 0.2 * 3,
      6,
    )
  })

  it('wraps a sixteen-sided column as a shaft too — it takes a tube, not panels', () => {
    const c = column({ crossSection: 'sixteen-sided', radius: 0.2 })
    expect(roles([c] as AnyNode[], c.id)).toContain('shaft')
  })
})

describe('a column embedded in a wall', () => {
  it('drops every face absorbed into the earlier-cast wall run', () => {
    const w = wall({ start: [-3, 0], end: [3, 0], thickness: 0.4, castOrder: 1 })
    const pilaster = column({ width: 0.4, depth: 0.4, castOrder: 2 })
    const faces = coverageForElement(pilaster.id as AnyNodeId, [w, pilaster] as AnyNode[])?.faces
    expect(faces?.filter((f) => f.formed)).toHaveLength(0)
    expect(faces?.find((f) => f.role === 'column-face-1')?.reason).toBe('EMBEDDED_IN_WALL')
  })

  it('keeps a column that projects past a narrower wall, trimmed by the stem it meets', () => {
    const w = wall({ start: [-3, 0], end: [3, 0], thickness: 0.2, castOrder: 1 })
    const pilaster = column({ width: 0.6, depth: 0.6, castOrder: 2 })
    const nodes = [w, pilaster] as AnyNode[]
    expect(formedRoles(nodes, pilaster.id)).toHaveLength(4)
    // The two faces the wall runs into lose the 0.2 m the stem occupies; the
    // two parallel to it are untouched.
    const areas = (coverageForElement(pilaster.id as AnyNodeId, nodes)?.faces ?? [])
      .filter((f) => f.formed)
      .map((f) => f.physicalArea)
      .sort((x, y) => x - y)
    expect(areas[0]).toBeCloseTo((0.6 - 0.2) * 3, 6)
    expect(areas[1]).toBeCloseTo((0.6 - 0.2) * 3, 6)
    expect(areas[2]).toBeCloseTo(0.6 * 3, 6)
    expect(areas[3]).toBeCloseTo(0.6 * 3, 6)
  })

  it('forms the whole column when it is cast first instead', () => {
    const w = wall({ start: [-3, 0], end: [3, 0], thickness: 0.4, castOrder: 2 })
    const c = column({ width: 0.4, depth: 0.4, castOrder: 1 })
    expect(formedRoles([w, c] as AnyNode[], c.id)).toHaveLength(4)
  })

  it('is not buried by the slab passing through it — the column stops at the soffit', () => {
    const c = column({ position: [3, 0, 2], castOrder: 1 })
    const s = slab({ castOrder: 2 })
    expect(formedRoles([c, s] as AnyNode[], c.id)).toHaveLength(4)
  })
})

describe('a slab', () => {
  it('forms a soffit and a rim, and never its trowelled top', () => {
    const s = slab()
    expect(roles([s] as AnyNode[], s.id)).toEqual(['soffit', 'edge', 'top'])
    expect(faceOf([s] as AnyNode[], s.id, 'top')?.reason).toBe('SLAB_TOP_FINISHED')
  })

  it('measures the soffit as the plan area and the rim as perimeter x thickness', () => {
    const s = slab()
    expect(faceOf([s] as AnyNode[], s.id, 'soffit')?.physicalArea).toBeCloseTo(24, 6)
    expect(faceOf([s] as AnyNode[], s.id, 'edge')?.physicalArea).toBeCloseTo(20 * 0.2, 6)
  })

  it('doubles the rim for an upstand or a downstand edge beam', () => {
    const s = slab({ edgeFaceCount: 2 })
    expect(faceOf([s] as AnyNode[], s.id, 'edge')?.physicalArea).toBeCloseTo(2 * 20 * 0.2, 6)
  })

  it('needs no soffit form when cast on ground', () => {
    const s = slab({ againstEarthSide: 'b' })
    const soffit = faceOf([s] as AnyNode[], s.id, 'soffit')
    expect(soffit?.formed).toBe(false)
    expect(soffit?.reason).toBe('SLAB_ON_GROUND')
  })

  it('forms a sloping top and loads it in uplift', () => {
    const s = slab({ topSurface: { kind: 'formed', slopeDeg: 0 } })
    const top = faceOf([s] as AnyNode[], s.id, 'top')
    expect(top?.formed).toBe(true)
    expect(top?.upliftLoaded).toBe(true)
  })

  it('is not carried by the walls under it — they prop it, they do not form its rim', () => {
    const w = wall({ start: [0, 0], end: [6, 0], castOrder: 1 })
    const s = slab({ castOrder: 2 })
    expect(faceOf([w, s] as AnyNode[], s.id, 'edge')?.physicalArea).toBeCloseTo(20 * 0.2, 6)
  })
})

describe('slab holes', () => {
  const withHole = (holeSide: number) =>
    slab({
      holes: [
        [
          [1, 1],
          [1 + holeSide, 1],
          [1 + holeSide, 1 + holeSide],
          [1, 1 + holeSide],
        ],
      ],
    })

  it('takes a large hole off the soffit under both numbers', () => {
    const s = withHole(2)
    const soffit = faceOf([s] as AnyNode[], s.id, 'soffit')
    expect(soffit?.physicalArea).toBeCloseTo(24 - 4, 6)
    expect(soffit?.measuredArea).toBeCloseTo(24 - 4, 6)
  })

  it('cuts a small hole physically but not from the measured soffit', () => {
    // 0.9 m² — under HKSMM4's 1.00 m² threshold.
    const s = withHole(0.9486832980505138)
    const soffit = faceOf([s] as AnyNode[], s.id, 'soffit')
    expect(soffit?.physicalArea).toBeCloseTo(24 - 0.9, 6)
    expect(soffit?.measuredArea).toBeCloseTo(24, 6)
    expect(soffit?.deductions[0]?.reason).toBe('OPENING_BELOW_THRESHOLD')
  })

  it('adds edge forms around the hole rim — a perforated slab needs more, not less', () => {
    const blank = slab()
    const holed = withHole(2)
    const before = faceOf([blank] as AnyNode[], blank.id, 'edge')?.physicalArea ?? 0
    const after = faceOf([holed] as AnyNode[], holed.id, 'edge')?.physicalArea ?? 0
    expect(after).toBeCloseTo(before + 8 * 0.2, 6)
  })
})

describe('adjacent slab bays', () => {
  const bayA = slab({
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    castOrder: 1,
  })
  const bayB = slab({
    polygon: [
      [4, 0],
      [8, 0],
      [8, 4],
      [4, 4],
    ],
    castOrder: 2,
  })
  const nodes = [bayA, bayB] as AnyNode[]

  it('leaves the earlier bay its full rim', () => {
    expect(faceOf(nodes, bayA.id, 'edge')?.physicalArea).toBeCloseTo(16 * 0.2, 6)
  })

  it('drops the later bay the shared rim it casts against hardened concrete', () => {
    expect(faceOf(nodes, bayB.id, 'edge')?.physicalArea).toBeCloseTo((16 - 4) * 0.2, 6)
  })

  it('never trims the measured rim — intersections are not deducted', () => {
    expect(faceOf(nodes, bayB.id, 'edge')?.measuredArea).toBeCloseTo(16 * 0.2, 6)
  })
})

describe('every element in a mixed level is classified', () => {
  it('covers walls, columns and slabs, each with every face reasoned', () => {
    const w = wall({ castOrder: 2 })
    const c = column({ position: [6, 0, 0], castOrder: 1 })
    const s = slab({ castOrder: 3 })
    const coverage = classifyCoverage([w, c, s] as AnyNode[])
    expect(coverage.size).toBe(3)
    expect(coverage.get(w.id as AnyNodeId)?.faces).toHaveLength(6)
    expect(coverage.get(c.id as AnyNodeId)?.faces).toHaveLength(6)
    expect(coverage.get(s.id as AnyNodeId)?.faces).toHaveLength(3)
    for (const element of coverage.values()) {
      for (const f of element.faces) expect(f.reason).toBeTruthy()
    }
  })

  it('emits nothing for a slab with formwork disabled', () => {
    const s = slab({ formworkMode: 'none' })
    expect(formedRoles([s] as AnyNode[], s.id)).toEqual([])
  })

  it('forms nothing on a column or slab until one names a shuttering system', () => {
    // Every kind reads the same field. A column the user has not shuttered is
    // not formed on their behalf — that would bill work nobody chose.
    const c = ColumnNode.parse({
      position: [0, 0, 0],
      crossSection: 'square',
      width: 0.4,
      depth: 0.4,
      height: 3,
    })
    const s = SlabNode.parse({
      polygon: [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
      thickness: 0.2,
    })
    expect(formedRoles([c] as AnyNode[], c.id)).toEqual([])
    expect(formedRoles([s] as AnyNode[], s.id)).toEqual([])
    expect(faceOf([c] as AnyNode[], c.id, 'column-face-1')?.reason).toBe('FORMWORK_DISABLED')
    expect(faceOf([s] as AnyNode[], s.id, 'soffit')?.reason).toBe('FORMWORK_DISABLED')
  })

  it('rejects a degenerate slab rather than reporting a zero-area soffit', () => {
    const degenerate = SlabNode.parse({
      polygon: [
        [0, 0],
        [1, 0],
      ],
      thickness: 0.2,
    })
    expect(toCastableElement(degenerate as AnyNode)).toBeNull()
  })
})
