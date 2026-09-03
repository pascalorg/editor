/**
 * S2.x FLOOR FRAMING and S3.0 ROOF FRAMING, drawn from Bones' floor
 * (`engines/floor-framing.ts`) and roof (`engines/roof-framing.ts`) engines.
 *
 * A framing plan is a drawing of LINES: every joist, rafter, truss chord and
 * beam is one member, projected to plan along its own longest axis, so a
 * rafter foreshortens by cos(pitch) exactly as it must. On top of the
 * linework go the two things that make it readable — the size-and-spacing
 * extent arrow over each family of parallel members, and a beam tag on every
 * member that has a row in the beam schedule.
 *
 * The engines' own labels drive everything printed: a member that says
 * "Purlin 2x6 @ mid-span under rafters (R802.5.1)" is drawn and captioned as
 * a purlin, and a truss bottom chord that says "design by truss manufacturer
 * — deferred submittal" puts that sentence on the sheet. Nothing is inferred
 * past what the engine states.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import type { ScheduleTable } from '../../schedule'
import {
  extentArrow,
  INK,
  INK_FAINT,
  INK_MID,
  line,
  PEN,
  type Pen,
  polygon,
  square,
  tag,
} from './draw'
import {
  flagsOf,
  formatFtIn,
  formatInchFraction,
  type Member,
  measuredSpacing,
  memberPlanCentre,
  memberPlanRect,
  memberPlanSegment,
  membersOf,
  nearestOcInches,
  type Pt,
  type StructuralModel,
  toFeet,
} from './model'
import type { LegendEntry, Note } from './plate'

/* -------------------------------------------------------- beam marks */

export type BeamRow = {
  mark: string
  members: Member[]
  size: string
  ply: string
  type: string
  location: string
  span: number
  flags: string[]
  advisories: string[]
}

/**
 * Beams grouped into schedule rows.
 *
 * Bones sizes prescriptive headers as a SOLID 4x, which its own spec module
 * documents as standing for the two-ply built-up header of IRC Table
 * R602.7(1) — so the schedule prints the ply that is actually built and says
 * where the convention comes from, rather than inventing a ply count.
 */
export function beamRows(members: readonly Member[], prefix: string): BeamRow[] {
  const groups = new Map<string, Member[]>()
  for (const member of members) {
    const key = `${member.role}|${member.size ?? cross(member)}|${conditionOf(member)}`
    groups.set(key, [...(groups.get(key) ?? []), member])
  }
  const ordered = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  return ordered.map(([, group], index) => {
    const first = group[0] as Member
    const size = first.size ?? cross(first)
    return {
      mark: `${prefix}${index + 1}`,
      members: group,
      size,
      ply: plyOf(first),
      type: typeOf(first),
      location: conditionOf(first),
      span: Math.max(...group.map((m) => m.dims[0])),
      flags: flagsOf(group),
      advisories: [...new Set(group.map((m) => m.advisory).filter(Boolean) as string[])],
    }
  })
}

/** A member with no nominal lumber size, described by its actual section. */
function cross(m: Member): string {
  return `${formatInchFraction(m.dims[2], 8)} × ${formatInchFraction(m.dims[1], 8)}`
}

function plyOf(m: Member): string {
  // A nominal 4x from the header rules IS the 2-ply built-up member of
  // Table R602.7(1) (see plugin-bones/src/core/spec.ts, HEADER_RULES_*).
  if (m.role === 'header' && /^4x/.test(m.size ?? '')) return '(2) 2x'
  if (m.role === 'girder' && /^4x/.test(m.size ?? '')) return '(2) 2x'
  return '1'
}

function typeOf(m: Member): string {
  if (m.material === 'concrete') return 'PRECAST CONC.'
  if (m.material === 'steel') return 'STEEL'
  if (m.material === 'engineered') return 'ENGINEERED'
  if (m.material === 'pt-lumber') return 'P.T. LUMBER'
  // The Bones span tables are SPF #2 throughout (core/spec.ts cites
  // R502.3.1(2) / R802.4.1 / R802.5.1(2), all SPF #2) — an ASSUMPTION of the
  // engine, printed as one.
  return 'SPF #2 (ASSUMED)'
}

