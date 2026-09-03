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
import { INK, INK_FAINT, INK_MID, line, PEN, type Pen, polygon, square, TYPE, text } from './draw'
import {
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
    `${model.spec.wallBracingMethod} continuous sheathing assumed on every braced wall line — R602.10.3 required bracing amount and Table R602.10.5 panel lengths are NOT verified from geometry.`,
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
  // Terse: `drawTable` prints an issue on one unwrapped line. The full
  // sentences are notes 4 and 5 of the braced wall notes below.
  const issues = [
    'Panel LENGTHS not derived — verify R602.10.3 / Table R602.10.5.',
    'Interior lines and the CS-WSP opening-height reduction are outside the engine.',
  ]
  return {
    title: 'Braced wall line schedule',
    columns: [
      { key: 'mark', label: 'LINE', weight: 0.7 },
      { key: 'axis', label: 'AXIS', weight: 0.6 },
      { key: 'method', label: 'METHOD', weight: 1.0 },
      { key: 'walls', label: 'WALLS', weight: 0.6 },
      { key: 'length', label: 'LENGTH', weight: 0.9 },
      { key: 'offset', label: 'OFFSET', weight: 0.9 },
      { key: 'notes', label: 'REMARKS', weight: 2.6 },
    ],
    rows: lines.map((l) => ({
      mark: l.label,
      axis: l.axis.toUpperCase(),
      method: model.spec.wallBracingMethod,
      walls: String(l.wallIds.length),
      length: `${toFeet(l.totalLength).toFixed(1)} ft`,
      offset: `${toFeet(l.offset).toFixed(1)} ft`,
      notes: 'Continuous sheathing per R602.10.4; panel length not verified',
    })),
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
      text: 'The REQUIRED amount of bracing per line, the minimum braced panel lengths and the panel-length reduction for adjacent clear opening height are NOT computed by this drawing set. The engineer of record shall verify them and mark the panels on this plan before submission.',
      cite: '(verify: IRC R602.10.3 / Table R602.10.5)',
    },
    {
      text: 'Portal frames at narrow returns beside wide openings are framed by the wall engine where they apply; their hold-down anchorage must be present in the foundation. Any portal post without a hold-down below it is flagged on the plan.',
      cite: 'IRC R602.10.6.4',
    },
  ]
}
