/**
 * SN1 — STRUCTURAL NOTES.
 *
 * The sheet a plan checker reads first: design criteria, material
 * assumptions, the fastening schedule and the deferred submittals. Every
 * number on it is traced — to `data/jurisdictions-climate.json` and
 * `data/jurisdictions-adoption.json` for the site criteria, to
 * `data/fastening-schedule.json` for the nailing, to the resolved
 * `FramingSpec` for the framing itself — and anything the engines do NOT
 * derive is printed as "(verify: …)" with its code section, never as a
 * plausible-looking number.
 *
 * The climate data ships its own caveat (a state row is a TYPICAL value, and
 * wind in particular varies enormously inside a state) and this sheet repeats
 * it verbatim next to the numbers, because a wind speed picked off a state
 * table and printed without that sentence is the kind of thing that gets a
 * set rejected.
 */
import fastening from '../../../../plugin-bones/data/fastening-schedule.json'
import type { ScheduleTable } from '../../schedule'
import {
  ADOPTION_DISCLAIMER,
  adoptionRow,
  CLIMATE_DISCLAIMER,
  flagsOf,
  formatFtIn,
  formatIn,
  type StructuralModel,
  structuralWarnings,
} from './model'
import type { Note } from './plate'

type FasteningFile = {
  version?: string
  disclaimer?: string
  sources?: string[]
  nails?: Record<string, { lengthIn?: number; use?: string }>
  connections?: Record<string, { nail?: string; count?: number; perFt?: number; note?: string }>
  hardware?: Record<string, Record<string, unknown>>
}

const FASTENING = fastening as FasteningFile

/* -------------------------------------------------------- criteria */

export function designCriteria(
  model: StructuralModel,
): { label: string; value: string; cite: string }[] {
  const climate = model.climate
  const adoption = adoptionRow(model.jurisdiction)
  const profile = model.profile
  const out: { label: string; value: string; cite: string }[] = [
    {
      // `drawTable` does not clip a cell, so a 90-character code name would
      // run through the SOURCE column. The effective-date tail is dropped
      // here and the full string is printed verbatim in note 1 below.
      label: 'Governing code',
      value: (adoption?.residentialCode ?? profile.residentialCode).replace(
        /,\s*effective\s.*$/,
        '',
      ),
      cite: `data/jurisdictions-adoption.json — ${model.jurisdiction}`,
    },
    {
      label: 'IRC base edition',
      value:
        adoption?.ircBase == null
          ? 'Not an IRC adoption — the citations on these sheets are generic practice, not local law'
          : `${adoption.ircBase} IRC`,
      cite: 'data/jurisdictions-adoption.json',
    },
    {
      label: 'Risk category',
      value: 'II (verify)',
      cite: '(verify: ASCE 7 Table 1.5-1 — not derived from the model)',
    },
    {
      label: 'Ultimate design wind speed, Vult',
      value: climate?.ultimateWindMph ? `${climate.ultimateWindMph} mph` : 'not in the data',
      cite: 'IRC Table R301.2(1) / Figure R301.2(2) — state typical value',
    },
    {
      label: 'Wind exposure category',
      value: 'B assumed (verify)',
      cite: '(verify: IRC R301.2.1.4 — terrain is not modelled by the scene)',
    },
    {
      label: 'Ground snow load, pg',
      value: climate ? `${climate.groundSnowLoadPsf ?? 0} psf` : 'not in the data',
      cite: 'IRC Table R301.2(1)',
    },
    {
      label: 'Seismic design category',
      value: climate?.seismicSdc ?? 'not in the data',
      cite: 'IRC Table R301.2(1) / R301.2.2',
    },
    {
      label: 'Frost depth / footing embedment',
      value: `${profile.frostLineIn}" (footings drawn at ${formatIn(model.spec.footingDepth)} below top of foundation)`,
      cite: 'IRC R403.1.4 / R403.1.4.1',
    },
    {
      label: 'Weathering potential',
      value: climate?.weatheringPotential ?? 'not in the data',
      cite: 'IRC Table R301.2(1) / Table R402.2',
    },
    {
      label: 'Termite infestation probability',
      value: climate?.termiteRisk ?? 'not in the data',
      cite: 'IRC Table R301.2(1) / R318',
    },
    {
      label: 'Presumptive soil bearing',
      value: 'not derived (verify)',
      cite: '(verify: IRC Table R401.4.1 — or a soils report)',
    },
    {
      label: 'Floor live load / roof live load',
      value: '40 psf floor, 20 psf roof — the loads the span tables used',
      cite: 'IRC Table R502.3.1(2) / Table R802.4.1',
    },
  ]
  return out
}

