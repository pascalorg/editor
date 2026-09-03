/**
 * THE PRESCRIPTIVE ENVELOPE TABLE — only what the repo can actually cite.
 *
 * An energy sheet that prints an R-value nobody in this repository can point
 * to is a liability, so this module fills the VALUE column from two data
 * files and leaves every other row saying, in as many words, that the number
 * must come off the adopted code's table:
 *
 *   ceiling R      packages/plugin-bones/data/mep-rules.json
 *                  hvac.manualJLite.ceilingRByZone  (+ its own citation)
 *   wood wall R    packages/plugin-bones/data/wall-assemblies.json
 *                  exterior.insulationByClimateZone (+ its own citation)
 *   SHGC           mep-rules.json hvac.manualJLite.shgcAssumed — whose note
 *                  cites it as the zone 1–3 MAXIMUM, so it is printed as a
 *                  citation only in zones 1–3 and as "(verify)" elsewhere.
 *
 * Mass wall, floor, slab edge, fenestration U, skylight U, envelope air
 * leakage and duct leakage are in NO data file here. They print
 * "per <adopted energy code> Table R402.1.2 (verify)" and nothing else. That
 * is the whole point: a blank the reader must fill is honest, an invented
 * number is not.
 */
import mepRules from '../../../plugin-bones/data/mep-rules.json'
import assemblies from '../../../plugin-bones/data/wall-assemblies.json'
import { climateZoneOf, type Jurisdiction } from './jurisdiction'

const MJ = (
  mepRules as {
    hvac?: {
      manualJLite?: {
        ceilingRByZone?: Record<string, number>
        ceilingRNote?: string
        shgcAssumed?: number
        shgcNote?: string
      }
    }
  }
).hvac?.manualJLite

const INSULATION = (
  assemblies as {
    exterior?: {
      insulationByClimateZone?: Record<
        string,
        { value?: string; compliance2021?: string[]; citation?: string }
      >
    }
  }
).exterior?.insulationByClimateZone

export type RequirementRow = {
  component: string
  /** What the value column prints. */
  value: string
  /** Where it came from, or the table the reader must open. */
  source: string
  /** True when the value came out of a repo data file with a citation. */
  cited: boolean
}

export type EnergyCodeLabel = { long: string; short: string }

/**
 * The energy code this jurisdiction enforces, derived from the adoption row —
 * its `specialRegimes` name a state energy code where one exists, and its
 * `residentialCode` carries the edition year. Florida's row yields
 * "FBC-EC 2023"; a state with no energy regime falls back to the IECC edition
 * matching the IRC base.
 */
export function energyCodeLabel(j: Jurisdiction): EnergyCodeLabel {
  const regime = j.specialRegimes.find((entry) => /energy/i.test(entry)) ?? ''
  const year = /\((\d{4})\)/.exec(j.code)?.[1] ?? ''
  if (regime) {
    const head = (regime.split(/[,—–-]/)[0] ?? regime).trim()
    const initials = head
      .split(/\s+/)
      .filter((word) => /^[A-Z]/.test(word))
      .map((word) => word[0])
      .join('')
    const suffix = /energy/i.test(regime) ? '-EC' : ''
    return {
      long: year ? `${regime} (${year} edition)` : regime,
      short: `${initials}${suffix}${year ? ` ${year}` : ''}`,
    }
  }
  const base = j.ircBase ?? 2021
  return {
    long: `IRC ${base} Chapter 11 (N1101–N1104) / IECC ${base}`,
    short: `IECC ${base} / IRC N1102`,
  }
}