function conditionOf(m: Member): string {
  const label = m.label ?? ''
  if (m.role === 'lintel') return 'MASONRY LINTEL'
  if (m.role === 'header') {
    const over = /over (\w+)/.exec(label)
    return over ? `HEADER OVER ${over[1]?.toUpperCase()}` : 'HEADER'
  }
  if (m.role === 'girder') return 'FLUSH GIRDER'
  if (m.role === 'ridge') return /purlin/i.test(label) ? 'PURLIN' : 'RIDGE'
  if (m.role === 'hip') return 'HIP'
  if (m.role === 'valley') return 'VALLEY'
  return m.role.replace(/-/g, ' ').toUpperCase()
}

/* --------------------------------------------------------- families */

type Family = { size: string; role: Member['role']; members: Member[]; angle: number }

/**
 * Parallel members of one size grouped into a FAMILY — the thing a framing
 * plan calls out once with a direction arrow instead of labelling 52 rafters.
 * Grouped by role, nominal size and plan bearing (15° buckets), so the two
 * slopes of a gable get their own arrow.
 */
function families(members: readonly Member[]): Family[] {
  const map = new Map<string, Family>()
  for (const member of members) {
    const seg = memberPlanSegment(member)
    if (seg.planLength < 0.15) continue
    const angle = Math.atan2(seg.b[1] - seg.a[1], seg.b[0] - seg.a[0])
    const bucket = Math.round((angle * 180) / Math.PI / 15)
    const size = member.size ?? cross(member)
    const key = `${member.role}|${size}|${bucket}`
    const family = map.get(key) ?? { size, role: member.role, members: [], angle }
    family.members.push(member)
    map.set(key, family)
  }
  return [...map.values()].filter((f) => f.members.length >= 2)
}

/**
 * The extent arrow + note for one family.
 *
 * `slot` staggers WHICH member of the family carries the arrow, so two
 * families running the same way (rafters over ceiling joists over purlins)
 * do not stack their captions on the same line — the first render of the
 * roof plan had three of them overprinted at mid-span.
 */
function familyCallout(family: Family, p: Pen, caption: string, slot = 0): FloorplanGeometry[] {
  const sorted = [...family.members].sort((a, b) => b.dims[0] - a.dims[0])
  const long = sorted.filter((m) => m.dims[0] > (sorted[0]?.dims[0] ?? 0) * 0.9)
  const pool = long.length > 0 ? long : sorted
  const pick =
    pool[Math.min(pool.length - 1, Math.floor(((slot + 1) * pool.length) / 6))] ?? pool[0]
  if (!pick) return []
  const seg = memberPlanSegment(pick)
  const shrink = 0.08
  const a: Pt = [
    seg.a[0] + (seg.b[0] - seg.a[0]) * shrink,
    seg.a[1] + (seg.b[1] - seg.a[1]) * shrink,
  ]
  const b: Pt = [
    seg.b[0] - (seg.b[0] - seg.a[0]) * shrink,
    seg.b[1] - (seg.b[1] - seg.a[1]) * shrink,
  ]
  return extentArrow(a, b, caption, p)
}

/**
 * "2x6 RAFTERS @ 24\" O.C." — the spacing is MEASURED from the members'
 * own positions, never taken from the spec, and it is only printed when the
 * measurement is a real repeat: three or more members whose median gap lands
 * on a tabulated o.c. column. A pair of mid-span purlins gets its size and
 * its role and no invented spacing.
 */
export function spacingCaption(family: { size: string; members: Member[] }, noun: string): string {
  if (family.members.length < 3) return `${family.size} ${noun}`
  const oc = nearestOcInches(measuredSpacing(family.members))
  return oc === null
    ? `${family.size} ${noun}`
    : `${family.size} ${noun} @ ${oc % 1 === 0 ? oc : oc.toFixed(1)}" O.C.`
}

/* ------------------------------------------------------ roof drawing */

const ROOF_SKIP = new Set<Member['role']>(['wrb', 'drip-edge', 'truss-web'])