/* ----------------------------------------------------------- notes */

export function structuralNotes(model: StructuralModel): Note[] {
  const spec = model.spec
  const climate = model.climate
  const notes: Note[] = []

  notes.push({
    text: `GOVERNING CODE — ${model.profile.residentialCode}. Jurisdiction resolved as ${model.jurisdiction} from the ${model.jurisdictionSource}.`,
    cite: 'data/jurisdictions-adoption.json',
  })
  notes.push({
    text: 'GENERAL — These structural sheets are generated from the Pascal model through the Bones framing engines. They are a drafting aid: every member shown was derived from the geometry actually in the model, and everything the engines could not derive is marked "verify" with its code section. The engineer of record shall review, complete and seal the set before submission.',
  })
  notes.push({
    text: `Site criteria are STATE-LEVEL typical values, not site values. ${CLIMATE_DISCLAIMER}`,
    cite: 'data/jurisdictions-climate.json',
  })
  if (climate?.windNote) {
    notes.push({
      text: `WIND — county and coastal variation for this state: ${climate.windNote}. Confirm the site wind speed, the wind-borne-debris region and any special regime with the authority having jurisdiction before using the ${climate.ultimateWindMph ?? '—'} mph figure above.`,
      cite: 'IRC R301.2.1 / Figure R301.2(2)',
    })
  }
  if (climate?.caveat) {
    notes.push({
      text: `CLIMATE DATA CAVEAT — ${climate.caveat}`,
      cite: 'data/jurisdictions-climate.json',
    })
  }
  if (ADOPTION_DISCLAIMER) {
    notes.push({
      text: `CODE ADOPTION — ${ADOPTION_DISCLAIMER}`,
      cite: 'data/jurisdictions-adoption.json',
    })
  }
  const adoption = adoptionRow(model.jurisdiction)
  if (adoption?.note) {
    notes.push({ text: `CODE CYCLE — ${adoption.note}`, cite: 'data/jurisdictions-adoption.json' })
  }

  notes.push({
    text: `LUMBER — ASSUMPTION: all sawn framing lumber is SPF #2 or better, kiln-dried, 19% maximum moisture content. Every allowable span used to size the members on these sheets was read from the SPF #2 columns of the IRC tables; a different species or grade changes the spans and the members must be re-checked.`,
    cite: 'IRC Table R502.3.1(2), Table R802.4.1, Table R802.5.1(2) — SPF #2',
  })
  notes.push({
    text: `STUDS — ${formatIn(spec.studSpacing)} o.c. nominal, ${spec.interiorStudSize} interior and ${spec.exteriorStudSize} in walls thicker than ${formatIn(spec.thickWallThreshold)}, with ${spec.topPlateCount === 2 ? 'a double' : 'a single'} top plate.`,
    cite: 'IRC Table R602.3(5)',
  })
  notes.push({
    text: `HEADERS — sized by clear rough opening from the prescriptive table; a header longer than ${formatFtIn(spec.engineeredHeaderSpan)} routes to an ENGINEERED beam and is flagged on the plan. A nominal 4x header on these sheets is the two-ply built-up 2x member of the table.${spec.headerAssumption ? ` ${spec.headerAssumption}.` : ''}`,
    cite: 'IRC Table R602.7(1)',
  })
  notes.push({
    text: 'ENGINEERED LUMBER — PSL / LVL / LSL / glulam members are not sized by these engines. Where a beam is flagged "engineered beam required", obtain the supplier design and add it to the beam schedule before submission.',
    cite: '(verify: IRC R502.1.3 / R602.7.3)',
  })
  notes.push({
    text: 'CONCRETE — 2,500 psi minimum specified compressive strength at 28 days for foundations and other concrete not exposed to the weather. Verify the exposure class, strength and air entrainment of garage slabs, porches and exterior flatwork with the AHJ.',
    cite: 'IRC Table R402.2',
  })
  notes.push({
    text: 'REINFORCEMENT — deformed bars, ASTM A615 Grade 60 assumed. Splice lengths, hooks and corner bars are NOT modelled as geometry on these sheets.',
    cite: '(verify: IRC R403.1.3 / ACI 318)',
  })
  if (model.members.some((m) => m.role === 'block')) {
    notes.push({
      text: 'MASONRY — exterior walls are reinforced concrete masonry with grouted cells at the vertical bars and a bond beam at the top of the wall. Unit strength, mortar type and grout are NOT derived by these engines.',
      cite: '(verify: IRC R606 / TMS 402)',
    })
  }
  notes.push({
    text: 'PRESERVATIVE TREATMENT — all wood in contact with concrete or masonry, and all wood exposed to weather, shall be naturally durable or preservative-treated, with fasteners and connectors rated for the treatment.',
    cite: 'IRC R317 / R317.3',
  })
  notes.push({
    text: 'DEFERRED SUBMITTALS — pre-engineered roof and floor trusses, their girder trusses, bearing and uplift connections, and any engineered beam flagged on the plans. Provide the manufacturer’s sealed design drawings before the framing inspection.',
    cite: 'IRC R802.10.1',
  })
  notes.push({
    text: 'FIELD VERIFICATION — the contractor shall verify all dimensions and existing conditions before starting work and shall report discrepancies to the engineer of record. Do not scale these drawings; written dimensions govern.',
  })

  const flags = flagsOf(model.members)
  for (const flag of flags) {
    notes.push({ text: `ENGINE FLAG — ${flag}`, cite: 'Resolve before submission' })
  }
  for (const warning of structuralWarnings(model)) {
    notes.push({ text: `MODEL WARNING — ${warning}`, cite: 'Bones compute' })
  }
  return notes
}

