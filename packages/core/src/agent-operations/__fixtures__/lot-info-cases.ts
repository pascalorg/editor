import { encodeTerrainField } from '../../lib/terrain-codec'
import { createTerrainField, quantize } from '../../lib/terrain-field'
import { SiteNode } from '../../schema'
import type { AgentToolCase, SceneGraph } from './cases'
import { building, level, STRAIGHT, scene, site, TILTED, U_LOT } from './site-cases'

/**
 * get_site reads everything the hosted Architect plugin's lot_info did, so lot_info retires into
 * it. lot_info took no input: each case is a lot it read (the new-project placeholder its stored
 * calls read, a parcel with setbacks, turned, with no street recorded and north turned, on a
 * corner with a sight triangle, a U and a round lot with more edges than it listed, setbacks that
 * leave nothing, the ground sloped, read flat or not read, no building yet, several buildings, no
 * site), beside the get_site call that covers it, run without a model through the core, MCP and
 * chat runners.
 *
 * `lotInfo` is what lot_info printed for that lot, in its own units (feet, square feet, its
 * words): worked by hand where the envelope is a plain inset, and in every case the same as
 * lot_info answered on the hosted main of 2026-10-14. An envelope inset round a concave corner,
 * a sight triangle or a curve is traced on a raster, so those cases hold lot_info's printed
 * numbers, the trace's slivers included. The check finds each of its facts in get_site's answer,
 * in metres: the lot's area; the setbacks; the buildable envelope's area, its front edge and that
 * edge's frontage and depth (lot_info's `buildable`), and each edge as a front (its `otherEdges`,
 * the first six); the footprint range (30 to 45% of the lot); the ground; the address. The
 * `result` states get_site's own numbers.
 *
 * Where they differ: get_site lists every edge, not the first six; it says whether the street is
 * recorded (`street` null while the front is the north-facing guess lot_info took silently); on a
 * sloped lot it gives the fall of the terrain across the lot, where lot_info printed the lot
 * drop-in's figure over the grid it sampled, which reaches past the lot; it reads the site the
 * house stands on, or the one named, where lot_info read the scene's first; and on a lot that
 * widens away from its street its front is the edge facing the street, where lot_info named the
 * longer rear (get_site's own cases, in site-cases.ts).
 */

type LotInfoRead = {
  lotSqFt: number
  terrain: string
  setbacksFt: Record<string, number> | 'defaults'
  buildable:
    | { frontageFt: number; depthFt: number; envelopeSqFt: number; frontEdge: number }
    | 'no envelope (no setbacks?)'
  otherEdges: { index: number; frontageFt: number; depthFt: number }[]
  suggestedFootprintSqFt: [number, number]
  address?: string
}

const FT = 0.3048
const SQ_FT = 1 / (FT * FT)
const NOT_READ = 'not read: the ground is flat until it is read'
const NO_ENVELOPE = 'no envelope (no setbacks?)'

type Brief = {
  lot: { areaM2: number; footprintRangeM2: [number, number] }
  buildable: {
    state: string
    areaM2: number
    edges: { edge: number; frontage: number; depth: number }[]
    frontEdge: number | null
    setbacks?: Record<string, number>
  }
  street: { edge: number } | null
  ground: { state: string; reliefM: number | null }
  address: string | null
}

