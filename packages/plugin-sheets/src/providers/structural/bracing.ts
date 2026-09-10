/**
 * S4.0 — BRACED WALL PLAN (IRC R602.10), from Bones' wall-bracing engine
 * (`packages/plugin-bones/src/engines/wall-bracing.ts`).
 *
 * The engine is deliberately modest: it IDENTIFIES braced wall lines from the
 * exterior wall graph and DECLARES the method (CS-WSP — continuous sheathing,
 * which is what the wall layer engine actually builds), and it says out loud
 * that the required panel length and spacing of R602.10.3 / Table R602.10.5
 * are not verified from geometry. This sheet prints exactly that and no more:
 * lines, method, hold-downs where the foundation placed them, and the
 * unverified-panel caveat on every row.
 *
 * A house whose exterior walls are masonry (the Florida default) has NO
 * R602.10 braced wall lines at all — R602.10 is the wood-frame method — and
 * the sheet is omitted rather than invented. `hasBracedWallLines` is what the
 * plan-set module asks before creating S4.0.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import {
  type BracedWallLine,
  identifyBracedWallLines,
} from '../../../../plugin-bones/src/engines/wall-bracing'
import type { ScheduleTable } from '../../schedule'
import { diagonalHatch, INK, INK_FAINT, INK_MID, line, PEN, type Pen, polygon, square, TYPE, text } from './draw'
import {
  formatFtIn,
  type Member,
  memberPlanCentre,
  membersOf,
  type Pt,
  type StructuralModel,
  toFeet,
} from './model'
import type { LegendEntry, Note } from './plate'

/** Walls the wood-bracing method actually applies to: the ones Bones STUDDED. */
function framedWalls(model: StructuralModel) {
  const framedIds = new Set(
    model.members
      .filter(
        (m) =>
          m.system === 'wall-framing' &&
          (m.role === 'stud' || m.role === 'king-stud' || m.role === 'trimmer'),
      )
      .map((m) => m.sourceId),
  )
  return model.walls.filter((w) => framedIds.has(w.id))
}

export function bracedWallLines(model: StructuralModel): BracedWallLine[] {
  return identifyBracedWallLines(framedWalls(model))
}

export function hasBracedWallLines(model: StructuralModel): boolean {
  return bracedWallLines(model).length > 0
}

/** IRC Table R602.10.5: a continuous-sheathing (CS-WSP) braced wall panel on an 8 ft wall is at least this long. */
const FULL_PANEL_M = 48 * 0.0254
/** The shortest segment the method credits at all — beside a low opening, per the table's adjacent-opening rule (verify). */
const MIN_PANEL_M = 24 * 0.0254

export type BracedPanel = {
  wallId: string
  /** Plan ends of the sheathed segment, level-local metres. */
  a: Pt
  b: Pt
  /** Wall thickness (the panel is drawn between the wall's faces). */
  thickness: number
  /** Unit direction a→b. */
  dir: Pt
  length: number
  /** At least the table's full length (48 in on an 8 ft wall). */
  full: boolean
}

/**
 * The braced wall panels along each line: every FULL-HEIGHT sheathed
 * segment between the wall's openings — a door or a window breaks the
 * sheathing — at least 24 in long, marked full at 48 in and more (Table
 * R602.10.5, CS-WSP, 8 ft walls). The wall's openings are the model's rough
 * openings, centred at `u` along the wall.
 */
export function bracedWallPanels(model: StructuralModel, lines: readonly BracedWallLine[]): Map<string, BracedPanel[]> {
  const out = new Map<string, BracedPanel[]>()
  for (const bwl of lines) {
    const panels: BracedPanel[] = []
    for (const id of bwl.wallIds) {
      const wall = model.walls.find((w) => w.id === id)
      if (!wall || wall.length <= 0) continue
      const gaps = wall.openings
        .map((o) => [Math.max(0, o.u - o.roughWidth / 2), Math.min(wall.length, o.u + o.roughWidth / 2)] as [number, number])
        .sort((p, q) => p[0] - q[0])
      const segments: [number, number][] = []
      let u = 0
      for (const [g0, g1] of gaps) {
        if (g0 > u) segments.push([u, g0])
        u = Math.max(u, g1)
      }
      if (u < wall.length) segments.push([u, wall.length])
      const at = (t: number): Pt => [wall.start[0] + wall.dir[0] * t, wall.start[1] + wall.dir[1] * t]
      for (const [s0, s1] of segments) {
        const length = s1 - s0
        if (length < MIN_PANEL_M) continue
        panels.push({
          wallId: id,
          a: at(s0),
          b: at(s1),
          thickness: wall.thickness,
          dir: [wall.dir[0], wall.dir[1]],
          length,
          full: length >= FULL_PANEL_M - 1e-6,
        })
      }
    }
    out.set(bwl.label, panels)
  }
  return out
}

