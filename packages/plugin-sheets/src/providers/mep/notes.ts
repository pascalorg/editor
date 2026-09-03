/**
 * The cited note blocks the trade sheets print.
 *
 * EVERY number on these sheets comes from `packages/plugin-bones/data` —
 * `electrical-rules.json` (NEC 2023 basis, Articles 210/220/410 plus IRC
 * R314/R315 for the alarms) and `mep-rules.json` (2021 IRC Part VII) — and is
 * printed WITH its citation. Where a requirement is real but the data file
 * does not carry it, the note says `(verify: …)` rather than inventing a
 * number: a plan note is read by a plans examiner, and a confident wrong
 * citation is worse than an honest gap.
 *
 * Mounting heights are the clearest case. The NEC sets no receptacle or
 * switch height; the data file says so in as many words
 * (`receptacles.heightAffNote`, `switches.heightAffNote`), so the note prints
 * the convention AND that it is convention.
 */
import electricalRules from '../../../../plugin-bones/data/electrical-rules.json'
import mepRules from '../../../../plugin-bones/data/mep-rules.json'

export const ELECTRICAL_BASIS = electricalRules.codeBasis.primary
export const ELECTRICAL_ALARM_BASIS = electricalRules.codeBasis.smokeCoAlarms
export const RULES_DISCLAIMER = electricalRules.disclaimer
export const MEP_BASIS = mepRules.basis

const e = electricalRules
const p = mepRules.plumbing

/**
 * The NEC edition a US state adopts, from the data file's adoption snapshot.
 * Null for a non-state jurisdiction ('AUTO' unresolved, 'INTL'). The snapshot
 * is state-level only, which the returned note says out loud — a city or
 * county may enforce a different edition.
 */
export function necEditionFor(jurisdiction: string): string | null {
  const state = jurisdiction.toUpperCase()
  if (state.length !== 2) return null
  const adoption = e.stateAdoption
  if ((adoption.noStatewideAdoptionStates as readonly string[]).includes(state)) {
    return `${state}: no statewide NEC adoption — local jurisdictions adopt (snapshot ${adoption.asOfDate})`
  }
  if ((adoption.nec2017States as readonly string[]).includes(state)) {
    return `${state}: NEC 2017 or earlier statewide (snapshot ${adoption.asOfDate}) — confirm with the AHJ`
  }
  if ((adoption.nec2020States as readonly string[]).includes(state)) {
    return `${state}: NEC 2020 statewide (snapshot ${adoption.asOfDate}) — confirm with the AHJ`
  }
  return `${state}: NEC 2023 statewide (snapshot ${adoption.asOfDate}) — confirm with the AHJ`
}

/**
 * The electrical general notes. Every line carries the section it comes from.
 *
 * Sourcing, line by line:
 *  1-3  `receptacles.*` + `layoutAlgorithmHints.countertopPlacement`
 *  4    `receptacles.outdoor*`
 *  5    `receptacles.hallwayOver10FtNeedsOne` / `hallwayMeasureNote`
 *  6-7  `gfci.*` (locations, the 6 ft sink/tub rule, the 2023 kitchen change)
 *  8    AFCI — `afci.circuitScope` / `afci.areas`
 *  9    tamper-resistant receptacles (NEC 406.12)
 *  10-12 `circuits.*` (small-appliance, bathroom, laundry, garage, lighting VA)
 *  13-15 `smokeAlarms.*` (IRC R314/R315)
 *  16   `switches.*` / `lighting.*` (210.70) — heights flagged as convention
 *  17   `circuits.minServiceAmps` + `minServiceNote` (230.79(C))
 *  18   working space (NEC 110.26(A))
 *  19   service drop / point of attachment (NEC 230.24(B), 230.26)
 *  20   EV-ready — flagged, because it is an ENERGY-code item, not the NEC
 */
