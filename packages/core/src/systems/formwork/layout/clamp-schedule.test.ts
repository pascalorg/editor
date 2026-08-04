import { describe, expect, test } from 'bun:test'
import { DOKA_KS_XLIFE, FRAMAX_COLUMN } from '../catalog'
import { dinPressure, type Placement } from '../pressure'
import {
  CLAMP_MODULE_MM,
  type ClampSchedule,
  clampSchedule,
  MAX_CLAMP_SPACING_MM,
  MIN_CLAMP_SPACING_MM,
} from './clamp-schedule'

/**
 * The property that matters here is the shape of the schedule, not one number in it:
 * tight at the base where the head is, opening out going up, never tightening again,
 * and closed at the top. A test that pinned exact elevations would break on any
 * change to a coefficient in a code that is not this module's business.
 */

const pour = (over: Partial<Placement> = {}): Placement => ({
  riseRateMH: 2,
  concreteTemperatureC: 20,
  pourHeightM: 3,
  elementKind: 'column',
  vibration: 'internal',
  ...over,
})

const scheduleFor = (
  over: Partial<Parameters<typeof clampSchedule>[0]> = {},
  placement: Partial<Placement> = {},
): ClampSchedule => {
  const liftHeightM = over.liftHeightM ?? 3
  return clampSchedule({
    liftHeightM,
    sideM: 0.4,
    kickerM: 0.075,
    envelope: dinPressure(
      { consistencyClass: 'F3' },
      pour({ pourHeightM: liftHeightM, ...placement }),
    ),
    form: DOKA_KS_XLIFE,
    ...over,
  })
}

/**
 * A schedule only steps where something actually limits it. A 400 mm column at 46
 * kN/m² allows the better part of a metre at its base, so it comes out flat at the
 * practical ceiling and there is no staircase to test — which is itself the correct
 * answer. The stepping cases below are the ones a limit bites in: a 600 mm section
 * poured at 6 m/h, which is where the trade tables live.
 */
const stepping = { sideM: 0.6 }
const fast = { riseRateMH: 6 }

describe('a column clamp schedule steps, because the pressure does', () => {
  test('opens out going up and never tightens', () => {
    const { rows } = scheduleFor(stepping, fast)
    expect(rows.length).toBeGreaterThan(2)
    // Every gap at least as wide as the one below it, except the closing row, which
    // takes whatever is left over.
    const derived = rows.slice(1, -1)
    for (let i = 1; i < derived.length; i++) {
      expect(derived[i]?.spacingBelowMm as number).toBeGreaterThanOrEqual(
        derived[i - 1]?.spacingBelowMm as number,
      )
    }
    // And it genuinely steps rather than coming out uniform: the top gap is wider
    // than the bottom one, which is the whole point of deriving it.
    const first = derived[0]?.spacingBelowMm as number
    const last = derived.at(-1)?.spacingBelowMm as number
    expect(last).toBeGreaterThan(first)
  })

  test('starts just above the kicker and closes at the pour top', () => {
    const { rows } = scheduleFor({ kickerM: 0.075 })
    expect(rows[0]?.elevationMm).toBeCloseTo(175, 6)
    expect(rows.at(-1)?.elevationMm).toBeCloseTo(3000, 6)
    expect(rows.at(-1)?.governedBy).toBe('pour-top')
  })

  test('sets out on a 25 mm module the crew can measure', () => {
    for (const row of scheduleFor(stepping, fast).rows.slice(1, -1)) {
      expect((row.spacingBelowMm % CLAMP_MODULE_MM).toFixed(6)).toBe('0.000000')
    }
  })

  test('comes out flat where nothing limits it, rather than inventing a staircase', () => {
    // A slim column poured slowly: every row is at the practical ceiling and that is
    // the right answer, not a failure to step.
    const { rows } = scheduleFor({ sideM: 0.3 }, { riseRateMH: 1 })
    for (const row of rows.slice(1, -1)) {
      expect(row.spacingBelowMm).toBe(MAX_CLAMP_SPACING_MM)
      expect(row.governedBy).toBe('practical-maximum')
    }
  })

  test('keeps every clamp inside its rating and the practical band', () => {
    const schedule = scheduleFor(stepping, fast)
    const capacity = schedule.clamp?.capacityKn as number
    expect(capacity).toBeGreaterThan(0)
    for (const row of schedule.rows) {
      expect(row.forceKn).toBeLessThanOrEqual(capacity)
    }
    for (const row of schedule.rows.slice(1, -1)) {
      expect(row.spacingBelowMm).toBeGreaterThanOrEqual(MIN_CLAMP_SPACING_MM)
      expect(row.spacingBelowMm).toBeLessThanOrEqual(MAX_CLAMP_SPACING_MM)
    }
    expect(schedule.warnings.some((w) => w.kind === 'over-capacity-at-base')).toBe(false)
  })

  test('reads the pressure down from the top, so the base row is the loaded one', () => {
    const { rows } = scheduleFor(stepping, fast)
    const base = rows[0]?.pressureKnM2 as number
    const top = rows.at(-1)?.pressureKnM2 as number
    expect(base).toBeGreaterThan(top)
    expect(top).toBeCloseTo(0, 6)
  })

  test('tightens the whole schedule when the pour rises faster', () => {
    const slow = scheduleFor(stepping, { riseRateMH: 1 })
    const quick = scheduleFor(stepping, fast)
    expect(quick.rows.length).toBeGreaterThan(slow.rows.length)
  })

  test('leaves no gap too small to set a clamp in at the top', () => {
    // Walking up from the base rarely lands exactly on the pour top, and the leftover
    // must not become a row 25 mm from its neighbour.
    for (const liftHeightM of [2.4, 2.7, 3, 3.3, 3.6, 4.2]) {
      const { rows } = scheduleFor({ ...stepping, liftHeightM }, fast)
      const closing = rows.at(-1)?.spacingBelowMm as number
      expect(closing).toBeGreaterThanOrEqual(MIN_CLAMP_SPACING_MM)
      expect(rows.at(-1)?.elevationMm).toBeCloseTo(liftHeightM * 1000, 6)
    }
  })
})