/** What a family of each roof role is CALLED on the plan. */
const ROOF_NOUNS: Partial<Record<Member['role'], string>> = {
  rafter: 'RAFTERS',
  'jack-rafter': 'JACK RAFTERS',
  'truss-chord': 'TRUSSES',
  'ceiling-joist': 'CEILING JOISTS',
  'collar-tie': 'COLLAR TIES',
  // The engine books mid-span purlins under the 'ridge' role.
  ridge: 'PURLIN AT MID-SPAN',
}

export function roofFramingPrimitives(
  model: StructuralModel,
  p: Pen,
): { primitives: FloorplanGeometry[]; legend: LegendEntry[]; warnings: string[] } {
  const out: FloorplanGeometry[] = []
  const legend: LegendEntry[] = []
  const warnings: string[] = []
  const roof = membersOf(model, 'roof-framing')

  // ── the walls the roof bears on ─────────────────────────────────────
  out.push(...bearingWallLayer(model, p, legend))

  if (roof.length === 0) {
    return { primitives: out, legend, warnings: ['No roof members derived for this level.'] }
  }

  // ── the roof plane and its overhang, from the deck members ──────────
  const deck = roof.filter((m) => m.role === 'sheathing')
  for (const member of deck) {
    out.push(
      polygon(memberPlanRect(member), {
        fill: 'none',
        stroke: INK_MID,
        strokeWidth: p.w(PEN.light),
        strokeDasharray: p.dash(0.14, 0.06, 0.03, 0.06),
      }),
    )
  }
  if (deck.length > 0) {
    legend.push({
      label: 'ROOF PLANE / OVERHANG EDGE',
      symbol: { kind: 'line', width: 0.01, dash: '0.14 0.06 0.03 0.06', color: INK_MID },
      note: deck[0]?.label ?? '',
    })
  }

  // ── linework, by role ───────────────────────────────────────────────
  const stick: Member[] = []
  const chords: Member[] = []
  const heavy: Member[] = []
  const hidden: Member[] = []
  const struts: Member[] = []
  const ties: Member[] = []
  const edges: Member[] = []
  for (const member of roof) {
    if (ROOF_SKIP.has(member.role) || member.role === 'sheathing') continue
    switch (member.role) {
      case 'ridge':
        // The engine also books mid-span PURLINS under this role; a purlin is
        // not a ridge and must not be drawn like one.
        ;(/purlin/i.test(member.label ?? '') ? stick : heavy).push(member)
        break
      case 'hip':
      case 'valley':
        heavy.push(member)
        break
      case 'rafter':
      case 'jack-rafter':
      case 'outlooker':
        stick.push(member)
        break
      case 'truss-chord':
        chords.push(member)
        break
      case 'ceiling-joist':
      case 'collar-tie':
        hidden.push(member)
        break
      case 'post':
        struts.push(member)
        break
      case 'blocking':
        ties.push(member)
        break
      case 'fascia':
        edges.push(member)
        break
      default:
        stick.push(member)
    }
  }

  for (const member of hidden) {
    const seg = memberPlanSegment(member)
    out.push(
      line(seg.a, seg.b, {
        stroke: INK_MID,
        strokeWidth: p.w(PEN.thin),
        strokeDasharray: p.dash(0.07, 0.05),
      }),
    )
  }
  for (const member of edges) {
    const seg = memberPlanSegment(member)
    out.push(line(seg.a, seg.b, { stroke: INK, strokeWidth: p.w(PEN.light) }))
  }
  for (const member of stick) {
    const seg = memberPlanSegment(member)
    out.push(line(seg.a, seg.b, { stroke: INK, strokeWidth: p.w(PEN.thin) }))
  }
  for (const member of chords) {
    const seg = memberPlanSegment(member)
    const bottom = /bottom chord/i.test(member.label ?? '')
    out.push(
      line(seg.a, seg.b, {
        stroke: INK,
        strokeWidth: p.w(bottom ? PEN.medium : PEN.thin),
      }),
    )
  }
  for (const member of heavy) {
    const seg = memberPlanSegment(member)
    out.push(
      line(seg.a, seg.b, { stroke: INK, strokeWidth: p.w(PEN.extraHeavy), strokeLinecap: 'butt' }),
    )
  }
  for (const member of struts) {
    out.push(
      square(memberPlanCentre(member), p.w(0.05), {
        fill: '#ffffff',
        stroke: INK,
        strokeWidth: p.w(PEN.thin),
      }),
    )
  }
  for (const member of ties) {
    const c = memberPlanCentre(member)
    const r = p.w(0.032)
    out.push(
      polygon(
        [
          [c[0] - r, c[1] + r * 0.7],
          [c[0] + r, c[1] + r * 0.7],
          [c[0], c[1] - r],
        ],
        { fill: 'none', stroke: INK, strokeWidth: p.w(PEN.thin) },
      ),
    )
  }

  if (stick.length > 0) {
    legend.push({ label: 'RAFTER / PURLIN / OUTLOOKER', symbol: { kind: 'line', width: 0.008 } })
  }
  if (edges.length > 0) {
    legend.push({
      label: 'SUB-FASCIA / FASCIA AT EAVE AND RAKE',
      symbol: { kind: 'line', width: 0.011 },
      note: edges[0]?.label ?? '',
    })
  }
  if (chords.length > 0) {
    legend.push({
      label: 'TRUSS — TOP CHORD LIGHT, BOTTOM CHORD HEAVY',
      symbol: { kind: 'line', width: 0.014 },
      note: 'Webbing shown representative — design by the truss manufacturer.',
    })
  }
  if (heavy.length > 0) {
    legend.push({
      label: 'RIDGE / HIP / VALLEY',
      symbol: { kind: 'line', width: 0.03 },
      note: heavy[0]?.label ?? '',
    })
  }
  if (hidden.length > 0) {
    legend.push({
      label: 'CEILING JOIST / COLLAR TIE (BELOW)',
      symbol: { kind: 'line', width: 0.008, dash: '0.07 0.05', color: INK_MID },
    })
  }
  if (struts.length > 0) {
    legend.push({ label: 'PURLIN STRUT / POST', symbol: { kind: 'square', color: '#ffffff' } })
  }
  if (ties.length > 0) {
    legend.push({
      label: 'HURRICANE / RAFTER TIE',
      symbol: { kind: 'hex', text: 'H' },
      note: `${ties.length} shown — ${ties[0]?.label ?? ''}`,
    })
  }

  // ── size + spacing callouts ─────────────────────────────────────────
  let slot = 0
  for (const family of families([...stick, ...chords, ...hidden])) {
    // The NOUN comes from the member ROLE, never from its label: a rafter's
    // own label says "purlin-supported @ mid-span", which read as a purlin
    // and mislabelled all 52 of them in the first render.
    if (family.role === 'outlooker') continue
    if (/barge/i.test(family.members[0]?.label ?? '')) continue
    const noun = ROOF_NOUNS[family.role] ?? family.role.replace(/-/g, ' ').toUpperCase()
    out.push(...familyCallout(family, p, spacingCaption(family, noun), slot))
    slot += 1
  }

  // ── beam tags ───────────────────────────────────────────────────────
  const beams = roofBeamMembers(model)
  const rows = beamRows(beams, 'RB')
  const tagR = p.w(0.1)
  for (const row of rows) {
    for (const member of row.members) {
      out.push(tag(memberPlanCentre(member), row.mark, tagR, p, 'circle'))
    }
  }
  if (rows.length > 0) {
    legend.push({ label: 'BEAM PER ROOF BEAM SCHEDULE', symbol: { kind: 'circle', text: 'RB' } })
  }

  // ── honesty ─────────────────────────────────────────────────────────
  warnings.push(...flagsOf(roof).slice(0, 4))
  if (chords.length > 0) {
    warnings.push(
      'Truss webbing is representative only — the truss layout and girder trusses are a deferred submittal by the manufacturer.',
    )
  }
  if (roof.some((m) => m.role === 'hip' || m.role === 'valley') === false && deck.length > 1) {
    warnings.push(
      'No hip or valley members derived — verify the intersection framing where roof planes meet.',
    )
  }
  return { primitives: out, legend, warnings }
}

