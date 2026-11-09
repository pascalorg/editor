import { siteBrief } from '../../lib/site-placement'
import { encodeTerrainField } from '../../lib/terrain-codec'
import { createTerrainField, quantize } from '../../lib/terrain-field'
import {
  type AnyNode,
  BuildingNode,
  FenceNode,
  ItemNode,
  LevelNode,
  SiteNode,
  WallNode,
} from '../../schema'
import type { AgentToolCase, SceneGraph } from './cases'

/**
 * `get_site` and `place_building`, and the lot-line signal of `create_room`, `add_wall` and
 * `verify_scene`. The expected coordinates are worked by hand from each lot, not read back from
 * the code that places the house.
 */

type Pt = [number, number]

/** Links parents' children and returns the graph, sites as roots. */
export function scene(...nodes: AnyNode[]): SceneGraph {
  const byId = Object.fromEntries(nodes.map((node) => [node.id, { ...node }])) as Record<
    string,
    AnyNode & { children?: string[] }
  >
  for (const node of Object.values(byId)) {
    const parent = node.parentId ? byId[node.parentId] : undefined
    if (parent && Array.isArray(parent.children) && !parent.children.includes(node.id))
      parent.children = [...parent.children, node.id]
  }
  return {
    nodes: byId,
    rootNodeIds: nodes.filter((node) => node.type === 'site').map((node) => node.id),
  }
}

export const site = (extra: Record<string, unknown> = {}) =>
  SiteNode.parse({ id: 'site_lot', children: [], ...extra })
export const building = (extra: Record<string, unknown> = {}, id = 'building_main') =>
  BuildingNode.parse({ id, parentId: 'site_lot', ...extra })
export const level = (buildingId = 'building_main', id = 'level_ground') =>
  LevelNode.parse({ id, parentId: buildingId, level: 0, name: 'Ground', height: 2.8 })

/** Four walls round a box from `[x0, z0]`, `w` along x and `d` along z. */
function box(levelId: string, tag: string, [x0, z0]: Pt, w: number, d: number): AnyNode[] {
  const corners: Pt[] = [
    [x0, z0],
    [x0 + w, z0],
    [x0 + w, z0 + d],
    [x0, z0 + d],
  ]
  return corners.map((start, i) =>
    WallNode.parse({
      id: `wall_${tag}_${i}`,
      parentId: levelId,
      start,
      end: corners[(i + 1) % 4],
      thickness: 0.2,
    }),
  )
}

/** The rectangle `w × d` centred on `centre`, turned `deg` (x toward z); edge 0 is the far −z side. */
function turnedLot(centre: Pt, w: number, d: number, deg: number): Pt[] {
  const t = (deg * Math.PI) / 180
  const corner = ([x, z]: Pt): Pt => [
    centre[0] + x * Math.cos(t) - z * Math.sin(t),
    centre[1] + x * Math.sin(t) + z * Math.cos(t),
  ]
  return (
    [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ] as Pt[]
  ).map(corner)
}

// An 18 × 32 m parcel turned 20°, its centre at site [8, −6], front (edge 0) to the north, yards
// 6 / 1.5 / 6 m; the building stands at [3, 0, 2]. The envelope is the parcel inset 6 m front and
// rear, 1.5 m each side: 15 × 20 m round the same centre, which is [5, −8] in the level frame.
export const TILTED = {
  polygon: { type: 'polygon', points: turnedLot([8, -6], 18, 32, 20) },
  setbacks: { front: 6, side: 1.5, rear: 6 },
  setbacksSource: 'zoning-code',
  frontEdge: 0,
  address: { street: '1458 Oak St', city: 'Palo Alto', state: 'CA' },
  parcel: { apn: '003-12-045' },
}

// A 20 × 40 m lot along +z, its street on the north edge (edge 0, z = 0).
export const STRAIGHT = {
  polygon: {
    type: 'polygon',
    points: [
      [0, 0],
      [20, 0],
      [20, 40],
      [0, 40],
    ],
  },
  frontEdge: 0,
}

// A U-shaped lot: two arms 10 m wide, the notch x 10..20 above z = 10 not part of it.
export const U_LOT = {
  polygon: {
    type: 'polygon',
    points: [
      [0, 0],
      [30, 0],
      [30, 30],
      [20, 30],
      [20, 10],
      [10, 10],
      [10, 30],
      [0, 30],
    ],
  },
}

