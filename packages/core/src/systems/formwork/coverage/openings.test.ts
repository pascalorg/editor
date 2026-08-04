import { describe, expect, it } from 'bun:test'
import { DoorNode } from '../../../schema/nodes/door'
import { WallNode } from '../../../schema/nodes/wall'
import { WindowNode } from '../../../schema/nodes/window'
import type { AnyNode, AnyNodeId } from '../../../schema/types'
import { measurementStandard } from '../measurement/standards'
import { coverageForElement } from './faces'

/**
 * The worked cases from `wiki/formwork/reference/coverage.md` §1.10. They are
 * the whole point of splitting measured from physical area: under HKSMM4 the
 * big window is a net −2.52 m² and the small duct is a net **+0.48 m²**,
 * because nothing is deducted below the threshold but the reveals are formed
 * either way.
 */

const HOST = { start: [0, 0] as [number, number], end: [5, 0] as [number, number] }

function wall(overrides: Record<string, unknown> = {}) {
  return WallNode.parse({
    ...HOST,
    thickness: 0.2,
    height: 3,
    formworkType: 'plywood',
    ...overrides,
  })
}

/** Freestanding 5 x 3 x 0.2 wall: 2 x 15 sides + 2 x 0.6 ends. */
const BLANK_AREA = 31.2

function windowIn(wallId: string, width: number, height: number, centreY: number) {
  return WindowNode.parse({
    wallId,
    parentId: wallId,
    position: [2.5, centreY, 0],
    width,
    height,
  })
}

function coverage(nodes: AnyNode[], id: string, standardId?: Parameters<typeof measurementStandard>[0]) {
  return coverageForElement(id as AnyNodeId, nodes, {
    standard: standardId ? measurementStandard(standardId) : undefined,
  })
}

describe('HKSMM4 worked case — a 1.2 x 1.5 m window in a 200 mm wall', () => {
  const host = wall()
  const opening = windowIn(host.id, 1.2, 1.5, 1.5)
  const nodes = [host, opening] as AnyNode[]

  it('deducts the void from both faces and adds four reveals: net -2.52 m²', () => {
    const result = coverage(nodes, host.id, 'HKSMM4')
    expect(result?.measuredArea).toBeCloseTo(BLANK_AREA - 2.52, 6)
  })

  it('shows the arithmetic: 3.6 m² deducted, 1.08 m² of reveals added', () => {
    const result = coverage(nodes, host.id, 'HKSMM4')
    const measured = result?.openings[0]
    expect(measured?.areaSqM).toBeCloseTo(1.8, 6)
    expect(measured?.reason).toBe('OPENING')
    expect(measured?.measuredDeductionPerFace).toBeCloseTo(1.8, 6)
    expect(measured?.revealSides).toBe(4)
    expect(measured?.revealAreaSqM).toBeCloseTo(1.08, 6)
  })
})

describe('HKSMM4 worked case — a 0.6 x 0.6 m duct penetration', () => {
  const host = wall()
  const opening = windowIn(host.id, 0.6, 0.6, 1.5)
  const nodes = [host, opening] as AnyNode[]

  it('deducts nothing and adds 0.48 m² of reveals: a small opening INCREASES formwork', () => {
    const result = coverage(nodes, host.id, 'HKSMM4')
    expect(result?.measuredArea).toBeCloseTo(BLANK_AREA + 0.48, 6)
  })

  it('records that the rule was considered, not skipped', () => {
    const measured = coverage(nodes, host.id, 'HKSMM4')?.openings[0]
    expect(measured?.reason).toBe('OPENING_BELOW_THRESHOLD')
    expect(measured?.measuredDeductionPerFace).toBe(0)
  })

  it('still cuts the panel — physical area always loses the void', () => {
    const result = coverage(nodes, host.id, 'HKSMM4')
    const sideA = result?.faces.find((f) => f.role === 'side-a')
    expect(sideA?.physicalArea).toBeCloseTo(15 - 0.36, 6)
    expect(sideA?.measuredArea).toBeCloseTo(15, 6)
  })
})

