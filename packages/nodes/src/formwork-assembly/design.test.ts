import { describe, expect, test } from 'bun:test'
import type { ColumnNode, SlabNode, WallNode } from '@pascal-app/core'
import {
  DEFAULT_FORMWORK_SETTINGS,
  type FormworkSettings,
  formworkSettings,
  type PourUnit,
} from '@pascal-app/core/formwork'
import type { FormworkProjectSettingsNode } from '@pascal-app/core/schema'
import { columnPourDesign, slabPourDesign, wallPourDesign } from './design'

/**
 * The design report and the 3D builders read the same three functions, so what is
 * asserted here is what both surfaces show. The chain's own arithmetic is covered
 * in `packages/core`; these are the wiring facts the report depends on — that the
 * pour unit rather than the element sets the head, that a stated spacing survives
 * to the panel and reports its overload, and that every figure the report prints is
 * actually populated.
 *
 * The settings are threaded through too, and for the same reason: a field the
 * dialog writes but no design function reads is a control that appears to work.
 * Each group below therefore asserts that stating something in the project
 * settings *moves* the answer, not merely that it is accepted.
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

/** Settings as they arrive from a real scene: resolved off a node, not hand-built. */
function makeSettings(overrides: Partial<FormworkProjectSettingsNode> = {}): FormworkSettings {
  return formworkSettings({
    object: 'node',
    id: 'formwork-settings_test',
    type: 'formwork-settings',
    parentId: 'site_test',
    visible: true,
    metadata: {},
    children: [],
    ...overrides,
  } as FormworkProjectSettingsNode)
}

const DEFAULTS = DEFAULT_FORMWORK_SETTINGS

describe('wallPourDesign', () => {
  test('reports every figure the design report prints', () => {
    const { design, liftHeightM, system } = wallPourDesign(
      DEFAULTS,
      makeWall(),
      undefined,
      undefined,
    )

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
    const whole = wallPourDesign(DEFAULTS, wall, undefined, undefined)
    // The base lift of a 9 m wall split into three: same wall, a third of the head.
    const lift = wallPourDesign(DEFAULTS, wall, makeUnit({ topElevation: 3 }), undefined)

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
    const full = wallPourDesign(DEFAULTS, wall, unit, undefined)
    const bay = wallPourDesign(DEFAULTS, wall, { ...unit, endAlong: 1.2 }, undefined)

    expect(full.design.tieSpacing.spans).toBe(3)
    expect(bay.design.tieSpacing.spans).toBe(1)
    // One span is weaker in bending than three but stronger in shear, and shear governs
    // a waler at these loads — so the short bay allows *more*, not less. Reporting the
    // count is the point: the figures are not comparable without it.
    expect(bay.design.tieSpacing.calculatedM).toBeGreaterThan(full.design.tieSpacing.calculatedM)
  })

  test('a stated spacing is adopted as given and its overload is reported', () => {
    // Wide enough that the check cannot possibly allow it at this head.
    const { design } = wallPourDesign(DEFAULTS, makeWall({ tieSpacing: 2 }), undefined, undefined)

    expect(design.tieSpacing.adoptedM).toBe(2)
    expect(design.tieSpacing.stated).toBe(true)
    expect(design.tieSpacing.utilisation).toBeGreaterThan(1)
    expect(design.warnings.some((w) => w.kind === 'stated-spacing-over-capacity')).toBe(true)
  })

  test('architectural exposure tightens the deflection limit', () => {
    const structural = wallPourDesign(DEFAULTS, makeWall(), undefined, undefined)
    const architectural = wallPourDesign(
      DEFAULTS,
      makeWall({ exposureClass: 'architectural' }),
      undefined,
      undefined,
    )

    expect(architectural.design.stud.calculatedM).toBeLessThan(structural.design.stud.calculatedM)
  })
})

