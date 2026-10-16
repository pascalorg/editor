import type { AnyNode, AnyNodeId } from '../schema'
import type { Assembly } from '../schema/assembly'
import { FOUNDATION_STANDARD } from './foundation-standard'

/** What a foundation wall is built of: block, or cast in place. */
export type FoundationConstructionId = 'cmu' | 'cast-concrete'

/** Where the scene says the building stands, as far as foundation practice goes. */
export type FoundationRegionId = 'us' | 'europe' | 'generic'

export type FoundationConstruction = {
  id: FoundationConstructionId
  /** Short name, for the results the agent reads. */
  label: string
  /** The wall as the agent is told of it. */
  description: string
  /** The stack a new foundation wall stores, outside in (the wall's thickness is its sum). */
  assembly: Assembly
  /** The course the generic foundation draws up to the floor, where the walls above it are thinner. */
  stemThickness: number
  /** How far the ground floor stands over finished grade: the top of the foundation, metres. */
  seatAboveGrade: number
  /** Where the seat comes from. */
  seatBasis: string
  /** Whether the numbers cite a standard (`standard`) or are a sensible default (`default`). */
  source: 'standard' | 'default'
}

const INCH = 0.0254

/**
 * The foundation constructions, as data: the wall a person gets below grade, the course the generic
 * foundation draws, and how high the floor stands over the ground. The generic one (`cmu`) is the
 * US residential practice and stays the answer wherever nothing says better.
 *
 * - `cmu`: 8 in block, 2x4 pressure-treated furring laid flat inside (IRC R404.1, R317.1), the
 *   floor 8 in over grade (R317.1 keeps wood framing that far off exposed ground).
 * - `cast-concrete`: the continental and British practice of a cast wall, 25 cm, insulated and
 *   waterproofed on the outside. The thicknesses are the usual ones (cellar walls of 20 to 25 cm,
 *   perimeter insulation of 10 cm, a 4 mm bitumen sheet), a sensible default rather than one
 *   country's code. The floor 15 cm over the ground: the damp-proof course of British practice
 *   (Approved Document C, NHBC) stands at least 150 mm over it, and plinths elsewhere run as high.
 */
export const FOUNDATION_CONSTRUCTIONS: Record<FoundationConstructionId, FoundationConstruction> = {
  cmu: {
    id: 'cmu',
    label: 'CMU',
    description:
      '8 in (0.203 m) CMU with 2x4 pressure-treated furring laid flat on the inside, 16 in on centre, interior finish as the level has it',
    assembly: {
      layers: [
        { id: 'block', role: 'structure', core: true, material: 'cmu', thickness: 0.203 },
        // IRC R317.1: furring on the inside of below-grade masonry is pressure treated, 16 in on centre.
        { id: 'furring', role: 'furring', material: 'pressure-treated wood', thickness: 0.038 },
      ],
      face: 'exterior',
    },
    stemThickness: FOUNDATION_STANDARD.stemThickness,
    seatAboveGrade: 0.203,
    seatBasis:
      'IRC R317.1 keeps wood framing resting on a foundation wall 8 in from exposed ground',
    source: 'standard',
  },
  'cast-concrete': {
    id: 'cast-concrete',
    label: 'cast concrete',
    description:
      '25 cm (0.25 m) cast concrete with 10 cm of insulation and a bitumen waterproofing membrane on the outside, interior finish as the level has it',
    assembly: {
      layers: [
        { id: 'membrane', role: 'membrane', material: 'bitumen membrane', thickness: 0.004 },
        { id: 'insulation', role: 'insulation', material: 'perimeter insulation', thickness: 0.1 },
        { id: 'concrete', role: 'structure', core: true, material: 'concrete', thickness: 0.25 },
      ],
      face: 'exterior',
    },
    stemThickness: 0.25,
    seatAboveGrade: 0.15,
    seatBasis:
      'a sensible default: the damp-proof course of British practice (Approved Document C, NHBC) stands at least 150 mm over the ground and continental plinths run about as high; verify the local rule',
    source: 'default',
  },
}

/**
 * What the tool descriptions say of the construction, in one phrase; a test keeps its numbers equal
 * to the data above.
 */
export const FOUNDATION_BY_REGION_NOTE =
  "built of what the building's region says: 8 in CMU with 2x4 pressure-treated furring laid flat inside (0.241 m) in the United States and where the scene does not say where the building stands, 25 cm cast concrete insulated and waterproofed outside (0.354 m) in Europe; the result names the region it read"

