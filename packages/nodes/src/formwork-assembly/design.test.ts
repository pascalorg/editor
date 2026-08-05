import { describe, expect, test } from 'bun:test'
import type { ColumnNode, SlabNode, WallNode } from '@pascal-app/core'
import type { PourUnit } from '@pascal-app/core/formwork'
import { columnPourDesign, slabPourDesign, wallPourDesign } from './design'

/**
 * The design report and the 3D builders read the same three functions, so what is
 * asserted here is what both surfaces show. The chain's own arithmetic is covered
 * in `packages/core`; these are the wiring facts the report depends on — that the
 * pour unit rather than the element sets the head, that a stated spacing survives
 * to the panel and reports its overload, and that every figure the report prints is
 * actually populated.
 */

function makeWall(overrides: Partial<WallNode> = {}): WallNode {
  return {
    object: 'node',
    id: 'wall_test',
    type: 'wall',
    parentId: 'level_test',
    visible: true,
    metadata: {},
    children: [],
    start: [0, 0],
    end: [6, 0],
    thickness: 0.25,
    height: 3,
    frontSide: 'unknown',
    backSide: 'unknown',
    formworkType: 'steel-panel',
    ...overrides,
  } as WallNode
}

function makeColumn(overrides: Partial<ColumnNode> = {}): ColumnNode {
  return {
    object: 'node',
    id: 'column_test',
    type: 'column',
    parentId: 'level_test',
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: 0,
    crossSection: 'square',
    width: 0.4,
    depth: 0.4,
    radius: 0.2,
    height: 3,
    formworkType: 'steel-panel',
    ...overrides,
  } as ColumnNode
}

function makeSlab(overrides: Partial<SlabNode> = {}): SlabNode {
  return {
    object: 'node',
    id: 'slab_test',
    type: 'slab',
    parentId: 'level_test',
    visible: true,
    metadata: {},
    children: [],
    polygon: [
      [0, 0],
      [6, 0],
      [6, 5],
      [0, 5],
    ],
    holes: [],
    elevation: 3,
    thickness: 0.25,
    formworkType: 'plywood',
    ...overrides,
  } as SlabNode
}

function makeUnit(overrides: Partial<PourUnit> = {}): PourUnit {
  return {
    elementId: 'wall_test',
    segmentIndex: 0,
    liftIndex: 0,
    startAlong: 0,
    endAlong: 6,
    baseElevation: 0,
    topElevation: 3,
    volumeCuM: 4.5,
    hasJointBelow: false,
    ...overrides,
  } as PourUnit
}

describe('wallPourDesign', () => {
  test('reports every figure the design report prints', () => {
    const { design, liftHeightM, system } = wallPourDesign(makeWall(), undefined, undefined)

    expect(liftHeightM).toBe(3)
    expect(system).toBeDefined()
    expect(design.designPressureKnM2).toBeGreaterThan(0)
    expect(design.envelope.governingEquation.length).toBeGreaterThan(0)
    expect(design.rows.length).toBeGreaterThan(0)
    expect(design.tiesPerM2).toBeGreaterThan(0)
    expect(design.bracing.rakerForceKn).toBeGreaterThan(0)
    // The report prints both figures per member, so both have to be finite: an
    // infinite `calculatedM` reaches the panel as "--" beside a real adopted value.
    for (const member of [design.stud, design.waler, design.tieSpacing]) {
      expect(Number.isFinite(member.calculatedM)).toBe(true)
      expect(member.adoptedM).toBeGreaterThan(0)
      expect(member.utilisation).toBeGreaterThan(0)
    }
  })

  test('the pour unit sets the head, not the element', () => {
    const wall = makeWall({ height: 9 })
    const whole = wallPourDesign(wall, undefined, undefined)
    // The base lift of a 9 m wall split into three: same wall, a third of the head.
    const lift = wallPourDesign(wall, makeUnit({ topElevation: 3 }), undefined)

    expect(whole.liftHeightM).toBe(9)
    expect(lift.liftHeightM).toBe(3)
    expect(lift.design.designPressureKnM2).toBeLessThan(whole.design.designPressureKnM2)
    expect(lift.design.tieSpacing.adoptedM).toBeGreaterThanOrEqual(whole.design.tieSpacing.adoptedM)
  })

  test('the run is the pour unit, so a bay cut short is continuous over fewer spans', () => {
    // `tieSpacing` is the waler's own allowable span, so it is the member whose span
    // count follows the run. The stud runs vertically and takes the lift height.
    const wall = makeWall({ height: 1.2, thickness: 0.15 })
    const unit = makeUnit({ topElevation: 1.2 })
    const full = wallPourDesign(wall, unit, undefined)
    const bay = wallPourDesign(wall, { ...unit, endAlong: 1.2 }, undefined)

    expect(full.design.tieSpacing.spans).toBe(3)
    expect(bay.design.tieSpacing.spans).toBe(1)
    // One span is weaker in bending than three but stronger in shear, and shear governs
    // a waler at these loads — so the short bay allows *more*, not less. Reporting the
    // count is the point: the figures are not comparable without it.
    expect(bay.design.tieSpacing.calculatedM).toBeGreaterThan(full.design.tieSpacing.calculatedM)
  })

  test('a stated spacing is adopted as given and its overload is reported', () => {
    // Wide enough that the check cannot possibly allow it at this head.
    const { design } = wallPourDesign(makeWall({ tieSpacing: 2 }), undefined, undefined)

    expect(design.tieSpacing.adoptedM).toBe(2)
    expect(design.tieSpacing.stated).toBe(true)
    expect(design.tieSpacing.utilisation).toBeGreaterThan(1)
    expect(design.warnings.some((w) => w.kind === 'stated-spacing-over-capacity')).toBe(true)
  })

  test('architectural exposure tightens the deflection limit', () => {
    const structural = wallPourDesign(makeWall(), undefined, undefined)
    const architectural = wallPourDesign(
      makeWall({ exposureClass: 'architectural' }),
      undefined,
      undefined,
    )

    expect(architectural.design.stud.calculatedM).toBeLessThan(structural.design.stud.calculatedM)
  })
})

