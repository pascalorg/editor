/**
 * THE GENERAL NOTES, AS DATA.
 *
 * Every line here is a drafting note in the imperative, and every line
 * carries the section it comes from. Section numbers are IRC 2021 (the base
 * of the code the site's jurisdiction adopts — see `jurisdiction.ts`); a
 * jurisdiction whose adopted code renumbers or amends a section is the
 * reader's to verify, which the sheet header says out loud.
 *
 * TWO HONESTY RULES, both enforced by hand when a note is added:
 *
 *  1. `cite` is the section this note is actually drawn from. Where the exact
 *     subsection is not certain, `verify: true` prints "(verify: R802.5)" —
 *     the reader is told to check rather than being handed a number that
 *     looks authoritative and is not.
 *  2. A handful of notes are drafting conventions, not code (do not scale;
 *     verify field conditions). They print "(drafting standard)" rather than
 *     borrowing a section number they do not come from.
 *
 * Notes that only apply somewhere print only there: `when` filters a section
 * or a note by the resolved jurisdiction (wind-borne debris in Florida, frost
 * depth where there is one, sprinklers where the state amended R313).
 */
import type { Jurisdiction } from './jurisdiction'

export type Note = {
  text: string
  /** IRC section this note is drawn from. Empty = drafting convention. */
  cite: string
  /** Print as "(verify: …)" — the exact subsection is not certain. */
  verify?: boolean
  /** Only include this note when the predicate passes. */
  when?: (j: Jurisdiction) => boolean
}

export type NoteSection = {
  title: string
  notes: Note[]
}

/** How a note's citation reads on the paper. */
export function citation(note: Note): string {
  if (!note.cite) return '(drafting standard)'
  return note.verify ? `(verify: ${note.cite})` : `(${note.cite})`
}

/** One flowable line of note text: the number, the sentence, the citation. */
export function noteLine(index: number, note: Note): string {
  return `${index}.  ${note.text} ${citation(note)}`
}

/* ------------------------------------------------------------- helpers */

const inWindBorneDebris = (j: Jurisdiction): boolean =>
  j.hvhz || j.hurricaneTies || (j.ultimateWindMph ?? 0) >= 130

const hasFrostDepth = (j: Jurisdiction): boolean => (j.frostLineIn ?? 0) > 0

/* ------------------------------------------------------------ sections */

/**
 * The whole notes body for a jurisdiction. Sections are printed in this
 * order; a section whose notes all filter out is dropped entirely.
 */
