/**
 * The MEP sheets: E1.0 electrical and P1.0 plumbing.
 *
 * Both are derived live — see providers/electrical.ts and
 * providers/plumbing.ts. This module only decides what lands where on the
 * paper, and it splits each sheet the way a real trade sheet is split: the
 * drawing takes about two thirds of the field with its legend and schedule in
 * a column beside it, and the CODE NOTES get a column of their own, because
 * twenty cited notes do not fit next to a plan at a readable size. The
 * providers know which part they are drawing from the viewport's `system`
 * ('plan' / 'notes'); an `electrical` viewport with no `system` still draws
 * everything, so a hand-added viewport is never half a sheet.
 *
 * E1.0 REPLACES the generic fallback `generate.ts` plans for that number
 * (merge is by sheet number — plans/context.ts).
 */
import { levelLabel } from '../model'
import { DEFAULT_VIEWPORT_LAYERS } from '../schema'
import type { Plan, PlanSetContext } from './context'

/** The share of the field the drawing takes, with the notes column beside it. */
const PLAN_SHARE = 0.66
/** Room above the field for the sheet's own heading strip. */
const HEADER = 0.4

/** What a trade plan shows of the architecture, and of nothing else. */
const TRADE_LAYERS = {
  ...DEFAULT_VIEWPORT_LAYERS,
  furniture: false,
  mep: false,
  framing: false,
  siteUtilities: false,
  terrain: false,
  roomLabels: true,
  openingMarks: false,
  automaticDimensions: false,
  contextualDimensions: false,
  manualDimensions: false,
  measurements: false,
  structuralGrids: false,
  stairAnnotations: false,
}

export function mepPlans(ctx: PlanSetContext): Plan[] {
  const { frame, gap, planScale, levels } = ctx
  if (levels.length === 0) return []

  const fieldY = frame.y + HEADER
  const fieldH = frame.h - HEADER - 0.2
  const planW = frame.w * PLAN_SHARE - gap / 2
  const notesW = frame.w - planW - gap
  const columnW = planW / levels.length
  const perLevelW = columnW - (levels.length > 1 ? gap : 0)

  const planViewport = (
    kind: 'electrical' | 'plumbing',
    level: { id: string },
    index: number,
    extraLayers: Record<string, boolean>,
  ) => ({
    kind,
    system: 'plan',
    levelId: level.id,
    title: `${kind === 'electrical' ? 'Electrical' : 'Plumbing'} plan — ${levelLabel(level as never)}`,
    scale: planScale,
    layers: { ...TRADE_LAYERS, ...extraLayers },
    x: frame.x + index * columnW,
    y: fieldY,
    w: perLevelW,
    h: fieldH,
  })

  const out: Plan[] = []

  /* ---------------------------------------------------------- E1.0 */

  out.push({
    number: 'E1.0',
    title: 'Electrical plan',
    viewports: [
      ...levels.map((level, index) =>
        planViewport('electrical', level, index, { electrical: true, plumbing: false }),
      ),
      {
        kind: 'electrical',
        system: 'notes',
        levelId: levels[0]?.id,
        title: 'Electrical notes',
        layers: { ...TRADE_LAYERS },
        x: frame.x + planW + gap,
        y: fieldY,
        w: notesW,
        h: fieldH,
      },
    ],
  })

  /* ---------------------------------------------------------- P1.0 */

  // The fixture SCHEDULE stays on the plumbing sheet: the marks the plan
  // bubbles print are that schedule's marks, so the two have to be readable
  // side by side. Notes take the top of the right column, the schedule the
  // bottom of it.
  const scheduleH = Math.max(2.4, fieldH * 0.42)
  out.push({
    number: 'P1.0',
    title: 'Plumbing plan',
    viewports: [
      ...levels.map((level, index) =>
        planViewport('plumbing', level, index, { plumbing: true, electrical: false }),
      ),
      {
        kind: 'plumbing',
        system: 'notes',
        levelId: levels[0]?.id,
        title: 'Plumbing notes',
        layers: { ...TRADE_LAYERS },
        x: frame.x + planW + gap,
        y: fieldY,
        w: notesW,
        h: Math.max(1.5, fieldH - scheduleH - gap),
      },
      {
        kind: 'schedule',
        scheduleOf: 'fixtures',
        levelId: levels[0]?.id,
        title: 'Fixture schedule',
        x: frame.x + planW + gap,
        y: fieldY + fieldH - scheduleH,
        w: notesW,
        h: scheduleH,
      },
    ],
  })

  return out
}
