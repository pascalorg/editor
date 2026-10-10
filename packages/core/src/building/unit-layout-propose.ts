import { roomArea, type UnitLayout, type UnitSpace } from './unit-layout'
import { dedupeLayouts, layoutDistance } from './unit-layout-dedupe'
import { generateUnitLayouts, type UnitBrief } from './unit-layout-generate'
import { observeLayout } from './unit-layout-observe'
import {
  candidateToPlan,
  type PlanMask,
  planInteriorPixels,
  registerOutline,
  scoreAgainstPlan,
} from './unit-layout-plan-score'
import { layoutPreviewSvg } from './unit-layout-preview'
import { type UnitRule, verifyUnitLayout } from './unit-layout-verify'

/**
 * The unit interior guesser's funnel: generate, verify, dedupe, order (by the plan score when the
 * unit's plan image is given, else by the code's own concerns), filter with a fast judge, and
 * keep a few finalists that differ. Pure: the host decodes the plan image and supplies the judge
 * (Jev behind a server key). A judge that fails, or none at all, never removes a candidate.
 */

/** The fast judge's answer about one layout: p(the client refuses it outright), its main weakness. */
export type UnitLayoutVerdict = { refuse: number; weakness: string | null }
/** One verdict per request, in order; null where it could not judge. */
export type UnitLayoutJudge = (
  requests: { id: string; client: string; facts: string[] }[],
) => Promise<(UnitLayoutVerdict | null)[]>

