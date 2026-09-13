/**
 * The dedicated notes sheet (A0.1 general notes, multi-column, code-cited),
 * the attic-ventilation calculation that rides in A3.0's right-hand column
 * beside the roof plan, and the energy compliance sheet (EN1.0) — all through
 * the `general-notes` and `energy` viewport kinds (providers/general-notes.ts,
 * providers/energy.ts).
 *
 * A0.1 is a WHOLE SHEET, not a corner of the cover. The cover's notes block
 * (`cover.ts` COVER_GENERAL_NOTES) is the eight-line courtesy version; this is
 * the hundred-note, discipline-by-discipline, section-cited sheet a plan
 * checker actually reads, and it needs the paper.
 *
 * The A3.0 entry is `extend: true`: `generate.ts` already reserves the right
 * third of that sheet (the roof plan viewport is 66 % wide), so the venting
 * table merges into the sheet the roof plan owns instead of claiming a number
 * of its own.
 */
import type { Plan, PlanSetContext } from './context'

export function notesPlans(ctx: PlanSetContext): Plan[] {
  const { frame } = ctx
  const plans: Plan[] = [
    {
      number: 'A0.1',
      title: 'General notes',
      viewports: [
        {
          kind: 'general-notes',
          notesKey: 'general',
          title: 'General notes',
          x: frame.x,
          y: frame.y + 0.4,
          w: frame.w,
          h: frame.h - 0.6,
        },
      ],
    },
  ]

  // The venting calculation is only honest where there is a roof to vent.
  const hasRoof = Object.values(ctx.nodes).some((node) => node?.type === 'roof-segment')
  if (hasRoof) {
    plans.push({
      number: 'A3.0',
      title: 'Roof plan',
      extend: true,
      viewports: [
        {
          kind: 'general-notes',
          notesKey: 'attic-ventilation',
          title: 'Roof venting calculation',
          x: frame.x + frame.w * 0.68,
          y: frame.y + 0.4,
          w: frame.w * 0.32,
          h: frame.h - 0.6,
        },
      ],
    })
  }
  return plans
}

export function energyPlans(ctx: PlanSetContext): Plan[] {
  const { frame } = ctx
  const levelId = ctx.levels[0]?.id
  return [
    {
      number: 'EN1.0',
      title: 'Energy compliance',
      viewports: [
        {
          kind: 'energy',
          title: 'Energy compliance',
          ...(levelId ? { levelId } : {}),
          x: frame.x,
          y: frame.y + 0.4,
          w: frame.w,
          h: frame.h - 0.6,
        },
      ],
    },
  ]
}
