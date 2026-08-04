import { describe, expect, it } from 'bun:test'
import { ColumnNode } from '../../../schema/nodes/column'
import { SlabNode } from '../../../schema/nodes/slab'
import { WallNode } from '../../../schema/nodes/wall'
import type { AnyNode, AnyNodeId } from '../../../schema/types'
import { measurementStandard } from '../measurement/standards'
import type { MeasurementStandardId } from '../measurement/types'
import { coverageForElement } from './faces'
import type { FaceRole } from './types'

/**
 * Banding as the solver sees it. `banding.test.ts` in `measurement/` proves the
 * band arithmetic against the clauses; this proves the classifier hands it the
 * right dimensions — which face's width is which, and where the soffit's prop
 * height comes from. Passing the wrong extent is the easy mistake, and it bills
 * a 6 m wall as a nib.
 */

function measurementOf(
  nodes: AnyNode[],
  id: string,
  role: FaceRole,
  standardId: MeasurementStandardId = 'HKSMM4',
) {
  const coverage = coverageForElement(id as AnyNodeId, nodes, {
    standard: measurementStandard(standardId),
  })
  return coverage?.faces.find((f) => f.role === role)?.measurement
}

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

describe('a wall face', () => {
  it('is billed by area when it is an ordinary run of wall', () => {
    const w = wall()
    const side = measurementOf([w] as AnyNode[], w.id, 'side-a')
    expect(side?.unit).toBe('m2')
    expect(side?.quantity).toBeCloseTo(18, 6)
    expect(side?.surfaceClass).toBe('vertical')
  })

  it('is billed by the metre when the wall is a short nib', () => {
    // A 150 mm return: the *length* is the narrow dimension of the side face,
    // and the run billed is its height.
    const w = wall({ end: [0.15, 0] })
    const side = measurementOf([w] as AnyNode[], w.id, 'side-a')
    expect(side?.unit).toBe('m')
    expect(side?.quantity).toBeCloseTo(3, 6)
    expect(side?.statedWidthM).toBeCloseTo(0.2, 6)
  })

  it('bills its ends off the wall thickness, not its length', () => {
    // A 300 mm-thick wall's end is a 300 mm-wide strip 3 m tall however long the
    // wall is — this is the face NRM2 item 24 is written about.
    const w = wall()
    const end = measurementOf([w] as AnyNode[], w.id, 'end-start')
    expect(end?.unit).toBe('m')
    expect(end?.quantity).toBeCloseTo(3, 6)
    expect(end?.widthM).toBeCloseTo(0.3, 6)
  })

  it('is classified curved when the wall arcs', () => {
    const curved = wall({ curveOffset: 0.8 })
    const straight = wall()
    expect(measurementOf([curved] as AnyNode[], curved.id, 'side-a')?.surfaceClass).toBe('curved')
    expect(measurementOf([straight] as AnyNode[], straight.id, 'side-a')?.surfaceClass).toBe(
      'vertical',
    )
  })

  it('is banded per pour unit, so a segment shorter than the threshold becomes a run', () => {
    // Splitting a wall does not just multiply the quantities: a 6 m wall cut into
    // 250 mm bays would be billed by the metre. Only the scoped length can
    // answer the width question, which is why the classifier bands the scope.
    const w = wall({ end: [0.25, 0] })
    expect(measurementOf([w] as AnyNode[], w.id, 'side-a')?.unit).toBe('m')
  })
})

describe('a slab soffit', () => {
  it('carries the thickness stage from the slab and the height stage from its props', () => {
    const s = slab({ thickness: 0.35, soffitHeightAboveSupport: 4.2 })
    const soffit = measurementOf([s] as AnyNode[], s.id, 'soffit')
    expect(soffit?.unit).toBe('m2')
    expect(soffit?.quantity).toBeCloseTo(24, 6)
    expect(soffit?.thicknessStage?.label).toBe('300 mm–400 mm')
    expect(soffit?.heightStage?.label).toBe('3.50 m–5.00 m')
  })

  it('has no height stage until someone states the prop height', () => {
    const s = slab({ thickness: 0.35 })
    const soffit = measurementOf([s] as AnyNode[], s.id, 'soffit')
    expect(soffit?.thicknessStage?.label).toBe('300 mm–400 mm')
    expect(soffit?.heightStage).toBeUndefined()
  })

  it('bands its measured area, not its gross — a deducted hole leaves the item', () => {
    const s = slab({
      thickness: 0.35,
      holes: [
        [
          [1, 1],
          [3, 1],
          [3, 3],
          [1, 3],
        ],
      ],
    })
    expect(measurementOf([s] as AnyNode[], s.id, 'soffit')?.quantity).toBeCloseTo(24 - 4, 6)
  })

  it('is not banded at all when it is cast on ground', () => {
    const s = slab({ againstEarthSide: 'b' })
    expect(measurementOf([s] as AnyNode[], s.id, 'soffit')).toBeUndefined()
  })
})