/* ----------------------------------------------- fastening schedule */

/** IRC Table R602.3(1) rows, straight out of the Bones data file. */
export function fasteningScheduleTable(): ScheduleTable {
  const connections = FASTENING.connections ?? {}
  const rows = Object.entries(connections).map(([key, value]) => ({
    mark: prettyConnection(key),
    nail: value.nail
      ? String(value.nail)
          .replace('-common', 'd common')
          .replace(/^(\d+)d/, '$1d')
      : '',
    qty:
      value.count !== undefined
        ? `${value.count}`
        : value.perFt !== undefined
          ? `${value.perFt}/ft`
          : '',
    note: value.note ?? '',
  }))
  const issues: string[] = []
  if (FASTENING.disclaimer) issues.push(FASTENING.disclaimer)
  for (const source of FASTENING.sources ?? []) issues.push(source)
  return {
    title: 'Fastening schedule',
    columns: [
      { key: 'mark', label: 'CONNECTION', weight: 2.0 },
      { key: 'nail', label: 'FASTENER', weight: 1.0 },
      { key: 'qty', label: 'QTY', weight: 0.6 },
      { key: 'note', label: 'REMARKS', weight: 3.0 },
    ],
    rows,
    issues,
  }
}

function prettyConnection(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/-/g, ' ')
    .replace(/\b(to)\b/g, 'to')
    .toUpperCase()
}

/** The connector hardware families the data file names. */
export function hardwareNotes(): Note[] {
  const hardware = FASTENING.hardware ?? {}
  return Object.entries(hardware).map(([key, value]) => ({
    text: `${prettyConnection(key)} — ${Object.entries(value)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(', ')}`,
    cite: 'data/fastening-schedule.json — size and capacity per the manufacturer',
  }))
}

/** Design criteria as a two-column schedule table. */
export function criteriaTable(model: StructuralModel): ScheduleTable {
  return {
    title: 'Design criteria',
    columns: [
      { key: 'mark', label: 'ITEM', weight: 1.5 },
      { key: 'value', label: 'VALUE', weight: 2.2 },
      { key: 'cite', label: 'SOURCE', weight: 2.4 },
    ],
    rows: designCriteria(model).map((row) => ({
      mark: row.label,
      value: row.value,
      cite: row.cite,
    })),
    issues: [
      'State-level typical values — confirm every line against Table R301.2(1) as filled in by the local authority having jurisdiction.',
    ],
  }
}
