/**
 * S1.0 — FOUNDATION & ANCHORAGE PLAN, drawn from Bones' foundation engine
 * (`packages/plugin-bones/src/engines/foundation.ts`).
 *
 * What lands on the paper and where it comes from:
 *   slab outline ............ the level's `slab` nodes (the model)
 *   wall footprints ......... `getWallPlanFootprint` + `calculateLevelMiters`
 *   footings / stemwalls .... members `foundation/footing`, `…/stemwall`
 *   anchor bolts ............ members `foundation/anchor-bolt` (R403.1.6)
 *   hold-downs .............. members `foundation/hold-down`
 *   footing reinforcement ... members `foundation/rebar`, by their own labels
 *   slab + vapor retarder ... members `foundation/slab`, `…/vapor-retarder`
 *   every dimension in a note the resolved `FramingSpec` or the member itself
 *
 * Nothing is drawn that the engine did not produce. A CMU jurisdiction (the
 * Florida default) emits NO sole-plate anchor bolts — the anchorage is
 * grouted dowels — and the sheet says exactly that instead of drawing bolts
 * that would not be installed.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import type { ScheduleTable } from '../../schedule'
import {
  callout,
  diagonalHatch,
  dot,
  INK,
  INK_MID,
  INK_SOFT,
  line,
  PEN,
  type Pen,
  polygon,
  square,
  TYPE,
  tag,
} from './draw'
import {
  flagsOf,
  formatFtIn,
  formatIn,
  formatInchFraction,
  type Member,
  memberPlanCentre,
  memberPlanRect,
  membersOf,
  type Pt,
  type StructuralModel,
} from './model'
import type { LegendEntry, Note } from './plate'

/* ------------------------------------------------------- footing types */

export type FootingType = {
  mark: string
  label: string
  /** Plan width of the pour, metres. */
  width: number
  /** Vertical thickness of the pour, metres. */
  thickness: number
  /** Depth of the underside below the top of foundation (y = 0), metres. */
  bottom: number
  reinforcement: string
  members: Member[]
  totalLength: number
  flags: string[]
}

/**
 * Footing members grouped into schedule TYPES by the engine's own label —
 * `Footing 16"×8"`, `Interior thickened footing 16"×12"`, `Pad footing …`.
 * Marks are assigned FT1, FT2 … in a stable order (continuous runs first,
 * then thickened, then pads, alphabetically inside each), so the tag on the
 * plan and the row in the schedule can never drift apart.
 */
export function footingTypes(model: StructuralModel): FootingType[] {
  const footings = membersOf(model, 'foundation', 'footing')
  if (footings.length === 0) return []
  const rebar = membersOf(model, 'foundation', 'rebar')
  const rebarBySource = new Map<string, Set<string>>()
  for (const bar of rebar) {
    const set = rebarBySource.get(bar.sourceId) ?? new Set<string>()
    if (bar.label) set.add(bar.label)
    rebarBySource.set(bar.sourceId, set)
  }

  const groups = new Map<string, Member[]>()
  for (const member of footings) {
    const key = member.label ?? 'Footing'
    groups.set(key, [...(groups.get(key) ?? []), member])
  }
  const rank = (label: string) =>
    /^Footing/.test(label) ? 0 : /Interior thickened/.test(label) ? 1 : /^Pad/.test(label) ? 2 : 3
  const ordered = [...groups.entries()].sort(
    (a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]),
  )
  return ordered.map(([label, members], index) => {
    const first = members[0] as Member
    const width = planWidthOf(first)
    const thickness = first.dims[1]
    const bottom = -(first.position[1] - thickness / 2)
    const bars = new Set<string>()
    for (const member of members) {
      for (const barLabel of rebarBySource.get(member.sourceId) ?? []) {
        if (/footing bar/i.test(barLabel)) bars.add(barLabel)
      }
    }
    return {
      mark: `FT${index + 1}`,
      label,
      width,
      thickness,
      bottom,
      reinforcement:
        bars.size > 0
          ? `(2) #4 CONT. — ${[...bars][0]}`
          : '(verify: IRC R403.1.3 — no reinforcement modelled at this LOD)',
      members,
      totalLength: members.reduce((sum, m) => sum + m.length, 0),
      flags: flagsOf(members),
    }
  })
}

