import {
  type AnyNode,
  BuildingNode,
  CeilingNode,
  type FenceNode,
  LevelNode,
  SiteNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '../../schema'
import type { AgentToolCase, SceneGraph } from './cases'

/**
 * `add_wall`, `add_level` and `create_stair`: one tool each where the MCP and the chat had two
 * (create_wall, create_level, create_stair_between_levels), each with its own rules. Where the two
 * disagreed the editor decides: a stair owns its floor openings and gets a storey made for it,
 * a level goes above the highest or below the lowest. The MCP's roof refusals are kept.
 *
 * A house of two 2.8 m storeys: the ground floor has a 6 × 5 m hall and one wall, the upper floor
 * a slab over the whole of it. Next to it a 3 m storey under a declared roof level.
 */

type Pt = [number, number]
const HALL: Pt[] = [
  [0, 0],
  [6, 0],
  [6, 5],
  [0, 5],
]

const graph = (...nodes: { id: string }[]): SceneGraph => ({
  nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
  rootNodeIds: nodes
    .filter((node) => (node as { type?: string }).type === 'building')
    .map((node) => node.id),
})

export function storeysScene(): SceneGraph {
  const wall = WallNode.parse({
    id: 'wall_ground',
    parentId: 'level_ground',
    name: 'Wall 1',
    start: [0, 0],
    end: [6, 0],
  })
  const hall = ZoneNode.parse({
    id: 'zone_hall',
    parentId: 'level_ground',
    name: 'Hall',
    polygon: HALL,
  })
  const groundSlab = SlabNode.parse({ id: 'slab_ground', parentId: 'level_ground', polygon: HALL })
  const upperSlab = SlabNode.parse({ id: 'slab_upper', parentId: 'level_upper', polygon: HALL })
  const ground = LevelNode.parse({
    id: 'level_ground',
    parentId: 'building_house',
    level: 0,
    name: 'Ground',
    height: 2.8,
    children: [wall.id, hall.id, groundSlab.id],
  })
  const upper = LevelNode.parse({
    id: 'level_upper',
    parentId: 'building_house',
    level: 1,
    name: 'Upper',
    height: 2.8,
    children: [upperSlab.id],
  })
  const house = BuildingNode.parse({ id: 'building_house', children: [ground.id, upper.id] })
  const storey = LevelNode.parse({
    id: 'level_storey',
    parentId: 'building_roofed',
    level: 0,
    name: 'Storey',
    height: 3,
  })
  const roof = LevelNode.parse({
    id: 'level_roof',
    parentId: 'building_roofed',
    level: 1,
    name: 'Roof',
    height: 3,
    metadata: { role: 'roof' },
  })
  const roofed = BuildingNode.parse({ id: 'building_roofed', children: [storey.id, roof.id] })
  return graph(house, ground, upper, wall, hall, groundSlab, upperSlab, roofed, storey, roof)
}

/** One building, one storey, nothing on it. */
function soloScene(): SceneGraph {
  const level = LevelNode.parse({
    id: 'level_solo',
    parentId: 'building_solo',
    level: 0,
    height: 2.5,
  })
  return graph(BuildingNode.parse({ id: 'building_solo', children: [level.id] }), level)
}

const bareBuildingScene = (): SceneGraph => graph(BuildingNode.parse({ id: 'building_bare' }))

const emptyScene = (): SceneGraph => ({ nodes: {}, rootNodeIds: [] })

export const ADD_WALL_CASES: AgentToolCase[] = [
  {
    name: 'a wall on the level named, numbered as the editor numbers walls',
    tool: 'add_wall',
    scene: storeysScene,
    input: { levelId: 'level_upper', start: [0, 0], end: [3, 4] },
    expect: { result: { ok: true, levelId: 'level_upper', length: 5 }, mentions: ['Wall 2'] },
  },
  {
    name: 'level is the same field as levelId',
    tool: 'add_wall',
    scene: storeysScene,
    input: { level: 'level_upper', start: [0, 0], end: [4, 0] },
    expect: { result: { levelId: 'level_upper', length: 4 } },
  },
  {
    name: 'without a level, the floor the person is viewing',
    tool: 'add_wall',
    scene: storeysScene,
    input: { start: [0, 0], end: [4, 0] },
    context: { activeLevelId: 'level_upper' },
    expect: { result: { levelId: 'level_upper' } },
  },
  {
    name: 'without a level or a viewed floor, the lowest storey',
    tool: 'add_wall',
    scene: storeysScene,
    input: { start: [0, 0], end: [4, 0] },
    expect: { result: { levelId: 'level_ground' } },
  },
  {
    name: 'a bend past half the chord is clamped to a half circle',
    tool: 'add_wall',
    scene: storeysScene,
    input: { levelId: 'level_ground', start: [0, 3], end: [4, 3], curveOffset: '3 m' },
    expect: { result: { curveOffset: 2 } },
  },
  {
    name: 'a declared roof level is not a storey and takes no walls',
    tool: 'add_wall',
    scene: storeysScene,
    input: { levelId: 'level_roof', start: [0, 0], end: [4, 0] },
    expect: { refusal: 'roof_level', mentions: ['level_roof'] },
  },
  {
    name: 'an unknown level is refused with the id',
    tool: 'add_wall',
    scene: storeysScene,
    input: { levelId: 'level_missing', start: [0, 0], end: [4, 0] },
    expect: { refusal: 'level_not_found', mentions: ['level_missing'] },
  },
  {
    name: 'a node that is not a level is refused',
    tool: 'add_wall',
    scene: storeysScene,
    input: { levelId: 'wall_ground', start: [0, 0], end: [4, 0] },
    expect: { refusal: 'not_a_level' },
  },
  {
    name: 'a wall shorter than a centimetre is refused, as the editor does not draw it',
    tool: 'add_wall',
    scene: storeysScene,
    input: { levelId: 'level_ground', start: [1, 1], end: [1, 1.005] },
    expect: { refusal: 'wall_too_short' },
  },
]

const fencesOn = (nodes: Readonly<Record<string, AnyNode>>, levelId: string) =>
  Object.values(nodes).filter(
    (node): node is FenceNode => node.type === 'fence' && node.parentId === levelId,
  )

export const ADD_FENCE_CASES: AgentToolCase[] = [
  {
    name: 'one fence per side along the points, privacy panels unless asked',
    tool: 'add_fence',
    scene: storeysScene,
    input: {
      levelId: 'level_ground',
      points: [
        [0, 0],
        [8, 0],
        [8, 6],
      ],
    },
    expect: {
      result: { ok: true, count: 2, levelId: 'level_ground', length: 14 },
      check: (_, nodes) => {
        const fences = fencesOn(nodes, 'level_ground')
        return fences.length === 2 && fences.every((fence) => fence.style === 'privacy')
          ? []
          : [`${fences.length} fences on the ground floor, styles ${fences.map((f) => f.style)}`]
      },
    },
  },
  {
    name: "closed runs back to the first point, a lot's boundary",
    tool: 'add_fence',
    scene: storeysScene,
    input: {
      levelId: 'level_ground',
      closed: true,
      style: 'picket',
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    },
    expect: { result: { ok: true, count: 4, length: 40 } },
  },
  {
    name: 'a side shorter than 10 cm is refused, nothing built',
    tool: 'add_fence',
    scene: storeysScene,
    input: {
      levelId: 'level_ground',
      points: [
        [0, 0],
        [4, 0],
        [4, 0.05],
      ],
    },
    expect: { refusal: 'fence_too_short' },
  },
  {
    name: 'a roof level takes no fence',
    tool: 'add_fence',
    scene: storeysScene,
    input: {
      levelId: 'level_roof',
      points: [
        [0, 0],
        [4, 0],
      ],
    },
    expect: { refusal: 'roof_level', mentions: ['level_roof'] },
  },
  {
    name: 'a finish the library lacks is refused with the nearest',
    tool: 'add_fence',
    scene: storeysScene,
    input: {
      levelId: 'level_ground',
      materialPreset: 'library:unobtainium',
      points: [
        [0, 0],
        [4, 0],
      ],
    },
    expect: { refusal: 'unknown_material' },
  },
]

export const ADD_LEVEL_CASES: AgentToolCase[] = [
  {
    name: 'above the highest level of the viewed building, at the default storey height',
    tool: 'add_level',
    scene: storeysScene,
    input: { name: 'Attic' },
    context: { activeLevelId: 'level_ground' },
    expect: {
      result: { ok: true, buildingId: 'building_house', floorIndex: 2, name: 'Attic', height: 2.5 },
    },
  },
  {
    name: 'on top of the storeys, under the roof level, which moves up one',
    tool: 'add_level',
    scene: storeysScene,
    input: { buildingId: 'building_roofed' },
    expect: {
      result: { ok: true, floorIndex: 1, shiftedLevelIds: ['level_roof'] },
      after: { level_roof: { level: 2 } },
    },
  },
  {
    name: 'below the lowest level for a basement, at the height asked',
    tool: 'add_level',
    scene: storeysScene,
    input: { buildingId: 'building_house', position: 'below', height: '3 m' },
    expect: { result: { buildingId: 'building_house', floorIndex: -1, height: 3 } },
  },
  {
    name: 'the scene’s only building needs no id',
    tool: 'add_level',
    scene: soloScene,
    input: {},
    expect: { result: { buildingId: 'building_solo', floorIndex: 1 } },
  },
  {
    name: 'a building with no level yet gets its ground floor',
    tool: 'add_level',
    scene: bareBuildingScene,
    input: {},
    expect: { result: { buildingId: 'building_bare', floorIndex: 0 } },
  },
  {
    name: 'with several buildings and none viewed, the building is asked for',
    tool: 'add_level',
    scene: storeysScene,
    input: {},
    expect: { refusal: 'building_required', mentions: ['building_house', 'building_roofed'] },
  },
  {
    name: 'an unknown building is refused with the id',
    tool: 'add_level',
    scene: storeysScene,
    input: { buildingId: 'building_missing' },
    expect: { refusal: 'building_not_found', mentions: ['building_missing'] },
  },
  {
    name: 'a node that is not a building is refused',
    tool: 'add_level',
    scene: storeysScene,
    input: { buildingId: 'level_ground' },
    expect: { refusal: 'not_a_building' },
  },
  // The fresh start: an agent that cleared the scene to restart could not begin again with
  // the tools (add_level answered no_building, add_wall no_levels). An empty scene gets the
  // editor's own empty scene: a site, its building, the ground level.
  {
    name: 'a scene with no building starts as the editor starts: site, building, ground level',
    tool: 'add_level',
    scene: emptyScene,
    input: {},
    expect: {
      result: { ok: true, floorIndex: 0 },
      check: (result, nodes) => {
        const level = nodes[result.levelId as string]
        const building = nodes[result.buildingId as string]
        const site = nodes[result.siteId as string]
        return [
          ...(level?.type === 'level' && level.parentId === building?.id ? [] : ['no ground level']),
          ...(building?.type === 'building' && building.parentId === site?.id ? [] : ['no building']),
          ...(site?.type === 'site' && site.parentId == null ? [] : ['no site at the root']),
        ]
      },
    },
  },
  {
    name: 'a site with no building gets its building and ground level',
    tool: 'add_level',
    scene: () => ({
      nodes: { site_lot: SiteNode.parse({ id: 'site_lot', children: [] }) },
      rootNodeIds: ['site_lot'],
    }),
    input: {},
    expect: {
      result: { ok: true, floorIndex: 0 },
      check: (result, nodes) => {
        const building = nodes[result.buildingId as string]
        return [
          ...('siteId' in result ? ['made a second site'] : []),
          ...(building?.parentId === 'site_lot' ? [] : ['the building is not on the site']),
        ]
      },
    },
  },
]

/** The house with the hall's ceiling on the ground floor, the surface a flight cuts below. */
function ceiledScene(): SceneGraph {
  const scene = storeysScene()
  const ceiling = CeilingNode.parse({ id: 'ceiling_hall', parentId: 'level_ground', polygon: HALL })
  const ground = scene.nodes.level_ground as LevelNode
  scene.nodes.ceiling_hall = ceiling
  scene.nodes.level_ground = { ...ground, children: [...ground.children, ceiling.id] }
  return scene
}

/**
 * The house with its hall split in two rooms, west and east, on both floors: a slab per room
 * upstairs (or only the west one) and a ceiling per room below, the west first on each level.
 */
function splitScene(eastSlab = true): SceneGraph {
  const scene = storeysScene()
  const west: Pt[] = [
    [0, 0],
    [3, 0],
    [3, 5],
    [0, 5],
  ]
  const east: Pt[] = [
    [3, 0],
    [6, 0],
    [6, 5],
    [3, 5],
  ]
  const slabs = [
    SlabNode.parse({ id: 'slab_upper_west', parentId: 'level_upper', polygon: west }),
    ...(eastSlab
      ? [SlabNode.parse({ id: 'slab_upper_east', parentId: 'level_upper', polygon: east })]
      : []),
  ]
  const ceilings = [
    CeilingNode.parse({ id: 'ceiling_west', parentId: 'level_ground', polygon: west }),
    CeilingNode.parse({ id: 'ceiling_east', parentId: 'level_ground', polygon: east }),
  ]
  delete scene.nodes.slab_upper
  for (const node of [...slabs, ...ceilings]) scene.nodes[node.id] = node
  const upper = scene.nodes.level_upper as LevelNode
  const ground = scene.nodes.level_ground as LevelNode
  scene.nodes.level_upper = { ...upper, children: slabs.map((slab) => slab.id) }
  scene.nodes.level_ground = {
    ...ground,
    children: [...ground.children, ...ceilings.map((ceiling) => ceiling.id)],
  }
  return scene
}

/**
 * The house with its upper floor in two rooms: a hall wrapping an L stair at (1, 0.3), its flights
 * and landing, and a bedroom over the corner the L leaves inside, where its footprint's middle lies.
 */
function wrappedScene(): SceneGraph {
  const scene = storeysScene()
  const hall = SlabNode.parse({
    id: 'slab_upper',
    parentId: 'level_upper',
    polygon: [
      [0, 0],
      [1.7, 0],
      [1.7, 2.4],
      [5.5, 2.4],
      [5.5, 4],
      [0, 4],
    ],
  })
  const bedroom = SlabNode.parse({
    id: 'slab_bedroom',
    parentId: 'level_upper',
    polygon: [
      [1.7, 0],
      [5.5, 0],
      [5.5, 2.4],
      [1.7, 2.4],
    ],
  })
  scene.nodes.slab_upper = hall
  scene.nodes.slab_bedroom = bedroom
  const upper = scene.nodes.level_upper as LevelNode
  scene.nodes.level_upper = { ...upper, children: [hall.id, bedroom.id] }
  return scene
}

type Stair = AnyNode & {
  name?: string
  railingMode?: string
  materialPreset?: string
  slabOpeningMode?: string
  openingOffset?: number
  children: string[]
}
type Opening = AnyNode & {
  parentId: string
  polygon: Pt[]
  drawnOn?: string
  ownerId?: string
  source?: string
}
const stairOf = (nodes: Readonly<Record<string, AnyNode>>) =>
  Object.values(nodes).find((node) => node.type === 'stair') as Stair | undefined
const openingsOf = (nodes: Readonly<Record<string, AnyNode>>) =>
  Object.values(nodes).filter((node) => node.type === 'floor-opening') as Opening[]
/** An outline's extent: [minX, minZ, maxX, maxZ]. */
const extent = (polygon: Pt[]) => [
  Math.min(...polygon.map((p) => p[0])),
  Math.min(...polygon.map((p) => p[1])),
  Math.max(...polygon.map((p) => p[0])),
  Math.max(...polygon.map((p) => p[1])),
]
const spans = (polygon: Pt[] | undefined, expected: number[]) =>
  !!polygon && extent(polygon).every((value, i) => Math.abs(value - expected[i]!) < 1e-3)

export const CREATE_STAIR_CASES: AgentToolCase[] = [
  {
    name: 'a flight rises to the floor above and owns the opening it cuts there',
    tool: 'create_stair',
    scene: storeysScene,
    input: { levelId: 'level_ground', x: 3, z: 1 },
    expect: {
      result: {
        ok: true,
        fromLevelId: 'level_ground',
        upperLevelId: 'level_upper',
        createdUpperLevel: false,
        // A 2.8 m storey in ~18 cm risers.
        stepCount: 16,
        slabHoleCut: true,
      },
    },
  },
  {
    name: 'from the viewed floor, turned in degrees, with the rise and steps asked',
    tool: 'create_stair',
    scene: storeysScene,
    input: { x: 3, z: 4, rotation: '180°', height: 2.8, steps: 14, width: '90 cm' },
    context: { activeLevelId: 'level_ground' },
    expect: {
      result: {
        fromLevelId: 'level_ground',
        upperLevelId: 'level_upper',
        stepCount: 14,
        rotation: 180,
        width: 0.9,
      },
    },
  },
  {
    name: 'from the top storey, a blank level is made above for it to arrive on',
    tool: 'create_stair',
    scene: soloScene,
    input: { x: 1, z: 1 },
    expect: { result: { fromLevelId: 'level_solo', createdUpperLevel: true, slabHoleCut: false } },
  },
  {
    name: 'a flight onto a declared roof level is refused',
    tool: 'create_stair',
    scene: storeysScene,
    input: { levelId: 'level_storey', x: 1, z: 1 },
    expect: { refusal: 'roof_level', mentions: ['level_roof'] },
  },
  {
    name: 'a flight from a declared roof level is refused',
    tool: 'create_stair',
    scene: storeysScene,
    input: { levelId: 'level_roof', x: 1, z: 1 },
    expect: { refusal: 'roof_level', mentions: ['level_roof'] },
  },
  {
    name: 'a level it should arrive on that is not above is refused',
    tool: 'create_stair',
    scene: storeysScene,
    input: { levelId: 'level_upper', toLevelId: 'level_ground', x: 1, z: 1 },
    expect: { refusal: 'not_above', mentions: ['level_ground'] },
  },
  {
    // create_stair_between_levels' options, kept by create_stair: railings, a finish, a name.
    name: 'railings on one side, a finish and a name, as asked',
    tool: 'create_stair',
    scene: storeysScene,
    input: {
      levelId: 'level_ground',
      x: 3,
      z: 1,
      railingMode: 'left',
      materialPreset: 'library:wood-woodfine1',
      name: 'Main stair',
    },
    expect: {
      result: { ok: true, railingMode: 'left' },
      check: (_result, nodes) => {
        const stair = stairOf(nodes)
        const segment = stair && (nodes[stair.children[0]!] as Stair | undefined)
        return stair?.railingMode === 'left' &&
          stair.name === 'Main stair' &&
          stair.materialPreset === 'library:wood-woodfine1' &&
          segment?.materialPreset === 'library:wood-woodfine1'
          ? []
          : [`stair ${JSON.stringify({ ...stair, children: undefined })}`]
      },
    },
  },
  {
    name: 'a finish the library lacks is refused, naming the nearest, and nothing is built',
    tool: 'create_stair',
    scene: storeysScene,
    input: { levelId: 'level_ground', x: 3, z: 1, materialPreset: 'library:oak-treads' },
    expect: {
      refusal: 'unknown_material',
      mentions: ['library:oak-treads', 'flooring', 'library:preset-'],
    },
  },
  {
    name: 'the margin round the opening, alone, widens the opening the stair owns',
    tool: 'create_stair',
    scene: storeysScene,
    input: { levelId: 'level_ground', x: 3, z: 1, openingOffset: 0.2 },
    expect: {
      result: { ok: true, slabHoleCut: true },
      check: (_result, nodes) => {
        const stair = stairOf(nodes)
        return stair?.slabOpeningMode === 'destination' && stair.openingOffset === 0.2
          ? []
          : [`mode ${stair?.slabOpeningMode}, offset ${stair?.openingOffset}`]
      },
    },
  },
  {
    name: 'with both cuts off, no opening is cut',
    tool: 'create_stair',
    scene: ceiledScene,
    input: {
      levelId: 'level_ground',
      x: 3,
      z: 1,
      createDestinationSlabOpening: false,
      createSourceCeilingOpening: false,
    },
    expect: {
      result: { ok: true, slabHoleCut: false },
      check: (_result, nodes) => [
        ...(openingsOf(nodes).length ? [`${openingsOf(nodes).length} openings`] : []),
        ...(stairOf(nodes)?.slabOpeningMode === 'none' ? [] : ['the stair still cuts']),
      ],
    },
  },
  {
    name: 'an opening of the size, margin, centre and turn given, owned by the stair',
    tool: 'create_stair',
    scene: ceiledScene,
    input: {
      levelId: 'level_ground',
      x: 3,
      z: 1,
      openingWidth: 1.6,
      openingLength: 3.4,
      openingOffset: 0.1,
      openingCenter: [3, 2.5],
      openingRotation: 0,
      createSourceCeilingOpening: false,
    },
    expect: {
      result: { ok: true, slabHoleCut: true, destinationSlabId: 'slab_upper' },
      check: (_result, nodes) => {
        const openings = openingsOf(nodes)
        const [opening] = openings
        return [
          ...(openings.length === 1 ? [] : [`${openings.length} openings`]),
          ...(opening?.parentId === 'level_upper' &&
          opening.source === 'stair' &&
          opening.ownerId === stairOf(nodes)?.id
            ? []
            : [`opening ${JSON.stringify(opening)}`]),
          // 1.6 + 2 × 0.1 across, 3.4 + 2 × 0.1 along, round (3, 2.5).
          ...(spans(opening?.polygon, [2.1, 0.7, 3.9, 4.3])
            ? []
            : [`spans ${opening && extent(opening.polygon)}`]),
          ...(stairOf(nodes)?.slabOpeningMode === 'none' ? [] : ['the stair cuts its own too']),
        ]
      },
    },
  },
  {
    name: 'the ceiling below alone, when the floor above is not to be cut',
    tool: 'create_stair',
    scene: ceiledScene,
    input: {
      levelId: 'level_ground',
      x: 3,
      z: 1,
      sourceCeilingId: 'ceiling_hall',
      createDestinationSlabOpening: false,
    },
    expect: {
      // A hole in the ceiling below is not one in the slab above: the floor upstairs stays closed.
      result: { ok: true, slabHoleCut: false, sourceCeilingId: 'ceiling_hall' },
      check: (_result, nodes) => {
        const openings = openingsOf(nodes)
        return openings.length === 1 &&
          openings[0]!.parentId === 'level_ground' &&
          openings[0]!.drawnOn === 'ceiling'
          ? []
          : [`openings ${JSON.stringify(openings.map((o) => [o.parentId, o.drawnOn]))}`]
      },
    },
  },
  {
    // Main centred the opening at z + length / 2 whatever the turn: off the flight once turned.
    name: 'an opening of a turned flight follows the climb',
    tool: 'create_stair',
    scene: ceiledScene,
    input: {
      levelId: 'level_ground',
      x: 2,
      z: 2,
      rotation: '90°',
      length: 3,
      openingWidth: 1.2,
      createSourceCeilingOpening: false,
    },
    expect: {
      result: { ok: true },
      // Climbing toward +X from (2, 2): 3 m along x, 1.2 m across z, and the 0.08 m margin.
      check: (_result, nodes) => {
        const [opening] = openingsOf(nodes)
        return spans(opening?.polygon, [1.92, 1.32, 5.08, 2.68])
          ? []
          : [`spans ${opening && extent(opening.polygon)}`]
      },
    },
  },
  {
    // On a floor of several rooms, the surfaces a flight cuts are the ones over and under it, not
    // the first on each storey.
    name: 'the slab above and the ceiling below are the ones the opening falls in',
    tool: 'create_stair',
    scene: () => splitScene(),
    input: { levelId: 'level_ground', x: 4.5, z: 1, openingWidth: 1 },
    expect: {
      result: {
        ok: true,
        slabHoleCut: true,
        destinationSlabId: 'slab_upper_east',
        sourceCeilingId: 'ceiling_east',
      },
    },
  },
  {
    name: 'an opening under no slab is not reported as cut through one',
    tool: 'create_stair',
    scene: () => splitScene(false),
    input: {
      levelId: 'level_ground',
      x: 4.5,
      z: 1,
      openingWidth: 1,
      createSourceCeilingOpening: false,
    },
    expect: {
      result: { ok: true, slabHoleCut: false },
      check: (result, nodes) => [
        ...('destinationSlabId' in result ? [`reported ${result.destinationSlabId}`] : []),
        ...(openingsOf(nodes).length ? [`${openingsOf(nodes).length} openings`] : []),
      ],
    },
  },
  {
    // The flight cuts the slab on the floor it arrives at and the ceiling on the one it leaves.
    name: 'a slab id on another storey is refused, naming the floor the flight arrives at',
    tool: 'create_stair',
    scene: ceiledScene,
    input: { levelId: 'level_ground', x: 3, z: 1, destinationSlabId: 'slab_ground' },
    expect: { refusal: 'slab_not_on_level', mentions: ['slab_ground', 'level_upper'] },
  },
  {
    name: 'a ceiling id on another storey is refused, naming the floor the flight leaves',
    tool: 'create_stair',
    scene: ceiledScene,
    input: {
      levelId: 'level_upper',
      x: 3,
      z: 1,
      sourceCeilingId: 'ceiling_hall',
      createDestinationSlabOpening: false,
    },
    expect: { refusal: 'ceiling_not_on_level', mentions: ['ceiling_hall', 'level_upper'] },
  },
  {
    name: 'a slab id that names no slab, or a ceiling id no ceiling, is refused',
    tool: 'create_stair',
    scene: ceiledScene,
    input: { levelId: 'level_ground', x: 3, z: 1, destinationSlabId: 'zone_hall' },
    expect: { refusal: 'slab_not_found', mentions: ['zone_hall'] },
  },
  {
    name: 'an unknown level is refused with the id',
    tool: 'create_stair',
    scene: storeysScene,
    input: { levelId: 'level_missing', x: 1, z: 1 },
    expect: { refusal: 'level_not_found', mentions: ['level_missing'] },
  },
  {
    // The default opening as given is the stair's footprint, whatever its shape.
    name: "a U's opening as given spans the stair's footprint, the margin round it",
    tool: 'create_stair',
    scene: ceiledScene,
    input: {
      levelId: 'level_ground',
      x: 1,
      z: 0.5,
      layout: 'u',
      openingWidth: 2.2,
      createSourceCeilingOpening: false,
    },
    expect: {
      // 2 m across the two flights, 1 + 2.24 m along: 2.2 m across as asked, 0.08 m round it.
      result: { ok: true, slabHoleCut: true, footprint: { minX: 0.5, minZ: 0.5, maxX: 2.5 } },
      check: (_result, nodes) => {
        const [opening] = openingsOf(nodes)
        return spans(opening?.polygon, [0.32, 0.42, 2.68, 3.82])
          ? []
          : [`spans ${opening && extent(opening.polygon)}`]
      },
    },
  },
  {
    name: "an L's opening as given goes through the slab over its flights, not the one under its middle",
    tool: 'create_stair',
    scene: wrappedScene,
    input: { levelId: 'level_ground', x: 1, z: 0.3, layout: 'l', createSourceCeilingOpening: false },
    expect: { result: { ok: true, slabHoleCut: true, destinationSlabId: 'slab_upper' } },
  },
  {
    name: 'a turn or lower flight with no L or U is refused',
    tool: 'create_stair',
    scene: storeysScene,
    input: { levelId: 'level_ground', x: 3, z: 1, turn: 'right' },
    expect: { refusal: 'stair_layout_required', mentions: ['layout'] },
  },
  {
    name: 'a lower flight that leaves the upper one no riser is refused with the range',
    tool: 'create_stair',
    scene: storeysScene,
    input: { levelId: 'level_ground', x: 3, z: 1, layout: 'l', lowerSteps: 16 },
    expect: { refusal: 'stair_layout', mentions: ['1 to 15'] },
  },
  {
    name: 'an L of fewer than four risers is refused',
    tool: 'create_stair',
    scene: storeysScene,
    input: { levelId: 'level_ground', x: 3, z: 1, layout: 'l', steps: 3 },
    expect: { refusal: 'stair_layout', mentions: ['An L stair needs at least 4 risers'] },
  },
  {
    name: 'a flight to no level with an opening asked is refused',
    tool: 'create_stair',
    scene: storeysScene,
    input: { levelId: 'level_ground', x: 3, z: 1, toLevelId: null, openingWidth: 1.2 },
    expect: { refusal: 'no_level_above', mentions: ['toLevelId'] },
  },
  {
    name: 'from the top storey, a flight to no level makes no level',
    tool: 'create_stair',
    scene: soloScene,
    input: { x: 1, z: 1, toLevelId: null, height: '18 in' },
    expect: {
      result: { ok: true, upperLevelId: null, createdUpperLevel: false, stepCount: 3, rise: 0.457 },
      check: (_result, nodes) => {
        const levels = Object.values(nodes).filter((node) => node.type === 'level')
        return levels.length === 1 ? [] : [`${levels.length} levels`]
      },
    },
  },
  {
    name: 'a railing finish the library lacks is refused, naming the field',
    tool: 'create_stair',
    scene: storeysScene,
    input: { levelId: 'level_ground', x: 3, z: 1, railingMaterial: 'library:brass-rail' },
    expect: { refusal: 'unknown_material', mentions: ['railingMaterial', 'library:brass-rail'] },
  },
]
