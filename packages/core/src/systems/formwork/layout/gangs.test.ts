import { describe, expect, it } from 'bun:test'
import { DOKA_FRAMAX_XLIFE, type FillerType, type FormworkSystem, PERI_TRIO } from '../catalog'
import { layOutFace } from './courses'
import {
  formworkGangCaveats,
  type Gang,
  gangFace,
  gangPickWeightKg,
  IDEAL_PICK_FRACTION,
} from './gangs'
import { stackCourses } from './stack'
import { packStrip } from './strip-pack'
import type { CourseLayout } from './tie-grid'

/**
 * A gang is a claim about what leaves the ground in one pick, so these tests are about
 * the three things that makes true: it can only break where every course breaks, its
 * weight is refused rather than estimated, and the hook goes where the frame is.
 */

/** A face packed the way `layOutFace` does, which is the input every caller has. */
function face(system: FormworkSystem, runMm: number, liftMm: number): CourseLayout[] {
  return layOutFace(system, { runMm, liftHeightMm: liftMm, kickerMm: 100 }).courses
}

/** One course of a stated height, for the cases where the stack is not the point. */
function oneCourse(system: FormworkSystem, runMm: number, heightMm: number): CourseLayout[] {
  const stack = stackCourses(system, heightMm, { kickerMm: 0, minFreeboardMm: 0 })
  return stack.courses.map((course) => ({
    course,
    pack: packStrip(system, runMm, { heightMm: course.panelHeightMm }),
  }))
}

function totalWeightOf(courses: CourseLayout[]): number {
  return courses.reduce(
    (sum, { pack }) =>
      sum +
      pack.pieces.reduce(
        (held, piece) =>
          held +
          (piece.kind === 'panel'
            ? piece.panel.weightKg
            : piece.kind === 'filler'
              ? piece.filler.weightKg
              : 0),
        0,
      ),
    0,
  )
}

describe('a face with no crane stated comes back as one pick', () => {
  it('does not invent a division nobody asked for', () => {
    const gangs = gangFace(face(DOKA_FRAMAX_XLIFE, 5400, 2600))
    expect(gangs.gangs).toHaveLength(1)
    expect(gangs.gangs[0]?.fromMm).toBe(0)
    expect(gangs.gangs[0]?.toMm).toBe(5400)
    expect(gangs.gangs[0]?.endedBy).toBe('run-end')
  })

  it('says so, because one gang is what the layout allows and not what the site can lift', () => {
    const gangs = gangFace(face(DOKA_FRAMAX_XLIFE, 5400, 2600))
    const caveats = formworkGangCaveats(gangs)
    expect(caveats.some((line) => line.includes('No crane capacity'))).toBe(true)
  })

  it('covers the whole run across the gangs, whatever the division', () => {
    for (const runMm of [2700, 4050, 5400, 8100, 10_800]) {
      const courses = face(DOKA_FRAMAX_XLIFE, runMm, 2600)
      const gangs = gangFace(courses, { maxPickWeightKg: 600 })
      const covered = gangs.gangs.reduce((sum, gang) => sum + gang.widthMm, 0)
      expect(covered).toBe(runMm)
      // And every piece of every course lands in exactly one gang.
      const placed = gangs.gangs.reduce((sum, gang) => sum + gang.pieces.length, 0)
      const total = courses.reduce((sum, { pack }) => sum + pack.pieces.length, 0)
      expect(placed).toBe(total)
    }
  })
})