describe('the same wall under a different contract', () => {
  const host = wall()
  const opening = windowIn(host.id, 0.6, 0.6, 1.5)
  const nodes = [host, opening] as AnyNode[]

  it('IS 1200 deducts the 0.36 m² duct that HKSMM4 ignores', () => {
    const is1200 = coverage(nodes, host.id, 'IS_1200_5')?.openings[0]
    expect(is1200?.reason).toBe('OPENING_BELOW_THRESHOLD')

    const bigger = windowIn(host.id, 0.8, 0.8, 1.5)
    const withBigger = coverage([host, bigger] as AnyNode[], host.id, 'IS_1200_5')?.openings[0]
    expect(withBigger?.areaSqM).toBeCloseTo(0.64, 6)
    expect(withBigger?.reason).toBe('OPENING')
  })

  it('NRM2 deducts nothing and measures no reveals — the opening is extra over', () => {
    const result = coverage(nodes, host.id, 'NRM2')
    expect(result?.measuredArea).toBeCloseTo(BLANK_AREA, 6)
    const measured = result?.openings[0]
    expect(measured?.reason).toBe('OPENING_EXTRA_OVER')
    expect(measured?.extraOverBand).toBe('≤ 5.00 m²')
    expect(measured?.revealsMeasured).toBe(false)
  })

  it('still cuts the same plywood under NRM2 — physical area is contract-independent', () => {
    const hk = coverage(nodes, host.id, 'HKSMM4')
    const nrm2 = coverage(nodes, host.id, 'NRM2')
    expect(nrm2?.physicalArea).toBeCloseTo(hk?.physicalArea ?? 0, 6)
  })
})

describe('reveal sides depend on where the void sits', () => {
  it('forms three sides for a floor-level door, not four — there is no sill', () => {
    const host = wall()
    const door = DoorNode.parse({
      wallId: host.id,
      parentId: host.id,
      position: [2.5, 1.05, 0],
      width: 0.9,
      height: 2.1,
    })
    const measured = coverage([host, door] as AnyNode[], host.id, 'HKSMM4')?.openings[0]
    expect(measured?.kind).toBe('door')
    expect(measured?.revealSides).toBe(3)
    // Two jambs (2 x 2.1) + head (0.9), no sill.
    expect(measured?.revealAreaSqM).toBeCloseTo((2 * 2.1 + 0.9) * 0.2, 6)
  })

  it('drops the head reveal for an opening running to the top of the wall', () => {
    const host = wall()
    const opening = windowIn(host.id, 1.2, 1.5, 2.25)
    const measured = coverage([host, opening] as AnyNode[], host.id, 'HKSMM4')?.openings[0]
    expect(measured?.revealSides).toBe(3)
  })

  it('clips a void that overruns the wall end rather than over-deducting', () => {
    const host = wall()
    const opening = WindowNode.parse({
      wallId: host.id,
      parentId: host.id,
      position: [4.8, 1.5, 0],
      width: 1,
      height: 1,
    })
    const measured = coverage([host, opening] as AnyNode[], host.id, 'HKSMM4')?.openings[0]
    // Centred at 4.8 on a 5 m wall, so only 4.3–5.0 of the 1 m width is real.
    expect(measured?.areaSqM).toBeCloseTo(0.7, 6)
    expect(measured?.revealSides).toBe(3)
  })

  it('ignores an opening hosted by a different wall', () => {
    const host = wall()
    const other = wall({ start: [0, 4], end: [5, 4] })
    const opening = windowIn(other.id, 1.2, 1.5, 1.5)
    expect(coverage([host, other, opening] as AnyNode[], host.id)?.openings).toEqual([])
  })

  it('ignores a hidden opening', () => {
    const host = wall()
    const opening = WindowNode.parse({
      wallId: host.id,
      parentId: host.id,
      position: [2.5, 1.5, 0],
      width: 1.2,
      height: 1.5,
      visible: false,
    })
    expect(coverage([host, opening] as AnyNode[], host.id)?.openings).toEqual([])
  })
})

describe('the audit trail', () => {
  it('records one deduction per opening on each formed side face', () => {
    const host = wall()
    const a = windowIn(host.id, 1.2, 1.5, 1.5)
    const b = WindowNode.parse({
      wallId: host.id,
      parentId: host.id,
      position: [1, 1.5, 0],
      width: 0.6,
      height: 0.6,
    })
    const faces = coverage([host, a, b] as AnyNode[], host.id, 'HKSMM4')?.faces ?? []
    const sideA = faces.find((f) => f.role === 'side-a')
    expect(sideA?.deductions).toHaveLength(2)
    expect(sideA?.deductions.map((d) => d.reason).sort()).toEqual([
      'OPENING',
      'OPENING_BELOW_THRESHOLD',
    ])
    for (const deduction of sideA?.deductions ?? []) {
      expect(deduction.physicalSqM).toBeCloseTo(deduction.areaSqM, 6)
    }
  })

  it('leaves unformed faces with no deductions to explain', () => {
    const host = wall({ formworkMode: 'single-sided-a' })
    const opening = windowIn(host.id, 1.2, 1.5, 1.5)
    const sideB = coverage([host, opening] as AnyNode[], host.id)?.faces.find(
      (f) => f.role === 'side-b',
    )
    expect(sideB?.formed).toBe(false)
    expect(sideB?.deductions).toEqual([])
  })
})