export const PROPOSE = {
  draws: 6000,
  finalists: 4,
  /** How many of the ordered layouts the judge sees. */
  judged: 120,
  /** The plan score's full two-sided pass runs on this many, after a one-sided sort. */
  fullyScored: 150,
  /** Keep when 1 − p(refuse) ≥ τ: lower with a plan image, where the plan score ranks. */
  tau: { withPlan: 0.3, withoutPlan: 0.4 },
  /** Finalists differ by at least this share of the unit (layoutDistance). */
  apart: 0.12,
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six']

/** The client the judge stands in for: the program, and what living there should feel like. */
export function unitClientBrief(brief: UnitBrief, area: number, where = 'An apartment') {
  const extras = [
    brief.rooms?.walk_in ? 'a walk-in closet' : null,
    brief.rooms?.pantry ? 'a pantry' : null,
    brief.rooms?.laundry ? 'a laundry' : null,
  ].filter(Boolean)
  return (
    `${where}: a ${Math.round(area)} m² apartment with ${WORDS[brief.bedrooms] ?? brief.bedrooms} bedrooms and ` +
    `${WORDS[brief.bathrooms] ?? brief.bathrooms} bathrooms${extras.length ? `, ${extras.join(' and ')}` : ''}. ` +
    'Would I want to live here? Daylight where I spend my days and in the bedrooms, a real ' +
    'arrival at the front door, bedrooms kept private from the living room, rooms my furniture ' +
    'fits in, and little floor lost to corridors.'
  )
}

export type ProposeOptions = {
  brief: UnitBrief
  /** The client the judge stands in for (the program and how living there should feel). */
  client?: string
  seed?: number
  draws?: number
  finalists?: number
  /** The unit's plan image, decoded (`planMask`); its outline registers it. */
  plan?: PlanMask
  judge?: UnitLayoutJudge
  tau?: number
}

export type UnitLayoutProposal = {
  id: string
  layout: UnitLayout
  rooms: { id: string; type: string; area: number }[]
  observations: string[]
  /** The judge's main weakness, else the code's first concern. */
  weakness: string | null
  /** 1 − p(refuse), when judged. */
  keep: number | null
  planScore: number | null
  concerns: number
  previewSvg: string
}

type Planned = {
  ordered: UnitLayout[]
  ordering: 'plan score' | 'concerns'
  registration: { orientation: string; residualPx: number } | null
  stats: {
    drawn: number
    valid: number
    distinct: number
    /** How many draws each rule rejected: a draw counts once per rule it failed. */
    rejectedBy: Partial<Record<UnitRule, number>>
  }
  planScores: Map<string, number>
}

/** Generate, verify, dedupe, order. Refuses an outline or a brief it cannot lay out. */
export function planUnitLayouts(space: UnitSpace, options: ProposeOptions): Planned {
  const drawn = generateUnitLayouts(space, options.brief, {
    seed: options.seed ?? 1,
    count: options.draws ?? PROPOSE.draws,
  })
  const margins = new Map<string, number>()
  const rejectedBy: Partial<Record<UnitRule, number>> = {}
  const valid = drawn.filter((layout) => {
    const verdict = verifyUnitLayout(space, layout)
    margins.set(layout.id, verdict.margin)
    if (!verdict.ok)
      for (const rule of new Set(verdict.rules.flatMap((r) => (r.margin < 0 ? [r.rule] : []))))
        rejectedBy[rule] = (rejectedBy[rule] ?? 0) + 1
    return verdict.ok
  })
  valid.sort((p, q) => margins.get(q.id)! - margins.get(p.id)!)
  const distinct = dedupeLayouts(valid, space)
  const stats = { drawn: drawn.length, valid: valid.length, distinct: distinct.length, rejectedBy }
  const planScores = new Map<string, number>()
  if (options.plan) {
    const mask = options.plan
    const registration = registerOutline(space.outline, mask)
    const rough = new Map(distinct.map((l) => [l.id, candidateToPlan(l, mask, registration)]))
    const byRough = [...distinct].sort((p, q) => rough.get(p.id)! - rough.get(q.id)!)
    const interior = planInteriorPixels(mask, space.outline, registration.frame, registration.scale)
    for (const layout of byRough.slice(0, PROPOSE.fullyScored))
      planScores.set(
        layout.id,
        scoreAgainstPlan(layout, space.outline, mask, registration, interior).score,
      )
    const ordered = [
      ...byRough
        .slice(0, PROPOSE.fullyScored)
        .sort((p, q) => planScores.get(p.id)! - planScores.get(q.id)!),
      ...byRough.slice(PROPOSE.fullyScored),
    ]
    return {
      ordered,
      ordering: 'plan score',
      registration: {
        orientation: registration.orientation,
        residualPx: Math.round(registration.residual * 10) / 10,
      },
      stats,
      planScores,
    }
  }
  // A dark bedroom outweighs any count of other concerns: it is the rule the plan image may
  // overrule, and without the image nothing should.
  const weighed = new Map(
    distinct.map((l) => {
      const concerns = observeLayout(l, space).filter((o) => o.level === 'concern')
      return [
        l.id,
        { dark: concerns.filter((o) => o.key === 'bedroom_dark').length, all: concerns.length },
      ]
    }),
  )
  const ordered = [...distinct].sort((p, q) => {
    const a = weighed.get(p.id)!
    const b = weighed.get(q.id)!
    return a.dark - b.dark || a.all - b.all || margins.get(q.id)! - margins.get(p.id)!
  })
  return { ordered, ordering: 'concerns', registration: null, stats, planScores }
}

/** Filter by the verdicts (missing ones keep the layout), then pick finalists that differ. */
export function finishUnitLayouts(
  space: UnitSpace,
  planned: Planned,
  verdicts: ReadonlyMap<string, UnitLayoutVerdict | null>,
  options: ProposeOptions,
) {
  const tau = options.tau ?? (options.plan ? PROPOSE.tau.withPlan : PROPOSE.tau.withoutPlan)
  const pool = planned.ordered.slice(0, PROPOSE.judged)
  const kept = pool.filter((l) => {
    const v = verdicts.get(l.id)
    return !v || 1 - v.refuse >= tau
  })
  const finalists: UnitLayout[] = []
  for (const layout of kept) {
    if (finalists.length >= (options.finalists ?? PROPOSE.finalists)) break
    if (finalists.every((f) => layoutDistance(f, layout, space) >= PROPOSE.apart))
      finalists.push(layout)
  }
  const proposals: UnitLayoutProposal[] = finalists.map((layout) => {
    const facts = observeLayout(layout, space)
    const verdict = verdicts.get(layout.id) ?? null
    const firstConcern = facts.find((o) => o.level === 'concern')
    return {
      id: layout.id,
      layout,
      rooms: layout.rooms.map((r) => ({
        id: r.id,
        type: r.type,
        area: Math.round(roomArea(r) * 10) / 10,
      })),
      observations: facts.map((o) => o.text),
      weakness: verdict?.weakness ?? firstConcern?.key ?? null,
      keep: verdict ? Math.round((1 - verdict.refuse) * 100) / 100 : null,
      planScore: planned.planScores.has(layout.id)
        ? Math.round(planned.planScores.get(layout.id)! * 1000) / 1000
        : null,
      concerns: facts.filter((o) => o.level === 'concern').length,
      previewSvg: layoutPreviewSvg(layout, space),
    }
  })
  const judged = pool.filter((l) => verdicts.get(l.id)).length
  return {
    finalists: proposals,
    ordering: planned.ordering,
    registration: planned.registration,
    stats: {
      ...planned.stats,
      judged,
      unjudged: pool.length - judged,
      kept: kept.length,
      tau,
    },
  }
}

export type ProposeResult = ReturnType<typeof finishUnitLayouts>

/** The whole funnel, with the host's judge when there is one. */
export async function proposeUnitLayouts(
  space: UnitSpace,
  options: ProposeOptions,
): Promise<ProposeResult> {
  const planned = planUnitLayouts(space, options)
  const verdicts = new Map<string, UnitLayoutVerdict | null>()
  if (options.judge) {
    const pool = planned.ordered.slice(0, PROPOSE.judged)
    const client = options.client ?? ''
    let answers: (UnitLayoutVerdict | null)[] = []
    try {
      answers = await options.judge(
        pool.map((l) => ({ id: l.id, client, facts: observeLayout(l, space).map((o) => o.text) })),
      )
    } catch {
      answers = []
    }
    pool.forEach((l, i) => {
      verdicts.set(l.id, answers[i] ?? null)
    })
  }
  return finishUnitLayouts(space, planned, verdicts, options)
}