/** Every fact lot_info gave for the lot, found in get_site's answer (metres against its feet). */
function readsAsLotInfo(lotInfo: LotInfoRead) {
  return (result: Record<string, unknown>): string[] => {
    const brief = result as unknown as Brief
    const problems: string[] = []
    // written so a missing or NaN number fails
    const feet = (
      what: string,
      metres: number | null | undefined,
      ft: number,
      tolerance = 0.05,
    ) => {
      if (!(typeof metres === 'number' && Math.abs(metres / FT - ft) <= tolerance))
        problems.push(`${what}: ${metres} m is not ${ft} ft`)
    }
    const squareFeet = (what: string, m2: number | undefined, sqFt: number, tolerance = 2) => {
      if (!(typeof m2 === 'number' && Math.abs(m2 * SQ_FT - sqFt) <= tolerance))
        problems.push(`${what}: ${m2} m² is not ${sqFt} sq ft`)
    }
    squareFeet('lotSqFt', brief.lot.areaM2, lotInfo.lotSqFt)
    // get_site rounds the range to the square metre: half of one is 5.4 sq ft
    squareFeet(
      'suggestedFootprintSqFt[0]',
      brief.lot.footprintRangeM2[0],
      lotInfo.suggestedFootprintSqFt[0],
      6,
    )
    squareFeet(
      'suggestedFootprintSqFt[1]',
      brief.lot.footprintRangeM2[1],
      lotInfo.suggestedFootprintSqFt[1],
      6,
    )

    const sloped = /^sloped: ([\d.]+) ft of relief across the lot$/.exec(lotInfo.terrain)
    const ground = sloped ? 'sloped' : lotInfo.terrain === 'read flat' ? 'flat' : 'unread'
    if (brief.ground.state !== ground) problems.push(`ground ${brief.ground.state}, not ${ground}`)
    // the fall across the lot, within the drop-in's figure over the wider grid it sampled
    if (sloped && !((brief.ground.reliefM ?? Number.NaN) / FT <= Number(sloped[1]) + 0.05))
      problems.push(`terrain relief ${brief.ground.reliefM} m is more than ${sloped[1]} ft`)

    if (lotInfo.setbacksFt === 'defaults') {
      if (brief.buildable.setbacks) problems.push('setbacks given where lot_info had none')
    } else
      for (const [role, ft] of Object.entries(lotInfo.setbacksFt))
        feet(`setbacksFt.${role}`, brief.buildable.setbacks?.[role], ft)

    if (lotInfo.buildable === NO_ENVELOPE) {
      // no setbacks (the whole lot is buildable) or setbacks that leave nothing
      if (!['lot', 'none'].includes(brief.buildable.state))
        problems.push(`buildable ${brief.buildable.state} where lot_info had no envelope`)
    } else {
      const { frontageFt, depthFt, envelopeSqFt, frontEdge } = lotInfo.buildable
      squareFeet('envelopeSqFt', brief.buildable.areaM2, envelopeSqFt)
      const front = brief.buildable.edges.find((edge) => edge.edge === frontEdge)
      feet('buildable.frontageFt', front?.frontage, frontageFt)
      feet('buildable.depthFt', front?.depth, depthFt)
      if (brief.buildable.frontEdge !== frontEdge)
        problems.push(`frontEdge ${brief.buildable.frontEdge}, not ${frontEdge}`)
    }
    for (const { index, frontageFt, depthFt } of lotInfo.otherEdges) {
      const edge = brief.buildable.edges.find((front) => front.edge === index)
      feet(`otherEdges[${index}].frontageFt`, edge?.frontage, frontageFt)
      feet(`otherEdges[${index}].depthFt`, edge?.depth, depthFt)
    }
    if (lotInfo.address)
      for (const part of lotInfo.address.split(', '))
        if (!brief.address?.includes(part)) problems.push(`address lacks ${part}`)
    return problems
  }
}

/** lot_info's answer for a lot, beside the get_site call that covers it. */
function covers(
  name: string,
  sceneOf: () => SceneGraph,
  lotInfo: LotInfoRead,
  result: Record<string, unknown>,
  more: {
    input?: Record<string, unknown>
    check?: (result: Record<string, unknown>) => string[]
    /** What the summary says of it, in words. */
    mentions?: string[]
  } = {},
): AgentToolCase {
  return {
    name: `covers lot_info on ${name}`,
    tool: 'get_site',
    scene: sceneOf,
    input: more.input ?? {},
    expect: {
      result,
      ...(more.mentions ? { mentions: more.mentions } : {}),
      check: (answer) => [...readsAsLotInfo(lotInfo)(answer), ...(more.check?.(answer) ?? [])],
    },
  }
}

const house = (extra: Record<string, unknown>) => () => scene(site(extra), building(), level())