/** The member's plan-projected width (the cross dimension a plan shows). */
function planWidthOf(m: Member): number {
  const rect = memberPlanRect(m)
  const a = rect[0] as Pt
  const b = rect[1] as Pt
  const c = rect[2] as Pt
  const side1 = Math.hypot(b[0] - a[0], b[1] - a[1])
  const side2 = Math.hypot(c[0] - b[0], c[1] - b[1])
  return Math.min(side1, side2)
}

/* --------------------------------------------------------- the drawing */

export function foundationPrimitives(
  model: StructuralModel,
  p: Pen,
): { primitives: FloorplanGeometry[]; legend: LegendEntry[]; warnings: string[] } {
  const out: FloorplanGeometry[] = []
  const legend: LegendEntry[] = []
  const warnings: string[] = []

  const footings = membersOf(model, 'foundation', 'footing')
  const stemwalls = membersOf(model, 'foundation', 'stemwall')
  const bolts = membersOf(model, 'foundation', 'anchor-bolt')
  const holdDowns = membersOf(model, 'foundation', 'hold-down')
  const slabMembers = membersOf(model, 'foundation', 'slab')
  const vapor = membersOf(model, 'foundation', 'vapor-retarder')
  const dowels = membersOf(model, 'foundation', 'rebar').filter((m) => /dowel/i.test(m.label ?? ''))

  // ── background: the walls that bear on all this ─────────────────────
  for (const fp of model.footprints) {
    out.push(
      polygon(fp.loop, {
        fill: fp.exterior ? '#dfe3e8' : '#eef0f2',
        stroke: INK_SOFT,
        strokeWidth: p.w(PEN.thin),
      }),
    )
  }
  if (model.footprints.length > 0) {
    legend.push({
      label: 'WALL ABOVE (BACKGROUND)',
      symbol: { kind: 'line', width: 0.008, color: '#9ca3af' },
      note: 'Bearing walls per the framing plans.',
    })
  }

  // ── slab outline: the heaviest line on the sheet ────────────────────
  for (const slab of model.slabs) {
    out.push(
      polygon(slab.polygon, {
        fill: 'none',
        stroke: INK,
        strokeWidth: p.w(PEN.heavy),
        strokeLinejoin: 'miter',
      }),
    )
    for (const hole of slab.holes) {
      out.push(polygon(hole, { fill: 'none', stroke: INK, strokeWidth: p.w(PEN.medium) }))
    }
  }
  if (model.slabs.length > 0) {
    legend.push({
      label: 'SLAB EDGE',
      symbol: { kind: 'line', width: 0.024 },
      note: 'Top of slab = top of foundation (y = 0).',
    })
  }

  // ── footings: hidden work, therefore DASHED ─────────────────────────
  const types = footingTypes(model)
  const markOf = new Map<Member, string>()
  for (const type of types) {
    for (const member of type.members) markOf.set(member, type.mark)
  }
  const footingDash = p.dash(0.09, 0.05)
  for (const member of footings) {
    out.push(
      polygon(memberPlanRect(member), {
        fill: 'none',
        stroke: INK_MID,
        strokeWidth: p.w(PEN.medium),
        strokeDasharray: footingDash,
      }),
    )
  }
  if (footings.length > 0) {
    legend.push({
      label: '(N) FOOTING — SEE FOOTING SCHEDULE',
      symbol: { kind: 'line', width: 0.014, dash: '0.09 0.05', color: INK_MID },
      note: 'Hidden below slab / grade.',
    })
  }

  // ── stemwalls: a solid pair of faces ────────────────────────────────
  for (const member of stemwalls) {
    out.push(
      polygon(memberPlanRect(member), {
        fill: 'none',
        stroke: INK,
        strokeWidth: p.w(PEN.light),
      }),
    )
  }
  if (stemwalls.length > 0) {
    const first = stemwalls[0] as Member
    legend.push({
      label: `(N) STEMWALL ${formatIn(planWidthOf(first))} — SEE SCHEDULE`,
      symbol: { kind: 'double-line', width: 0.01 },
    })
  }

  // ── anchor bolts and hold-downs ─────────────────────────────────────
  const boltR = p.w(0.028)
  for (const bolt of bolts) out.push(dot(memberPlanCentre(bolt), boltR))
  if (bolts.length > 0) {
    legend.push({
      label: 'ANCHOR BOLT — SEE ANCHORAGE SCHEDULE',
      symbol: { kind: 'dot' },
      note: `${bolts.length} shown.`,
    })
  }
  const hdSide = p.w(0.055)
  for (const hd of holdDowns) {
    out.push(square(memberPlanCentre(hd), hdSide, { fill: INK, stroke: 'none' }))
  }
  if (holdDowns.length > 0) {
    legend.push({
      label: 'HOLD-DOWN — SEE ANCHORAGE SCHEDULE',
      symbol: { kind: 'square' },
      note: `${holdDowns.length} shown.`,
    })
  }
  for (const bar of dowels) {
    const c = memberPlanCentre(bar)
    const r = p.w(0.026)
    out.push(
      {
        kind: 'circle',
        cx: c[0],
        cy: c[1],
        r,
        fill: '#ffffff',
        stroke: INK,
        strokeWidth: p.w(PEN.thin),
      },
      line([c[0] - r, c[1]], [c[0] + r, c[1]], { stroke: INK, strokeWidth: p.w(PEN.thin) }),
      line([c[0], c[1] - r], [c[0], c[1] + r], { stroke: INK, strokeWidth: p.w(PEN.thin) }),
    )
  }
  if (dowels.length > 0) {
    legend.push({
      label: 'VERT. DOWEL — LAPS CMU WALL VERTICAL',
      symbol: { kind: 'circle', text: '+' },
      note: `${dowels.length} shown (R606.12).`,
    })
  }

  // ── footing type tags ───────────────────────────────────────────────
  const tagR = p.w(0.1)
  for (const member of footings) {
    const mark = markOf.get(member)
    if (!mark) continue
    out.push(tag(memberPlanCentre(member), mark, tagR, p, 'hex'))
  }
  if (types.length > 0) {
    legend.push({
      label: 'FOOTING TYPE — SEE FOOTING SCHEDULE',
      symbol: { kind: 'hex', text: 'FT' },
    })
  }

  // ── pad footings get concrete hatch (they read as pours, not runs) ──
  for (const member of footings) {
    if (!/^Pad footing/.test(member.label ?? '')) continue
    const rect = memberPlanRect(member)
    out.push(...diagonalHatch(rect, p.w(0.06), { stroke: INK_MID, strokeWidth: p.w(PEN.hair) }))
  }

  // ── the slab callout ────────────────────────────────────────────────
  const slabNote = slabCallout(model, slabMembers, vapor)
  const anchor = calloutAnchor(model)
  if (anchor && slabNote.length > 0) {
    out.push(
      ...callout(anchor.from, anchor.to, slabNote, p, { anchor: 'start', size: p.w(TYPE.small) }),
    )
  }

  // ── the anchorage callout ───────────────────────────────────────────
  const anchorageNote = anchorageCallout(model, bolts, dowels)
  if (anchor && anchorageNote.length > 0) {
    const from: Pt = [
      anchor.from[0],
      model.bounds.minY + (model.bounds.maxY - model.bounds.minY) * 0.78,
    ]
    const to: Pt = [model.bounds.maxX + p.w(0.5), from[1]]
    out.push(...callout(from, to, anchorageNote, p, { anchor: 'start', size: p.w(TYPE.small) }))
  }

  // ── honesty ─────────────────────────────────────────────────────────
  if (footings.length === 0) {
    warnings.push(
      'Bones produced no footings for this level — foundation is only derived on the ground storey with the Foundation system enabled.',
    )
  }
  if (bolts.length === 0 && dowels.length === 0 && footings.length > 0) {
    warnings.push(
      'No sill anchorage modelled on this level — verify R403.1.6 anchor bolts or the masonry dowel schedule.',
    )
  }
  for (const flag of flagsOf([...footings, ...bolts, ...holdDowns])) warnings.push(flag)
  if (slabMembers.length > 0 && vapor.length === 0) {
    warnings.push('Slab drawn without a vapor retarder — verify IRC R506.2.3.')
  }

  return { primitives: out, legend, warnings }
}