/** The full-credit panel length on a line, metres. */
export function providedBracing(panels: readonly BracedPanel[]): number {
  return panels.filter((p) => p.full).reduce((sum, p) => sum + p.length, 0)
}

/**
 * IRC R602.10.1.3: braced wall lines run no more than 60 ft apart — 25 ft
 * in Seismic Design Category D0, D1 and D2 (35 ft with the section's
 * exception, which this drawing does not take).
 */
function maxLineSpacingM(sdc: string | null): number {
  return /^D/i.test(sdc ?? '') ? 25 * 0.3048 : 60 * 0.3048
}

export function bracingPrimitives(
  model: StructuralModel,
  p: Pen,
): { primitives: FloorplanGeometry[]; legend: LegendEntry[]; warnings: string[] } {
  const out: FloorplanGeometry[] = []
  const legend: LegendEntry[] = []
  const warnings: string[] = []
  const lines = bracedWallLines(model)

  for (const fp of model.footprints) {
    out.push(
      polygon(fp.loop, {
        fill: '#f2f3f5',
        stroke: fp.exterior ? INK_MID : INK_FAINT,
        strokeWidth: p.w(fp.exterior ? PEN.light : PEN.hair),
      }),
    )
  }

  if (lines.length === 0) {
    return {
      primitives: out,
      legend,
      warnings: [
        'No IRC R602.10 braced wall lines on this level — no wood-framed exterior walls were derived. Masonry walls brace as reinforced masonry (R606); verify the shear design separately.',
      ],
    }
  }

  const b = model.bounds
  const dashDot = p.dash(0.34, 0.07, 0.05, 0.07)
  const bracedIds = new Set(lines.flatMap((l) => l.wallIds))

  // Highlight the walls that make up each line, then run the line itself
  // across the building at the line's own perpendicular offset.
  for (const fp of model.footprints) {
    if (!bracedIds.has(fp.id)) continue
    out.push(polygon(fp.loop, { fill: 'none', stroke: INK, strokeWidth: p.w(PEN.heavy) }))
  }

  const margin = Math.max(0.6, (b.maxX - b.minX) * 0.05)
  const panelsByLine = bracedWallPanels(model, lines)
  const centre: Pt = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]
  // the panels themselves: hatched between the wall's faces, each with its
  // length outside the wall; a short one (24–48 in) reads lighter and says so
  let fullCount = 0
  let shortCount = 0
  for (const panels of panelsByLine.values()) {
    for (const panel of panels) {
      const n: Pt = [-panel.dir[1], panel.dir[0]]
      const h = panel.thickness / 2
      const rect: Pt[] = [
        [panel.a[0] + n[0] * h, panel.a[1] + n[1] * h],
        [panel.b[0] + n[0] * h, panel.b[1] + n[1] * h],
        [panel.b[0] - n[0] * h, panel.b[1] - n[1] * h],
        [panel.a[0] - n[0] * h, panel.a[1] - n[1] * h],
      ]
      out.push(polygon(rect, { fill: panel.full ? '#cbd5e1' : '#e5e7eb', stroke: INK, strokeWidth: p.w(PEN.light) }))
      out.push(...diagonalHatch(rect, p.w(0.05), { stroke: panel.full ? INK : INK_MID, strokeWidth: p.w(PEN.hair) }))
      // the length, outside the house: the side of the wall away from the plan's centre
      const mid: Pt = [(panel.a[0] + panel.b[0]) / 2, (panel.a[1] + panel.b[1]) / 2]
      const outward = (mid[0] - centre[0]) * n[0] + (mid[1] - centre[1]) * n[1] >= 0 ? 1 : -1
      const off = h + p.w(0.12)
      out.push(
        text([mid[0] + n[0] * outward * off, mid[1] + n[1] * outward * off], `${formatFtIn(panel.length)}${panel.full ? '' : '*'}`, p.w(TYPE.micro), {
          weight: 600,
          anchor: 'middle',
          fill: panel.full ? INK : INK_MID,
        }),
      )
      if (panel.full) fullCount++
      else shortCount++
    }
  }
  if (fullCount > 0) {
    legend.push({
      label: 'BRACED WALL PANEL — CS-WSP, FULL HEIGHT, ≥ 48"',
      symbol: { kind: 'hatch' },
      note: `${fullCount} shown; lengths tallied in the schedule.`,
    })
  }
  if (shortCount > 0) {
    legend.push({
      label: 'SHORT PANEL* (24"–48") — CREDIT PER TABLE R602.10.5 ONLY BESIDE A LOW OPENING',
      symbol: { kind: 'hatch' },
      note: `${shortCount} shown, not counted as provided — verify.`,
    })
  }
  // the spacing between parallel lines, dimensioned beyond the house, and
  // the code's limit on it (SDC D: 25 ft — a long house needs an interior line)
  const limit = maxLineSpacingM(model.design.sdc)
  for (const axis of ['x', 'z'] as const) {
    const sorted = lines.filter((l) => l.axis === axis).sort((l, m) => l.offset - m.offset)
    for (let i = 1; i < sorted.length; i++) {
      const lo = sorted[i - 1] as BracedWallLine
      const hi = sorted[i] as BracedWallLine
      const gap = hi.offset - lo.offset
      if (gap < 0.3) continue
      const stand = margin * 1.6
      const start: Pt = axis === 'x' ? [b.maxX + stand, lo.offset] : [lo.offset, b.maxY + stand]
      const end: Pt = axis === 'x' ? [b.maxX + stand, hi.offset] : [hi.offset, b.maxY + stand]
      out.push({
        kind: 'dimension',
        start,
        end,
        offsetNormal: axis === 'x' ? [1, 0] : [0, 1],
        offsetDistance: 0,
        extensionOvershoot: p.w(0.08),
        stroke: INK_MID,
        terminator: 'architectural-tick',
        text: `${formatFtIn(gap)} BWL SPACING`,
      } as FloorplanGeometry)
      if (gap > limit + 1e-6) {
        warnings.push(
          `Braced wall lines ${lo.label} and ${hi.label} are ${toFeet(gap).toFixed(1)} ft apart — R602.10.1.3 limits the spacing to ${Math.round(toFeet(limit))} ft${/^D/i.test(model.design.sdc ?? '') ? ` in SDC ${model.design.sdc}` : ''}; an interior braced wall line is needed between them (the engine derives exterior lines only).`,
        )
      }
    }
  }
  for (const bwl of lines) {
    const a: Pt = bwl.axis === 'x' ? [b.minX - margin, bwl.offset] : [bwl.offset, b.minY - margin]
    const z: Pt = bwl.axis === 'x' ? [b.maxX + margin, bwl.offset] : [bwl.offset, b.maxY + margin]
    out.push(
      line(a, z, {
        stroke: INK,
        strokeWidth: p.w(PEN.medium),
        strokeDasharray: dashDot,
      }),
    )
    const labelAt: Pt = bwl.axis === 'x' ? [a[0], a[1] - p.w(0.07)] : [z[0], z[1] + p.w(0.18)]
    out.push(
      text(labelAt, `BWL ${bwl.label}`, p.w(TYPE.body), {
        weight: 800,
        anchor: bwl.axis === 'x' ? 'start' : 'middle',
      }),
    )
  }
  legend.push({
    label: 'BRACED WALL LINE (BWL)',
    symbol: { kind: 'line', width: 0.014, dash: '0.34 0.07 0.05 0.07' },
    note: `Method ${model.spec.wallBracingMethod} — continuous sheathing.`,
  })
  legend.push({
    label: 'WALL ON A BRACED WALL LINE',
    symbol: { kind: 'line', width: 0.024 },
  })

  const holdDowns = membersOf(model, 'foundation', 'hold-down')
  for (const hd of holdDowns) {
    out.push(square(memberPlanCentre(hd), p.w(0.055), { fill: INK, stroke: 'none' }))
  }
  if (holdDowns.length > 0) {
    legend.push({
      label: 'HOLD-DOWN AT BRACED WALL END',
      symbol: { kind: 'square' },
      note: `${holdDowns.length} shown — see the anchorage schedule on S1.0.`,
    })
  } else {
    warnings.push(
      'No hold-downs derived on this level — this jurisdiction does not trigger the seismic hold-down set. Verify the R602.10 braced-wall-panel anchorage.',
    )
  }

  warnings.push(
    `${model.spec.wallBracingMethod} continuous sheathing assumed on every braced wall line — the panels shown are the full-height segments between openings; the REQUIRED length per line (Table R602.10.3(1) wind / (3) seismic${model.design.sdc ? `, SDC ${model.design.sdc}` : ''}) is not computed — verify against the PROVIDED column.`,
  )
  for (const flag of new Set(
    holdDowns.map((m: Member) => m.flag).filter((f): f is string => Boolean(f)),
  )) {
    warnings.push(flag)
  }
  return { primitives: out, legend, warnings }
}