// The 20 × 40 m lot along +z, street on its north edge (0), yards 6 front, 1.5 each side, 7.5
// rear: the envelope is x 1.5..18.5, z 6..32.5, 17 × 26.5 m (450.5 m²), its edge 0 the front.
const SETBACKS = { front: 6, side: 1.5, rear: 7.5 }
const STRAIGHT_PARCEL = {
  ...STRAIGHT,
  setbacks: SETBACKS,
  setbacksSource: 'zoning-code',
  address: { street: '12 Elm St', city: 'Davis', state: 'CA', zip: '95616' },
}
const STRAIGHT_FEET: Omit<LotInfoRead, 'terrain'> = {
  lotSqFt: 8611,
  setbacksFt: { front: 19.685, side: 4.921, rear: 24.606 },
  buildable: { frontageFt: 55.774, depthFt: 86.942, envelopeSqFt: 4849, frontEdge: 0 },
  otherEdges: [
    { index: 0, frontageFt: 55.774, depthFt: 86.942 },
    { index: 1, frontageFt: 86.942, depthFt: 55.774 },
    { index: 2, frontageFt: 55.774, depthFt: 86.942 },
    { index: 3, frontageFt: 86.942, depthFt: 55.774 },
  ],
  suggestedFootprintSqFt: [2583, 3875],
}
const STRAIGHT_BUILDABLE = {
  state: 'setbacks',
  areaM2: 450.5,
  edges: [
    { frontage: 17, depth: 26.5 },
    { frontage: 26.5, depth: 17 },
    { frontage: 17, depth: 26.5 },
    { frontage: 26.5, depth: 17 },
  ],
}

/**
 * A slope down the lot: 0.05 m a metre along +z, on a heightfield wider than the lot (from 5 m
 * outside it), as the lot drop-in samples it, so the fall across the lot (2 m over its 40 m) is
 * less than the field's (2.5 m, 8.202 ft), the figure the drop-in recorded and lot_info printed.
 */
function slopedTerrain() {
  const field = createTerrainField({ origin: [-5, -5], spacing: 1, cols: 31, rows: 51 })
  for (let row = 0; row < field.rows; row++)
    for (let col = 0; col < field.cols; col++)
      field.heights[row * field.cols + col] = quantize(field, (field.origin[1] + row) * 0.05)
  return encodeTerrainField(field)
}

/** The answer lists `count` edges, indexed 0 to count - 1, each with a finite frontage and depth. */
function everyEdge(count: number) {
  return (result: Record<string, unknown>): string[] => {
    const { edges } = (result as unknown as Brief).buildable
    const listed =
      edges.length === count &&
      edges.every(
        (edge, i) =>
          edge.edge === i && Number.isFinite(edge.frontage) && Number.isFinite(edge.depth),
      )
    return listed ? [] : [`${edges.length} edges, not ${count}`]
  }
}

// A round lot, radius 10 m round [0, 0], as 64 lines of 0.98 m each.
const ROUND = Array.from({ length: 64 }, (_, i) => {
  const angle = (i / 64) * 2 * Math.PI - Math.PI / 2
  return [10 * Math.cos(angle), 10 * Math.sin(angle)]
})

// What lot_info answered on the round lot with 1 m setbacks: the front an arc chord a metre long.
const ROUND_LOT_INFO: LotInfoRead = {
  lotSqFt: 3376,
  terrain: NOT_READ,
  setbacksFt: { front: 3.281, side: 3.281, rear: 3.281 },
  buildable: { frontageFt: 2.903, depthFt: 58.978, envelopeSqFt: 2733, frontEdge: 0 },
  otherEdges: [
    { index: 0, frontageFt: 2.903, depthFt: 58.978 },
    { index: 1, frontageFt: 2.932, depthFt: 58.974 },
    { index: 2, frontageFt: 2.991, depthFt: 58.973 },
    { index: 3, frontageFt: 2.773, depthFt: 58.971 },
    { index: 4, frontageFt: 2.886, depthFt: 58.973 },
    { index: 5, frontageFt: 3.045, depthFt: 58.968 },
  ],
  suggestedFootprintSqFt: [1013, 1519],
}