/** Where the big plan callouts hang: off the slab's right edge. */
function calloutAnchor(model: StructuralModel): { from: Pt; to: Pt } | null {
  const b = model.bounds
  if (!Number.isFinite(b.minX) || b.maxX <= b.minX) return null
  const midY = b.minY + (b.maxY - b.minY) * 0.42
  return {
    from: [b.minX + (b.maxX - b.minX) * 0.62, midY],
    to: [b.maxX + (b.maxX - b.minX) * 0.06, midY],
  }
}

/**
 * The slab callout, kept SHORT on purpose.
 *
 * A plan callout is a key into the notes, not the note itself: the viewport
 * window is fitted to the drawing plus its words, so a four-line sentence
 * hung off the building shrinks the plan by a third. The full sentences —
 * base course, reinforcement, the vapor-retarder spec — live in the general
 * foundation notes plate, which wraps and has room for them.
 */
function slabCallout(
  model: StructuralModel,
  slabMembers: readonly Member[],
  vapor: readonly Member[],
): string[] {
  if (slabMembers.length === 0) {
    return model.slabs.length > 0 ? ['SLAB NOT DERIVED', '(verify: IRC R506)'] : []
  }
  const first = slabMembers[0] as Member
  const lines = [`${formatInchFraction(first.dims[1])} CONC. SLAB ON GRADE (IRC R506.1)`]
  if (vapor.length > 0) lines.push('OVER 6-MIL VAPOR RETARDER (R506.2.3)')
  lines.push('REINF. NOT MODELLED (verify R506.2.4)')
  return lines
}