describe('what limits the spacing', () => {
  test('names the clamp where the clamp governs', () => {
    // A 600 mm section at 6 m/h: the base band is clamp-limited.
    const { rows } = scheduleFor(stepping, fast)
    expect(rows[0]?.governedBy).toBe('clamp')
  })

  test('bends the clamp arm long before it pulls the corner apart', () => {
    // The arm's demand carries b², the corner tension only b, so on a wide section the
    // bending check is the one that bites — and a schedule derived from the 90 kN
    // tension alone would come out several times too wide and look like it passed.
    const schedule = scheduleFor({ sideM: 0.6 }, fast)
    const clamp = schedule.clamp
    const base = schedule.rows[0]
    expect(base?.forceKn as number).toBeLessThan((clamp?.capacityKn as number) / 4)
    expect(base?.governedBy).toBe('clamp')
  })

  test('hands over to the form’s own yoke where it publishes one', () => {
    // A system column form takes the load into its frame's stiffback rather than into a
    // loose angle, so a yoke weaker than the clamp arm is what governs.
    const schedule = clampSchedule({
      liftHeightM: 3,
      sideM: 1,
      kickerM: 0.075,
      envelope: dinPressure({ consistencyClass: 'F3' }, pour()),
      form: { ...FRAMAX_COLUMN, yokeMomentKnM: 0.5 },
    })
    expect(schedule.rows.some((row) => row.governedBy === 'yoke')).toBe(true)
  })

  test('lets the sheathing govern where the face is the weak part', () => {
    const schedule = scheduleFor({
      // A plywood box: the ply span collapses as the pressure climbs.
      sheathingSpanMm: (pressureKnM2) => (pressureKnM2 > 0 ? 4000 / pressureKnM2 : 4000),
    })
    expect(schedule.rows.some((row) => row.governedBy === 'sheathing')).toBe(true)
  })

  test('falls back to the practical ceiling where nothing structural bites', () => {
    // A slim column poured slowly: the arithmetic would allow metres.
    const { rows } = scheduleFor({ sideM: 0.2 }, { riseRateMH: 0.5 })
    expect(rows.some((row) => row.governedBy === 'practical-maximum')).toBe(true)
    for (const row of rows.slice(0, -1)) {
      expect(row.spacingBelowMm).toBeLessThanOrEqual(MAX_CLAMP_SPACING_MM)
    }
  })

  test('holds the spacing flat through the constant part of the envelope', () => {
    // A 6 m column at 6 m/h is hydrostatic only to 4.08 m, so the pressure is constant
    // over the whole bottom third and the spacing has to stay put through it — the
    // guard's real job, and not something a 1/h formula does on its own.
    const { rows } = scheduleFor({ ...stepping, liftHeightM: 6 }, fast)
    const flat = rows.filter((row) => row.pressureKnM2 > 101.9)
    expect(flat.length).toBeGreaterThan(3)
    const gaps = new Set(flat.slice(1).map((row) => row.spacingBelowMm))
    expect(gaps.size).toBe(1)
  })
})