/** Members that get a row in the ROOF BEAM SCHEDULE. */
export function roofBeamMembers(model: StructuralModel): Member[] {
  return model.members.filter(
    (m) =>
      (m.system === 'wall-framing' && (m.role === 'header' || m.role === 'lintel')) ||
      (m.system === 'roof-framing' &&
        (m.role === 'ridge' || m.role === 'hip' || m.role === 'valley')),
  )
}

/* ----------------------------------------------------- floor drawing */

export function floorFramingPrimitives(
  model: StructuralModel,
  p: Pen,
): { primitives: FloorplanGeometry[]; legend: LegendEntry[]; warnings: string[] } {
  const out: FloorplanGeometry[] = []
  const legend: LegendEntry[] = []
  const warnings: string[] = []
  const floor = membersOf(model, 'floor-framing')

  out.push(...bearingWallLayer(model, p, legend))

  const joists = floor.filter((m) => m.role === 'joist')
  const rims = floor.filter((m) => m.role === 'rim-joist')
  const girders = floor.filter((m) => m.role === 'girder')
  const posts = floor.filter((m) => m.role === 'post')
  const hangers = floor.filter((m) => m.role === 'hanger')
  const blocking = floor.filter((m) => m.role === 'blocking')

  for (const member of joists) {
    const seg = memberPlanSegment(member)
    out.push(line(seg.a, seg.b, { stroke: INK, strokeWidth: p.w(PEN.thin) }))
  }
  for (const member of blocking) {
    const seg = memberPlanSegment(member)
    out.push(
      line(seg.a, seg.b, {
        stroke: INK_MID,
        strokeWidth: p.w(PEN.thin),
        strokeDasharray: p.dash(0.05, 0.04),
      }),
    )
  }
  for (const member of rims) {
    const seg = memberPlanSegment(member)
    out.push(line(seg.a, seg.b, { stroke: INK, strokeWidth: p.w(PEN.heavy) }))
  }
  for (const member of girders) {
    out.push(
      polygon(memberPlanRect(member), {
        fill: 'none',
        stroke: INK,
        strokeWidth: p.w(PEN.medium),
        strokeDasharray: p.dash(0.1, 0.05),
      }),
    )
  }
  for (const member of posts) {
    out.push(square(memberPlanCentre(member), p.w(0.06), { fill: INK, stroke: 'none' }))
  }
  for (const member of hangers) {
    const c = memberPlanCentre(member)
    const r = p.w(0.03)
    out.push(
      polygon(
        [
          [c[0] - r, c[1] - r],
          [c[0] + r, c[1] - r],
          [c[0] + r, c[1] + r],
          [c[0] - r, c[1] + r],
        ],
        { fill: 'none', stroke: INK, strokeWidth: p.w(PEN.thin) },
      ),
    )
  }

  if (joists.length > 0)
    legend.push({ label: 'FLOOR JOIST', symbol: { kind: 'line', width: 0.008 } })
  if (rims.length > 0) legend.push({ label: 'RIM JOIST', symbol: { kind: 'line', width: 0.024 } })
  if (girders.length > 0) {
    legend.push({
      label: 'BEAM PER FLOOR BEAM SCHEDULE',
      symbol: { kind: 'line', width: 0.014, dash: '0.1 0.05' },
    })
  }
  if (posts.length > 0) legend.push({ label: 'POST UNDER BEAM', symbol: { kind: 'square' } })
  if (hangers.length > 0) {
    legend.push({
      label: 'JOIST HANGER',
      symbol: { kind: 'square', color: '#ffffff' },
      note: hangers[0]?.label ?? '',
    })
  }
  if (blocking.length > 0) {
    legend.push({
      label: 'BLOCKING / BRIDGING',
      symbol: { kind: 'line', width: 0.008, dash: '0.05 0.04', color: INK_MID },
    })
  }

  families(joists).forEach((family, i) => {
    out.push(...familyCallout(family, p, spacingCaption(family, 'FLOOR JOISTS'), i))
  })

  const rows = beamRows(girders, 'FB')
  const tagR = p.w(0.1)
  for (const row of rows) {
    for (const member of row.members) {
      out.push(tag(memberPlanCentre(member), row.mark, tagR, p, 'circle'))
    }
  }

  warnings.push(...flagsOf(floor).slice(0, 5))
  return { primitives: out, legend, warnings }
}