describe('the project settings reach the wall chain', () => {
  test('a slower pour than the default earns a lower pressure', () => {
    // The default is the fastest rate DIN covers, which on a 3 m lift returns more
    // than the fluid head and is capped by it. Stating the real rate is how a project
    // claims the saving — and if this ever stops moving, the dialog is decorative.
    const fast = wallPourDesign(DEFAULTS, makeWall(), undefined, undefined)
    const slow = wallPourDesign(
      makeSettings({ placement: { riseRateMH: 2 } }),
      makeWall(),
      undefined,
      undefined,
    )

    expect(slow.design.designPressureKnM2).toBeLessThan(fast.design.designPressureKnM2)
  })

  test('cold concrete costs more, because it sets later', () => {
    // Only visible where the formula governs rather than the fluid head, which is why
    // this is asserted at a stated rate rather than at the default.
    const warm = makeSettings({ placement: { riseRateMH: 2, concreteTemperatureC: 20 } })
    const cold = makeSettings({ placement: { riseRateMH: 2, concreteTemperatureC: 10 } })

    expect(
      wallPourDesign(cold, makeWall(), undefined, undefined).design.designPressureKnM2,
    ).toBeGreaterThan(
      wallPourDesign(warm, makeWall(), undefined, undefined).design.designPressureKnM2,
    )
  })

  test('the stated standard is the one the envelope is derived under', () => {
    const aci = wallPourDesign(
      makeSettings({ pressureStandard: 'ACI_347' }),
      makeWall(),
      undefined,
      undefined,
    )

    expect(DEFAULTS.pressureStandard).toBe('DIN_18218')
    expect(aci.design.envelope.standard).toBe('ACI_347')
  })

  test('a flowable mix pushes harder than a stiff one at the same rate', () => {
    const stiff = makeSettings({
      placement: { riseRateMH: 2 },
      concrete: { consistencyClass: 'F1' },
    })
    const flowable = makeSettings({
      placement: { riseRateMH: 2 },
      concrete: { consistencyClass: 'F5' },
    })

    expect(
      wallPourDesign(flowable, makeWall(), undefined, undefined).design.designPressureKnM2,
    ).toBeGreaterThan(
      wallPourDesign(stiff, makeWall(), undefined, undefined).design.designPressureKnM2,
    )
  })

  test('doubled walers halve what each member bends under, so the ties open out', () => {
    // `tieSpacing` is the waler's own allowable span, so pairing the walers is the one
    // parts setting whose effect lands on it directly.
    const single = wallPourDesign(DEFAULTS, makeWall(), undefined, undefined)
    const doubled = wallPourDesign(
      makeSettings({ parts: { doubledWalers: true } }),
      makeWall(),
      undefined,
      undefined,
    )

    expect(doubled.design.tieSpacing.calculatedM).toBeGreaterThan(
      single.design.tieSpacing.calculatedM,
    )
  })

  test('the bracing settings are the bracing check’s inputs', () => {
    const exposed = wallPourDesign(
      makeSettings({ bracing: { windPressureKpa: 2.5 } }),
      makeWall(),
      undefined,
      undefined,
    )
    const sheltered = wallPourDesign(DEFAULTS, makeWall(), undefined, undefined)

    expect(exposed.design.bracing.rakerForceKn).toBeGreaterThan(
      sheltered.design.bracing.rakerForceKn,
    )
  })

  test('the resolved settings carry what the project actually stated', () => {
    // The report tells an assumption from a decision off `stated`, and it cannot be
    // recovered by comparing against the default: a project that deliberately states
    // DIN's maximum rate is not assuming it.
    expect(DEFAULTS.stated).toBeUndefined()
    expect(makeSettings().stated?.placement).toBeUndefined()
    expect(makeSettings({ placement: { riseRateMH: 7 } }).stated?.placement?.riseRateMH).toBe(7)
  })
})