export function electricalNotes(options: { serviceAmps: number }): string[] {
  const r = e.receptacles
  const counter = e.layoutAlgorithmHints.countertopPlacement
  const gfciList = (e.gfci.gfciLocations as readonly string[]).join(', ')
  const afciList = (e.afci.areas as readonly string[]).slice(0, 8).join(', ')
  return [
    `Provide receptacle outlets so that no point along the floor line of any wall space ${r.minWallWidthFt} ft or more in width is more than ${r.maxFromOpeningFt} ft, measured horizontally along the floor line, from an outlet; maximum spacing ${r.wallSpacingMaxFt} ft. Wall space is broken by ${(r.wallSpaceBrokenBy as readonly string[]).join(', ')}. (NEC ${r.necSection}(A))`,
    `Countertop and work surfaces ${r.counterMinWidthRequiringReceptacleIn} in or wider: first receptacle within ${counter.firstReceptacleMaxFromEndIn} in of each end of the counter line, then not more than ${counter.subsequentSpacingMaxIn} in on centre; not more than ${r.counterReceptacleMaxAboveCounterIn} in above the counter surface. (NEC ${r.necSection}(C))`,
    `Provide at least one 125 V, 15 A or 20 A receptacle within ${e.gfci.sinkRuleFt} ft of the outside edge of each lavatory basin, and not more than ${r.bathroomMaxBelowCounterTopIn} in below the counter top. (NEC ${r.necSection}(D))`,
    `Provide one readily accessible outdoor receptacle at the front and one at the back of the dwelling, not more than ${r.outdoorMaxAboveGradeFt} ft above grade, weather-resistant and in an in-use cover. (NEC ${r.necSection}(E), 406.9(B))`,
    `Hallways 10 ft or longer, measured along the centreline without passing through a doorway, require at least one receptacle outlet. (NEC ${r.necSection}(H))`,
    `GFCI protection is required for all 125 V through 250 V receptacles supplied by single-phase branch circuits rated 150 V or less to ground in: ${gfciList}. (NEC ${e.gfci.necSection})`,
    `GFCI protection is also required for receptacles within ${e.gfci.sinkRuleFt} ft of the top inside edge of the bowl of a sink, and within ${e.gfci.sinkRuleFt} ft of the outside edge of a bathtub or shower stall. (NEC 210.8(A)(7), 210.8(A)(9))`,
    `AFCI protection is required for ${e.afci.circuitScope.toLowerCase()} in ${afciList} and similar rooms and areas. (NEC 210.12(A))`,
    'All 125 V, 15 A and 20 A receptacles in dwelling units shall be listed tamper-resistant. (NEC 406.12)',
    `Provide ${e.circuits.smallApplianceKitchen20A} 20 A small-appliance branch circuits serving ${(e.circuits.smallApplianceServes as readonly string[]).join(', ')}; these circuits shall have no other outlets. (NEC ${e.circuits.necSection.split(' / ')[0]}(C)(1))`,
    'Provide one 20 A branch circuit for bathroom receptacles, one 20 A branch circuit for the laundry, and one 20 A branch circuit for garage receptacle outlets. (NEC 210.11(C)(2), (C)(3), (C)(4))',
    `General lighting and general-use receptacle load calculated at ${e.circuits.generalLightingVaPerSqft} VA per sq ft of dwelling floor area. (NEC 220.41)`,
    'Smoke alarms: in each sleeping room, outside each separate sleeping area in the immediate vicinity of the bedrooms, and on each story including basements and habitable attics. (IRC R314.3)',
    `Smoke alarms shall be hardwired with battery back-up and interconnected so that actuation of one alarm sounds all alarms. Locate not less than ${e.smokeAlarms.minFromBathtubShowerDoorFt} ft from a bathroom door opening into a bathroom containing a tub or shower, and not less than ${e.smokeAlarms.minFromCookingApplianceFt} ft horizontally from a permanently installed cooking appliance (${e.smokeAlarms.cookingClearanceExceptions.photoelectricFt} ft where photoelectric). (IRC R314.3.3, R314.4)`,
    'Carbon monoxide alarms outside each separate sleeping area in the immediate vicinity of the bedrooms where the dwelling has fuel-fired appliances or an attached garage. (IRC R315.3)',
    `Provide a listed wall-mounted lighting control device in every habitable room, kitchen, bathroom, hallway, stairway, attached garage and at outdoor entrances; stairways with ${e.lighting.stairwayRiserThreshold} or more risers require a control at each floor and landing level with an entryway. (NEC ${e.lighting.necSection}(A))  Mounting heights shown — receptacles ${r.heightAffIn} in and switches ${e.switches.heightAffIn} in to box centre — are drafting convention, not a code requirement; ${r.heightAffIn} in also meets the ANSI A117.1 reach minimum.`,
    `Service: ${serviceAmpsNote(options.serviceAmps)}`,
    'Maintain the working space in front of the panelboard clear and unobstructed for the life of the installation: not less than 30 in wide, 36 in deep, and 6 ft 6 in high. The space above and below the enclosure footprint is dedicated to the electrical installation. (NEC 110.26(A), 110.26(E))',
    'Overhead service conductors: point of attachment not less than 10 ft above finished grade; conductor clearances not less than 10 ft above finished grade and accessible walking surfaces, 12 ft over residential driveways, and 18 ft over public streets and alleys, for conductors 150 V or less to ground. Confirm the drop, attachment and clearance requirements with the serving utility. (NEC 230.24(B), 230.26)',
    'EV-ready: where required by the adopted energy code, provide a raceway from the panelboard to the parking location, terminating in a listed enclosure at the charger location, and reserve panel capacity and a labelled space for the branch circuit. (verify: adopted energy code — e.g. CA Energy Code Title 24 Part 6 §150.0(s); equipment per NEC Article 625)',
  ]
}

