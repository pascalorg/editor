import {
  type AnyNode,
  BuildingNode,
  getActiveRoofHeight,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '../../schema'
import type { AgentToolCase, SceneGraph } from './cases'

/**
 * `create_roof`, one tool where the chat and the MCP had one each with two level rules: the roof
 * over a building's top storey goes on its roof level, the level directly above (a roof made on the
 * ground floor's level blocked the exploded view), and stands on the storey's wall tops.
 *
 * A building of 2.5 m storeys, each an 8 × 6 m room walled round; the top one is `walls` tall.
 */

type Pt = [number, number]
const ROOM: Pt[] = [
  [0, 0],
  [8, 0],
  [8, 6],
  [0, 6],
]

const graph = (...nodes: AnyNode[]): SceneGraph => ({
  nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
  rootNodeIds: nodes.filter((node) => node.type === 'building').map((node) => node.id),
})

function storey(id: string, index: number, wallHeight = 2.5) {
  const walls = ROOM.map((start, i) =>
    WallNode.parse({
      id: `wall_${id}_${i}`,
      parentId: id,
      start,
      end: ROOM[(i + 1) % ROOM.length]!,
      height: wallHeight,
    }),
  )
  const zone = ZoneNode.parse({ id: `zone_${id}`, parentId: id, name: 'Hall', polygon: ROOM })
  const level = LevelNode.parse({
    id,
    parentId: 'building_r',
    level: index,
    height: 2.5,
    children: [...walls.map((wall) => wall.id), zone.id],
  })
  return [level, ...walls, zone]
}

function house({
  storeys = 1,
  topWalls = 2.5,
  above,
}: {
  storeys?: number
  topWalls?: number
  /** What stands above the top storey: an empty level, or a roof level with its roof. */
  above?: 'empty' | 'roof'
} = {}) {
  return (): SceneGraph => {
    const ids = Array.from({ length: storeys }, (_, i) => (i === 0 ? 'level_g' : `level_${i}`))
    const nodes = ids.flatMap((id, i) => storey(id, i, i === storeys - 1 ? topWalls : 2.5))
    const extra: AnyNode[] = []
    if (above === 'empty')
      extra.push(LevelNode.parse({ id: 'level_e', parentId: 'building_r', level: storeys }))
    if (above === 'roof') {
      const segment = RoofSegmentNode.parse({ id: 'rseg_old', parentId: 'roof_old' })
      extra.push(
        LevelNode.parse({
          id: 'level_r',
          parentId: 'building_r',
          level: storeys,
          name: 'Roof',
          children: ['roof_old'],
          metadata: { role: 'roof' },
        }),
        RoofNode.parse({ id: 'roof_old', parentId: 'level_r', children: [segment.id] }),
        segment,
      )
    }
    const building = BuildingNode.parse({
      id: 'building_r',
      children: [...ids, ...extra.filter((node) => node.type === 'level').map((node) => node.id)],
    })
    return graph(building, ...nodes, ...extra)
  }
}

const roofOf = (result: Record<string, unknown>, nodes: Readonly<Record<string, AnyNode>>) =>
  nodes[result.roofId as string] as RoofNode | undefined

/** The roof sits on a declared roof level directly above `storeyId`, following its walls at `y`. */
const onRoofLevel =
  (storeyId: string, y: number) =>
  (result: Record<string, unknown>, nodes: Readonly<Record<string, AnyNode>>) => {
    const roof = roofOf(result, nodes)
    const level = roof?.parentId ? nodes[roof.parentId] : undefined
    const covered = nodes[storeyId]
    const problems: string[] = []
    if (level?.type !== 'level' || covered?.type !== 'level')
      return [`roof ${roof?.id} is not on a level`]
    if (level.metadata.role !== 'roof') problems.push(`${level.id} is not declared a roof level`)
    if (level.level !== covered.level + 1) problems.push(`${level.id} is not right above ${storeyId}`)
    if (roof?.support?.kind !== 'walls') problems.push('the roof does not follow its walls')
    if (Math.abs((roof?.position[1] ?? Number.NaN) - y) > 1e-6)
      problems.push(`the eave is at ${roof?.position[1]}, not ${y} over the roof level`)
    return problems
  }

export const CREATE_ROOF_CASES: AgentToolCase[] = [
  {
    name: 'over a one-storey house, on a new Roof level above it, on the wall tops',
    tool: 'create_roof',
    scene: house(),
    input: {},
    expect: {
      result: { coveredLevelId: 'level_g', roofType: 'gable' },
      check: (result, nodes) => [
        ...onRoofLevel('level_g', 0)(result, nodes),
        ...(result.createdRoofLevelId === result.roofLevelId ? [] : ['no Roof level was made']),
        ...((nodes[result.roofLevelId as string] as LevelNode | undefined)?.name === 'Roof'
          ? []
          : ['the roof level is not named Roof']),
      ],
    },
  },
  {
    name: 'a roof as a builder says it: 6:12 is pitched atan(6/12), 18-inch eaves reach 18 in past the walls in plan',
    tool: 'create_roof',
    scene: house(),
    input: { pitch: '6:12', overhang: '18 in' },
    expect: {
      result: { coveredLevelId: 'level_g' },
      check: (result, nodes) =>
        (result.segmentIds as string[]).flatMap((id) => {
          const { pitch, overhang } = nodes[id] as RoofSegmentNode
          // The segment stores the overhang along its slope.
          const reach = overhang * Math.cos(Math.atan(6 / 12))
          return [
            ...(Math.abs(pitch - 26.565051177078) < 1e-9 ? [] : [`${id} is pitched ${pitch}°`]),
            ...(Math.abs(reach - 0.4572) < 1e-9 ? [] : [`${id}'s eaves reach ${reach} m`]),
          ]
        }),
    },
  },
  {
    name: 'eaves left out reach the default 0.3 m past the walls in plan',
    tool: 'create_roof',
    scene: house(),
    input: { pitch: 40 },
    expect: {
      result: { coveredLevelId: 'level_g' },
      check: (result, nodes) =>
        (result.segmentIds as string[]).flatMap((id) => {
          const reach = (nodes[id] as RoofSegmentNode).overhang * Math.cos((40 * Math.PI) / 180)
          return Math.abs(reach - 0.3) < 1e-9 ? [] : [`${id}'s eaves reach ${reach} m`]
        }),
    },
  },
  {
    name: 'walls taller than their storey lift the eave to their tops',
    tool: 'create_roof',
    scene: house({ topWalls: 3 }),
    input: {},
    expect: {
      result: { coveredLevelId: 'level_g' },
      check: (result, nodes) => {
        const level = nodes[result.roofLevelId as string] as LevelNode | undefined
        const rise = (result.segmentIds as string[]).map((id) =>
          getActiveRoofHeight(nodes[id] as RoofSegmentNode),
        )
        // The new roof level is as tall as the roof rises over it, the eave's lift included.
        return [
          ...onRoofLevel('level_g', 0.5)(result, nodes),
          ...(Math.abs((level?.height ?? 0) - (0.5 + Math.max(...rise))) < 1e-6
            ? []
            : [`the roof level is ${level?.height} m tall, under its roof`]),
        ]
      },
    },
  },
  {
    name: 'no level named: the top storey, whichever floor the person is viewing',
    tool: 'create_roof',
    scene: house({ storeys: 2 }),
    input: {},
    context: { activeLevelId: 'level_g' },
    expect: { result: { coveredLevelId: 'level_1' }, check: onRoofLevel('level_1', 0) },
  },
  {
    name: 'an empty level above the top storey becomes its roof level',
    tool: 'create_roof',
    scene: house({ above: 'empty' }),
    input: { levelId: 'level_g' },
    expect: {
      result: { roofLevelId: 'level_e', createdRoofLevelId: null },
      after: { level_e: { metadata: { role: 'roof' }, name: 'Roof' } },
      check: onRoofLevel('level_g', 0),
    },
  },
  {
    name: 'a storey that has a roof already is refused, naming it',
    tool: 'create_roof',
    scene: house({ above: 'roof' }),
    input: {},
    expect: { refusal: 'roof_exists', mentions: ['roof_old', 'delete_node'] },
  },
  {
    name: 'the ground floor of two storeys is refused: a roof caps the top one',
    tool: 'create_roof',
    scene: house({ storeys: 2 }),
    input: { levelId: 'level_g' },
    expect: { refusal: 'storey_above', mentions: ['level_1'] },
  },
  {
    name: 'an empty level with a storey above it is not made a roof level under that storey',
    tool: 'create_roof',
    scene: () => {
      const nodes = house({ storeys: 2 })().nodes as Record<string, AnyNode>
      const building = nodes.building_r as BuildingNode
      const empty = LevelNode.parse({ id: 'level_e', parentId: 'building_r', level: 1 })
      const upper = nodes.level_1 as LevelNode
      return graph(
        { ...building, children: ['level_g', 'level_e', 'level_1'] },
        ...Object.values(nodes).filter((node) => node.type !== 'building' && node.id !== 'level_1'),
        empty,
        { ...upper, level: 2 },
      )
    },
    input: { levelId: 'level_g' },
    expect: { refusal: 'storey_above', mentions: ['level_e', 'Roof tool'] },
  },
  {
    name: 'two floor plates that overlap are one footprint, their overlap roofed',
    tool: 'create_roof',
    scene: () =>
      graph(
        BuildingNode.parse({ id: 'building_r', children: ['level_g'] }),
        LevelNode.parse({
          id: 'level_g',
          parentId: 'building_r',
          level: 0,
          height: 2.5,
          children: ['slab_west', 'slab_east'],
        }),
        SlabNode.parse({
          id: 'slab_west',
          parentId: 'level_g',
          polygon: [
            [0, 0],
            [8, 0],
            [8, 6],
            [0, 6],
          ],
        }),
        SlabNode.parse({
          id: 'slab_east',
          parentId: 'level_g',
          polygon: [
            [4, 0],
            [12, 0],
            [12, 6],
            [4, 6],
          ],
        }),
      ),
    input: {},
    expect: {
      result: { coveredLevelId: 'level_g', roofType: 'gable' },
      check: (result, nodes) => {
        const segments = (result.segmentIds as string[]).map((id) => nodes[id])
        const [segment] = segments
        return segments.length === 1 &&
          segment?.type === 'roof-segment' &&
          segment.width === 12 &&
          segment.depth === 6
          ? []
          : [`expected one 12 × 6 m segment, got ${JSON.stringify(segments)}`]
      },
    },
  },
  {
    name: 'no level named nor in view on a site of two buildings: which one is asked',
    tool: 'create_roof',
    scene: () => {
      const one = house()()
      const other = BuildingNode.parse({ id: 'building_o', children: ['level_o'] })
      const room = ZoneNode.parse({ id: 'zone_o', parentId: 'level_o', name: 'Shed', polygon: ROOM })
      const level = LevelNode.parse({
        id: 'level_o',
        parentId: other.id,
        level: 0,
        height: 2.5,
        children: [room.id],
      })
      return graph(...(Object.values(one.nodes) as AnyNode[]), other, level, room)
    },
    input: {},
    context: { activeLevelId: null },
    expect: { refusal: 'building_required', mentions: ['building_r', 'building_o'] },
  },
  {
    name: 'a rectangle on a site of two empty buildings, with no level named: which one is asked',
    tool: 'create_roof',
    scene: () =>
      graph(
        BuildingNode.parse({ id: 'building_r', children: ['level_g'] }),
        LevelNode.parse({ id: 'level_g', parentId: 'building_r', level: 0, height: 2.5 }),
        BuildingNode.parse({ id: 'building_o', children: ['level_o'] }),
        LevelNode.parse({ id: 'level_o', parentId: 'building_o', level: 0, height: 2.5 }),
      ),
    input: { width: 4, depth: 3 },
    context: { activeLevelId: null },
    expect: { refusal: 'building_required', mentions: ['building_r', 'building_o'] },
  },
  {
    name: 'a fascia finish the library lacks is refused, as the roof finish is',
    tool: 'create_roof',
    scene: house(),
    input: { fasciaMaterialPreset: 'library:no-such-fascia' },
    expect: { refusal: 'unknown_material', mentions: ['fasciaMaterialPreset'] },
  },
  {
    name: "a two-storey house with a porch roof drawn on the upper storey still takes its own roof",
    tool: 'create_roof',
    scene: () => {
      const two = house({ storeys: 2 })()
      const porch = RoofNode.parse({ id: 'roof_porch', parentId: 'level_1', position: [10, 0, 3] })
      const upper = two.nodes.level_1 as LevelNode
      return graph(
        ...(Object.values(two.nodes) as AnyNode[]).filter((node) => node.id !== 'level_1'),
        { ...upper, children: [...upper.children, porch.id] },
        porch,
      )
    },
    input: {},
    expect: { result: { coveredLevelId: 'level_1' } },
  },
  {
    name: 'a roof level named stands for the storey under it',
    tool: 'create_roof',
    scene: house({ above: 'empty' }),
    input: { levelId: 'level_e' },
    expect: { result: { coveredLevelId: 'level_g', roofLevelId: 'level_e' } },
  },
  {
    name: 'a rectangle of its own needs no rooms',
    tool: 'create_roof',
    scene: () =>
      graph(
        BuildingNode.parse({ id: 'building_r', children: ['level_g'] }),
        LevelNode.parse({ id: 'level_g', parentId: 'building_r', level: 0, height: 2.5 }),
      ),
    input: { width: 4, depth: 3, center: [2, 1.5] },
    expect: { result: { coveredLevelId: 'level_g' }, check: onRoofLevel('level_g', 0) },
  },
  {
    name: 'with no rooms anywhere, a rectangle is asked for',
    tool: 'create_roof',
    scene: () =>
      graph(
        BuildingNode.parse({ id: 'building_r', children: ['level_g'] }),
        LevelNode.parse({ id: 'level_g', parentId: 'building_r', level: 0, height: 2.5 }),
      ),
    input: {},
    expect: { refusal: 'no_rooms', mentions: ['width and depth'] },
  },
]

/** `scene` with a roof over `levelId`'s 8 × 6 m room on that level, its segment bearing at `y`. */
function roofedOn(
  scene: () => SceneGraph,
  levelId: string,
  y: number,
  support: 'walls' | 'level' = 'walls',
) {
  return (): SceneGraph => {
    const nodes = { ...(scene().nodes as Record<string, AnyNode>) }
    const segment = RoofSegmentNode.parse({
      id: 'rseg_low',
      parentId: 'roof_low',
      width: 8,
      depth: 6,
      wallHeight: 0,
    })
    const roof = RoofNode.parse({
      id: 'roof_low',
      parentId: levelId,
      position: [4, y, 3],
      support: { kind: support },
      children: [segment.id],
    })
    const level = nodes[levelId] as LevelNode
    return graph(
      ...Object.values(nodes).filter((node) => node.id !== levelId),
      { ...level, children: [...level.children, roof.id] },
      roof,
      segment,
    )
  }
}

/**
 * `move_roofs_to_roof_level`: a project built before the rule holds its roofs on the storey whose
 * walls carry them; the roof's panel moves them by hand, and this tool for agents, standing where
 * they stood.
 */
export const MOVE_ROOFS_CASES: AgentToolCase[] = [
  {
    name: 'a bungalow roof on its walls goes up to a new Roof level, its eave where it was',
    tool: 'move_roofs_to_roof_level',
    scene: roofedOn(house(), 'level_g', 2.5),
    input: { levelId: 'level_g' },
    expect: {
      result: { roofIds: ['roof_low'] },
      check: (result, nodes) => {
        const roof = nodes.roof_low as RoofNode
        const level = nodes[result.roofLevelId as string] as LevelNode | undefined
        return [
          ...(result.createdRoofLevelId === result.roofLevelId ? [] : ['no Roof level was made']),
          ...(level?.level === 1 && level.metadata.role === 'roof'
            ? []
            : ['the roof level is not declared right above the storey']),
          ...(roof.parentId === result.roofLevelId ? [] : [`the roof is on ${roof.parentId}`]),
          // the roof level's floor is the storey's 2.5 m up: the eave stays on the 2.5 m walls
          ...(Math.abs(roof.position[1]) < 1e-6 ? [] : [`the eave moved: y ${roof.position[1]}`]),
          ...(roof.children.includes('rseg_low') ? [] : ['the segment was not kept']),
        ]
      },
    },
  },
  {
    name: 'a lower storey’s roof goes onto the storey above it',
    tool: 'move_roofs_to_roof_level',
    scene: roofedOn(house({ storeys: 2 }), 'level_g', 2.5, 'level'),
    input: { levelId: 'level_g' },
    expect: {
      result: { roofIds: ['roof_low'], roofLevelId: 'level_1', createdRoofLevelId: null },
      after: { roof_low: { parentId: 'level_1', position: [4, 0, 3] } },
    },
  },
  {
    name: 'a roof already on the roof level leaves nothing to move',
    tool: 'move_roofs_to_roof_level',
    scene: house({ above: 'roof' }),
    input: { levelId: 'level_g' },
    expect: { refusal: 'no_roof_on_walls', mentions: ['level_g'] },
  },
  {
    name: 'a porch roof on its beam, under the walls’ tops, stays on its storey',
    tool: 'move_roofs_to_roof_level',
    scene: roofedOn(house(), 'level_g', 2.1, 'level'),
    input: { levelId: 'level_g' },
    expect: { refusal: 'no_roof_on_walls' },
  },
  {
    name: 'a level that does not exist is refused',
    tool: 'move_roofs_to_roof_level',
    scene: house(),
    input: { levelId: 'level_x' },
    expect: { refusal: 'level_not_found' },
  },
]
