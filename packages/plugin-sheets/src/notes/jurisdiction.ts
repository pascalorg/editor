/**
 * WHICH CODE THE NOTES CITE.
 *
 * A general-notes sheet that cites the wrong code is worse than no notes at
 * all, so the code name is READ, never assumed: the site node's state keys
 * `packages/plugin-bones/data/jurisdictions-adoption.json` (the researched
 * adoption table Bones already ships) and the answer is printed verbatim in
 * the sheet header. When the state is unknown the sheet says so and falls
 * back to the IRC 2021 base every note below is written against.
 *
 * The IECC climate zone comes from `wall-assemblies.json`
 * (`exterior.stateClimateZone`) because `jurisdictions-climate.json` carries
 * no zone field — its own citation note says as much. Both files carry
 * caveats about county-level variation; those caveats are printed on the
 * paper rather than swallowed here.
 *
 * NOTHING in this module invents a code value. Everything it returns either
 * came out of a data file with a citation attached or is flagged as unknown.
 */
import adoptionData from '../../../plugin-bones/data/jurisdictions-adoption.json'
import climateData from '../../../plugin-bones/data/jurisdictions-climate.json'
import assembliesData from '../../../plugin-bones/data/wall-assemblies.json'
import type { NodeMap } from '../model'
import { projectRecord, siteAddress, siteNode } from '../model'

/* ----------------------------------------------------------- data rows */

type AdoptionRow = {
  name?: string
  residentialCode?: string
  ircBase?: number | null
  amendmentFlavor?: string
  specialRegimes?: string[]
  note?: string
}

type ClimateRow = {
  name?: string
  frostLineIn?: number
  frostLineNote?: string
  groundSnowLoadPsf?: number
  ultimateWindMph?: number
  windNote?: string
  seismicSdc?: string
  termiteRisk?: string
  flags?: Record<string, boolean>
  caveat?: string
}

const ADOPTION = (adoptionData as { states?: Record<string, AdoptionRow> }).states ?? {}
const CLIMATE = (climateData as { states?: Record<string, ClimateRow> }).states ?? {}
const EXTERIOR =
  (
    assembliesData as {
      exterior?: {
        stateClimateZone?: Record<string, string>
        stateClimateZoneCitation?: string
        insulationByClimateZone?: Record<
          string,
          { value?: string; compliance2021?: string[]; citation?: string }
        >
      }
    }
  ).exterior ?? {}

/** What the notes cite when the site has no state on it. */
export const FALLBACK_CODE = 'IRC 2021'

/**
 * The identifier a section is cited under. An IRC adoption keeps the IRC's
 * section numbers, so the number is the same everywhere — the NAME in front
 * of it is what a plan checker expects to see (Steve, 2026-09-06: "ensure
 * the code sections change to the correct identifier by area"): Florida
 * cites the Florida Building Code, Residential; California the California
 * Residential Code. States whose adopted code is the IRC itself, amended,
 * cite the IRC. Only names known for certain are listed.
 */
const CODE_TAGS: Record<string, string> = {
  FL: 'FBC-R',
  CA: 'CRC',
  NC: 'NCRC',
  NY: 'RCNYS',
}

/** The tag a jurisdiction's citations carry — 'IRC' unless the state publishes its own edition. */
export function codeTagOf(state: string, resolved: boolean): string {
  return resolved && CODE_TAGS[state] ? (CODE_TAGS[state] as string) : 'IRC'
}

/**
 * Re-tag a line of sheet text for the jurisdiction: the "IRC" in front of a
 * section, table or figure number becomes the adopted code's name. The
 * IRC's own name where it is named as the BASE of an adoption ("2021 IRC
 * base") is left alone — that sentence is about the IRC.
 */