/** Rows for the PRESCRIPTIVE REQUIREMENTS table. */
export function prescriptiveRequirements(j: Jurisdiction): {
  code: EnergyCodeLabel
  zone: string | null
  rows: RequirementRow[]
  notes: string[]
} {
  const code = energyCodeLabel(j)
  const { label, key } = climateZoneOf(j.state)
  const verify = `per ${code.short} Table R402.1.2 (verify)`
  const rows: RequirementRow[] = []

  const ceilingR = key ? MJ?.ceilingRByZone?.[key] : undefined
  rows.push(
    ceilingR
      ? {
          component: 'Ceiling / attic',
          value: `R-${ceilingR}`,
          source: '2021 IECC Table R402.1.3 (mep-rules.json)',
          cited: true,
        }
      : { component: 'Ceiling / attic', value: verify, source: '—', cited: false },
  )

  const wall = key ? INSULATION?.[key] : undefined
  rows.push(
    wall?.value
      ? {
          component: 'Wood-frame wall',
          value:
            wall.compliance2021 && wall.compliance2021.length > 0
              ? wall.compliance2021.join('  ·  ')
              : wall.value.replace(/^R/, 'R-'),
          source: wall.citation ?? '2021 IECC Table R402.1.3',
          cited: true,
        }
      : { component: 'Wood-frame wall', value: verify, source: '—', cited: false },
  )

  rows.push({ component: 'Mass wall', value: verify, source: '—', cited: false })
  rows.push({ component: 'Floor', value: verify, source: '—', cited: false })
  rows.push({ component: 'Slab edge (R-value / depth)', value: verify, source: '—', cited: false })
  rows.push({ component: 'Fenestration U-factor', value: verify, source: '—', cited: false })
  rows.push({ component: 'Skylight U-factor', value: verify, source: '—', cited: false })

  const zoneDigit = key ? Number.parseInt(key, 10) : Number.NaN
  const shgc = MJ?.shgcAssumed
  rows.push(
    shgc !== undefined && zoneDigit >= 1 && zoneDigit <= 3
      ? {
          component: 'Glazed fenestration SHGC',
          value: `≤ ${shgc.toFixed(2)}`,
          source: '2021 IECC Table R402.1.2, zones 1–3 max (mep-rules.json)',
          cited: true,
        }
      : { component: 'Glazed fenestration SHGC', value: verify, source: '—', cited: false },
  )

  rows.push({
    component: 'Envelope air leakage (ACH50)',
    value: `per ${code.short} R402.4.1.2 (verify)`,
    source: 'Blower-door test by an approved third party',
    cited: false,
  })
  rows.push({
    component: 'Duct leakage (cfm25 / 100 sf)',
    value: `per ${code.short} R403.3.5 (verify)`,
    source: 'Duct leakage test, rough-in or postconstruction',
    cited: false,
  })

  const notes: string[] = [
    `Adopted energy code: ${code.long}. Section numbers above are the IECC/IRC numbering the adopted code is based on — verify the adopted numbering and any state amendment.`,
    'Rows reading "(verify)" are NOT carried in this drawing set’s data. Take the value from the adopted code’s component table before ordering insulation or fenestration.',
  ]
  if (rows.some((row) => row.cited)) {
    notes.push(
      'Cited rows are the IECC base values shipped with this repository’s assembly data; a state energy code may amend them.',
    )
  }
  if (!label) {
    notes.push(
      'No climate zone resolved for this site — every row must be taken from the adopted code’s table by hand.',
    )
  }
  return { code, zone: label, rows, notes }
}

/**
 * The compliance path note. Pascal computes areas; it does not run a
 * performance model, and saying so on the sheet is the point.
 */
export function compliancePathNote(j: Jurisdiction, code: EnergyCodeLabel): string[] {
  const florida = /florida/i.test(j.stateName) || j.state === 'FL'
  if (florida) {
    return [
      `COMPLIANCE PATH — NOT COMPUTED BY PASCAL. Attach ${code.short} Form R402 (prescriptive) or Form R405 (performance, simulated), prepared and signed by the responsible designer or a registered energy rater, to this permit set.`,
      'The areas on this sheet are the inputs to that form, taken from the model. They are not, in themselves, a demonstration of compliance.',
      'Blower-door and duct-leakage tests are by an approved third party; record the results on the permanent certificate at the electrical panel.',
    ]
  }
  return [
    `COMPLIANCE PATH — NOT COMPUTED BY PASCAL. Demonstrate compliance by the prescriptive path of ${code.long}, by the total UA alternative, or by an approved simulated-performance analysis, and attach the completed forms to this permit set.`,
    'The areas on this sheet are the inputs to that analysis, taken from the model. They are not, in themselves, a demonstration of compliance.',
    'Blower-door and duct-leakage tests are by an approved third party; record the results on the permanent certificate at the electrical panel.',
  ]
}