describe('columnPourDesign', () => {
  test('reports the envelope the schedule was graded off', () => {
    const { designPressureKnM2, envelope, facets, form, liftHeightM, schedule, sideM } =
      columnPourDesign(DEFAULTS, makeColumn(), undefined)

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
    const { schedule } = columnPourDesign(DEFAULTS, makeColumn({ height: 4 }), undefined)
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
    const { schedule } = columnPourDesign(DEFAULTS, makeColumn({ height: 4 }), undefined)
    const forces = schedule.rows.map((row) => row.forceKn)

    // The base clamp shares the band below it with the kicker rather than carrying all
    // of it, which is why omitting the kicker fails a column form at its foot.
    expect(forces[0] as number).toBeLessThan(Math.max(...forces))
  })

  test('a round section is wrapped and banded rather than boxed', () => {
    const { facets, form, schedule } = columnPourDesign(
      DEFAULTS,
      makeColumn({ crossSection: 'round', radius: 0.25 }),
      undefined,
    )

    expect(facets).toBe(24)
    expect(form).toBeUndefined()
    expect(schedule.formSizeMm).toBeUndefined()
  })

  test('the kicker is only at the base of the element, not at a lift joint', () => {
    const column = makeColumn({ height: 6 })
    const base = columnPourDesign(DEFAULTS, column, makeUnit({ topElevation: 3 }))
    const upper = columnPourDesign(
      DEFAULTS,
      column,
      makeUnit({ baseElevation: 3, topElevation: 6, liftIndex: 1, hasJointBelow: true }),
    )

    expect(base.kickerM).toBeGreaterThan(0)
    expect(upper.kickerM).toBe(0)
  })

  test('kickerless is honoured at the element base', () => {
    const { kickerM } = columnPourDesign(
      DEFAULTS,
      makeColumn({ kickerMode: 'kickerless' }),
      undefined,
    )
    expect(kickerM).toBe(0)
  })

  test('a slower pour opens the clamp schedule out', () => {
    const fast = columnPourDesign(DEFAULTS, makeColumn({ height: 4 }), undefined)
    const slow = columnPourDesign(
      makeSettings({ placement: { riseRateMH: 2 } }),
      makeColumn({ height: 4 }),
      undefined,
    )

    expect(slow.designPressureKnM2).toBeLessThan(fast.designPressureKnM2)
    expect(slow.schedule.rows.length).toBeLessThanOrEqual(fast.schedule.rows.length)
  })
})

describe('slabPourDesign', () => {
  test('reports every figure the design report prints', () => {
    const { design, soffitHeightM } = slabPourDesign(DEFAULTS, makeSlab())

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
    const thin = slabPourDesign(DEFAULTS, makeSlab({ thickness: 0.15 }))
    const thick = slabPourDesign(DEFAULTS, makeSlab({ thickness: 0.4 }))

    expect(thick.design.load.totalKpa).toBeGreaterThan(thin.design.load.totalKpa)
    expect(thick.design.joist.adoptedM).toBeLessThanOrEqual(thin.design.joist.adoptedM)
  })

  test('a stated joist spacing is adopted as given', () => {
    const { design } = slabPourDesign(DEFAULTS, makeSlab({ walerSpacing: 1.5 }))

    expect(design.joist.adoptedM).toBe(1.5)
    expect(design.joist.stated).toBe(true)
  })

  test('the stated soffit height is used in preference to the assumed storey', () => {
    expect(
      slabPourDesign(DEFAULTS, makeSlab({ soffitHeightAboveSupport: 4.2 })).soffitHeightM,
    ).toBe(4.2)
  })

  test('the project’s deck loads are what the falsework carries', () => {
    // A deck reads none of the pressure settings, so `falseworkLoads` is the only way
    // a project can move a soffit design — and every field here is one the dialog
    // offers.
    const nominal = slabPourDesign(DEFAULTS, makeSlab())
    const loaded = slabPourDesign(
      makeSettings({ falseworkLoads: { liveLoadKpa: 6, motorizedCarts: true } }),
      makeSlab(),
    )

    expect(loaded.design.load.liveKpa).toBe(6)
    expect(loaded.design.load.totalKpa).toBeGreaterThan(nominal.design.load.totalKpa)
    expect(loaded.design.joist.adoptedM).toBeLessThanOrEqual(nominal.design.joist.adoptedM)
  })

  test('the mix’s unit weight reaches the deck, and none of the pressure settings do', () => {
    const heavy = slabPourDesign(makeSettings({ concrete: { unitWeightKnM3: 30 } }), makeSlab())
    // A rate of rise is a lateral-pressure input; a soffit is loaded by weight, so
    // stating one must leave the deck design exactly where it was.
    const poured = slabPourDesign(makeSettings({ placement: { riseRateMH: 1 } }), makeSlab())

    expect(heavy.design.load.deadKpa).toBeGreaterThan(
      slabPourDesign(DEFAULTS, makeSlab()).design.load.deadKpa,
    )
    expect(poured.design.load.totalKpa).toBe(
      slabPourDesign(DEFAULTS, makeSlab()).design.load.totalKpa,
    )
  })
})