function anchorageCallout(
  model: StructuralModel,
  bolts: readonly Member[],
  dowels: readonly Member[],
): string[] {
  const bolt = bolts[0]
  if (bolt) {
    return [
      `A.B. ${formatInchFraction(bolt.dims[0])} DIA. @ ${formatFtIn(model.spec.anchorBoltSpacing)} O.C. MAX`,
      `${formatIn(model.spec.anchorBoltEndDistance)} MAX FROM PLATE ENDS`,
      '(IRC R403.1.6)',
    ]
  }
  if (dowels.length > 0) {
    return [
      'NO SOLE-PLATE ANCHOR BOLTS',
      'CMU WALLS — DOWELS IN GROUTED CELLS',
      '(IRC R606.12 / R403.1.3.2)',
    ]
  }
  return []
}

/* ---------------------------------------------------------- schedules */

export function footingScheduleTable(model: StructuralModel): ScheduleTable {
  const types = footingTypes(model)
  const issues: string[] = []
  for (const type of types) {
    for (const flag of type.flags) issues.push(`${type.mark}: ${flag}`)
  }
  if (types.length === 0) {
    issues.push('No footings derived for this level — nothing to schedule.')
  }
  return {
    title: 'Footing schedule',
    columns: [
      { key: 'mark', label: 'TYPE', weight: 0.7 },
      { key: 'kind', label: 'DESCRIPTION', weight: 2.1 },
      { key: 'width', label: 'WIDTH', weight: 0.8 },
      { key: 'thickness', label: 'THICK', weight: 0.8 },
      { key: 'bottom', label: 'BOT. BELOW T.O.F.', weight: 1.1 },
      { key: 'reinf', label: 'REINFORCEMENT', weight: 2.0 },
      { key: 'qty', label: 'RUNS / LF', weight: 0.9 },
    ],
    rows: types.map((type) => ({
      mark: type.mark,
      kind: describeFooting(type.label),
      width: formatIn(type.width),
      thickness: formatIn(type.thickness),
      bottom: formatIn(type.bottom),
      reinf: type.reinforcement.replace(/ — .*/, ''),
      qty: `${type.members.length} / ${(type.totalLength / 0.3048).toFixed(0)} lf`,
    })),
    issues,
  }
}