/* ------------------------------------------------------ shared layer */

/**
 * The wall layer every framing plan carries: exterior walls heavy, interior
 * BEARING walls medium, non-bearing light. "Bearing" is Bones' own rule from
 * the foundation engine (an interior wall over 2.4 m long is treated as
 * bearing and gets a thickened footing) so the framing plan and the
 * foundation plan agree about the load path — the assumption is printed in
 * the notes rather than hidden here.
 */
function bearingWallLayer(
  model: StructuralModel,
  p: Pen,
  legend: LegendEntry[],
): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  let hasBearing = false
  let hasNonBearing = false
  for (const fp of model.footprints) {
    const bearing = fp.bearing
    hasBearing ||= bearing
    hasNonBearing ||= !bearing
    out.push(
      polygon(fp.loop, {
        fill: bearing ? '#e5e7eb' : '#f6f7f9',
        stroke: bearing ? INK : INK_FAINT,
        strokeWidth: p.w(bearing ? (fp.exterior ? PEN.heavy : PEN.medium) : PEN.hair),
      }),
    )
  }
  if (hasBearing) {
    legend.push({
      label: 'BEARING WALL',
      symbol: { kind: 'line', width: 0.02 },
      note: 'All exterior walls are bearing walls.',
    })
  }
  if (hasNonBearing) {
    legend.push({
      label: 'NON-BEARING PARTITION',
      symbol: { kind: 'line', width: 0.006, color: INK_FAINT },
    })
  }
  return out
}