describe('columnPourDesign', () => {
  test('reports the envelope the schedule was graded off', () => {
    const { designPressureKnM2, envelope, facets, form, liftHeightM, schedule, sideM } =
      columnPourDesign(makeColumn(), undefined)

    expect(facets).toBeUndefined() // square — boxed, not wrapped
    expect(form).toBeDefined()
    expect(sideM).toBe(0.4)
    expect(liftHeightM).toBe(3)
    expect(designPressureKnM2).toBeGreaterThan(0)
    expect(designPressureKnM2).toBeLessThanOrEqual(envelope.maxKnM2)
    expect(schedule.rows.length).toBeGreaterThan(0)
    expect(schedule.clampCount).toBeGreaterThanOrEqual(schedule.setCount)
  })

  test('clamp rows open out going up, because the head falls off', () => {
    const { schedule } = columnPourDesign(makeColumn({ height: 4 }), undefined)
    // The closing row at the pour top sits at zero head, so it is not part of the
    // graded run and carries no force.
    const graded = schedule.rows.filter((row) => row.governedBy !== 'pour-top')

    expect(graded.length).toBeGreaterThan(3)
    expect(schedule.rows.at(-1)?.governedBy).toBe('pour-top')
    for (let i = 1; i < graded.length; i++) {
      const previous = graded[i - 1] as (typeof graded)[number]
      const row = graded[i] as (typeof graded)[number]
      expect(row.elevationMm).toBeGreaterThan(previous.elevationMm)
      expect(row.pressureKnM2).toBeLessThan(previous.pressureKnM2)
      expect(row.spacingBelowMm).toBeGreaterThanOrEqual(previous.spacingBelowMm)
    }
  })

  test('the kicker relieves the base row, so the worst row is the one above it', () => {
    const { schedule } = columnPourDesign(makeColumn({ height: 4 }), undefined)
    const forces = schedule.rows.map((row) => row.forceKn)

    // The base clamp shares the band below it with the kicker rather than carrying all
    // of it, which is why omitting the kicker fails a column form at its foot.
    expect(forces[0] as number).toBeLessThan(Math.max(...forces))
  })

  test('a round section is wrapped and banded rather than boxed', () => {
    const { facets, form, schedule } = columnPourDesign(
      makeColumn({ crossSection: 'round', radius: 0.25 }),
      undefined,
    )

    expect(facets).toBe(24)
    expect(form).toBeUndefined()
    expect(schedule.formSizeMm).toBeUndefined()
  })

  test('the kicker is only at the base of the element, not at a lift joint', () => {
    const column = makeColumn({ height: 6 })
    const base = columnPourDesign(column, makeUnit({ topElevation: 3 }))
    const upper = columnPourDesign(
      column,
      makeUnit({ baseElevation: 3, topElevation: 6, liftIndex: 1, hasJointBelow: true }),
    )

    expect(base.kickerM).toBeGreaterThan(0)
    expect(upper.kickerM).toBe(0)
  })

  test('kickerless is honoured at the element base', () => {
    const { kickerM } = columnPourDesign(makeColumn({ kickerMode: 'kickerless' }), undefined)
    expect(kickerM).toBe(0)
  })
})

describe('slabPourDesign', () => {
  test('reports every figure the design report prints', () => {
    const { design, soffitHeightM } = slabPourDesign(makeSlab())

    expect(soffitHeightM).toBeGreaterThan(0)
    expect(design.load.totalKpa).toBeGreaterThan(0)
    expect(design.load.totalKpa).toBeGreaterThanOrEqual(design.load.minimumKpa)
    expect(design.propsPerM2).toBeGreaterThan(0)
    for (const member of [design.joist, design.bearer, design.propSpacing]) {
      expect(Number.isFinite(member.calculatedM)).toBe(true)
      expect(member.adoptedM).toBeGreaterThan(0)
    }
  })

  test('a thicker slab tightens the grid on its own', () => {
    const thin = slabPourDesign(makeSlab({ thickness: 0.15 }))
    const thick = slabPourDesign(makeSlab({ thickness: 0.4 }))

    expect(thick.design.load.totalKpa).toBeGreaterThan(thin.design.load.totalKpa)
    expect(thick.design.joist.adoptedM).toBeLessThanOrEqual(thin.design.joist.adoptedM)
  })

  test('a stated joist spacing is adopted as given', () => {
    const { design } = slabPourDesign(makeSlab({ walerSpacing: 1.5 }))

    expect(design.joist.adoptedM).toBe(1.5)
    expect(design.joist.stated).toBe(true)
  })

  test('the stated soffit height is used in preference to the assumed storey', () => {
    expect(slabPourDesign(makeSlab({ soffitHeightAboveSupport: 4.2 })).soffitHeightM).toBe(4.2)
  })
})