function describeFooting(label: string): string {
  if (/^Footing/.test(label)) return 'CONT. WALL FOOTING'
  if (/Interior thickened/.test(label)) return 'THICKENED SLAB FOOTING (INT. BEARING)'
  if (/^Pad footing/.test(label)) return 'PAD FOOTING AT GIRDER POST'
  return label.toUpperCase()
}

/**
 * The anchorage schedule — the S1.0 pairing of the reference set's SHEARWALL
 * and HOLDOWN schedules, cut down to what Bones actually derives. Bones' wall
 * bracing engine declares a METHOD but does not size panels, so this schedule
 * lists the ANCHORAGE hardware it does place and says plainly that panel
 * sizing is not verified (the shearwall schedule proper needs R602.10.3
 * amount-of-bracing math the engine documents as v2).
 */
export function anchorageScheduleTable(model: StructuralModel): ScheduleTable {
  const bolts = membersOf(model, 'foundation', 'anchor-bolt')
  const washers = membersOf(model, 'foundation', 'plate-washer')
  const holdDowns = membersOf(model, 'foundation', 'hold-down')
  const dowels = membersOf(model, 'foundation', 'rebar').filter((m) => /dowel/i.test(m.label ?? ''))
  const rows: ScheduleTable['rows'] = []
  const issues: string[] = []

  if (bolts.length > 0) {
    const bolt = bolts[0] as Member
    rows.push({
      mark: 'AB',
      item: 'SILL ANCHOR BOLT',
      size: `${formatInchFraction(bolt.dims[0])} DIA.`,
      spacing: `${formatFtIn(model.spec.anchorBoltSpacing)} O.C. MAX`,
      qty: String(bolts.length),
      cite: 'IRC R403.1.6',
      notes: `${formatIn(model.spec.anchorBoltEndDistance)} max from each plate-section end; 7" min. embedment`,
    })
  }
  if (washers.length > 0) {
    const washer = washers[0] as Member
    rows.push({
      mark: 'PW',
      item: 'PLATE WASHER',
      size: `${formatInchFraction(washer.dims[0])} SQ. × ${formatInchFraction(washer.dims[1], 1000)}`,
      spacing: 'EACH ANCHOR BOLT',
      qty: String(washers.length),
      cite: 'IRC R602.11.1',
      notes: washer.label ?? '',
    })
  }
  for (const [i, group] of groupByLabel(holdDowns).entries()) {
    const first = group.members[0] as Member
    rows.push({
      mark: `HD${i + 1}`,
      item: (first.label ?? 'HOLD-DOWN').toUpperCase(),
      size: `${formatIn(first.dims[0])} × ${formatIn(first.dims[1])}`,
      spacing: 'AT BRACED WALL ENDS',
      qty: String(group.members.length),
      cite: 'IRC R602.10 / R403.1.6',
      notes: 'Model and capacity by design — set to the schedule of the connector manufacturer',
    })
  }
  if (dowels.length > 0) {
    const first = dowels[0] as Member
    rows.push({
      mark: 'DW',
      item: 'MASONRY DOWEL',
      size: `${formatInchFraction(first.dims[0])} DIA.`,
      spacing: 'PER GROUTED CELL',
      qty: String(dowels.length),
      cite: 'IRC R606.12',
      notes: first.label ?? '',
    })
  }
  if (rows.length === 0) {
    issues.push('No anchorage hardware derived for this level — verify IRC R403.1.6 by hand.')
  }
  issues.push('Braced-wall panel lengths NOT verified — see IRC R602.10.3 / Table R602.10.5.')
  return {
    title: 'Anchorage schedule',
    columns: [
      { key: 'mark', label: 'MARK', weight: 0.6 },
      { key: 'item', label: 'ITEM', weight: 1.6 },
      { key: 'size', label: 'SIZE', weight: 1.1 },
      { key: 'spacing', label: 'SPACING', weight: 1.2 },
      { key: 'qty', label: 'QTY', weight: 0.5 },
      { key: 'cite', label: 'CODE', weight: 1.1 },
      { key: 'notes', label: 'REMARKS', weight: 2.4 },
    ],
    rows,
    issues,
  }
}