const near = (a: number, b: number, tolerance = 0.02) => Math.abs(a - b) <= tolerance

/** The footprint, read back from the scene the call left, is centred where it should be. */
const centredOn =
  (target: Pt, tolerance = 0.02) =>
  (_result: Record<string, unknown>, nodes: Readonly<Record<string, AnyNode>>) => {
    const brief = siteBrief(nodes, { buildingId: 'building_main' })
    const footprint = brief?.footprint
    if (!footprint) return ['no footprint after the call']
    const centre = brief.buildable.centre ?? [Number.NaN, Number.NaN]
    const problems: string[] = []
    if (!(near(centre[0], target[0], tolerance) && near(centre[1], target[1], tolerance)))
      problems.push(`buildable centre ${centre} is not ${target}`)
    if (footprint.offCentreM > tolerance)
      problems.push(`footprint ${footprint.offCentreM} m off the buildable centre`)
    if (footprint.fit !== 'buildable') problems.push(`footprint fit ${footprint.fit}`)
    return problems
  }

export const GET_SITE_CASES: AgentToolCase[] = [
  {
    name: 'a new project reads as the placeholder, buildable whole, centred on the origin',
    tool: 'get_site',
    scene: () => scene(site(), building(), level()),
    input: {},
    expect: {
      result: {
        siteId: 'site_lot',
        buildingId: 'building_main',
        placeholder: true,
        buildable: { state: 'lot', centre: [0, 0] },
        street: null,
        footprint: null,
      },
      mentions: ['placeholder'],
    },
  },
  {
    name: 'a turned parcel off the origin, read in the moved building’s level frame',
    tool: 'get_site',
    scene: () => scene(site(TILTED), building({ position: [3, 0, 2] }), level()),
    input: {},
    expect: {
      result: {
        placeholder: false,
        address: '1458 Oak St, Palo Alto, CA',
        parcel: { apn: '003-12-045' },
        buildable: { state: 'setbacks', centre: [5, -8], source: 'zoning-code' },
        street: { side: 'north', edge: 0, squareRotationDeg: -20 },
        pose: { position: [3, 0, 2], rotationDeg: 0 },
      },
      mentions: ['[5, -8]'],
    },
  },
  {
    name: 'setbacks that leave nothing are named, the lot is not used instead',
    tool: 'get_site',
    scene: () =>
      scene(
        site({
          polygon: {
            type: 'polygon',
            points: [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
            ],
          },
          setbacks: { front: 6, side: 6, rear: 6 },
        }),
        building(),
        level(),
      ),
    input: {},
    expect: { result: { buildable: { state: 'none', centre: null, ring: [] } } },
  },
  {
    name: 'the yards of a house, seen from the street',
    tool: 'get_site',
    scene: () =>
      scene(site(STRAIGHT), building(), level(), ...box('level_ground', 'h', [7, 7], 10, 12)),
    input: {},
    expect: {
      result: {
        // the walls are 0.2 m thick, so their outer faces stand 0.1 m out of their lines
        footprint: {
          fit: 'buildable',
          yards: { front: 6.9, rear: 20.9, left: 2.9, right: 6.9 },
        },
      },
    },
  },
  {
    name: 'setbacks of zero exclude nothing: the whole lot is buildable',
    tool: 'get_site',
    scene: () => scene(site({ setbacks: { front: 0, side: 0, rear: 0 } }), building(), level()),
    input: {},
    expect: {
      result: {
        buildable: {
          state: 'setbacks',
          centre: [0, 0],
          ring: [
            [-15, -15],
            [15, -15],
            [15, 15],
            [-15, 15],
          ],
        },
      },
    },
  },
  {
    name: 'a street edge and no front edge: the setbacks and the street both measure from it',
    tool: 'get_site',
    // the south edge (2, z = 40) is the street: front 6 from it, rear 2 from z = 0, sides 1
    scene: () =>
      scene(
        site({
          polygon: STRAIGHT.polygon,
          streetEdges: [2],
          setbacks: { front: 6, side: 1, rear: 2 },
        }),
        building(),
        level(),
      ),
    input: {},
    expect: {
      result: {
        street: { side: 'south', edge: 2 },
        buildable: { state: 'setbacks', centre: [10, 18] },
      },
    },
  },
  {
    name: 'a house bridging the notch of a U lot reaches past it by its middle, not its corners',
    tool: 'get_site',
    // the piece outside is x 10..20 across the notch; its middle is 5 m from both notch sides
    scene: () =>
      scene(site(U_LOT), building(), level(), ...box('level_ground', 'h', [5, 15], 20, 10)),
    input: {},
    expect: { result: { footprint: { fit: 'outside', overhang: { lotM: 5 } } } },
  },
  {
    name: "a terrain's fall over the lot counts a peak on a lot line, between the samples",
    tool: 'get_site',
    // a 3 × 3 field, 10 m apart, flat but for its middle sample at 10 m; no sample lies on the
    // lot, whose east line passes 1 m short of that peak and rises to 9 m there
    scene: () => {
      const field = createTerrainField({ origin: [0, 0], spacing: 10, cols: 3, rows: 3 })
      field.heights[4] = quantize(field, 10)
      const lot = {
        type: 'polygon',
        points: [
          [1, 1],
          [9, 1],
          [9, 19],
          [1, 19],
        ],
      }
      return scene(site({ polygon: lot, terrain: encodeTerrainField(field) }), building(), level())
    },
    input: {},
    expect: { result: { ground: { state: 'sloped', reliefM: 9 } } },
  },
  {
    name: 'a terrain far off the lot, its samples 10 nm apart: read over the field’s own lines',
    tool: 'get_site',
    // past the field heightAt holds its edge, so the lot's lines cross only the field's few grid
    // lines, not the 10^24 between the lot and the field; the field's west column rises 2 m
    scene: () => {
      const field = createTerrainField({ origin: [1e16, 0], spacing: 1e-8, cols: 2, rows: 2 })
      field.heights[2] = quantize(field, 2)
      const terrain = encodeTerrainField(field)
      return scene(site({ polygon: STRAIGHT.polygon, terrain }), building(), level())
    },
    input: {},
    expect: { result: { ground: { state: 'sloped', reliefM: 2 } } },
  },
  {
    name: 'a terrain finer than the coordinates can hold: the fall heightAt shows, not its samples',
    tool: 'get_site',
    // at 1e16 the coordinates step 2 m, so the middle sample (5 m), 10 nm from the field's west
    // column, is at no point of the lot: the ground shows the flat columns either side of it
    scene: () => {
      const field = createTerrainField({ origin: [1e16, 0], spacing: 1e-8, cols: 3, rows: 3 })
      field.heights[4] = quantize(field, 5)
      const lot = {
        type: 'polygon',
        points: [
          [1e16 - 4, -4],
          [1e16 + 4, -4],
          [1e16 + 4, 4],
          [1e16 - 4, 4],
        ],
      }
      return scene(site({ polygon: lot, terrain: encodeTerrainField(field) }), building(), level())
    },
    input: {},
    expect: { result: { ground: { state: 'sloped', reliefM: 0 } } },
  },
  {
    name: 'a lot widening away from its street: the front is the edge facing it, not the longer rear',
    tool: 'get_site',
    // 10 m on the street (z = 0) and 100 m at the back (z = 20), 1 m setbacks
    scene: () =>
      scene(
        site({
          polygon: {
            type: 'polygon',
            points: [
              [0, 0],
              [10, 0],
              [55, 20],
              [-45, 20],
            ],
          },
          frontEdge: 0,
          setbacks: { front: 1, side: 1, rear: 1 },
        }),
        building(),
        level(),
      ),
    input: {},
    expect: {
      result: { street: { side: 'north', edge: 0 }, buildable: { frontEdge: 0 } },
      mentions: ['9.6 m along the street'],
    },
  },
  {
    name: 'a narrow frontage the side setbacks take whole: no buildable edge faces the street',
    tool: 'get_site',
    // 2 m on the street (z = 0), 60 m at the back: 5 m side yards leave a triangle pointing at
    // the street, its sides diagonal; neither is a front, though one is nearer the street
    scene: () =>
      scene(
        site({
          polygon: {
            type: 'polygon',
            points: [
              [0, 0],
              [2, 0],
              [30, 40],
              [-30, 40],
            ],
          },
          frontEdge: 0,
          setbacks: { front: 1, side: 5, rear: 1 },
        }),
        building(),
        level(),
      ),
    input: {},
    expect: {
      result: {
        street: { side: 'north', edge: 0, squareRotationDeg: 0 },
        buildable: { state: 'setbacks', frontEdge: null },
      },
      mentions: ['no edge of it faces the street, so no frontage to build along'],
    },
  },
  {
    name: 'a site named, two buildings on it: read for the one viewed',
    tool: 'get_site',
    scene: () =>
      scene(
        site(STRAIGHT),
        building(),
        level(),
        building({ position: [10, 0, 20] }, 'building_shed'),
        level('building_shed', 'level_shed'),
      ),
    context: { activeLevelId: 'level_shed' },
    input: { site: 'site_lot' },
    expect: {
      result: {
        siteId: 'site_lot',
        buildingId: 'building_shed',
        lot: {
          ring: [
            [-10, -20],
            [10, -20],
            [10, 20],
            [-10, 20],
          ],
        },
      },
    },
  },
  {
    name: 'a site named by an id no node has: refused',
    tool: 'get_site',
    scene: () => scene(site(STRAIGHT), building(), level()),
    input: { site: 'site_missing' },
    expect: { refusal: 'site_not_found' },
  },
  {
    name: 'a site named by a node that is not one: refused',
    tool: 'get_site',
    scene: () => scene(site(STRAIGHT), building(), level()),
    input: { site: 'building_main' },
    expect: { refusal: 'not_a_site' },
  },
  {
    name: 'a building and a site it does not stand on: refused',
    tool: 'get_site',
    scene: () =>
      scene(
        site(STRAIGHT),
        SiteNode.parse({ id: 'site_b', children: [] }),
        building({ parentId: 'site_b' }),
        level(),
      ),
    input: { building: 'building_main', site: 'site_lot' },
    expect: { refusal: 'building_not_on_site', mentions: ['stands on site_b'] },
  },
  {
    name: 'no site: refused',
    tool: 'get_site',
    scene: () => scene(BuildingNode.parse({ id: 'building_main' }), level()),
    input: {},
    expect: { refusal: 'no_site' },
  },
]