/* ---------------------------------------------------------- schedules */

export function beamScheduleTable(
  rows: readonly BeamRow[],
  title: string,
  emptyIssue: string,
): ScheduleTable {
  const issues: string[] = []
  for (const row of rows) {
    for (const flag of row.flags) issues.push(`${row.mark}: ${flag}`)
    for (const advisory of row.advisories) issues.push(`${row.mark}: ${advisory}`)
  }
  if (rows.length === 0) issues.push(emptyIssue)
  return {
    title,
    columns: [
      { key: 'mark', label: 'MARK', weight: 0.7 },
      { key: 'qty', label: 'QTY', weight: 0.5 },
      { key: 'ply', label: 'PLY', weight: 0.7 },
      { key: 'size', label: 'SIZE', weight: 1.0 },
      { key: 'type', label: 'TYPE', weight: 1.4 },
      { key: 'location', label: 'LOCATION', weight: 1.7 },
      { key: 'span', label: 'LENGTH', weight: 1.0 },
    ],
    rows: rows.map((row) => ({
      mark: row.mark,
      qty: String(row.members.length),
      ply: row.ply,
      size: row.size,
      type: row.type,
      location: row.location,
      span: formatFtIn(row.span),
    })),
    issues,
  }
}

/* -------------------------------------------------------------- notes */

export function roofFramingNotes(model: StructuralModel): Note[] {
  const roof = membersOf(model, 'roof-framing')
  const deck = roof.find((m) => m.role === 'sheathing')
  const rafters = roof.filter((m) => m.role === 'rafter' && !/barge/i.test(m.label ?? ''))
  const chords = roof.filter((m) => m.role === 'truss-chord')
  const ties = roof.filter((m) => m.role === 'blocking')
  const spec = model.spec
  const climate = model.climate
  const notes: Note[] = [
    {
      text: `Governing code: ${model.profile.residentialCode}.`,
      cite: `Jurisdiction ${model.jurisdiction} — ${model.jurisdictionSource}`,
    },
  ]
  if (rafters.length > 0) {
    const oc = nearestOcInches(measuredSpacing(rafters))
    notes.push({
      text: `Rafters ${rafters[0]?.size ?? ''} at ${oc ?? Math.round(spec.rafterSpacing / 0.0254)}" o.c. Allowable spans are taken on the horizontal projection for SPF #2 at the ground snow load of this jurisdiction (${climate?.groundSnowLoadPsf ?? 'n/a'} psf).`,
      cite: 'IRC Table R802.4.1 — span table selected by ground snow load',
    })
  }
  if (chords.length > 0) {
    notes.push({
      text: 'Roof is framed with pre-engineered trusses. Truss design, webbing, girder trusses, bearing and uplift connections are a DEFERRED SUBMITTAL by the truss manufacturer; the layout shown is representative. Contractor shall verify all truss dimensions and locations before ordering.',
      cite: 'IRC R802.10 — truss design drawings required',
    })
  }
  if (deck) {
    notes.push({ text: `${deck.label}.`, cite: 'IRC R803.2 / Table R602.3(1)' })
  }
  if (ties.length > 0) {
    notes.push({
      text: `Provide a ${ties[0]?.label ?? 'hurricane tie'} at every rafter or truss bearing. The ultimate design wind speed for this jurisdiction is ${climate?.ultimateWindMph ?? 'n/a'} mph${climate?.windNote ? ` — ${climate.windNote}` : ''}`,
      cite: 'IRC R802.11 / Table R802.11 — uplift; verify the site wind speed with the AHJ',
    })
  }
  notes.push({
    text: 'Roof overframing, crickets and saddles are not derived by the framing engine. Frame them per detail and verify the ventilation path through the sheathing below.',
    cite: '(verify: IRC R806 ventilation)',
  })
  notes.push({
    text: 'All wood exposed to weather or in contact with concrete or masonry shall be naturally durable or preservative-treated.',
    cite: 'IRC R317',
  })
  for (const flag of flagsOf(roof)) {
    notes.push({ text: `ENGINE FLAG — ${flag}`, cite: 'Resolve before submission' })
  }
  return notes
}