export function generalNoteSections(j: Jurisdiction): NoteSection[] {
  const frost = j.frostLineIn ?? 12
  const zone = j.climateZone ?? 'the site climate zone'
  const wallR = j.wallInsulation
  const sections: NoteSection[] = [
    {
      title: 'General & codes',
      notes: [
        {
          text: `All work shall comply with ${j.resolved ? j.codeShort : 'the adopted residential code'} and with the local amendments of the jurisdiction named in the title block.`,
          cite: 'R101.2',
        },
        {
          text: 'Obtain a permit and the approved construction documents before starting work, and keep the approved set on the job site for the duration of the work.',
          cite: 'R105.1, R106.3.1',
        },
        {
          text: 'Notify the building department for every required inspection. Do not cover or conceal work until it has been inspected and approved.',
          cite: 'R109.1',
        },
        {
          text: 'Do not occupy any part of the building until the building official has issued a certificate of occupancy.',
          cite: 'R110.1',
        },
        {
          text: 'Structural design criteria — wind, seismic, snow, frost and soil — are those listed in the project data on the cover sheet. Do not exceed the design loads shown.',
          cite: 'R301.1, Table R301.2(1)',
        },
        {
          text: 'Build every condition not detailed on these drawings to the code minimum and to the manufacturer’s printed installation instructions; where the two differ, the more restrictive governs.',
          cite: 'R102.4',
          verify: true,
        },
        {
          text: 'Submit alternative materials, designs and methods of construction to the building official for written approval before installation.',
          cite: 'R104.11',
        },
        {
          text: 'Submit deferred items — roof and floor trusses, engineered lumber, glazing and shutter product approvals, hold-down anchorage — for review before fabrication.',
          cite: 'R106.1',
          verify: true,
        },
        {
          text: 'Do not scale these drawings. Written dimensions govern; dimensions are to face of stud unless noted otherwise.',
          cite: '',
        },
        {
          text: 'Verify every dimension and existing condition in the field before starting work and report any discrepancy to the designer before proceeding.',
          cite: '',
        },
        {
          text: 'Details and notes shown on one drawing apply to all like conditions throughout the work unless noted otherwise.',
          cite: '',
        },
        {
          text: `Products in this jurisdiction are subject to a statewide product-approval system; furnish approval numbers for exterior doors, windows, shutters, roofing and soffit before installation.`,
          cite: 'R101.2',
          verify: true,
          when: (jur) => /product approval/i.test(jur.amendmentFlavor),
        },
      ],
    },
    {
      title: 'Site, excavation & foundation',
      notes: [
        {
          text: 'Grade the finished surface to fall a minimum of 6 in within the first 10 ft measured away from the foundation. Where lot lines, walls or slopes prevent it, provide drains or swales to divert water away from the building.',
          cite: 'R401.3',
        },
        {
          text: 'Strip all vegetation, topsoil and organic material from beneath slabs and footings. Bear footings on undisturbed native soil or on engineered fill compacted and tested per the geotechnical report.',
          cite: 'R401.2',
        },
        {
          text: `Bear the bottom of all exterior footings not less than ${frost} in below finished grade${j.frostLineNote ? ` — ${j.frostLineNote.replace(/\.$/, '')}` : ''}.`,
          cite: 'R403.1.4',
          when: hasFrostDepth,
        },
        {
          text: 'Footing width and thickness shall be not less than the values in the footing table for the load-bearing value of the soil and the number of storeys supported. Where an engineer’s foundation plan is included, that plan governs.',
          cite: 'Table R403.1(1)',
        },
        {
          text: 'Where no soils report is provided, footings are sized on the presumptive load-bearing value of the soil class assumed in the structural notes. Provide a soils report where the building official requires one.',
          cite: 'Table R401.4.1',
        },
        {
          text: 'Concrete for footings, foundation walls and slabs shall reach a minimum 28-day compressive strength of 2,500 psi, or more where the weathering-probability table requires it.',
          cite: 'Table R402.2',
        },
        {
          text: 'Anchor sill plates with not less than 1/2 in diameter anchor bolts embedded 7 in minimum into concrete or grouted masonry, spaced not more than 6 ft on centre, with a bolt not more than 12 in and not less than seven bolt diameters from each end of each plate and not less than two bolts per plate. Provide a nut and washer at each bolt.',
          cite: 'R403.1.6',
        },
        {
          text: 'Slab-on-ground shall be not less than 3-1/2 in thick, cast over a Class I vapor retarder of not less than 6 mil polyethylene with joints lapped 6 in, over a 4 in base course of clean graded aggregate. The base course may be omitted on well-drained or sand-gravel soils.',
          cite: 'R506.1, R506.2.2, R506.2.3',
        },
        {
          text: 'Ventilate under-floor (crawl) spaces at not less than 1 sq ft of net free area per 150 sq ft of under-floor area, reduced to 1 per 1,500 where a Class I vapor retarder covers the ground and one ventilating opening is within 3 ft of each corner.',
          cite: 'R408.1, R408.2',
        },
        {
          text: 'Provide an access opening to each under-floor space not less than 18 in by 24 in through a perimeter wall, or 16 in by 24 in through the floor.',
          cite: 'R408.4',
        },
        {
          text: 'Unvented under-floor spaces shall be sealed, insulated at the perimeter, ground-covered with a Class I vapor retarder and conditioned by one of the approved methods.',
          cite: 'R408.3',
        },
        {
          text: 'Damp-proof foundation walls that retain earth and enclose habitable or usable space below grade, and provide foundation drainage unless the soil is well-drained gravel or sand-gravel.',
          cite: 'R405.1, R406.1',
        },
        {
          text: `Provide approved subterranean termite protection — chemical soil treatment, a bait system, pressure-preservative-treated wood, naturally durable wood or a physical barrier— for this ${j.termiteRisk || 'termite-prone'} termite area.`,
          cite: 'R318.1',
          when: (jur) => jur.termiteRisk !== '' && jur.termiteRisk !== 'none',
        },
        {
          text: 'Wood in contact with concrete, masonry or the ground, and wood less than 8 in above exposed earth, shall be preservative-treated or naturally durable. Fasteners and connectors in preservative-treated wood shall be hot-dipped galvanized, stainless steel, silicon bronze or copper.',
          cite: 'R317.1, R317.3',
        },
      ],
    },
    {
      title: 'Wood framing',
      notes: [
        {
          text: 'Fasten all framing in accordance with the code fastening schedule. Where a connection is not shown, use the schedule’s nailing for that connection; substitutions require the building official’s approval.',
          cite: 'Table R602.3(1)',
        },
        {
          text: 'Size and space bearing-wall studs per the stud table for the number of storeys supported. Do not use a smaller stud or a wider spacing than the plans show.',
          cite: 'Table R602.3(5)',
        },
        {
          text: 'Double the top plates of bearing and exterior walls and lap the joints not less than 24 in at corners and intersections. A single top plate is permitted only with the tie plate or strap the exception requires.',
          cite: 'R602.3.2',
        },
        {
          text: 'Notch bearing-wall studs not more than 25 percent of the stud depth and bore holes not more than 40 percent (60 percent in doubled studs, no more than two successive doubled studs), keeping the edge of the hole not less than 5/8 in from the edge of the stud.',
          cite: 'R602.6',
        },
        {
          text: 'Do not notch a joist in the middle third of its span. Limit end notches to one-quarter of the joist depth, holes to one-third of the depth, and keep holes not less than 2 in from the top and bottom edges and from any notch.',
          cite: 'R502.8.1',
        },
        {
          text: 'Bear joists not less than 1-1/2 in on wood or metal and not less than 3 in on masonry or concrete. Provide full-depth blocking or a rim joist at every bearing to resist rotation.',
          cite: 'R502.6, R502.7',
        },
        {
          text: 'Size headers over openings from the header tables for the span, the loads carried and the number of storeys above, and provide the number of king and jack studs the tables call for at each end.',
          cite: 'Table R602.7(1), Table R602.7(2)',
        },
        {
          text: 'Construct braced wall lines and braced wall panels by the bracing method shown, full-height and continuously sheathed where indicated. Install hold-downs and their anchorage per the manufacturer’s printed instructions.',
          cite: 'R602.10',
        },
        {
          text: 'Frame roofs with rafters and ceiling joists sized from the span tables for the species, grade, spacing and load. Provide a ridge board not less in depth than the cut end of the rafter, and collar ties or ridge straps in the upper third of the attic space.',
          cite: 'R802.4, R802.5',
          verify: true,
        },
        {
          text: 'Install wood structural panel sheathing with the long dimension perpendicular to the supports, with panel edges spaced 1/8 in, and fasten per the panel schedule.',
          cite: 'R503.2.1',
          verify: true,
        },
        {
          text: 'Roof and floor trusses shall be designed and sealed by the truss manufacturer’s registered engineer. Do not cut, notch, drill or alter a truss chord or web without the written approval of that engineer; install permanent bracing per the truss design drawings.',
          cite: 'R802.10.1, R802.10.4',
        },
        {
          text: 'Provide a continuous load path from the roof through the walls to the foundation with approved metal connectors, and tie the roof assembly down to resist the design wind uplift.',
          cite: 'R802.11',
        },
        {
          text: 'Fireblock concealed draft openings at ceiling and floor levels, at 10 ft intervals in furred spaces, at stair stringers top and bottom, and at openings around vents, pipes, ducts and chimneys.',
          cite: 'R302.11',
        },
        {
          text: 'Draftstop floor-ceiling assemblies where the ceiling is suspended below the framing or the floor framing is open-web, dividing the concealed space into areas not exceeding 1,000 sq ft.',
          cite: 'R302.12',
        },
        {
          text: 'Install engineered wood products — I-joists, LVL, PSL and rim board — strictly per the manufacturer’s printed instructions. Cut, notch and bore only within the manufacturer’s published allowances.',
          cite: 'R502.1.2',
          verify: true,
        },
      ],
    },
    {
      title: 'Fire & life safety',
      notes: [
        {
          text: 'Exterior walls with a fire separation distance of less than 5 ft shall be 1-hour fire-resistance rated, tested from both sides. Projections and openings within that distance are limited or prohibited by the exterior-wall table.',
          cite: 'R302.1, Table R302.1(1)',
        },
        {
          text: 'Separate the garage from the dwelling with not less than 1/2 in gypsum board on the garage side, 5/8 in Type X on the garage ceiling where habitable rooms are above, and equivalent protection on the structure supporting that separation.',
          cite: 'R302.6, Table R302.6',
        },
        {
          text: 'Openings from a garage directly into a sleeping room are prohibited. Other openings shall be a solid wood door not less than 1-3/8 in thick, a solid or honeycomb-core steel door not less than 1-3/8 in thick, or a 20-minute fire-rated door, equipped with a self-closing and self-latching device.',
          cite: 'R302.5.1',
        },
        {
          text: 'Ducts penetrating the garage separation shall be not less than 0.019 in (26 gage) sheet steel or other approved material, with no openings into the garage.',
          cite: 'R302.5.2',
        },
        {
          text: 'Provide habitable rooms with glazing area not less than 8 percent of the floor area and openable area not less than 4 percent, or with the artificial light and mechanical ventilation the exception permits.',
          cite: 'R303.1',
        },
        {
          text: 'Provide each bathroom with an openable window of not less than 3 sq ft with half openable, or with local exhaust of 50 cfm intermittent or 20 cfm continuous discharged to the outdoors.',
          cite: 'R303.3, Table M1507.4',
        },
        {
          text: 'Habitable rooms, hallways and portions of basements containing them shall have a ceiling height of not less than 7 ft; bathrooms, toilet rooms and laundry rooms not less than 6 ft 8 in.',
          cite: 'R305.1',
        },
        {
          text: 'Provide every sleeping room and every basement with an emergency escape and rescue opening with a net clear opening of 5.7 sq ft (5.0 sq ft where the opening is at grade level), not less than 24 in net clear height and 20 in net clear width, with the sill not more than 44 in above the finished floor.',
          cite: 'R310.1, R310.2.1, R310.2.2',
        },
        {
          text: 'Provide not less than one egress door, side-hinged, with a clear width of not less than 32 in and a clear height of not less than 78 in, openable from the inside without a key, tool or special knowledge.',
          cite: 'R311.2',
        },
        {
          text: 'Stairways shall be not less than 36 in wide above the handrail, with not less than 6 ft 8 in headroom, risers not more than 7-3/4 in and treads not less than 10 in. The greatest riser height and the greatest tread depth within a flight shall not exceed the smallest by more than 3/8 in.',
          cite: 'R311.7.1, R311.7.2, R311.7.5.1, R311.7.5.2',
        },
        {
          text: 'Provide a handrail on at least one side of each continuous run of four or more risers, 34 in to 38 in above the tread nosings, continuous the full length of the flight, with 1-1/2 in clearance to the wall and a graspable Type I or Type II profile.',
          cite: 'R311.7.8, R311.7.8.3',
          verify: true,
        },
        {
          text: 'Provide guards not less than 36 in high at walking surfaces more than 30 in above the floor or grade within 36 in horizontally, with intermediate rails or ornamental closures that will not allow a 4 in sphere to pass.',
          cite: 'R312.1.1, R312.1.2, R312.1.3',
        },
        {
          text: 'Provide smoke alarms in each sleeping room, outside each separate sleeping area in the immediate vicinity of the bedrooms, and on each additional storey including basements and habitable attics. Interconnect all alarms, power them from the building wiring and provide battery backup.',
          cite: 'R314.3, R314.4, R314.6',
        },
        {
          text: 'Provide carbon monoxide alarms outside each separate sleeping area in the immediate vicinity of the bedrooms where the dwelling contains a fuel-fired appliance or has an attached garage with an opening into the dwelling.',
          cite: 'R315.2.1, R315.3',
        },
        {
          text: 'Separate foam plastic insulation from the interior of the building with an approved 15-minute thermal barrier of not less than 1/2 in gypsum board. Attics and crawl spaces entered only for service require an ignition barrier over the foam.',
          cite: 'R316.4, R316.5.3',
        },
        {
          text: 'The state has amended the residential sprinkler requirement of Section R313 — confirm with the building official whether an automatic sprinkler system is required for this dwelling before framing.',
          cite: 'R313',
          verify: true,
          when: (jur) => /sprinkler/i.test(jur.amendmentFlavor),
        },
      ],
    },
    {
      title: 'Glazing & opening protection',
      notes: [
        {
          text: 'Provide safety glazing in glazing in doors and in fixed or operable panels adjacent to a door where the nearest vertical edge is within a 24 in arc of the door in a closed position and the exposed bottom edge is less than 60 in above the floor.',
          cite: 'R308.4.1, R308.4.2',
        },
        {
          text: 'Provide safety glazing in walls and enclosures for bathtubs, showers, saunas, steam rooms and hot tubs where the exposed bottom edge of the glazing is less than 60 in above the standing or walking surface.',
          cite: 'R308.4.5',
        },
        {
          text: 'Provide safety glazing in glazing adjacent to stairways, landings and ramps within 36 in horizontally of a walking surface where the exposed bottom edge is less than 60 in above the walking surface.',
          cite: 'R308.4.6, R308.4.7',
        },
        {
          text: 'Each light of safety glazing shall carry a permanent manufacturer’s label identifying the fabricator, the safety-glazing standard and the type of glazing.',
          cite: 'R308.1',
        },
        {
          text: 'Exterior windows and doors shall be tested, labeled and installed for the design pressures shown on the window and door schedules, using the anchorage in the manufacturer’s approved installation instructions.',
          cite: 'R609.2',
          verify: true,
        },
        {
          text: `Wind-borne debris region: protect every glazed opening with impact-resistant glazing or with shutters tested to ASTM E1996 and ASTM E1886, or design the building as partially enclosed. Design wind speed for this state is approximately ${j.ultimateWindMph ?? 0} mph ultimate — confirm the site value with the AHJ before ordering.`,
          cite: 'R301.2.1.2, R609',
          when: inWindBorneDebris,
        },
        {
          text: 'Skylights and sloped glazing shall be tested and labeled, shall be laminated, tempered or heat-strengthened as the code permits, and shall be curb-mounted and flashed per the manufacturer’s instructions.',
          cite: 'R308.6.2, R308.6.3',
          verify: true,
        },
        {
          text: 'Garage doors shall carry a permanent label identifying the manufacturer, the model, the positive and negative design pressures, the installation-instruction reference and the test standard.',
          cite: 'R609.4',
          verify: true,
          when: inWindBorneDebris,
        },
      ],
    },
    {
      title: 'Exterior envelope & roofing',
      notes: [
        {
          text: 'Install a water-resistive barrier over exterior wall sheathing — not less than one layer of No. 15 asphalt felt or an approved equivalent — lapped shingle-fashion so water is shed to the exterior.',
          cite: 'R703.1.1, R703.2',
        },
        {
          text: 'Flash every exterior opening, penetration, deck ledger and wall-to-roof intersection, and integrate the flashing with the water-resistive barrier so that water draining down the barrier is directed to the exterior.',
          cite: 'R703.4',
        },
        {
          text: 'Install exterior wall coverings and their fasteners per the manufacturer’s printed instructions and the exterior-covering fastening table, over sheathing or approved framing.',
          cite: 'R703.3',
          verify: true,
        },
        {
          text: 'Install roof coverings per the manufacturer’s printed instructions and the code’s minimum slope. Asphalt shingles require a slope of not less than 4:12, or not less than 2:12 with a double layer of underlayment.',
          cite: 'R905.2.2, R905.1.1',
          verify: true,
        },
        {
          text: 'Provide underlayment, drip edge at the eaves and rakes, valley flashing, and step and counter-flashing where the roof abuts a vertical surface.',
          cite: 'R905.2.7, R905.2.8',
          verify: true,
        },
        {
          text: 'Ventilate enclosed attics and enclosed rafter spaces per the roof plan’s ventilation calculation. Openings shall be covered with corrosion-resistant mesh with a least dimension of not less than 1/16 in and not more than 1/4 in.',
          cite: 'R806.1, R806.2',
        },
        {
          text: 'Where eave or cornice vents are installed, keep a minimum 1 in air space between the insulation and the roof sheathing at the vent location and install a baffle in each ventilated rafter or truss bay.',
          cite: 'R806.3',
        },
        {
          text: 'Discharge roof drainage away from the foundation with gutters, downspouts and splash blocks or piped outlets. Do not discharge onto adjoining property.',
          cite: 'R801.3',
        },
        {
          text: 'Attach deck ledgers to the band joist with the approved fasteners in the ledger table, flash the ledger, and provide the lateral-load connection the code requires.',
          cite: 'R507.9',
          verify: true,
        },
      ],
    },
    {
      title: 'Energy conservation',
      notes: [
        {
          text: `Insulate and air-seal the building thermal envelope to the prescriptive requirements for climate zone ${zone}. See sheet EN1.0 for the computed envelope areas and the component requirement table.`,
          cite: 'N1102.1',
        },
        wallR
          ? {
              text: `Prescriptive wood-frame wall insulation for this climate zone is ${wallR.value.replace(/^R/, 'R-')}${wallR.options.length > 0 ? ` (equivalent options: ${wallR.options.join('; ')})` : ''}.`,
              cite: wallR.citation || 'N1102.1.3',
            }
          : {
              text: 'Prescriptive envelope R-values and U-factors for this site are not established in this drawing set — take them from the adopted energy code’s component table before ordering insulation and fenestration.',
              cite: 'N1102.1',
              verify: true,
            },
        {
          text: 'Install a continuous air barrier over the whole thermal envelope, sealed at every penetration, and install insulation in full contact with the air barrier per the air-barrier and insulation installation table.',
          cite: 'N1102.4.1, Table N1102.4.1.1',
        },
        {
          text: 'Envelope air leakage shall be verified by an approved third-party blower-door test and shall not exceed the air-change limit of the adopted energy code for this climate zone. Record the tested result on the energy certificate.',
          cite: 'N1102.4.1.2',
          verify: true,
        },
        {
          text: 'Insulate supply and return ducts outside the conditioned envelope to not less than R-8 (R-6 where the duct is less than 3 in in diameter) and seal all joints, seams and connections.',
          cite: 'N1103.3.1',
          verify: true,
        },
        {
          text: 'Duct tightness shall be verified by a postconstruction or rough-in leakage test unless the entire air distribution system is inside the conditioned space; leakage shall not exceed the adopted code limit.',
          cite: 'N1103.3.3',
          verify: true,
        },
        {
          text: 'Post a permanent certificate on or near the electrical distribution panel listing the installed insulation R-values, the fenestration U-factor and SHGC, the tested envelope and duct leakage, and the heating, cooling and water-heating equipment efficiencies.',
          cite: 'N1101.14',
          verify: true,
        },
        {
          text: 'Not less than 90 percent of the permanently installed lighting fixtures shall contain high-efficacy lamps.',
          cite: 'N1104.1',
          verify: true,
        },
        {
          text: 'Size heating and cooling equipment from an ACCA Manual J load calculation and select it per Manual S. Oversized equipment is not an acceptable substitute for a load calculation.',
          cite: 'N1103.7, M1401.3',
          verify: true,
        },
      ],
    },
    {
      title: 'Electrical',
      notes: [
        {
          text: 'All electrical work shall comply with the electrical provisions of the residential code (NFPA 70 as adopted) and shall be installed by a licensed electrical contractor.',
          cite: 'E3401.1',
          verify: true,
        },
        {
          text: 'Space receptacle outlets in every kitchen, family, dining, living, sun, bedroom, recreation and similar room so that no point measured horizontally along the floor line of any wall space is more than 6 ft from a receptacle. Any wall space 2 ft or more in width requires a receptacle.',
          cite: 'E3901.2, E3901.2.1',
        },
        {
          text: 'Provide a receptacle at each kitchen wall counter space 12 in or wider, spaced so that no point along the counter wall line is more than 24 in from a receptacle. Island and peninsular counter receptacles shall be provided as the code requires.',
          cite: 'E3901.4',
          verify: true,
        },
        {
          text: 'Provide at least one receptacle outlet within 3 ft of the outside edge of each bathroom basin, on a wall or partition adjacent to the basin or on the basin countertop.',
          cite: 'E3901.6',
        },
        {
          text: 'Provide at least one receptacle outlet outdoors at the front and at the back of the dwelling, readily accessible from grade and not more than 6 ft 6 in above grade.',
          cite: 'E3901.7',
        },
        {
          text: 'Provide at least one 20-ampere receptacle outlet in the laundry area, at least one receptacle in each vehicle bay of an attached garage, and at least one receptacle in each hallway 10 ft or more in length.',
          cite: 'E3901.9, E3901.10, E3901.11',
        },
        {
          text: 'Provide ground-fault circuit-interrupter protection for receptacles in bathrooms, garages and accessory buildings, outdoors, crawl spaces, unfinished basements, kitchens, laundry areas and within 6 ft of any sink, bathtub or shower. Confirm the current list against the adopted edition.',
          cite: 'E3902',
          verify: true,
        },
        {
          text: 'Provide arc-fault circuit-interrupter protection for branch circuits supplying outlets and devices in kitchens, family, dining, living, parlour, library, den, bedroom, sun, recreation and similar rooms, hallways, closets and laundry areas.',
          cite: 'E3902.16',
          verify: true,
        },
        {
          text: 'Provide not less than two 20-ampere small-appliance branch circuits for the kitchen, pantry and dining receptacles, a separate 20-ampere laundry branch circuit, and a separate 20-ampere bathroom branch circuit.',
          cite: 'E3703.2, E3703.3, E3703.4',
          verify: true,
        },
        {
          text: 'Size the service from a calculated load and provide a readily accessible service disconnecting means outside the building or nearest the point of entrance of the service conductors.',
          cite: 'E3601.6, E3602.2',
          verify: true,
        },
        {
          text: 'Provide clear working space at the panelboard of not less than 30 in wide, 36 in deep and 6 ft 6 in high. Do not install a panelboard in a clothes closet or a bathroom.',
          cite: 'E3405.2, E3405.3',
          verify: true,
        },
        {
          text: 'Ground the service to a grounding electrode system and bond the interior metal water piping and any metal gas piping to the service equipment enclosure or the grounding electrode conductor.',
          cite: 'E3608, E3609',
          verify: true,
        },
        {
          text: 'Provide at least one wall-switch-controlled lighting outlet in every habitable room, bathroom, hallway, stairway and attached garage, and at every outdoor egress door with grade-level access.',
          cite: 'E3903.2, E3903.3',
          verify: true,
        },
      ],
    },
    {
      title: 'Plumbing',
      notes: [
        {
          text: 'All plumbing work shall comply with the plumbing provisions of the residential code and shall be installed by a licensed plumbing contractor.',
          cite: 'P2501.1',
        },
        {
          text: 'Where piping is installed through or against a stud, joist or plate less than 1-1/4 in from the exposed face, protect the pipe with a steel shield plate not less than 0.062 in thick covering the full width of the framing member.',
          cite: 'P2603.2.1',
        },
        {
          text: 'Protect water, drain and vent piping from freezing and from structural settlement. Do not install water piping in an exterior wall or unheated space where it cannot be protected.',
          cite: 'P2603.5, P2603.6',
          verify: true,
        },
        {
          text: 'Set fixtures level and secure to the floor or wall, seal the joint between the fixture and the wall or floor watertight, and provide an accessible shutoff valve at every fixture supply.',
          cite: 'P2705.1',
        },
        {
          text: 'Water closets require not less than 15 in from the centreline to any side wall, partition or vanity, not less than 30 in between fixture centrelines, and not less than 21 in of clear space in front.',
          cite: 'P2705.1',
          verify: true,
        },
        {
          text: 'Shower compartments shall have not less than 900 sq in of interior cross-sectional area and a minimum interior dimension of 30 in. Finish walls in tub and shower areas with a smooth, non-absorbent surface to not less than 72 in above the drain inlet.',
          cite: 'P2708.1, R307.2',
        },
        {
          text: 'Shower and tub-shower combination valves shall be balanced-pressure, thermostatic or combination type, set to a maximum discharge of 120°F.',
          cite: 'P2708.4',
          verify: true,
        },
        {
          text: 'Install water heaters per the manufacturer’s printed instructions with a temperature and pressure relief valve, the relief discharge piped full-size to an approved location, and a drain pan piped to an indirect waste where a leak would damage the structure.',
          cite: 'P2801.6, P2804.6.1',
          verify: true,
        },
        {
          text: 'Provide drainage cleanouts at the base of each stack, at each change of direction greater than 45 degrees, and at horizontal-drain intervals the code requires; extend cleanouts to grade or to an accessible location.',
          cite: 'P3005.2',
          verify: true,
        },
        {
          text: 'Vent terminals shall extend not less than 6 in above the roof, not less than 12 in from a vertical surface, and shall not be located within 10 ft horizontally of, or less than 3 ft above, any door, openable window or air intake.',
          cite: 'P3103.1, P3103.5',
          verify: true,
        },
        {
          text: 'Test the drain, waste and vent system with a 10 ft head of water or 5 psi of air, and test the water-distribution system at the working pressure, before concealing any piping.',
          cite: 'P2503.5, P2503.7',
          verify: true,
        },
        {
          text: 'Protect the potable water supply against backflow at hose bibbs, lawn irrigation, boiler feed and every other connection to a non-potable source with an approved backflow-prevention device.',
          cite: 'P2902',
          verify: true,
        },
      ],
    },
    {
      title: 'Mechanical',
      notes: [
        {
          text: 'Size heating and cooling equipment from an ACCA Manual J room-by-room load calculation, select equipment per Manual S, and design the duct system per Manual D. Submit the calculations with the permit application.',
          cite: 'M1401.3',
        },
        {
          text: 'Appliances installed in an attic shall have a passageway not less than 22 in by 30 in, a level working platform not less than 30 in by 30 in at the service side, and a luminaire and receptacle outlet at the appliance controlled from the passageway opening.',
          cite: 'M1305.1.2',
          verify: true,
        },
        {
          text: 'Provide a secondary condensate drain, an auxiliary drain pan or a water-level detection device that shuts the equipment off where condensate overflow would damage the building.',
          cite: 'M1411.3, M1411.3.1',
          verify: true,
        },
        {
          text: 'Exhaust clothes dryers to the outdoors through a 4 in diameter smooth-interior metal duct not less than 0.016 in thick, with joints running in the direction of airflow and not fastened with screws, terminating with a backdraft damper and no screen.',
          cite: 'M1502.4.1, M1502.4.2, M1502.3',
        },
        {
          text: 'Limit dryer exhaust duct length to 35 ft, reduced 5 ft for each 90-degree bend and 2-1/2 ft for each 45-degree bend, unless the manufacturer’s permitted length is posted at the dryer connection.',
          cite: 'M1502.4.5',
          verify: true,
        },
        {
          text: 'Exhaust range hoods to the outdoors through a single-wall duct with a backdraft damper. Where the kitchen exhaust rate exceeds 400 cfm, provide compensating makeup air interlocked with the exhaust.',
          cite: 'M1503.3, M1503.6',
          verify: true,
        },
        {
          text: 'Provide local exhaust to the outdoors: not less than 50 cfm intermittent or 20 cfm continuous at each bathroom, and 100 cfm intermittent or 25 cfm continuous at the kitchen. Do not terminate an exhaust duct in an attic, crawl space or soffit.',
          cite: 'Table M1507.4, M1507.2',
          verify: true,
        },
        {
          text: 'Provide whole-house mechanical ventilation at the rate the ventilation table requires for the floor area and number of bedrooms, with controls that operate it automatically and a readily accessible manual override.',
          cite: 'M1505.4, Table M1505.4.3(1)',
          verify: true,
        },
        {
          text: 'Seal all duct joints and seams with mastic, mastic-plus-embedded-fabric or approved tape, and support ducts at the intervals the code requires. Insulate ducts outside the conditioned envelope.',
          cite: 'M1601.4.1',
          verify: true,
        },
        {
          text: 'Provide combustion air for every fuel-fired appliance per the combustion-air provisions, or use direct-vent or sealed-combustion appliances. Do not install a fuel-fired appliance in a sleeping room, bathroom or closet opening into one except as the exceptions permit.',
          cite: 'M1701.1, G2406.2',
          verify: true,
        },
      ],
    },
  ]

  return sections
    .map((section) => ({
      title: section.title,
      notes: section.notes.filter((note) => !note.when || note.when(j)),
    }))
    .filter((section) => section.notes.length > 0)
}