export const PLACE_BUILDING_CASES: AgentToolCase[] = [
  {
    name: 'an outline on an empty building: the house will rise centred, before any wall',
    tool: 'place_building',
    scene: () => scene(site(), building(), level()),
    input: {
      outline: [
        [0, 0],
        [12, 0],
        [12, 10],
        [0, 10],
      ],
    },
    expect: {
      result: { moved: true, position: [-6, 0, -5], rotationDeg: 0, fit: 'buildable' },
      after: { building_main: { position: [-6, 0, -5] } },
    },
  },
  {
    name: 'walls traced from a corner (the house off the bottom-left of the lot) stand centred',
    tool: 'place_building',
    scene: () => scene(site(), building(), level(), ...box('level_ground', 'h', [-20, 1], 20, 26)),
    input: {},
    expect: {
      result: { moved: true, position: [10, 0, -14], fit: 'buildable' },
      // the walls keep their own coordinates
      after: { wall_h_0: { start: [-20, 1], end: [0, 1] } },
      check: centredOn([-10, 14]),
    },
  },
  {
    name: 'a replayed call moves nothing',
    tool: 'place_building',
    scene: () =>
      scene(
        site(),
        building({ position: [10, 0, -14] }),
        level(),
        ...box('level_ground', 'h', [-20, 1], 20, 26),
      ),
    input: {},
    expect: { result: { moved: false, position: [10, 0, -14] }, mentions: ['nothing moved'] },
  },
  {
    name: 'on a turned parcel the house is centred in the setbacks, still facing as it did',
    tool: 'place_building',
    scene: () =>
      scene(
        site(TILTED),
        building({ position: [3, 0, 2] }),
        level(),
        ...box('level_ground', 'h', [0, 0], 12, 10),
      ),
    input: {},
    expect: {
      // the walls' footprint (with their 0.1 m outer faces) is centred on [6, 5]: site [8, −6]
      result: { moved: true, position: [2, 0, -11], rotationDeg: 0, fit: 'buildable' },
      check: centredOn([6, 5]),
    },
  },
  {
    name: 'turned on purpose (squared to the street), it is still centred',
    tool: 'place_building',
    scene: () =>
      scene(
        site(TILTED),
        building({ position: [3, 0, 2] }),
        level(),
        ...box('level_ground', 'h', [0, 0], 12, 10),
      ),
    input: { rotationDeg: -20 },
    expect: {
      result: { moved: true, rotationDeg: -20, fit: 'buildable' },
      check: centredOn([6, 5]),
    },
  },
  {
    name: 'a building already turned 0.7 rad keeps its turn and lands centred',
    tool: 'place_building',
    scene: () =>
      scene(
        site(),
        building({ rotation: [0, 0.7, 0], position: [20, 0, 20] }),
        level(),
        ...box('level_ground', 'h', [3, 4], 8, 6),
      ),
    input: {},
    expect: {
      result: { moved: true, rotationDeg: 40.1, fit: 'buildable' },
      after: { building_main: { rotation: [0, 0.7, 0] } },
      check: centredOn([7, 7], 0.05),
    },
  },
  {
    name: 'a lot whose centroid is too near its edge for the house: the most interior point wins',
    tool: 'place_building',
    // a 20 m square with a 4 m strip running 40 m east: the centroid [18.6, 7.7] is on the lot,
    // but a 16 m house centred there crosses the square's east side; at the square's middle it fits
    scene: () =>
      scene(
        site({
          polygon: {
            type: 'polygon',
            points: [
              [0, 0],
              [60, 0],
              [60, 4],
              [20, 4],
              [20, 20],
              [0, 20],
            ],
          },
        }),
        building(),
        level(),
      ),
    input: {
      outline: [
        [0, 0],
        [16, 0],
        [16, 16],
        [0, 16],
      ],
    },
    expect: {
      result: { moved: true, fit: 'buildable' },
      check: (result) => {
        const [x, , z] = result.position as number[]
        return near(x as number, 2, 0.5) && near(z as number, 2, 0.5) ? [] : [`at ${x}, ${z}`]
      },
    },
  },
  {
    name: 'a house bigger than the lot is centred, never the lot resized, and said to be outside',
    tool: 'place_building',
    scene: () => scene(site(), building(), level()),
    input: {
      outline: [
        [0, 0],
        [40, 0],
        [40, 34],
        [0, 34],
      ],
    },
    expect: {
      // 5 m past the lot line east and west, 2 m north and south: its corners 5.39 m out
      result: {
        position: [-20, 0, -17],
        fit: 'outside',
        overhang: { lotM: 5.39 },
      },
      check: (result) => {
        const sides = [...(result.overhang as { sides: string[] }).sides].sort()
        return sides.join() === 'east,north,south,west' ? [] : [`sides ${sides}`]
      },
      after: {
        site_lot: {
          polygon: {
            type: 'polygon',
            points: [
              [-15, -15],
              [15, -15],
              [15, 15],
              [-15, 15],
            ],
          },
        },
      },
      mentions: ['placeholder'],
    },
  },
  {
    name: 'yards from a site plan: 7 m front, 3 m left (east, seen from the north street)',
    tool: 'place_building',
    scene: () =>
      scene(site(STRAIGHT), building(), level(), ...box('level_ground', 'h', [0, 0], 10, 12)),
    input: { yards: { front: 7, left: 3 } },
    expect: {
      // outer faces x −0.1..10.1, z −0.1..12.1: 7 m from z = 0 and 3 m from x = 20
      result: { moved: true, position: [6.9, 0, 7.1], yards: { front: 7, left: 3 } },
    },
  },
  {
    name: 'a house about to rise on a turned parcel stands square to the street, in the setbacks',
    tool: 'place_building',
    // 14 × 10 m fits the 15 × 20 m envelope only squared to it
    scene: () => scene(site(TILTED), building({ position: [3, 0, 2] }), level()),
    input: {
      outline: [
        [0, 0],
        [14, 0],
        [14, 10],
        [0, 10],
      ],
    },
    expect: { result: { moved: true, rotationDeg: -20, fit: 'buildable' } },
  },
  {
    name: 'yards with a new rotation are measured from the street as the house will face it',
    tool: 'place_building',
    // turned 90°, the house still has its front 3 m from the north street: site z 3..7, x centred
    scene: () => scene(site(STRAIGHT), building(), level()),
    input: {
      outline: [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
      ],
      rotationDeg: 90,
      yards: { front: 3 },
    },
    expect: { result: { position: [10, 0, 5], rotationDeg: 90, yards: { front: 3 } } },
  },
  {
    name: 'replayed, yards with a new rotation move nothing',
    tool: 'place_building',
    scene: () =>
      scene(
        site(STRAIGHT),
        building({ position: [10, 0, 5], rotation: [0, Math.PI / 2, 0] }),
        level(),
      ),
    input: {
      outline: [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
      ],
      rotationDeg: 90,
      yards: { front: 3 },
    },
    expect: { result: { moved: false, position: [10, 0, 5] } },
  },
  {
    name: 'a front and a side yard on a lot askew to the house are both met',
    tool: 'place_building',
    // on a lot turned 30° each yard's move changes the other's
    scene: () =>
      scene(
        site({ polygon: { type: 'polygon', points: turnedLot([0, 0], 30, 30, 30) }, frontEdge: 0 }),
        building(),
        level(),
      ),
    input: {
      outline: [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
      ],
      rotationDeg: 0,
      yards: { front: 10, left: 10 },
    },
    expect: { result: { moved: true, rotationDeg: 0, yards: { front: 10, left: 10 } } },
  },
  {
    name: 'front and rear yards together: refused',
    tool: 'place_building',
    scene: () =>
      scene(site(STRAIGHT), building(), level(), ...box('level_ground', 'h', [0, 0], 10, 12)),
    input: { yards: { front: 7, rear: 7 } },
    expect: { refusal: 'yards_conflict' },
  },
  {
    name: 'a front yard the lot is too shallow for: refused',
    tool: 'place_building',
    scene: () =>
      scene(site(STRAIGHT), building(), level(), ...box('level_ground', 'h', [0, 0], 10, 12)),
    input: { yards: { front: 30 } },
    expect: { refusal: 'yards_infeasible' },
  },
  {
    name: 'yards on a site with no street: refused',
    tool: 'place_building',
    scene: () => scene(site(), building(), level(), ...box('level_ground', 'h', [0, 0], 10, 12)),
    input: { yards: { front: 5 } },
    expect: { refusal: 'no_street' },
  },
  {
    name: 'nothing to place yet: refused, asking for the outline',
    tool: 'place_building',
    scene: () => scene(site(), building(), level()),
    input: {},
    expect: { refusal: 'needs_footprint', mentions: ['outline'] },
  },
  {
    name: 'centring next to another building: refused',
    tool: 'place_building',
    scene: () =>
      scene(
        site(),
        building(),
        level(),
        ...box('level_ground', 'h', [0, 0], 10, 12),
        building({}, 'building_garage'),
        level('building_garage', 'level_garage'),
        ...box('level_garage', 'g', [8, 8], 6, 6),
      ),
    input: { building: 'building_main' },
    expect: { refusal: 'other_building_on_site', mentions: ['building_garage'] },
  },
  {
    name: 'two buildings and none named: refused',
    tool: 'place_building',
    surfaces: ['core', 'mcp'],
    scene: () =>
      scene(
        site(),
        building(),
        level(),
        building({}, 'building_garage'),
        level('building_garage', 'level_garage'),
      ),
    input: {},
    expect: { refusal: 'building_required' },
  },
  {
    name: 'a fenced house: the fence moves with it and is named for a re-trace',
    tool: 'place_building',
    scene: () =>
      scene(
        site(),
        building(),
        level(),
        ...box('level_ground', 'h', [-20, 1], 20, 26),
        FenceNode.parse({
          id: 'fence_front',
          parentId: 'level_ground',
          start: [-20, 0],
          end: [0, 0],
        }),
        ItemNode.parse({
          id: 'item_tree',
          parentId: 'level_ground',
          position: [-25, 0, 5],
          asset: {
            id: 'tree',
            name: 'Tree',
            category: 'outdoor',
            thumbnail: '',
            src: 'asset://tree',
            dimensions: [1, 3, 1],
          },
        }),
      ),
    input: {},
    expect: {
      result: { moved: true },
      contains: { movedWithIt: [{ id: 'fence_front' }, { id: 'item_tree' }] },
      after: { fence_front: { start: [-20, 0], end: [0, 0] } },
    },
  },
]