/**
 * The stemwall-reinforcement half of the stemwall note — written from the
 * bars the engine ACTUALLY emitted, never from the spec alone.
 */
function verticalsClause(model: StructuralModel, spec: StructuralModel['spec']): string {
  const verticals = membersOf(model, 'foundation', 'rebar').filter((m) =>
    /stemwall vertical/i.test(m.label ?? ''),
  )
  if (verticals.length > 0) {
    return `, with #4 verticals at ${spec.seismicHoldDowns ? '24"' : '48"'} o.c. and a #4 horizontal at the stemwall top`
  }
  const dowels = membersOf(model, 'foundation', 'rebar').filter((m) => /dowel/i.test(m.label ?? ''))
  if (dowels.length > 0) {
    return '. The vertical steel in this stemwall is the masonry dowel schedule below — no separate stemwall grid is placed'
  }
  return '. Stemwall vertical reinforcement is NOT modelled at this level of detail (verify: IRC R403.1.3.2)'
}

function groupByLabel(members: readonly Member[]): { label: string; members: Member[] }[] {
  const map = new Map<string, Member[]>()
  for (const member of members) {
    const key = member.label ?? member.role
    map.set(key, [...(map.get(key) ?? []), member])
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, list]) => ({ label, members: list }))
}

/* -------------------------------------------------------------- notes */