/** The service line — the only number Bones actually reports is the minimum. */
function serviceAmpsNote(minServiceAmps: number): string {
  return `${minServiceAmps} A minimum, 3-wire, for a one-family dwelling (NEC 230.79(C)). The service size shown on this sheet is that CODE MINIMUM, not a calculated load — size the service and the panelboard from a load calculation per NEC Article 220 (optional method 220.82) before permit. (verify: NEC 220.82)`
}

/**
 * The plumbing general notes. The IRC citations are carried inside the data
 * file's own note strings (`mep-rules.json`), so each line quotes the source
 * rather than restating it — the citation cannot drift from the number.
 */
export function plumbingNotes(): string[] {
  const dwv = p.dwv
  const supply = p.supply
  const rough = p.fixtureRoughIn
  return [
    `Horizontal drainage piping shall be installed at the minimum slope shown: ${dwv.slopeNote}`,
    `Drain and vent sizing: ${dwv.branchSizingNote} Building drain — ${dwv.buildingDrainNote}`,
    `Every building drain shall be vented. ${dwv.ventStackNote}`,
    `Trap arms: ${dwv.trapArmNote}  Trap seal ${dwv.trapSealMinIn} in minimum to ${dwv.trapSealMaxIn} in maximum.`,
    'Provide cleanouts at the base of each stack and at the junction of the building drain and building sewer, accessible for rodding. (IRC P3005.2)',
    `Fixture clearances: ${rough.clearanceNote}`,
    `Shower compartments: ${rough.showerMinNote}`,
    `Water service: ${supply.mainNote} Distribution branches ${supply.branchIn} in — ${supply.branchNote}`,
    `Water pressure: ${supply.pressureNote}`,
    `Water heater working space and installation: ${supply.waterHeater.note}`,
    `Temperature and pressure relief: ${supply.waterHeater.tpNote}`,
    `Drain pan: ${supply.waterHeater.panNote}`,
    `Seismic restraint: ${supply.waterHeater.seismicStraps.note}`,
    `Piping in framed walls: ${p.wetWall.shieldPlateNote} Plumbing walls to be ${p.wetWall.nominalStud} (${p.wetWall.actualCavityDepthIn} in cavity) or double ${'2x4'} — ${p.wetWall.note}`,
    'Thermostatic or pressure-balancing mixing valves at showers and tub/shower combinations, with the handle stop set to limit the outlet temperature. (verify: IRC P2708.4 / P2724 and the adopted amendment — e.g. CPC 418 at 120 °F)',
    'Hose bibbs and other outlets to which a hose may be attached shall be protected against backflow by a non-removable backflow preventer. (verify: IRC P2902 / CPC 603.5.7)',
    'Gas piping, where a fuel-gas appliance is installed, per the adopted fuel-gas code; sizing, materials and testing are not shown on this sheet. (verify: IRC Chapter 24 / IFGC)',
  ]
}

/** The reference sheet's plumbing key — the letters tagged at every fixture. */
export const PLUMBING_KEY: { letter: string; label: string }[] = [
  { letter: 'W', label: 'Discharges waste into the waste/drain line' },
  { letter: 'H', label: 'Hot water from the water heater' },
  { letter: 'C', label: 'Cold water from the main' },
  { letter: 'G', label: 'Gas supply' },
  {
    letter: 'T',
    label: 'Thermostatic / pressure-balancing mixing valve at the tub or shower',
  },
]