export function bracingScheduleTable(model: StructuralModel): ScheduleTable {
  const lines = bracedWallLines(model)
  const panelsByLine = bracedWallPanels(model, lines)
  // Terse: `drawTable` prints an issue on one unwrapped line. The full
  // sentences are notes 4 and 5 of the braced wall notes below.
  const required = model.design.sdc
    ? `Table R602.10.3(3), SDC ${model.design.sdc}`
    : 'Table R602.10.3(1) (wind)'
  const issues = [
    `REQUIRED per ${required} is not computed — verify it against PROVIDED.`,
    'Interior lines and the CS-WSP opening-height reduction are outside the engine.',
  ]
  return {
    title: 'Braced wall line schedule',
    columns: [
      { key: 'mark', label: 'LINE', weight: 0.6 },
      { key: 'axis', label: 'AXIS', weight: 0.5 },
      { key: 'method', label: 'METHOD', weight: 0.9 },
      { key: 'length', label: 'LINE LENGTH', weight: 0.9 },
      { key: 'panels', label: 'PANELS', weight: 0.7 },
      { key: 'provided', label: 'PROVIDED', weight: 0.9 },
      { key: 'required', label: 'REQUIRED', weight: 1.4 },
      { key: 'notes', label: 'REMARKS', weight: 2.0 },
    ],
    rows: lines.map((l) => {
      const panels = panelsByLine.get(l.label) ?? []
      const full = panels.filter((p) => p.full)
      const short = panels.length - full.length
      return {
        mark: l.label,
        axis: l.axis.toUpperCase(),
        method: model.spec.wallBracingMethod,
        length: `${toFeet(l.totalLength).toFixed(1)} ft`,
        panels: `${full.length}${short > 0 ? ` (+${short}*)` : ''}`,
        provided: `${toFeet(providedBracing(panels)).toFixed(1)} ft`,
        required: `${required} — verify`,
        notes:
          full.length === 0
            ? 'NO full-height panel ≥ 48" on this line — openings leave none; a portal frame or a longer pier is needed'
            : 'Continuous sheathing per R602.10.4; panels are the full-height segments between openings',
      }
    }),
    issues,
  }
}