export const SITE_LINE_CASES: AgentToolCase[] = [
  {
    name: 'a room past the lot line says how far and where',
    tool: 'create_room',
    scene: () => scene(site(), building(), level()),
    input: {
      name: 'Garage',
      polygon: [
        [10, 0],
        [20, 0],
        [20, 5],
        [10, 5],
      ],
    },
    expect: {
      result: { site: { fit: 'outside', sides: ['east'] } },
      check: (result) =>
        // to the outer face of its 0.1 m walls
        near(Number((result.site as { overhangM?: number }).overhangM), 5.05, 0.01)
          ? []
          : [`overhang ${(result.site as { overhangM?: number }).overhangM}`],
    },
  },
  {
    name: 'a room on the lot carries no site flag',
    tool: 'create_room',
    scene: () => scene(site(), building(), level()),
    input: {
      name: 'Living',
      polygon: [
        [0, 0],
        [5, 0],
        [5, 4],
        [0, 4],
      ],
    },
    expect: { result: { ok: true }, check: (result) => ('site' in result ? ['site flag'] : []) },
  },
  {
    name: 'a room drawn to the lot line has walls past it',
    tool: 'create_room',
    scene: () => scene(site(), building(), level()),
    input: {
      name: 'Study',
      polygon: [
        [10, 0],
        [15, 0],
        [15, 4],
        [10, 4],
      ],
      wallThickness: 0.2,
    },
    expect: { result: { site: { fit: 'outside', overhangM: 0.1, sides: ['east'] } } },
  },
  {
    name: 'a wall past the lot line says so',
    tool: 'add_wall',
    scene: () => scene(site(), building(), level()),
    input: { start: [0, 20], end: [8, 20] },
    expect: { result: { site: { fit: 'outside', sides: ['south'] } } },
  },
  {
    name: 'a curved wall whose chord stays on the lot bows past it',
    tool: 'add_wall',
    // the chord runs at z = 13; bowed 3 m south, the wall reaches z 16.05
    scene: () => scene(site(), building(), level()),
    input: { start: [-5, 13], end: [5, 13], curveOffset: -3 },
    expect: { result: { site: { fit: 'outside', overhangM: 1.05, sides: ['south'] } } },
  },
]