export function retagCode(text: string, tag: string): string {
  if (tag === 'IRC' || !text.includes('IRC')) return text
  return text
    .replace(/\bIRC 20\d\d(?=\s+(?:[RPMGEN]\d|Table|Figure))/g, tag)
    .replace(/\bIRC(?=\s+(?:[RPMGEN]\d|Table|Figure|Section|Chapter|App))/g, tag)
    // a citation wrapped after its code name: "(IRC" at the end of one line, "R302.11)" on the next
    .replace(/\(IRC$/, `(${tag}`)
    .replace(/\(verify: IRC$/, `(verify: ${tag}`)
}

/**
 * Florida's counties the parcel services rarely return, read off the site's
 * coordinates instead — printed as INFERRED, never as fact. Miami-Dade and
 * Broward are the High-Velocity Hurricane Zone (FBC-R R301.2.1.1 / the
 * adoption table's special regimes) and, with Monroe, IECC zone 1A (the
 * "(1A Miami/Keys)" of the climate table). The boxes are the counties'
 * inhabited extents; the Everglades share of Miami-Dade below 25.3° is
 * left to Monroe's box, which is where the Keys are.
 */
type CountyBox = {
  county: string
  hvhz: boolean
  zone: '1A' | null
  lat: [number, number]
  lng: [number, number]
}
const FL_COUNTY_BOXES: CountyBox[] = [
  { county: 'Miami-Dade', hvhz: true, zone: '1A', lat: [25.3, 25.98], lng: [-80.88, -80.1] },
  { county: 'Broward', hvhz: true, zone: '1A', lat: [25.95, 26.35], lng: [-80.9, -80.05] },
  { county: 'Monroe', hvhz: false, zone: '1A', lat: [24.4, 25.3], lng: [-82.2, -80.25] },
]

/** The Florida county a site's coordinates fall in, when it is one the code treats specially. */
export function inferFloridaCounty(lng: number, lat: number): CountyBox | null {
  for (const box of FL_COUNTY_BOXES) {
    if (lat >= box.lat[0] && lat <= box.lat[1] && lng >= box.lng[0] && lng <= box.lng[1]) return box
  }
  return null
}

/* -------------------------------------------------------------- shape */

export type Jurisdiction = {
  /** Two-letter code from the project record or the site node; '' when unknown. */
  state: string
  stateName: string
  county: string
  city: string
  /** The adopted residential code, verbatim from the adoption table. */
  code: string
  /** Short form for the citation header line, e.g. 'FBC-R 2023 (2021 IRC)'. */
  codeShort: string
  /** IRC edition the adopted code is based on; null for non-IRC codes. */
  ircBase: number | null
  /** True when the code name was read from the data file rather than assumed. */
  resolved: boolean
  /** The name citations carry in front of a section number: 'FBC-R', 'CRC', 'IRC'. */
  codeTag: string
  /** The county was read off the site's coordinates, not the record — printed as such. */
  countyInferred: boolean
  /** The site's [lng, lat] from the parcel record, when it has one. */
  siteLngLat: [number, number] | null
  /** The HVHZ wind-speed range from the climate table ('170–180 mph'), when the site is in it. */
  windRange: string | null
  /** IECC climate zone label ('2A'), or null when the state is unknown. */
  climateZone: string | null
  /** The raw zone string, which may name split counties: '2A (1A Miami/Keys)'. */
  climateZoneRaw: string | null
  climateZoneCitation: string
  /** Prescriptive wood-frame wall R from the same table, with its citation. */
  wallInsulation: { value: string; options: string[]; citation: string } | null
  /** Design values the notes lean on (frost depth, wind, termite). */
  frostLineIn: number | null
  frostLineNote: string
  ultimateWindMph: number | null
  windNote: string
  termiteRisk: string
  seismicSdc: string
  hvhz: boolean
  hurricaneTies: boolean
  /** Everything the reader must verify locally — printed, never silent. */
  caveats: string[]
  /** The jurisdiction's own special regimes, verbatim from the data file. */
  specialRegimes: string[]
  amendmentFlavor: string
}

/* ------------------------------------------------------------- resolve */

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Two-letter state code: the project record wins, then the site address. */
export function resolveState(nodes: NodeMap): string {
  const record = projectRecord(nodes) as unknown as
    | { jurisdiction?: { state?: unknown; county?: unknown; city?: unknown } }
    | undefined
  const fromRecord = str(record?.jurisdiction?.state)
  if (fromRecord) return fromRecord.toUpperCase()
  const address = siteAddress(nodes)
  if (address.state) return address.state.toUpperCase()
  const site = siteNode(nodes)
  const parcel = (site?.parcel ?? {}) as Record<string, unknown>
  return str(parcel.state).toUpperCase()
}

/**
 * Short code label for the header line. The adoption row's `residentialCode`
 * is a full sentence ("Florida Building Code, Residential — 8th Edition
 * (2023), 2021 IRC base, effective 2023-12-31"); the header wants the name
 * without the effective date, so the trailing ", effective …" clause is cut
 * and nothing else is rewritten.
 */
function shortCode(row: AdoptionRow | undefined): string {
  const full = str(row?.residentialCode)
  if (!full) return FALLBACK_CODE
  return full.replace(/,\s*effective\s+[\d-]+\s*$/i, '')
}

/** IECC zone label + key from the free-text state zone string ('2A (1A Miami/Keys)'). */
export function climateZoneOf(state: string): {
  label: string | null
  key: string | null
  raw: string | null
} {
  const raw = EXTERIOR.stateClimateZone?.[state] ?? null
  const match = raw ? /^(\d)([ABC])?/.exec(raw.trim()) : null
  if (!match) return { label: null, key: null, raw }
  const digit = match[1] as string
  return {
    label: `${digit}${match[2] ?? ''}`,
    key: digit === '4' && match[2] === 'C' ? '4M' : digit,
    raw,
  }
}

export function resolveJurisdiction(nodes: NodeMap): Jurisdiction {
  const state = resolveState(nodes)
  const adoption = state ? ADOPTION[state] : undefined
  const climate = state ? CLIMATE[state] : undefined
  const zone: { label: string | null; key: string | null; raw: string | null }  = climateZoneOf(state)
  const insulation = zone.key ? EXTERIOR.insulationByClimateZone?.[zone.key] : undefined

  const record = projectRecord(nodes) as unknown as
    | { jurisdiction?: { county?: unknown; city?: unknown } }
    | undefined
  const site = siteNode(nodes)
  const parcel = (site?.parcel ?? {}) as Record<string, unknown>
  const address = siteAddress(nodes)
  let county = str(record?.jurisdiction?.county) || str(parcel.county)
  const city = str(record?.jurisdiction?.city) || address.city
  const origin = Array.isArray(parcel.originLngLat) ? (parcel.originLngLat as unknown[]) : null
  const siteLngLat: [number, number] | null =
    origin && typeof origin[0] === 'number' && typeof origin[1] === 'number'
      ? [origin[0], origin[1]]
      : null

  const caveats: string[] = []
  // Florida: HVHZ and zone 1A are county facts; without a county on the
  // record the coordinates say which county, and the sheet says it was inferred.
  let countyInferred = false
  let box: CountyBox | null = null
  if (state === 'FL' && siteLngLat) {
    box = inferFloridaCounty(siteLngLat[0], siteLngLat[1])
    if (box && !county) {
      county = box.county
      countyInferred = true
    } else if (box && county && !county.toLowerCase().startsWith(box.county.toLowerCase())) {
      box = null
    }
  }
  const hvhz = climate?.flags?.hvhz === true && box?.hvhz === true
  if (countyInferred) {
    caveats.push(
      `County inferred from the site coordinates (${county}) — the parcel record carries none; verify.`,
    )
  }
  if (box?.zone) {
    zone.label = box.zone
    zone.key = box.zone.charAt(0)
  }
  const windRange = (() => {
    if (!hvhz) return null
    const m = /HVHZ[^0-9]*(\d+)\s*-\s*(\d+)\s*mph/i.exec(str(climate?.windNote))
    return m ? `${m[1]}–${m[2]} mph` : null
  })()
  if (!state) {
    caveats.push(
      'No state on the site node — notes cite IRC 2021. Set the project jurisdiction and re-issue.',
    )
  } else if (!adoption) {
    caveats.push(
      `No adoption record for "${state}" in jurisdictions-adoption.json — notes cite IRC 2021.`,
    )
  }
  caveats.push(
    adoption
      ? `Adopted code above is a drafting aid from a researched table; LOCAL AMENDMENTS ARE NOT INCLUDED and must be verified with the authority having jurisdiction${county ? ` (${county} County)` : ''}.`
      : 'Local amendments are not included and must be verified with the authority having jurisdiction.',
  )
  if (zone.raw && /\(/.test(zone.raw)) {
    caveats.push(
      box?.zone
        ? `Climate zone ${box.zone} — ${county} County (the state table reads "${zone.raw}"); confirm with the AHJ.`
        : `Climate zone varies by county in ${adoption?.name ?? state} (${zone.raw}) — confirm the site's zone with the AHJ.`,
    )
  }
  if (hvhz) {
    caveats.push(
      `${county} County is in the High-Velocity Hurricane Zone — HVHZ provisions (opening protection, roof uplift and product approvals) apply throughout; ultimate design wind speed ${windRange ?? 'per the ASCE 7 map'} — verify.`,
    )
  }
  if (climate?.caveat) caveats.push(climate.caveat)

  return {
    state,
    stateName: str(adoption?.name) || str(climate?.name) || state,
    county,
    city,
    code: str(adoption?.residentialCode) || FALLBACK_CODE,
    codeShort: shortCode(adoption),
    ircBase: adoption ? (adoption.ircBase ?? null) : 2021,
    resolved: Boolean(adoption),
    codeTag: codeTagOf(state, Boolean(adoption)),
    countyInferred,
    siteLngLat,
    windRange,
    climateZone: zone.label,
    climateZoneRaw: zone.raw,
    climateZoneCitation: str(EXTERIOR.stateClimateZoneCitation),
    wallInsulation: insulation?.value
      ? {
          value: insulation.value,
          options: insulation.compliance2021 ?? [],
          citation: str(insulation.citation),
        }
      : null,
    frostLineIn: typeof climate?.frostLineIn === 'number' ? climate.frostLineIn : null,
    frostLineNote: str(climate?.frostLineNote),
    ultimateWindMph: typeof climate?.ultimateWindMph === 'number' ? climate.ultimateWindMph : null,
    windNote: str(climate?.windNote),
    termiteRisk: str(climate?.termiteRisk),
    seismicSdc: str(climate?.seismicSdc),
    hvhz,
    hurricaneTies: climate?.flags?.hurricaneTies === true,
    caveats,
    specialRegimes: adoption?.specialRegimes ?? [],
    amendmentFlavor: str(adoption?.amendmentFlavor),
  }
}

/**
 * The one line every notes sheet opens with: what the section numbers below
 * actually refer to. Printed even when — especially when — the code could
 * not be resolved.
 */
export function codeHeaderLine(j: Jurisdiction): string {
  if (!j.resolved) {
    return `SECTION REFERENCES ARE TO THE 2021 INTERNATIONAL RESIDENTIAL CODE (IRC). THE ADOPTED CODE FOR THIS SITE IS NOT ESTABLISHED — VERIFY BEFORE SUBMITTAL.`
  }
  const base = j.ircBase ? `${j.ircBase} IRC section numbering` : 'the adopted code'
  return `ADOPTED CODE: ${j.codeShort.toUpperCase()}. SECTION REFERENCES BELOW USE ${base.toUpperCase()} AS ADOPTED; VERIFY LOCAL AMENDMENTS.`
}