export function foundationNotes(model: StructuralModel): Note[] {
  const spec = model.spec
  const profile = model.profile
  const climate = model.climate
  const bolts = membersOf(model, 'foundation', 'anchor-bolt')
  const dowels = membersOf(model, 'foundation', 'rebar').filter((m) => /dowel/i.test(m.label ?? ''))
  const slab = membersOf(model, 'foundation', 'slab')[0]
  const vapor = membersOf(model, 'foundation', 'vapor-retarder')[0]
  const washers = membersOf(model, 'foundation', 'plate-washer')

  const notes: Note[] = [
    {
      text: `Governing code: ${profile.residentialCode}. All foundation work shall comply with it and with the local amendments of the authority having jurisdiction.`,
      cite: `Jurisdiction ${model.jurisdiction} — ${model.jurisdictionSource}`,
    },
    {
      text: 'Footings shall bear on firm, undisturbed natural soil or on engineered fill compacted per the geotechnical report. The presumptive load-bearing value of the soil is NOT modelled by this drawing set.',
      cite: '(verify: IRC Table R401.4.1)',
    },
    {
      text: `Bottom of exterior footings at ${formatIn(spec.footingDepth)} below the top of foundation, matching the ${profile.frostLineIn}" frost depth for this jurisdiction${climate?.frostLineNote ? ` — ${climate.frostLineNote}` : ''}`,
      cite: 'IRC R403.1.4 / R403.1.4.1',
    },
    {
      text: `Continuous wall footings ${formatIn(spec.footingWidth)} wide with 2 × #4 continuous bars, 3" clear of the footing bottom. Lap splices, hooks and corner bars are takeoff data and are NOT modelled as geometry.`,
      cite: 'IRC R403.1 / R403.1.3 — (verify splice lengths)',
    },
    {
      // The vertical claim is CONDITIONAL on the engine having emitted them:
      // a masonry wall gets grouted-cell dowels instead of the generic
      // stemwall grid (foundation.ts skips the grid when a CMU layout
      // exists), so claiming both would be claiming steel nobody places.
      text: `Stemwall ${formatIn(spec.stemwallThickness)} thick from the footing top to the top of foundation${verticalsClause(model, spec)}. Grade is not modelled: the required reveal of the foundation above finished grade is assumed satisfied at the framed floor line.`,
      cite: 'IRC R403.1.3.2 / R404.1.6 — (verify reveal in the field)',
    },
  ]

  if (bolts.length > 0) {
    const bolt = bolts[0] as Member
    notes.push({
      text: `Sill anchorage: ${formatInchFraction(bolt.dims[0])} diameter anchor bolts at ${formatFtIn(spec.anchorBoltSpacing)} o.c. maximum, minimum two per plate section, one within ${formatIn(spec.anchorBoltEndDistance)} of each plate-section end, 7" minimum embedment into the concrete. Door rough openings interrupt the sole plate: each plate section carries its own bolt layout.`,
      cite: 'IRC R403.1.6',
    })
  }
  if (washers.length > 0) {
    const washer = washers[0] as Member
    notes.push({
      text: `${washer.label ?? 'Plate washers'} at every anchor bolt.`,
      cite: 'IRC R602.11.1',
    })
  }
  if (dowels.length > 0) {
    notes.push({
      text: 'Exterior walls are reinforced masonry: there is no sole plate at the top of foundation, and therefore no R403.1.6 bolt layout. Anchorage is vertical dowels hooked in the footing mat and lapping the wall verticals in grouted cells.',
      cite: 'IRC R606.12 / R403.1.3.2',
    })
  }
  if (slab) {
    notes.push({
      text: `Slab on grade: ${formatInchFraction(slab.dims[1])} concrete floor${vapor ? `, over a ${vapor.label ?? '6-mil vapor retarder'}` : ''}. ${slab.advisory ? `${slab.advisory[0]?.toUpperCase()}${slab.advisory.slice(1)}.` : ''}`,
      cite: `IRC R506.1${vapor ? ' / R506.2.3' : ''} / R506.2.2`,
    })
    notes.push({
      text: 'Slab reinforcement (welded wire, fibre or bar mat) is NOT derived by the framing engines. Specify it on the structural design and show it here before submitting.',
      cite: '(verify: IRC R506.2.4)',
    })
  }
  notes.push({
    text: 'Concrete for foundations and other concrete not exposed to the weather: 2,500 psi minimum specified compressive strength at 28 days. Verify the exposure class, air entrainment and strength of garage slabs, porches, carport slabs and exterior flatwork with the authority having jurisdiction.',
    cite: `IRC Table R402.2 — weathering potential for this jurisdiction: ${climate?.weatheringPotential ?? 'not in the jurisdiction data'}`,
  })
  if (climate?.termiteRisk && climate.termiteRisk !== 'none') {
    notes.push({
      text: `Termite infestation probability for this jurisdiction is "${climate.termiteRisk}". Provide the required protection against subterranean termites; treatment method is not part of this drawing set.`,
      cite: 'IRC R318',
    })
  }
  notes.push({
    text: 'Stepped footings on sloping sites are NOT derived: Pascal levels are flat planes and the scene carries no grade or terrain model, so every run is drawn at one elevation.',
    cite: '(verify: IRC R403.1.5)',
  })
  notes.push({
    text: 'Contractor shall verify all dimensions and existing conditions in the field before placing concrete and report any discrepancy to the engineer of record. Do not scale these drawings.',
  })
  return notes
}

/** Total slab area actually poured by the engine, square feet. */
export function slabAreaSqFt(model: StructuralModel): number {
  let area = 0
  for (const member of membersOf(model, 'foundation', 'slab')) {
    const rect = memberPlanRect(member)
    const a = rect[0] as Pt
    const b = rect[1] as Pt
    const c = rect[2] as Pt
    area += Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1])
  }
  return area * 10.7639
}

/** One line of counts for the notes plate sub-head. */
export function foundationSummary(model: StructuralModel): string {
  const footings = membersOf(model, 'foundation', 'footing')
  const total = footings.reduce((sum, m) => sum + m.length, 0) / 0.3048
  const parts = [`${footings.length} footing runs (${total.toFixed(0)} lf)`]
  const bolts = membersOf(model, 'foundation', 'anchor-bolt').length
  if (bolts > 0) parts.push(`${bolts} anchor bolts`)
  const area = slabAreaSqFt(model)
  if (area > 1) parts.push(`${area.toFixed(0)} sf slab`)
  return parts.join(' · ')
}