describe('the form the box is actually set to', () => {
  test('forms the concrete at the next increment, not at its own dimension', () => {
    // 337 mm of concrete in a KS Xlife is a 350 mm box.
    expect(scheduleFor({ sideM: 0.337 }).formSizeMm).toBe(350)
  })

  test('sizes the clamp against the form, not the concrete', () => {
    // 590 mm of concrete needs a 600 mm box, which the 150–600 clamp still closes.
    expect(scheduleFor({ sideM: 0.59 }).clamp?.maxSizeMm).toBe(600)
  })

  test('says so when the section is past the form’s reach', () => {
    const schedule = scheduleFor({ sideM: 0.8 })
    expect(schedule.formSizeMm).toBeUndefined()
    expect(schedule.warnings.some((w) => w.kind === 'section-outside-form-range')).toBe(true)
  })

  test('says so when the pour is taller than the form stacks', () => {
    const schedule = clampSchedule({
      liftHeightM: 4,
      sideM: 0.4,
      envelope: dinPressure({ consistencyClass: 'F3' }, pour({ pourHeightM: 4 })),
      form: FRAMAX_COLUMN,
    })
    expect(schedule.warnings.some((w) => w.kind === 'height-exceeds-form')).toBe(true)
  })

  test('admits it is only geometry when no form was named', () => {
    const schedule = clampSchedule({
      liftHeightM: 3,
      sideM: 0.4,
      envelope: dinPressure({ consistencyClass: 'F3' }, pour()),
    })
    expect(schedule.clamp).toBeUndefined()
    expect(schedule.warnings.some((w) => w.kind === 'no-clamp-data')).toBe(true)
    expect(schedule.rows.length).toBeGreaterThan(0)
  })
})

describe('counting what gets ordered', () => {
  test('counts a set per row and four clamps per set', () => {
    const schedule = scheduleFor()
    expect(schedule.setCount).toBe(schedule.rows.length)
    expect(schedule.clampCount).toBe(schedule.rows.length * 4)
  })
})

describe('a spacing the job specified', () => {
  test('uses it as given rather than deriving one', () => {
    const { rows } = scheduleFor({ uniformSpacingM: 0.5 })
    for (const row of rows.slice(1, -1)) {
      expect(row.spacingBelowMm).toBeCloseTo(500, 6)
      expect(row.governedBy).toBe('specified')
    }
  })

  test('still reports the overload it causes, and what would fix it', () => {
    const schedule = scheduleFor({ sideM: 0.6, uniformSpacingM: 1.2 }, fast)
    const warning = schedule.warnings.find((w) => w.kind === 'over-capacity-at-base')
    expect(warning).toBeDefined()
    expect(warning?.message).toContain('Leave the spacing unset')
    // And the derived schedule for the same pour does not warn, which is the point of
    // the comparison the message invites.
    expect(
      scheduleFor({ sideM: 0.6 }, fast).warnings.some((w) => w.kind === 'over-capacity-at-base'),
    ).toBe(false)
  })

  test('reports an overload the schedule cannot design its way out of', () => {
    // A 1 m column, 8 m in one lift, SCC at 5 °C rising at 7 m/h. Every input is
    // individually inside its code's scope and together they put 200 kN/m² on the base,
    // where even 100 mm is not tight enough — so the answer is a different pour, not a
    // different schedule.
    const schedule = clampSchedule({
      liftHeightM: 8,
      sideM: 1,
      kickerM: 0.075,
      envelope: dinPressure(
        { selfCompacting: true },
        pour({ riseRateMH: 7, concreteTemperatureC: 5, pourHeightM: 8 }),
      ),
      form: FRAMAX_COLUMN,
    })
    const warning = schedule.warnings.find((w) => w.kind === 'over-capacity-at-base')
    expect(warning).toBeDefined()
    expect(warning?.message).toContain('nothing left to give')
  })
})