export function bracingNotes(model: StructuralModel): Note[] {
  const lines = bracedWallLines(model)
  return [
    {
      text: `Governing code: ${model.profile.residentialCode}.`,
      cite: `Jurisdiction ${model.jurisdiction} — ${model.jurisdictionSource}`,
    },
    {
      text: `Braced wall lines are identified from the exterior wall graph and clustered within the 4 ft offset tolerance. ${lines.length} line${lines.length === 1 ? '' : 's'} on this level.`,
      cite: 'IRC R602.10.1.1',
    },
    {
      text: `Bracing method: ${model.spec.wallBracingMethod} (continuous wood structural panel sheathing on every exterior face). Sheathe and nail per the fastening schedule on SN1.`,
      cite: 'IRC R602.10.4 / Table R602.3(1)',
    },
    {
      text: 'The braced wall panels drawn are the full-height sheathed segments between openings on each line, 48 in and longer counted as PROVIDED; a 24–48 in segment (marked *) takes credit only beside a low opening per the table and is not counted. The REQUIRED amount of bracing per line is NOT computed by this drawing set; the engineer of record shall verify it before submission.',
      cite: '(verify: IRC R602.10.3 / Table R602.10.5)',
    },
    {
      text: 'Portal frames at narrow returns beside wide openings are framed by the wall engine where they apply; their hold-down anchorage must be present in the foundation. Any portal post without a hold-down below it is flagged on the plan.',
      cite: 'IRC R602.10.6.4',
    },
  ]
}