/* ---------------------------------------------------------- roof notes */

/** The short roof-specific note block ('roof' notesKey). */
export function roofNotes(j: Jurisdiction): NoteSection[] {
  return [
    {
      title: 'Roof plan notes',
      notes: [
        {
          text: 'Roof pitches are shown by the slope arrows; each arrow points down-slope and carries the rise in 12 for that plane.',
          cite: '',
        },
        {
          text: 'The dashed line at the perimeter is the eave / rake edge of the roof including the overhang; the solid line is the wall line below.',
          cite: '',
        },
        {
          text: 'Ventilate enclosed attics and enclosed rafter spaces per the ventilation calculation on this sheet. Protect openings against the entrance of rain and snow.',
          cite: 'R806.1, R806.2',
        },
        {
          text: 'Provide a minimum 1 in air space between the insulation and the roof sheathing at every vented eave, and install a baffle in each ventilated rafter or truss bay.',
          cite: 'R806.3',
        },
        {
          text: 'Provide drip edge at eaves and rakes, valley flashing, and step and counter-flashing at every vertical surface. Flash all roof penetrations.',
          cite: 'R905.2.8',
          verify: true,
        },
        {
          text: 'Tie the roof assembly down to resist the design wind uplift with approved connectors, continuous from the rafter or truss to the foundation.',
          cite: 'R802.11',
          when: (jur) => jur.hurricaneTies || (jur.ultimateWindMph ?? 0) >= 115,
        },
      ].filter((note) => !note.when || note.when(j)),
    },
  ]
}