describe('a slab rim', () => {
  it('is billed by the metre of perimeter — a 200 mm edge is narrow under any standard', () => {
    const s = slab()
    const edge = measurementOf([s] as AnyNode[], s.id, 'edge')
    expect(edge?.unit).toBe('m')
    expect(edge?.quantity).toBeCloseTo(20, 6)
    expect(edge?.statedWidthM).toBeCloseTo(0.2, 6)
  })

  it('runs twice around an upstand, because both sides are formed', () => {
    const s = slab({ edgeFaceCount: 2 })
    expect(measurementOf([s] as AnyNode[], s.id, 'edge')?.quantity).toBeCloseTo(40, 6)
  })

  it('becomes an area item once the slab is deep enough to leave the band', () => {
    const s = slab({ thickness: 0.6 })
    const edge = measurementOf([s] as AnyNode[], s.id, 'edge')
    expect(edge?.unit).toBe('m2')
    expect(edge?.quantity).toBeCloseTo(20 * 0.6, 6)
  })
})

describe('a column face', () => {
  it('is billed by area however slender the column', () => {
    // The narrow-width clauses we hold name wall sides (HKSMM4) and wall ends
    // (NRM2 11.24). Neither names a column, and no source we have extends them
    // to one, so a 250 mm column face stays an area item rather than inheriting
    // a rule by analogy. Its width is still carried, so adding a column clause
    // later is data, not a code change.
    const slender = ColumnNode.parse({
      position: [0, 0, 0],
      crossSection: 'square',
      width: 0.25,
      depth: 0.25,
      height: 3,
      formworkType: 'plywood',
    })
    const face = measurementOf([slender] as AnyNode[], slender.id, 'column-face-1')
    expect(face?.unit).toBe('m2')
    expect(face?.quantity).toBeCloseTo(0.75, 6)
    expect(face?.surfaceClass).toBe('vertical')
  })

  it('reads a round column as one curved shaft, never as a narrow strip', () => {
    const round = ColumnNode.parse({
      position: [0, 0, 0],
      crossSection: 'round',
      radius: 0.2,
      height: 3,
      formworkType: 'plywood',
    })
    const shaft = measurementOf([round] as AnyNode[], round.id, 'shaft')
    expect(shaft?.surfaceClass).toBe('curved')
    expect(shaft?.unit).toBe('m2')
    expect(shaft?.quantity).toBeCloseTo(2 * Math.PI * 0.2 * 3, 6)
  })
})

describe('the same geometry under two standards', () => {
  const w = wall({ thickness: 0.4 })

  it('bills a 400 mm wall end by the metre under NRM2 and by area under HKSMM4', () => {
    // The clauses disagree — 500 mm against 300 mm — so the same wall yields
    // different bill items. That divergence is the point of the strategy.
    expect(measurementOf([w] as AnyNode[], w.id, 'end-start', 'NRM2')?.unit).toBe('m')
    expect(measurementOf([w] as AnyNode[], w.id, 'end-start', 'HKSMM4')?.unit).toBe('m2')
  })

  it('bands a sloping top under NRM2 only, and leaves the level one unbanded', () => {
    const sloped = wall({ topSurface: { kind: 'formed', slopeDeg: 20 } })
    expect(measurementOf([sloped] as AnyNode[], sloped.id, 'top', 'NRM2')?.slopeBand).toEqual({
      boundaryDeg: 15,
      over: true,
    })
    expect(
      measurementOf([sloped] as AnyNode[], sloped.id, 'top', 'HKSMM4')?.slopeBand,
    ).toBeUndefined()
  })
})

describe('every formed face is billable', () => {
  it('measures each formed face and never a face that was not built', () => {
    const nodes = [
      wall({ castOrder: 1 }),
      slab({ castOrder: 2, soffitHeightAboveSupport: 3 }),
      ColumnNode.parse({
        position: [8, 0, 0],
        crossSection: 'square',
        width: 0.4,
        depth: 0.4,
        height: 3,
        formworkType: 'plywood',
        castOrder: 1,
      }),
    ] as AnyNode[]

    for (const node of nodes) {
      const coverage = coverageForElement(node.id as AnyNodeId, nodes)
      for (const f of coverage?.faces ?? []) {
        if (f.formed) {
          expect(f.measurement).toBeDefined()
          expect(f.measurement?.sourceRefs.length).toBeGreaterThan(0)
        } else {
          expect(f.measurement).toBeUndefined()
        }
      }
    }
  })
})