describe('a gang breaks only where every course breaks', () => {
  it('takes the intersection of the courses joints, not one course own', () => {
    // Two courses of aligned joints: the stations are shared by construction, so they
    // are all available as gang boundaries.
    const courses = face(DOKA_FRAMAX_XLIFE, 8100, 5300)
    expect(courses.length).toBeGreaterThan(1)
    const gangs = gangFace(courses)
    const base = courses[0]?.pack.pieces.slice(1).map((piece) => Math.round(piece.fromMm)) ?? []
    expect(gangs.breakStationsMm).toEqual(base)
  })

  it('offers no boundary at all inside a single panel', () => {
    const gangs = gangFace(oneCourse(DOKA_FRAMAX_XLIFE, 2700, 2700))
    expect(gangs.breakStationsMm).toEqual([])
    expect(gangs.gangs).toHaveLength(1)
  })

  it('splits at a joint the courses share once a crane is stated', () => {
    const courses = face(DOKA_FRAMAX_XLIFE, 8100, 2600)
    const one = gangFace(courses)
    const pick = one.gangs[0]?.pickWeightKg as number
    expect(pick).toBeGreaterThan(0)
    // Half the face's own weight forces at least one break, and the break has to be a
    // station the pack already holds.
    const split = gangFace(courses, { maxPickWeightKg: pick / 2 })
    expect(split.gangs.length).toBeGreaterThan(1)
    for (const gang of split.gangs.slice(1)) {
      expect(
        one.gangs[0]?.pieces.some(({ piece }) => Math.round(piece.fromMm) === gang.fromMm),
      ).toBe(true)
    }
  })

  it('reports the gang that cannot be split rather than cutting a panel in half', () => {
    // One 2.70 m panel: nothing inside it is a joint, so a capacity below its weight is
    // a layout to redo and this says which.
    const courses = oneCourse(DOKA_FRAMAX_XLIFE, 2700, 2700)
    const gangs = gangFace(courses, { maxPickWeightKg: 10 })
    expect(gangs.gangs).toHaveLength(1)
    expect(gangs.gangs[0]?.overLimit).toBe(true)
    const warning = gangs.warnings.find((entry) => entry.kind === 'over-pick-weight')
    expect(warning?.allowed).toBe(10)
    expect(warning?.message).toContain('no joint line inside it')
    expect(
      formworkGangCaveats(gangs, { maxPickWeightKg: 10 }).some((line) => line.includes('re-laid')),
    ).toBe(true)
  })

  it('closes a gang on width where the width bites before the weight', () => {
    const courses = face(DOKA_FRAMAX_XLIFE, 8100, 2600)
    const gangs = gangFace(courses, { maxWidthMm: 4000 })
    expect(gangs.gangs.length).toBeGreaterThan(1)
    for (const gang of gangs.gangs) expect(gang.widthMm).toBeLessThanOrEqual(4000)
    expect(gangs.gangs[0]?.endedBy).toBe('max-width')
  })

  it('takes each gang as far as the limit allows, so the picks are as few as possible', () => {
    const courses = face(DOKA_FRAMAX_XLIFE, 8100, 2600)
    const gangs = gangFace(courses, { maxWidthMm: 4000 })
    // Adding the next segment to the first gang would break 4000; not adding it would
    // have been a waste of a pick.
    const first = gangs.gangs[0]
    const second = gangs.gangs[1]
    expect((first?.widthMm ?? 0) + (second?.pieces[0]?.piece.widthMm ?? 0)).toBeGreaterThan(4000)
  })
})

