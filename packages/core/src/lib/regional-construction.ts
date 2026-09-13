/**
 * Regional construction conventions — what a house in a place is normally
 * built of, as distinct from what the code requires. The first case is
 * Florida's exterior walls: concrete block (CMU) is the norm through the
 * peninsula and the Miami-Dade / Broward High-Velocity Hurricane Zone, wood
 * frame the norm in North Florida and the Panhandle, and NO Florida
 * jurisdiction mandates block — the FBC accepts wood frame with its wind
 * design everywhere. Steve, 2026-09-09: "i want the florida houses to show
 * block in mandated areas not the whole state". One table, read by the
 * generator (which writes the wall assembly) and by Bones (which frames what
 * the assembly says, and falls back to this when a wall declares nothing).
 *
 * Sources (conventions, not citations of law): the FBC's HVHZ is Miami-Dade
 * and Broward (FBC-B 202); the block belt is the peninsula south of roughly
 * the Ocala–Daytona line; verify the local norm with the AHJ / builders.
 */

export type ExteriorWallSystem = 'cmu' | 'framed'

export type ExteriorWallConvention = {
  system: ExteriorWallSystem
  /** Why — one line for the panel, the summary and the level warning. */
  basis: string
  /** Inside the FBC High-Velocity Hurricane Zone (Miami-Dade, Broward). */
  hvhz: boolean
}

export type ConventionSite = {
  /** Two-letter state code. */
  state?: string | null
  /** County name, with or without "County". */
  county?: string | null
  /** Latitude, decimal degrees north. */
  lat?: number | null
}

/** The FBC High-Velocity Hurricane Zone. */
export const FL_HVHZ_COUNTIES: readonly string[] = ['miami-dade', 'broward']

/**
 * Peninsular Florida counties where block is the norm for a one-storey
 * house (and the ground storey of a two-storey). Counties near the line
 * (Marion, Flagler, Putnam …) fall to the latitude rule below.
 */
export const FL_BLOCK_BELT_COUNTIES: readonly string[] = [
  'palm beach',
  'monroe',
  'collier',
  'lee',
  'charlotte',
  'sarasota',
  'manatee',
  'hillsborough',
  'pinellas',
  'pasco',
  'hernando',
  'citrus',
  'sumter',
  'polk',
  'hardee',
  'desoto',
  'highlands',
  'glades',
  'hendry',
  'okeechobee',
  'martin',
  'st. lucie',
  'st lucie',
  'indian river',
  'brevard',
  'osceola',
  'orange',
  'seminole',
  'lake',
  'volusia',
]

/** North of this latitude wood frame is the norm (the Ocala–Daytona line). */
export const FL_BLOCK_BELT_NORTH_LAT = 29.6

function normalizeCounty(county: string | null | undefined): string | null {
  if (!county) return null
  const trimmed = county
    .trim()
    .toLowerCase()
    .replace(/\s+county$/, '')
    .replace(/\s+/g, ' ')
  return trimmed.length > 0 ? trimmed : null
}

function titleCase(county: string): string {
  return county.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bSt\b/, 'St.')
}

/**
 * The exterior-wall convention for a site. Outside Florida: wood frame.
 * In Florida: block in the HVHZ and the peninsular block belt (by county,
 * else by latitude), wood frame in the north and the Panhandle, and wood
 * frame when the place is not known at all.
 */
export function exteriorWallConvention(site: ConventionSite): ExteriorWallConvention {
  const state = (site.state ?? '').trim().toUpperCase()
  if (state !== 'FL') {
    return {
      system: 'framed',
      basis: `wood frame — the norm ${state ? `in ${state}` : 'outside Florida'}`,
      hvhz: false,
    }
  }
  const county = normalizeCounty(site.county)
  if (county && FL_HVHZ_COUNTIES.includes(county)) {
    return {
      system: 'cmu',
      basis: `${titleCase(county)} County — the FBC High-Velocity Hurricane Zone; concrete block with a product-approved envelope is the norm (the code accepts wood frame with its wind design — verify with the AHJ)`,
      hvhz: true,
    }
  }
  if (county && FL_BLOCK_BELT_COUNTIES.includes(county)) {
    return {
      system: 'cmu',
      basis: `${titleCase(county)} County — peninsular Florida, where concrete block is the norm for a one-storey house; wood frame is legal under the FBC wind design (a convention, not a code mandate — verify with the AHJ)`,
      hvhz: false,
    }
  }
  const lat = typeof site.lat === 'number' && Number.isFinite(site.lat) ? site.lat : null
  if (lat !== null) {
    if (lat < FL_BLOCK_BELT_NORTH_LAT) {
      return {
        system: 'cmu',
        basis: `${county ? `${titleCase(county)} County, ` : ''}${lat.toFixed(2)}°N — south of the Ocala–Daytona line, where concrete block is the norm; wood frame is legal under the FBC wind design (a convention, not a code mandate — verify with the AHJ)`,
        hvhz: false,
      }
    }
    return {
      system: 'framed',
      basis: `${county ? `${titleCase(county)} County, ` : ''}${lat.toFixed(2)}°N — North Florida / the Panhandle, where wood frame to the FBC wind design is the norm (block is common too — verify with the AHJ)`,
      hvhz: false,
    }
  }
  if (county) {
    return {
      system: 'framed',
      basis: `${titleCase(county)} County — North Florida / the Panhandle, where wood frame to the FBC wind design is the norm (verify with the AHJ)`,
      hvhz: false,
    }
  }
  return {
    system: 'framed',
    basis: 'Florida, place unknown — wood frame assumed; drop in a lot (county / location) to get the regional norm',
    hvhz: false,
  }
}
