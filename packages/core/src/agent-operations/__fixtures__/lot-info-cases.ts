import { encodeTerrainField } from '../../lib/terrain-codec'
import { createTerrainField, quantize } from '../../lib/terrain-field'
import type { AgentToolCase, SceneGraph } from './cases'
import { building, level, STRAIGHT, scene, site, TILTED, U_LOT } from './site-cases'

/**
 * get_site reads everything the hosted Architect plugin's lot_info did, so lot_info retires into
 * it. lot_info took no input: each case is a lot it read (the new-project placeholder its stored
 * calls read, a parcel with setbacks, turned, with no street recorded, on a corner with a sight
 * triangle, a U with more edges than it listed, setbacks that leave nothing, the ground sloped,
 * read flat or not read, no building yet, several buildings, no site), beside the get_site call
 * that covers it, run without a model through the core, MCP and chat runners.
 *
 * `lotInfo` is what lot_info printed for that lot, in its own units (feet, square feet, its
 * words): worked by hand, and the same as lot_info answered on the hosted main of 2026-10-14. The
 * envelope of the corner lot and of the U is traced on a raster (core's inset of a concave corner
 * or a sight triangle), so those two hold lot_info's printed numbers, slivers of the trace
 * included. The check finds each of its facts in get_site's answer, in metres: the lot's area; the
 * setbacks; the buildable envelope's area, and its frontage and depth on the edge behind the street
 * (lot_info's `buildable`) and on each edge (its `otherEdges`, the first six); the footprint range
 * (30 to 45% of the lot); the ground; the address. The `result` states get_site's own numbers.
 *
 * Where they differ, get_site is the honest one: with no street recorded, lot_info took the edge
 * facing most nearly north as the front, get_site leaves `frontEdge` null and gives that edge's
 * frontage and depth among the others; it lists every edge a house could face, not the first six
 * with the trace's slivers; it reads the slope from the terrain itself, across the lot.
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
    const feet = (what: string, metres: number | undefined, ft: number, tolerance = 0.05) => {
      if (metres === undefined || Math.abs(metres / FT - ft) > tolerance)
        problems.push(`${what}: ${metres} m is not ${ft} ft`)
    }
    const squareFeet = (what: string, m2: number | undefined, sqFt: number, tolerance = 2) => {
      if (m2 === undefined || Math.abs(m2 * SQ_FT - sqFt) > tolerance)
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
    if (sloped) feet('terrain relief', brief.ground.reliefM ?? undefined, Number(sloped[1]))

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
      // lot_info's front was the recorded street, else its guess; get_site names only the street's
      const named = brief.street ? frontEdge : null
      if (brief.buildable.frontEdge !== named)
        problems.push(`frontEdge ${brief.buildable.frontEdge}, not ${named}`)
    }
    for (const { index, frontageFt, depthFt } of lotInfo.otherEdges) {
      const edge = brief.buildable.edges.find((front) => front.edge === index)
      // a sliver of the inset envelope is no front: get_site leaves it out
      if (frontageFt * FT < 1) {
        if (edge) problems.push(`otherEdges[${index}], a sliver, listed`)
        continue
      }
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
 * outside it), so the fall across the lot (2 m over its 40 m) is less than the field's (2.5 m).
 * The lot drop-in recorded the same fall, 6.562 ft, which lot_info printed.
 */
function slopedTerrain() {
  const field = createTerrainField({ origin: [-5, -5], spacing: 1, cols: 31, rows: 51 })
  for (let row = 0; row < field.rows; row++)
    for (let col = 0; col < field.cols; col++)
      field.heights[row * field.cols + col] = quantize(field, (field.origin[1] + row) * 0.05)
  return encodeTerrainField(field)
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
        frontEdge: null,
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
    { mentions: ['a house usually covers 30–45%: 270–405 m²', 'ground: not read'] },
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
    'setbacks with no street recorded (lot_info took the north-facing edge as the front)',
    house({ polygon: STRAIGHT.polygon, setbacks: SETBACKS }),
    { ...STRAIGHT_FEET, terrain: NOT_READ },
    { street: null, buildable: { ...STRAIGHT_BUILDABLE, frontEdge: null } },
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
    {
      // the rear, the street side, the cut corner, the front and the side; not the sliver
      check: (result) => {
        const { edges } = (result as unknown as Brief).buildable
        return edges.map((edge) => edge.edge).join() === '0,2,3,4,5'
          ? []
          : [`edges ${edges.map((edge) => edge.edge)}`]
      },
    },
  ),
  covers(
    'a U-shaped lot: every edge a house could face (lot_info listed the first six, slivers too)',
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
      // the front, the right arm's side, its end and inner side, the notch's end, the left arm's
      // inner side, its end and its side: eight, each a metre or more, the arms 8 m deep
      check: (result) => {
        const { edges } = (result as unknown as Brief).buildable
        const arms = edges.filter((edge) => edge.frontage > 15 && edge.frontage < 20)
        return edges.length === 8 &&
          edges.every((edge) => edge.frontage >= 1) &&
          arms.length === 2 &&
          arms.every((edge) => Math.abs(edge.depth - 8) < 0.05)
          ? []
          : [`edges ${JSON.stringify(edges)}`]
      },
    },
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
    'a sloped lot: the fall across the lot, not across its terrain',
    house({
      ...STRAIGHT_PARCEL,
      terrain: slopedTerrain(),
      metadata: { terrainSample: { reliefFt: 6.562, flat: false } },
    }),
    { ...STRAIGHT_FEET, terrain: 'sloped: 6.562 ft of relief across the lot' },
    { ground: { state: 'sloped', reliefM: 2 } },
    { mentions: ['ground: sloped, 2 m of fall across the lot'] },
  ),
  covers(
    'a lot whose ground was read flat',
    house({ ...STRAIGHT_PARCEL, metadata: { terrainSample: { reliefFt: 0.2, flat: true } } }),
    { ...STRAIGHT_FEET, terrain: 'read flat' },
    { ground: { state: 'flat', reliefM: 0.06 } },
    { mentions: ['ground: flat (read: 0.1 m of fall across the lot)'] },
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
  {
    // lot_info: "no lot in the scene: lot_from_address, or the Lot tab"
    name: 'covers lot_info on a scene with no lot: refused',
    tool: 'get_site',
    scene: () => scene(building(), level()),
    input: {},
    expect: { refusal: 'no_site' },
  },
]