describe('a pick weight is the parts own, or there is none', () => {
  it('sums the catalog weights of every piece in the gang', () => {
    const courses = face(DOKA_FRAMAX_XLIFE, 5400, 2600)
    const gangs = gangFace(courses)
    expect(gangs.gangs[0]?.pickWeightKg).toBeCloseTo(totalWeightOf(courses), 1)
    expect(gangs.totalWeightKg).toBeCloseTo(totalWeightOf(courses), 1)
  })

  it('refuses a total where a piece has no stated weight, following the BOM', () => {
    // 4225 mm on Framax is 25 mm off every width in the system, so it comes back with a
    // board somebody cuts — and nothing in the catalog says what that board weighs.
    const courses = oneCourse(DOKA_FRAMAX_XLIFE, 4225, 2700)
    const gangs = gangFace(courses)
    expect(gangs.gangs[0]?.pickWeightKg).toBeUndefined()
    expect(gangs.totalWeightKg).toBeUndefined()
    expect(gangs.heaviestPickKg).toBeUndefined()
    const warning = gangs.warnings.find((entry) => entry.kind === 'weight-not-stated')
    expect(warning?.message).toContain('floor rather than a figure')
    expect(gangs.gangs[0]?.unweighed.length).toBeGreaterThan(0)
  })

  it('names the heaviest single pick, which is what a crane is chosen against', () => {
    const courses = face(DOKA_FRAMAX_XLIFE, 8100, 2600)
    const gangs = gangFace(courses, { maxWidthMm: 4000 })
    const heaviest = Math.max(...gangs.gangs.map((gang) => gang.pickWeightKg as number))
    expect(gangs.heaviestPickKg).toBe(heaviest)
    expect(gangs.heaviestPickKg).toBeLessThan(gangs.totalWeightKg as number)
  })

  it('keeps every gang inside a stated capacity where the joints allow it', () => {
    const courses = face(PERI_TRIO, 9600, 2600)
    const capacity = 400
    const gangs = gangFace(courses, { maxPickWeightKg: capacity })
    for (const gang of gangs.gangs) {
      if (gang.overLimit) continue
      expect(gang.pickWeightKg as number).toBeLessThanOrEqual(capacity)
    }
  })

  it('adds the steelwork a caller can see and refuses the sum where either half is missing', () => {
    const gangs = gangFace(face(DOKA_FRAMAX_XLIFE, 5400, 2600))
    const gang = gangs.gangs[0] as Gang
    expect(gangPickWeightKg(gang, 180)).toBeCloseTo((gang.pickWeightKg as number) + 180, 1)
    expect(gangPickWeightKg(gang, undefined)).toBeUndefined()
    const unweighed = gangFace(oneCourse(DOKA_FRAMAX_XLIFE, 4225, 2700)).gangs[0] as Gang
    expect(gangPickWeightKg(unweighed, 180)).toBeUndefined()
    // And says the panel figure is not the hook figure.
    expect(formworkGangCaveats(gangs).some((line) => line.includes('Walers, ties'))).toBe(true)
  })

  it('treats a catalog weight of zero as unstated rather than weightless', () => {
    const system = {
      ...DOKA_FRAMAX_XLIFE,
      panels: DOKA_FRAMAX_XLIFE.panels.map((panel) => ({ ...panel, weightKg: 0 })),
    }
    const gangs = gangFace(oneCourse(system, 2700, 2700))
    expect(gangs.gangs[0]?.pickWeightKg).toBeUndefined()
    expect(gangs.warnings.some((entry) => entry.kind === 'weight-not-stated')).toBe(true)
  })
})

