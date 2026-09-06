/**
 * The S-series, as sheets.
 *
 *   S5.x  Typical details               six framed details a sheet, from the
 *                                       ground storey's variables
 *   S1.0  Foundation & anchorage plan  plan + footing/anchorage schedules,
 *                                      foundation legend, cited notes
 *   S2.x  Floor framing plan           one per level that HAS a framed floor
 *   S3.0  Roof framing plan            plan + roof beam schedule, notes, legend
 *   S4.0  Braced wall plan             only when IRC R602.10 braced wall lines
 *                                      actually exist (a masonry house has none)
 *   SN1   Structural notes             design criteria, materials, fastening
 *
 * Every sheet is a plan viewport (the left ~66% of the field) beside a column
 * of plates (the right ~34%), which is how the reference sets read: the
 * schedules and the notes that make a number enforceable sit next to the
 * drawing they belong to, never on a sheet of their own.
 *
 * A sheet is only planned when the engines actually produce something for it.
 * `generate.ts` merges these by NUMBER, so S1.0 here REPLACES the generic
 * foundation-plan fallback; numbers this module does not return keep whatever
 * the generator planned.
 */
import { detailsPageCount, hasBracedWallLines, structuralModel } from '../providers/structural'
import { DEFAULT_VIEWPORT_LAYERS } from '../schema'
import type { Plan, PlanSetContext } from './context'

/** Layer set every structural viewport uses: framing on, finishes off. */
const STRUCTURAL_LAYERS = {
  ...DEFAULT_VIEWPORT_LAYERS,
  furniture: false,
  roomLabels: false,
  openingMarks: false,
  mep: false,
  electrical: false,
  plumbing: false,
  siteUtilities: false,
  terrain: false,
  framing: true,
  automaticDimensions: false,
  structuralGrids: true,
}

/** The right-hand plate column, as a fraction of the drawable field. */
const PLATE_FRACTION = 0.34