export function floorFramingNotes(model: StructuralModel): Note[] {
  const floor = membersOf(model, 'floor-framing')
  const joists = floor.filter((m) => m.role === 'joist')
  const notes: Note[] = [
    {
      text: `Governing code: ${model.profile.residentialCode}.`,
      cite: `Jurisdiction ${model.jurisdiction} — ${model.jurisdictionSource}`,
    },
  ]
  if (joists.length > 0) {
    const oc = nearestOcInches(measuredSpacing(joists))
    const longest = Math.max(...joists.map((m) => m.dims[0]))
    notes.push({
      text: `Floor joists ${joists[0]?.size ?? ''} at ${oc ?? 16}" o.c.; longest derived span ${formatFtIn(longest)} (${toFeet(longest).toFixed(1)} ft). Sized against the SPF #2 allowable-span table at 40 psf live / 10 psf dead, L/360.`,
      cite: 'IRC Table R502.3.1(2)',
    })
    notes.push({
      text: 'Joists shall bear a minimum of 1-1/2" on wood or metal and 3" on masonry, and shall be blocked or bridged at their supports.',
      cite: 'IRC R502.6 / R502.7',
    })
  }
  notes.push({
    text: 'Floor sheathing is not scheduled on this sheet; nail it per the fastening schedule on SN1.',
    cite: 'IRC Table R602.3(1)',
  })
  for (const flag of flagsOf(floor)) {
    notes.push({ text: `ENGINE FLAG — ${flag}`, cite: 'Resolve before submission' })
  }
  return notes
}

/** The honest "there is no floor framing here" plate body. */
export function noFloorFramingNotes(model: StructuralModel): Note[] {
  const slabs = membersOf(model, 'foundation', 'slab')
  const reason = model.isGround
    ? `${model.levelLabel} is the ground storey and is slab-on-grade: it has no framed floor. The slab, its vapor retarder and the footings under it are drawn on the foundation plan.`
    : `The framing engines produced no floor members for ${model.levelLabel}. A framed floor is derived from the level's own slab outline — draw a floor slab on this level, or X-ray it in Bones, and this sheet will fill in.`
  return [
    { text: reason, cite: slabs.length > 0 ? 'IRC R506 — slab on grade' : undefined },
    {
      text: 'Nothing on this sheet is inferred: no joist size, direction, spacing or beam has been invented to fill the page.',
    },
  ]
}

/** Exported for the tests: the marks the roof beam schedule will carry. */
export function roofBeamRows(model: StructuralModel): BeamRow[] {
  return beamRows(roofBeamMembers(model), 'RB')
}

/** Exported for the tests: the marks the floor beam schedule will carry. */
export function floorBeamRows(model: StructuralModel): BeamRow[] {
  return beamRows(membersOf(model, 'floor-framing', 'girder'), 'FB')
}