export const SITE_VERIFY_CASES: AgentToolCase[] = [
  {
    name: 'a house across the notch of a U lot, every corner on the lot, is past its line',
    tool: 'verify_scene',
    scene: () =>
      scene(site(U_LOT), building(), level(), ...box('level_ground', 'h', [5, 20], 20, 5)),
    input: {},
    expect: { result: {}, contains: { issues: [{ type: 'footprint_outside_site' }] } },
  },
  {
    name: 'a house on the lot but into the yards',
    tool: 'verify_scene',
    scene: () =>
      scene(
        site({ ...STRAIGHT, setbacks: { front: 6, side: 1.5, rear: 6 } }),
        building(),
        level(),
        ...box('level_ground', 'h', [1, 2], 10, 12),
      ),
    input: {},
    expect: {
      result: {},
      contains: { issues: [{ type: 'footprint_outside_setbacks' }] },
      lacks: { issues: [{ type: 'footprint_outside_site' }] },
    },
  },
  {
    name: 'setbacks that leave nothing to build on',
    tool: 'verify_scene',
    scene: () =>
      scene(
        site({ ...STRAIGHT, setbacks: { front: 30, side: 1.5, rear: 30 } }),
        building(),
        level(),
      ),
    input: {},
    expect: { result: {}, contains: { issues: [{ type: 'buildable_area_none' }] } },
  },
  {
    name: 'inside the buildable area but off its centre is no problem',
    tool: 'verify_scene',
    scene: () =>
      scene(
        site({ ...STRAIGHT, setbacks: { front: 6, side: 1.5, rear: 6 } }),
        building(),
        level(),
        ...box('level_ground', 'h', [2, 7], 8, 8),
      ),
    input: {},
    expect: {
      result: {},
      lacks: {
        issues: [
          { type: 'footprint_outside_site' },
          { type: 'footprint_outside_setbacks' },
          { type: 'buildable_area_none' },
        ],
      },
    },
  },
]