/** What the scene says about where the building stands, and the construction that follows. */
export type FoundationReading = {
  region: FoundationRegionId
  construction: FoundationConstruction
  /** Why this construction, for the agent: the region read and what it was read from. */
  basis: string
}

type Nodes = Record<AnyNodeId, AnyNode>
type Loose = Record<string, unknown>

const US_STATES = new Set(
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(
    ' ',
  ),
)

const US_STATE_NAMES: Record<string, string> = Object.fromEntries([
  ['ALABAMA', 'AL'],
  ['ALASKA', 'AK'],
  ['ARIZONA', 'AZ'],
  ['ARKANSAS', 'AR'],
  ['CALIFORNIA', 'CA'],
  ['COLORADO', 'CO'],
  ['CONNECTICUT', 'CT'],
  ['DELAWARE', 'DE'],
  ['DISTRICT OF COLUMBIA', 'DC'],
  ['FLORIDA', 'FL'],
  ['GEORGIA', 'GA'],
  ['HAWAII', 'HI'],
  ['IDAHO', 'ID'],
  ['ILLINOIS', 'IL'],
  ['INDIANA', 'IN'],
  ['IOWA', 'IA'],
  ['KANSAS', 'KS'],
  ['KENTUCKY', 'KY'],
  ['LOUISIANA', 'LA'],
  ['MAINE', 'ME'],
  ['MARYLAND', 'MD'],
  ['MASSACHUSETTS', 'MA'],
  ['MICHIGAN', 'MI'],
  ['MINNESOTA', 'MN'],
  ['MISSISSIPPI', 'MS'],
  ['MISSOURI', 'MO'],
  ['MONTANA', 'MT'],
  ['NEBRASKA', 'NE'],
  ['NEVADA', 'NV'],
  ['NEW HAMPSHIRE', 'NH'],
  ['NEW JERSEY', 'NJ'],
  ['NEW MEXICO', 'NM'],
  ['NEW YORK', 'NY'],
  ['NORTH CAROLINA', 'NC'],
  ['NORTH DAKOTA', 'ND'],
  ['OHIO', 'OH'],
  ['OKLAHOMA', 'OK'],
  ['OREGON', 'OR'],
  ['PENNSYLVANIA', 'PA'],
  ['RHODE ISLAND', 'RI'],
  ['SOUTH CAROLINA', 'SC'],
  ['SOUTH DAKOTA', 'SD'],
  ['TENNESSEE', 'TN'],
  ['TEXAS', 'TX'],
  ['UTAH', 'UT'],
  ['VERMONT', 'VT'],
  ['VIRGINIA', 'VA'],
  ['WASHINGTON', 'WA'],
  ['WEST VIRGINIA', 'WV'],
  ['WISCONSIN', 'WI'],
  ['WYOMING', 'WY'],
] as const)

/** 'tx', 'Texas', 'TEXAS ' → 'TX'; null for anything that is no US state (a Canadian province, a French région). */
function usStateOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim().toUpperCase().replace(/\s+/g, ' ')
  if (US_STATES.has(text)) return text
  return US_STATE_NAMES[text] ?? null
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const UNITED_STATES_NAMES = new Set(['usa', 'us', 'united states', 'united states of america'])
/** The countries a formatted address can end with, where masonry and cast foundations are the practice. */
const EUROPEAN_COUNTRY_NAMES = new Set(
  [
    'albania, andorra, austria, belgium, belgique, belgie, bosnia and herzegovina, bulgaria, croatia, cyprus,',
    'czechia, czech republic, denmark, estonia, finland, france, germany, deutschland, greece, hungary,',
    'iceland, ireland, italy, italia, latvia, liechtenstein, lithuania, luxembourg, malta, monaco,',
    'montenegro, netherlands, nederland, north macedonia, norway, poland, portugal, romania,',
    'san marino, serbia, slovakia, slovenia, spain, espana, sweden, switzerland, suisse, schweiz,',
    'svizzera, united kingdom, uk, great britain, england, scotland, wales, northern ireland',
  ]
    .join(' ')
    .split(',')
    .map((name) => name.trim()),
)

/** The country the last part of a formatted address names ('…, 75008 Paris, France'), as a region. */
function regionOfAddress(
  formatted: unknown,
): { region: FoundationRegionId; country: string } | null {
  if (typeof formatted !== 'string') return null
  const last = formatted.split(',').at(-1)
  if (!last) return null
  const country = fold(last)
  if (UNITED_STATES_NAMES.has(country)) return { region: 'us', country: last.trim() }
  if (EUROPEAN_COUNTRY_NAMES.has(country)) return { region: 'europe', country: last.trim() }
  return null
}