export function structuralPlans(ctx: PlanSetContext): Plan[] {
  const { frame, gap } = ctx
  const levels = ctx.levels
  const ground = levels[0]
  if (!ground) return []

  const planW = frame.w * (1 - PLATE_FRACTION) - gap
  const plateX = frame.x + planW + gap
  const plateW = frame.w - planW - gap
  const top = frame.y + 0.4
  const fieldH = frame.h - 0.6

  const plans: Plan[] = []

  /* ── S1.0 — foundation ───────────────────────────────────────────── */
  const foundationModel = structuralModel(ctx.nodes, ground.id)
  const scheduleH = fieldH * 0.4
  const legendH = fieldH * 0.2
  plans.push({
    number: 'S1.0',
    title: 'Foundation & anchorage plan',
    viewports: [
      {
        kind: 'structural',
        system: 'foundation',
        levelId: ground.id,
        title: 'Foundation & anchorage plan',
        scale: ctx.planScale,
        layers: { ...STRUCTURAL_LAYERS },
        x: frame.x,
        y: top,
        w: planW,
        h: fieldH,
      },
      {
        kind: 'structural',
        system: 'foundation-schedules',
        levelId: ground.id,
        title: 'Footing & anchorage schedules',
        x: plateX,
        y: top,
        w: plateW,
        h: scheduleH,
      },
      {
        kind: 'structural',
        system: 'foundation-legend',
        levelId: ground.id,
        title: 'Foundation legend',
        scale: ctx.planScale,
        x: plateX,
        y: top + scheduleH + gap,
        w: plateW,
        h: legendH,
      },
      {
        kind: 'structural',
        system: 'foundation-notes',
        levelId: ground.id,
        title: 'General foundation notes',
        x: plateX,
        y: top + scheduleH + legendH + gap * 2,
        w: plateW,
        h: fieldH - scheduleH - legendH - gap * 2,
      },
    ],
  })

  /* ── S2.x — floor framing, only where a framed floor exists ──────── */
  let floorIndex = 0
  for (const level of levels) {
    const model = structuralModel(ctx.nodes, level.id)
    if (!model?.members.some((m) => m.system === 'floor-framing')) continue
    plans.push({
      number: `S2.${floorIndex}`,
      title: `Floor framing plan — ${model.levelLabel}`,
      viewports: [
        {
          kind: 'structural',
          system: 'floor-framing',
          levelId: level.id,
          title: `Floor framing plan — ${model.levelLabel}`,
          scale: ctx.planScale,
          layers: { ...STRUCTURAL_LAYERS },
          x: frame.x,
          y: top,
          w: planW,
          h: fieldH,
        },
        {
          kind: 'structural',
          system: 'floor-schedules',
          levelId: level.id,
          title: 'Floor beam schedule',
          x: plateX,
          y: top,
          w: plateW,
          h: fieldH * 0.4,
        },
        {
          kind: 'structural',
          system: 'floor-notes',
          levelId: level.id,
          title: 'Floor framing notes & legend',
          scale: ctx.planScale,
          x: plateX,
          y: top + fieldH * 0.4 + gap,
          w: plateW,
          h: fieldH * 0.6 - gap,
        },
      ],
    })
    floorIndex += 1
  }

  /* ── S3.0 — roof framing, on the storey that owns the roof ───────── */
  const roofLevel = [...levels]
    .reverse()
    .find((level) =>
      (structuralModel(ctx.nodes, level.id)?.members ?? []).some(
        (m) => m.system === 'roof-framing',
      ),
    )
  const roofModel = roofLevel ? structuralModel(ctx.nodes, roofLevel.id) : null
  if (roofLevel && roofModel) {
    plans.push({
      number: 'S3.0',
      title: 'Roof framing plan',
      viewports: [
        {
          kind: 'structural',
          system: 'roof-framing',
          levelId: roofLevel.id,
          title: `Roof framing plan — ${roofModel.levelLabel}`,
          scale: ctx.planScale,
          layers: { ...STRUCTURAL_LAYERS },
          x: frame.x,
          y: top,
          w: planW,
          h: fieldH,
        },
        {
          kind: 'structural',
          system: 'roof-schedules',
          levelId: roofLevel.id,
          title: 'Roof beam schedule',
          x: plateX,
          y: top,
          w: plateW,
          h: fieldH * 0.36,
        },
        {
          kind: 'structural',
          system: 'roof-notes',
          levelId: roofLevel.id,
          title: 'Roof framing notes & legend',
          scale: ctx.planScale,
          x: plateX,
          y: top + fieldH * 0.36 + gap,
          w: plateW,
          h: fieldH * 0.64 - gap,
        },
      ],
    })
  }

  /* ── S4.0 — braced wall plan, only where R602.10 applies ─────────── */
  const bracedLevel = levels.find((level) => {
    const model = structuralModel(ctx.nodes, level.id)
    return model ? hasBracedWallLines(model) : false
  })
  if (bracedLevel) {
    const model = structuralModel(ctx.nodes, bracedLevel.id)
    plans.push({
      number: 'S4.0',
      title: 'Braced wall plan',
      viewports: [
        {
          kind: 'structural',
          system: 'wall-bracing',
          levelId: bracedLevel.id,
          title: `Braced wall plan — ${model?.levelLabel ?? ''}`,
          scale: ctx.planScale,
          layers: { ...STRUCTURAL_LAYERS },
          x: frame.x,
          y: top,
          w: planW,
          h: fieldH,
        },
        {
          kind: 'structural',
          system: 'bracing-schedules',
          levelId: bracedLevel.id,
          title: 'Braced wall line schedule',
          x: plateX,
          y: top,
          w: plateW,
          h: fieldH,
        },
      ],
    })
  }

  /* ── SN1 — structural notes ──────────────────────────────────────── */
  plans.push({
    number: 'SN1',
    title: 'Structural notes',
    viewports: [
      {
        kind: 'structural',
        system: 'notes',
        levelId: (foundationModel ?? roofModel)?.levelId ?? ground.id,
        title: 'Structural notes',
        x: frame.x,
        y: top,
        w: frame.w,
        h: fieldH,
      },
    ],
  })

  /* ── S5.x — typical details, from the ground storey's framed variables ── */
  if (foundationModel) {
    const pages = detailsPageCount(foundationModel, ctx.nodes)
    for (let page = 1; page <= pages; page++) {
      const title = page > 1 ? `Typical details (${page})` : 'Typical details'
      plans.push({
        number: `S5.${page - 1}`,
        title,
        viewports: [
          {
            kind: 'structural',
            system: page > 1 ? `details-${page}` : 'details',
            levelId: ground.id,
            title,
            x: frame.x,
            y: top,
            w: frame.w,
            h: fieldH,
          },
        ],
      })
    }
  }

  return plans
}