// A corner lot, 30 m square: the street on its south edge (2, the front) and its east edge (1,
// a street side 3 m deep), and a 40 ft sight triangle at the corner they share, [30, 30]. The
// envelope, x 1.5..27 and z 6..24, loses that corner to the triangle's hypotenuse x + z = 47.808:
// by hand [1.5, 6], [27, 6], [27, 20.808], [23.808, 24], [1.5, 24], its front 22.308 × 18 m.
// The trace adds a sliver at [27, 6], so the edge behind the street front is its 4.
const CORNER = {
  polygon: {
    type: 'polygon',
    points: [
      [0, 0],
      [30, 0],
      [30, 30],
      [0, 30],
    ],
  },
  frontEdge: 2,
  streetEdges: [1, 2],
  sightTriangleFt: 40,
  setbacks: { front: 6, side: 1.5, rear: 6, streetSide: 3 },
}

export const LOT_INFO_CASES: AgentToolCase[] = [
  // The stored threads' calls (local-08, local-17): the placeholder lot, 9688 sq ft.
  covers(
    'the new-project placeholder, as its stored calls read it',
    house({}),
    {
      lotSqFt: 9688,
      terrain: NOT_READ,
      setbacksFt: 'defaults',
      buildable: NO_ENVELOPE,
      otherEdges: [],
      suggestedFootprintSqFt: [2906, 4359],
    },
    {
      placeholder: true,
      lot: { areaM2: 900, footprintRangeM2: [270, 405] },
      buildable: {
        state: 'lot',
        areaM2: 900,
        frontEdge: 0,
        edges: [
          { frontage: 30, depth: 30 },
          { frontage: 30, depth: 30 },
          { frontage: 30, depth: 30 },
          { frontage: 30, depth: 30 },
        ],
      },
      street: null,
      ground: { state: 'unread', reliefM: null },
    },
    {
      mentions: ['ground: not read'],
      // the range is in the answer, but the summary leaves it out: the placeholder is no real lot
      check: (result) =>
        (result.summary as string[]).some((line) => line.includes('usually covers'))
          ? ['the summary gives the placeholder a footprint range']
          : [],
    },
  ),
  covers(
    'a parcel with setbacks and its street',
    house(STRAIGHT_PARCEL),
    { ...STRAIGHT_FEET, terrain: NOT_READ, address: '12 Elm St, Davis, CA, 95616' },
    {
      lot: { areaM2: 800, footprintRangeM2: [240, 360] },
      street: { side: 'north', edge: 0, frontage: 20, depth: 40 },
      buildable: { ...STRAIGHT_BUILDABLE, frontEdge: 0 },
      address: '12 Elm St, Davis, CA 95616',
    },
    {
      mentions: [
        '451 m² · 17 m along the street, 26.5 m deep (its edge 0)',
        'lot edge 0, 20 m of frontage, 40 m deep',
      ],
    },
  ),
  covers(
    'a turned parcel off the origin, the building moved',
    () => scene(site(TILTED), building({ position: [3, 0, 2] }), level()),
    {
      lotSqFt: 6200,
      terrain: NOT_READ,
      setbacksFt: { front: 19.685, side: 4.921, rear: 19.685 },
      buildable: { frontageFt: 49.213, depthFt: 65.617, envelopeSqFt: 3229, frontEdge: 0 },
      otherEdges: [
        { index: 0, frontageFt: 49.213, depthFt: 65.617 },
        { index: 1, frontageFt: 65.617, depthFt: 49.213 },
        { index: 2, frontageFt: 49.213, depthFt: 65.617 },
        { index: 3, frontageFt: 65.617, depthFt: 49.213 },
      ],
      suggestedFootprintSqFt: [1860, 2790],
      address: '1458 Oak St, Palo Alto, CA',
    },
    {
      lot: { areaM2: 576, footprintRangeM2: [173, 259] },
      street: { edge: 0, frontage: 18, depth: 32 },
      buildable: {
        areaM2: 300,
        frontEdge: 0,
        edges: [
          { frontage: 15, depth: 20 },
          { frontage: 20, depth: 15 },
          { frontage: 15, depth: 20 },
          { frontage: 20, depth: 15 },
        ],
      },
    },
  ),
  covers(
    'setbacks with no street recorded: the north-facing edge taken as the front',
    house({ polygon: STRAIGHT.polygon, setbacks: SETBACKS }),
    { ...STRAIGHT_FEET, terrain: NOT_READ },
    { street: null, buildable: { ...STRAIGHT_BUILDABLE, frontEdge: 0 } },
    { mentions: ['17 m along its edge facing north (the setbacks take it as the front'] },
  ),
  covers(
    'setbacks with no street recorded and north turned: the east edge taken as the front',
    // north a quarter turn clockwise of plan up, so the edge facing most nearly north is the
    // east one (1): front 6 from x = 20, rear 7.5 from x = 0, sides 1.5: x 7.5..14, z 1.5..38.5
    house({ polygon: STRAIGHT.polygon, setbacks: SETBACKS, northRotation: Math.PI / 2 }),
    {
      lotSqFt: 8611,
      terrain: NOT_READ,
      setbacksFt: { front: 19.685, side: 4.921, rear: 24.606 },
      buildable: { frontageFt: 121.391, depthFt: 21.325, envelopeSqFt: 2589, frontEdge: 1 },
      otherEdges: [
        { index: 0, frontageFt: 21.325, depthFt: 121.391 },
        { index: 1, frontageFt: 121.391, depthFt: 21.325 },
        { index: 2, frontageFt: 21.325, depthFt: 121.391 },
        { index: 3, frontageFt: 121.391, depthFt: 21.325 },
      ],
      suggestedFootprintSqFt: [2583, 3875],
    },
    {
      street: null,
      buildable: {
        areaM2: 240.5,
        frontEdge: 1,
        ring: [
          [7.5, 1.5],
          [14, 1.5],
          [14, 38.5],
          [7.5, 38.5],
        ],
      },
    },
  ),
  covers(
    'a corner lot whose sight triangle cuts a corner off the envelope',
    house(CORNER),
    {
      lotSqFt: 9688,
      terrain: NOT_READ,
      setbacksFt: { front: 19.685, side: 4.921, rear: 19.685, streetSide: 9.843 },
      buildable: { frontageFt: 73.187, depthFt: 59.057, envelopeSqFt: 4884, frontEdge: 4 },
      otherEdges: [
        { index: 0, frontageFt: 83.368, depthFt: 59.055 },
        { index: 1, frontageFt: 0.436, depthFt: 101.449 },
        { index: 2, frontageFt: 48.283, depthFt: 83.661 },
        { index: 3, frontageFt: 14.761, depthFt: 93.516 },
        { index: 4, frontageFt: 73.187, depthFt: 59.057 },
        { index: 5, frontageFt: 59.039, depthFt: 83.66 },
      ],
      suggestedFootprintSqFt: [2906, 4359],
    },
    {
      street: { side: 'south', edge: 2, frontage: 30, depth: 30 },
      buildable: { state: 'setbacks', frontEdge: 4 },
    },
    { check: everyEdge(6) },
  ),
  covers(
    'a U-shaped lot: every edge (lot_info listed the first six of eighteen)',
    house({ ...U_LOT, frontEdge: 0, setbacks: { front: 1, side: 1, rear: 1 } }),
    {
      lotSqFt: 7535,
      terrain: NOT_READ,
      setbacksFt: { front: 3.281, side: 3.281, rear: 3.281 },
      buildable: { frontageFt: 91.819, depthFt: 91.864, envelopeSqFt: 5858, frontEdge: 0 },
      otherEdges: [
        { index: 0, frontageFt: 91.819, depthFt: 91.864 },
        { index: 1, frontageFt: 0.199, depthFt: 91.97 },
        { index: 2, frontageFt: 91.663, depthFt: 91.863 },
        { index: 3, frontageFt: 25.967, depthFt: 91.863 },
        { index: 4, frontageFt: 0.422, depthFt: 80.119 },
        { index: 5, frontageFt: 62.202, depthFt: 26.246 },
      ],
      suggestedFootprintSqFt: [2260, 3391],
    },
    { lot: { areaM2: 700 }, buildable: { state: 'setbacks', frontEdge: 0 } },
    {
      // the notch's two inner sides, 19 m along each arm, reach 8 m back across it
      check: (result) => {
        const { edges } = (result as unknown as Brief).buildable
        const arms = edges.filter((edge) => edge.frontage > 18 && edge.frontage < 20)
        return [
          ...everyEdge(18)(result),
          ...(arms.length === 2 && arms.every((edge) => Math.abs(edge.depth - 8) < 0.05)
            ? []
            : [`arms ${JSON.stringify(arms)}`]),
        ]
      },
    },
  ),
  covers(
    'a round lot, its line a run of short edges: every edge, the front among them',
    house({
      polygon: { type: 'polygon', points: ROUND },
      frontEdge: 0,
      setbacks: { front: 1, side: 1, rear: 1 },
    }),
    ROUND_LOT_INFO,
    { buildable: { state: 'setbacks', frontEdge: 0 } },
    { check: everyEdge(64) },
  ),
  covers(
    'setbacks that leave nothing to build on',
    house({
      polygon: {
        type: 'polygon',
        points: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
      },
      frontEdge: 0,
      setbacks: { front: 6, side: 6, rear: 6 },
    }),
    {
      lotSqFt: 1076,
      terrain: NOT_READ,
      setbacksFt: { front: 19.685, side: 19.685, rear: 19.685 },
      buildable: NO_ENVELOPE,
      otherEdges: [],
      suggestedFootprintSqFt: [323, 484],
    },
    {
      street: { edge: 0, frontage: 10, depth: 10 },
      buildable: { state: 'none', areaM2: 0, edges: [], frontEdge: null },
    },
  ),
  covers(
    'a sloped lot: the fall across the lot, not across the wider grid the drop-in read',
    house({
      ...STRAIGHT_PARCEL,
      terrain: slopedTerrain(),
      metadata: { terrainSample: { reliefFt: 8.202, flat: false } },
    }),
    { ...STRAIGHT_FEET, terrain: 'sloped: 8.202 ft of relief across the lot' },
    { ground: { state: 'sloped', reliefM: 2 } },
    { mentions: ['ground: sloped, 2 m of fall across the lot'] },
  ),
  covers(
    'a lot whose ground was read flat',
    house({ ...STRAIGHT_PARCEL, metadata: { terrainSample: { reliefFt: 0.2, flat: true } } }),
    { ...STRAIGHT_FEET, terrain: 'read flat' },
    { ground: { state: 'flat', reliefM: 0.06 } },
    { mentions: ['ground: read flat (0.1 m of fall over the grid read round the lot)'] },
  ),
  covers(
    'a lot with no building on it yet, in site coordinates',
    () => scene(site(STRAIGHT_PARCEL)),
    { ...STRAIGHT_FEET, terrain: NOT_READ },
    {
      buildingId: null,
      lot: { ring: STRAIGHT.polygon.points },
      buildable: { ...STRAIGHT_BUILDABLE, frontEdge: 0 },
    },
    { mentions: ['lot, in site (no building stands on it yet) coordinates'] },
  ),
  covers(
    'a site with two buildings, the one asked for named',
    () =>
      scene(
        site(STRAIGHT_PARCEL),
        building(),
        level(),
        building({ position: [10, 0, 20] }, 'building_shed'),
        level('building_shed', 'level_shed'),
      ),
    { ...STRAIGHT_FEET, terrain: NOT_READ },
    { buildingId: 'building_shed', buildable: { ...STRAIGHT_BUILDABLE, frontEdge: 0 } },
    { input: { building: 'building_shed' } },
  ),
  covers(
    'two sites, the house on the second: the first, vacant, read by its id',
    // lot_info read the scene's first site whichever the house stood on
    () =>
      scene(
        site(STRAIGHT_PARCEL),
        SiteNode.parse({ id: 'site_b', children: [] }),
        building({ parentId: 'site_b' }),
        level(),
      ),
    { ...STRAIGHT_FEET, terrain: NOT_READ, address: '12 Elm St, Davis, CA, 95616' },
    { siteId: 'site_lot', buildingId: null, buildable: { ...STRAIGHT_BUILDABLE, frontEdge: 0 } },
    { input: { site: 'site_lot' } },
  ),
  {
    // lot_info: "no lot in the scene: lot_from_address, or the Lot tab"
    name: 'covers lot_info on a scene with no lot: refused',
    tool: 'get_site',
    scene: () => scene(building(), level()),
    input: {},
    expect: { refusal: 'no_site' },
  },
]