/**
 * A coarse box over Europe, for a site with a point and no address. It leaves out Africa and the
 * Near East, and what it takes in beyond the continent (Anatolia's west, Kaliningrad) is masonry
 * country too. Canada and the United States are not read from coordinates: their border is no
 * box, and a site with only a point there keeps the generic construction.
 */
function inEurope(lat: number, lng: number): boolean {
  return lat >= 36 && lat <= 71.5 && lng >= -10.7 && lng <= 31
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function siteOf(nodes: Nodes, buildingId: string | null | undefined): Loose | null {
  const building = buildingId ? nodes[buildingId as AnyNodeId] : undefined
  const parent = building?.parentId ? nodes[building.parentId as AnyNodeId] : undefined
  if (parent?.type === 'site') return parent as unknown as Loose
  const site = Object.values(nodes).find((node) => node.type === 'site')
  return (site as unknown as Loose | undefined) ?? null
}

/**
 * Where the scene says the building stands, from what it carries without any plugin and in the
 * order Bones' jurisdiction guess reads the same site: the state set by hand on the site
 * (`metadata.codeOverrides.state`), the site's address state, the parcel's state; then, which
 * Bones has no use for, the country the dossier's address ends with, and last the site's
 * coordinates (a point over Europe). Nothing else is guessed: not the browser (core runs on the
 * server too, where there is none), and a state or country that is not recognised leaves the
 * region generic.
 */
export function foundationRegionOf(
  nodes: Nodes,
  buildingId?: string | null,
): { region: FoundationRegionId; basis: string } {
  const site = siteOf(nodes, buildingId)
  const nowhere = {
    region: 'generic' as const,
    basis:
      'the scene does not say where the building stands (no site state, address country or coordinates)',
  }
  if (!site) return nowhere
  const overrides = (site.metadata as { codeOverrides?: Loose } | undefined)?.codeOverrides
  const byHand = usStateOf(overrides?.state)
  if (byHand) return { region: 'us', basis: `the site's code overrides set the state ${byHand}` }
  const addressState = usStateOf((site.address as Loose | undefined)?.state)
  if (addressState)
    return { region: 'us', basis: `the site's address is in the state ${addressState}` }
  const parcelState = usStateOf((site.parcel as Loose | undefined)?.state)
  if (parcelState)
    return { region: 'us', basis: `the site's parcel is in the state ${parcelState}` }

  const dossier = site.dossier as { address?: Loose; point?: Loose } | undefined
  const named = regionOfAddress(dossier?.address?.formatted)
  if (named) {
    return {
      region: named.region,
      basis: `the site's dossier address ends with ${named.country}`,
    }
  }
  const origin = (site.parcel as { originLngLat?: unknown } | undefined)?.originLngLat
  const points: Array<{ lat: unknown; lng: unknown }> = [
    { lat: dossier?.point?.lat, lng: dossier?.point?.lng },
    ...(Array.isArray(origin) ? [{ lat: origin[1], lng: origin[0] }] : []),
  ]
  for (const { lat, lng } of points) {
    if (finite(lat) && finite(lng) && inEurope(lat, lng)) {
      return {
        region: 'europe',
        basis: `the site's coordinates (${lat.toFixed(2)}, ${lng.toFixed(2)}) lie in Europe`,
      }
    }
  }
  return nowhere
}

/**
 * The foundation construction of a building, by region: the US block practice, cast concrete in
 * Europe, and the generic block where the scene says nothing. `basis` names what was read, for the
 * agent to repeat.
 */
export function foundationReadingOf(nodes: Nodes, buildingId?: string | null): FoundationReading {
  const { region, basis: regionBasis } = foundationRegionOf(nodes, buildingId)
  const id: FoundationConstructionId = region === 'europe' ? 'cast-concrete' : 'cmu'
  const regionPart =
    region === 'generic'
      ? `no region known (${regionBasis})`
      : `region ${region === 'us' ? 'United States' : 'Europe'} (${regionBasis})`
  const basis = `${regionPart}${region === 'generic' ? '; the generic block foundation applies' : ''}`
  return { region, construction: FOUNDATION_CONSTRUCTIONS[id], basis }
}

/** The reading for the building a level belongs to (no building: the site's region alone). */
export function foundationReadingOfLevel(nodes: Nodes, levelId: string): FoundationReading {
  const parent = nodes[(nodes[levelId as AnyNodeId]?.parentId ?? '') as AnyNodeId]
  return foundationReadingOf(nodes, parent?.type === 'building' ? parent.id : null)
}