describe('the hook goes where the frame is', () => {
  it('places two points at the balanced position on a plain run', () => {
    const courses = face(DOKA_FRAMAX_XLIFE, 5400, 2600)
    const gang = gangFace(courses).gangs[0]
    const points = gang?.liftingPoints ?? []
    expect(points).toHaveLength(2)
    const inset = 5400 * IDEAL_PICK_FRACTION
    expect(points[0]?.alongMm).toBeCloseTo(inset, 0)
    expect(points[1]?.alongMm).toBeCloseTo(5400 - inset, 0)
    for (const point of points) expect(point.offsetFromIdealMm).toBe(0)
  })

  it('shares the pick between the points, and drops the load where there is no total', () => {
    const weighed = gangFace(face(DOKA_FRAMAX_XLIFE, 5400, 2600)).gangs[0]
    const each = weighed?.liftingPoints.map((point) => point.loadKg as number) ?? []
    expect(each).toHaveLength(2)
    expect(each[0]).toBeCloseTo((weighed?.pickWeightKg as number) / 2, 1)
    const unweighed = gangFace(oneCourse(DOKA_FRAMAX_XLIFE, 4225, 2700)).gangs[0]
    for (const point of unweighed?.liftingPoints ?? []) expect(point.loadKg).toBeUndefined()
  })

  it('bolts to a panel and never to a make-up piece', () => {
    // A run whose balanced positions can land on the mid-run filler.
    for (const runMm of [2900, 4150, 4225, 6100]) {
      const gangs = gangFace(oneCourse(DOKA_FRAMAX_XLIFE, runMm, 2700))
      const gang = gangs.gangs[0]
      const panelIds = new Set(
        gang?.pieces
          .filter(({ piece }) => piece.kind === 'panel')
          .map(({ piece }) => (piece.kind === 'panel' ? piece.panel.id : '')) ?? [],
      )
      for (const point of gang?.liftingPoints ?? []) expect(panelIds.has(point.panelId)).toBe(true)
    }
  })

  it('reports a point it had to move, because the gang then hangs out of level', () => {
    // 1.75 m on Framax packs 1350 + 100 filler + 300, and the far balanced position at
    // 1387 mm lands on that filler. The eye moves to the 300 panel's centre at 1600.
    const courses = oneCourse(DOKA_FRAMAX_XLIFE, 1750, 2700)
    expect(courses[0]?.pack.pieces.map((piece) => piece.kind)).toEqual(['panel', 'filler', 'panel'])
    const gangs = gangFace(courses)
    const points = gangs.gangs[0]?.liftingPoints ?? []
    expect(points[0]?.offsetFromIdealMm).toBe(0)
    expect(points[1]?.offsetFromIdealMm).not.toBe(0)
    expect(points[1]?.alongMm).toBe(1600)
    expect(gangs.warnings.some((entry) => entry.kind === 'lifting-point-moved')).toBe(true)
    expect(
      formworkGangCaveats(gangs).some((line) => line.includes('off the balanced position')),
    ).toBe(true)
  })

  it('puts the eyes at the head of the top course, which is where the gang is slung', () => {
    const courses = face(DOKA_FRAMAX_XLIFE, 5400, 5300)
    const gang = gangFace(courses).gangs[0]
    const top = courses.at(-1)?.course.topMm as number
    for (const point of gang?.liftingPoints ?? []) expect(point.elevationMm).toBe(Math.round(top))
    expect(gang?.courseCount).toBe(courses.length)
    expect(gang?.heightMm).toBeCloseTo(top - (courses[0]?.course.baseMm as number), 6)
  })

  it('asks for headroom under the hook, which the sling angle sets', () => {
    const courses = face(DOKA_FRAMAX_XLIFE, 5400, 2600)
    const steep = gangFace(courses, { slingAngleDeg: 75 }).gangs[0]?.minHookHeightMm as number
    const flat = gangFace(courses, { slingAngleDeg: 45 }).gangs[0]?.minHookHeightMm as number
    // A flatter sling needs *less* height for the same spread; a steeper one needs more.
    expect(steep).toBeGreaterThan(flat)
    expect(flat).toBeGreaterThan(0)
  })

  it('says a gang of make-up pieces has nothing to lift by', () => {
    // A stub too narrow for any panel: one closure plate and no frame anywhere on it.
    // Built by hand because no run the packer is given comes back this way — which is
    // the point, since a hand-set stub is exactly where somebody would reach for a hook.
    const filler = DOKA_FRAMAX_XLIFE.fillers[0] as FillerType
    const gangs = gangFace([
      {
        course: { baseMm: 0, topMm: 2700, heightMm: 2700, panelHeightMm: 2700 },
        pack: {
          pieces: [{ kind: 'filler', fromMm: 0, toMm: 50, widthMm: 50, filler }],
          unfilledMm: 0,
          cost: 1,
          fillerPosition: 'middle',
        },
      },
    ])
    expect(gangs.gangs).toHaveLength(1)
    expect(gangs.gangs[0]?.pickWeightKg).toBe(filler.weightKg)
    expect(gangs.gangs[0]?.liftingPoints).toHaveLength(0)
    expect(gangs.gangs[0]?.minHookHeightMm).toBeUndefined()
    const warning = gangs.warnings.find((entry) => entry.kind === 'no-lifting-panel')
    expect(warning?.message).toContain('hand-set')
  })
})

describe('the empty cases', () => {
  it('returns nothing for a face with no courses', () => {
    const gangs = gangFace([])
    expect(gangs.gangs).toHaveLength(0)
    expect(gangs.breakStationsMm).toHaveLength(0)
    expect(formworkGangCaveats(gangs)).toHaveLength(0)
  })

  it('returns nothing for a run too short to form', () => {
    const gangs = gangFace(oneCourse(PERI_TRIO, 15, 2700))
    expect(gangs.gangs).toHaveLength(0)
  })
})
