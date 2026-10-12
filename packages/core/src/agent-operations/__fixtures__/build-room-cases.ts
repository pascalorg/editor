import {
  type AnyNode,
  type AssetInput,
  BuildingNode,
  DoorNode,
  ItemNode,
  LevelNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../../schema'
import { doorFacing } from '../../building/wall-openings'
import { reconcileSceneStructure } from '../../lib/structure-reconcile'
import { findBlockedDoors } from '../door-clearance'
import { findItemItemCollisions } from '../layout-clearance'
import type { AgentToolCase, SceneGraph } from './cases'

/**
 * `create_room` and `furnish_room`: one tool each where the MCP and the chat had two. create_room
 * is the core's room command (the MCP's: walls only where no wall runs, terraces) with the chat's
 * doors and windows declared by polygon edge, attributed by position among the walls of the room's
 * own level and placed with add_door's and add_window's rules. furnish_room is the MCP's placement
 * (door clear zones, existing items, nudges, every skip said) with the chat's door detection, over
 * the host's catalog.
 *
 * Rooms: a ground floor with a 4 m wall carrying a door and a window and a kitchen off to the side,
 * the same 4 m wall on the floor above (collinear with the one below), and a roof level.
 */

type Pt = [number, number]
type Nodes = Readonly<Record<string, AnyNode>>

const graph = (...nodes: { id: string }[]): SceneGraph => ({
  nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
  rootNodeIds: nodes
    .filter((node) => (node as { type?: string }).type === 'building')
    .map((node) => node.id),
})

const KITCHEN: Pt[] = [
  [10, 0],
  [14, 0],
  [14, 3],
  [10, 3],
]
/** A 4 × 3 m room clear of everything on either floor. */
const CLEAR: Pt[] = [
  [0, 5],
  [4, 5],
  [4, 8],
  [0, 8],
]

function roomsScene(): SceneGraph {
  const door = DoorNode.parse({
    id: 'door_g',
    parentId: 'wall_g',
    wallId: 'wall_g',
    position: [1, 1.05, 0],
  })
  const window = WindowNode.parse({
    id: 'window_g',
    parentId: 'wall_g',
    wallId: 'wall_g',
    width: 1,
    height: 1.2,
    position: [3, 1.5, 0],
  })
  const wallG = WallNode.parse({
    id: 'wall_g',
    parentId: 'level_g',
    start: [0, 0],
    end: [4, 0],
    height: 2.5,
    children: [door.id, window.id],
  })
  const kitchen = ZoneNode.parse({
    id: 'zone_kitchen',
    parentId: 'level_g',
    name: 'Kitchen',
    polygon: KITCHEN,
    spaceRole: 'room',
  })
  const wallU = WallNode.parse({
    id: 'wall_u',
    parentId: 'level_u',
    start: [0, 0],
    end: [4, 0],
    height: 2.5,
  })
  const ground = LevelNode.parse({
    id: 'level_g',
    parentId: 'building_b',
    level: 0,
    name: 'Ground',
    height: 2.8,
    children: [wallG.id, kitchen.id],
  })
  const upper = LevelNode.parse({
    id: 'level_u',
    parentId: 'building_b',
    level: 1,
    name: 'Upper',
    height: 2.8,
    children: [wallU.id],
  })
  const roof = LevelNode.parse({
    id: 'level_r',
    parentId: 'building_b',
    level: 2,
    name: 'Roof',
    metadata: { role: 'roof' },
  })
  const building = BuildingNode.parse({
    id: 'building_b',
    children: [ground.id, upper.id, roof.id],
  })
  return graph(building, ground, upper, roof, wallG, door, window, kitchen, wallU)
}

/**
 * Run 6's order: walls drawn first, one add_wall each, round CLEAR (and `extra` inside it), then the
 * rooms the reconciler made of them, "Room 1" first; `renamed` is a name a person gave it since.
 */
function walledScene({ extra = [], renamed }: { extra?: [Pt, Pt][]; renamed?: string } = {}) {
  return (): SceneGraph => {
    const base = roomsScene().nodes as Record<string, AnyNode>
    const walls = [...CLEAR.map((point, i): [Pt, Pt] => [point, CLEAR[(i + 1) % 4]!]), ...extra].map(
      ([start, end], i) =>
        WallNode.parse({ id: `wall_c${i}`, parentId: 'level_g', start, end, height: 2.5 }),
    )
    const level = base.level_g as LevelNode
    let nodes: Record<string, AnyNode> = {
      ...base,
      level_g: { ...level, children: [...level.children, ...walls.map((wall) => wall.id)] },
      ...Object.fromEntries(walls.map((wall) => [wall.id, wall])),
    }
    const names: Record<string, string[]> = { zone: ['zone_walled', 'zone_side'] }
    let count = 0
    nodes = reconcileSceneStructure({
      nodes,
      mintId: (kind) => names[kind]?.shift() ?? `${kind}_walled${++count}`,
    }).nodes as Record<string, AnyNode>
    if (renamed) nodes.zone_walled = { ...nodes.zone_walled!, name: renamed } as AnyNode
    return graph(...Object.values(nodes))
  }
}

// ─── Checks the table cannot state: minted ids and derived construction ───────────────────────

const problems = (...entries: [boolean, string][]) =>
  entries.flatMap(([ok, problem]) => (ok ? [] : [problem]))

const wallsOn = (nodes: Nodes, levelId: string) =>
  Object.values(nodes).filter((node) => node.type === 'wall' && node.parentId === levelId)

/** Where an opening stands on the plan: along its wall from the wall's start. */
function openingPlanPoint(nodes: Nodes, id: string): Pt | null {
  const opening = nodes[id] as (AnyNode & { position?: number[] }) | undefined
  const wall = opening?.parentId ? nodes[opening.parentId] : undefined
  if (!(opening?.position && wall?.type === 'wall')) return null
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  const t = opening.position[0]! / length
  return [
    wall.start[0] + t * (wall.end[0] - wall.start[0]),
    wall.start[1] + t * (wall.end[1] - wall.start[1]),
  ]
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

/** The room the result names: its zone, its walls in edge order, its derived floor and ceiling. */
function roomBuilt(levelId: string, name: string, edges: number) {
  return (result: Record<string, unknown>, nodes: Nodes) => {
    const zone = nodes[result.zoneId as string]
    const wallIds = result.wallIds as (string | null)[]
    const slab = nodes[result.slabId as string]
    const ceiling = nodes[result.ceilingId as string]
    return problems(
      [
        zone?.type === 'zone' &&
          zone.parentId === levelId &&
          zone.name === name &&
          zone.spaceRole === 'room',
        `zone ${String(result.zoneId)} is not the room "${name}" on ${levelId}`,
      ],
      // The reconciler adopted the room the call wrote rather than minting one of its own.
      [
        zone?.type === 'zone' && zone.autoFromWalls === true,
        `zone ${String(result.zoneId)} was not adopted by the reconciler`,
      ],
      [
        wallIds.length === edges && new Set(wallIds).size === edges,
        `wallIds ${JSON.stringify(wallIds)} is not one wall per edge`,
      ],
      [
        wallIds.every((id) => id && nodes[id]?.type === 'wall' && nodes[id]?.parentId === levelId),
        `wallIds ${JSON.stringify(wallIds)} are not walls of ${levelId}`,
      ],
      [
        slab?.type === 'slab' &&
          slab.boundary === 'auto' &&
          !!slab.zoneIds?.includes(result.zoneId as string),
        `slabId ${String(result.slabId)} is not the room's derived floor plate`,
      ],
      [
        ceiling?.type === 'ceiling' &&
          ceiling.boundary === 'auto' &&
          ceiling.zoneId === result.zoneId,
        `ceilingId ${String(result.ceilingId)} is not the room's derived ceiling`,
      ],
    )
  }
}

/** The room zones of the ground floor inside CLEAR's box: the one per walled space there. */
const roomsInClear = (nodes: Nodes) =>
  Object.values(nodes).filter(
    (node) =>
      node.type === 'zone' &&
      node.parentId === 'level_g' &&
      node.spaceRole === 'room' &&
      node.polygon.every(([x, z]) => x >= -0.01 && x <= 4.01 && z >= 4.99 && z <= 8.01),
  ) as ZoneNode[]

const area = (polygon: readonly (readonly number[])[]) =>
  Math.abs(
    polygon.reduce((sum, [x, z], i) => {
      const [nx, nz] = polygon[(i + 1) % polygon.length]!
      return sum + x! * nz! - nx! * z!
    }, 0) / 2,
  )

const roomOn = (levelId: string) => (result: Record<string, unknown>, nodes: Nodes) =>
  problems([
    nodes[result.zoneId as string]?.parentId === levelId,
    `the room is on ${String(nodes[result.zoneId as string]?.parentId)}, not ${levelId}`,
  ])

const room = (input: Record<string, unknown>) => ({ name: 'Bedroom', polygon: CLEAR, ...input })

export const CREATE_ROOM_CASES: AgentToolCase[] = [
  // A door declared with a new room is planned before the host knows the new walls' outside;
  // once the room is derived, a door on an outside wall faces out, as add_door's does.
  {
    name: "a door declared on a new room's outside wall faces out",
    tool: 'create_room',
    scene: roomsScene,
    input: { levelId: 'level_g', name: 'Studio', polygon: CLEAR, doors: [{ wallIndex: 0 }] },
    expect: {
      result: { ok: true },
      check: (result, nodes) => {
        const [doorId] = result.doorIds as string[]
        const door = nodes[doorId!]
        const wall = nodes[door?.parentId ?? '']
        const facing = wall?.type === 'wall' ? doorFacing(wall) : undefined
        return problems(
          [facing?.side !== undefined, `the wall does not know its outside: ${JSON.stringify(wall)}`],
          [
            door?.type === 'door' && door.side === facing?.side,
            `the door faces ${door?.type === 'door' ? door.side : '?'}, its wall's outside is ${facing?.side}`,
          ],
        )
      },
    },
  },
  {
    name: 'a room is a wall per edge and a zone; its floor plate and ceiling are derived',
    tool: 'create_room',
    scene: roomsScene,
    input: room({ levelId: 'level_g' }),
    expect: {
      result: { ok: true, reusedWalls: 0, areaSqMeters: 12, doorIds: [], windowIds: [] },
      check: roomBuilt('level_g', 'Bedroom', 4),
    },
  },
  {
    name: 'an edge a wall already runs along reuses that wall, its door and window kept',
    tool: 'create_room',
    scene: roomsScene,
    input: {
      levelId: 'level_g',
      name: 'Hall',
      polygon: [
        [0, 0],
        [4, 0],
        [4, -3],
        [0, -3],
      ],
    },
    expect: {
      result: { ok: true, reusedWalls: 1 },
      after: { wall_g: { children: ['door_g', 'window_g'] } },
      check: (result, nodes) => [
        ...roomBuilt('level_g', 'Hall', 4)(result, nodes),
        ...problems([
          (result.wallIds as string[])[0] === 'wall_g',
          `edge 0 is ${(result.wallIds as string[])[0]}, not the wall already there`,
        ]),
      ],
    },
  },
  // The 2026-09-03 defect: the chat bound an upper room's openings to the collinear wall below.
  {
    name: "openings go on the walls of the room's own level, never the collinear wall below",
    tool: 'create_room',
    scene: roomsScene,
    input: {
      levelId: 'level_u',
      name: 'Study',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      doors: [{ wallIndex: 0, t: 0.25 }],
      windows: [{ wallIndex: 2 }],
    },
    expect: {
      result: { ok: true, reusedWalls: 1 },
      after: { wall_g: { children: ['door_g', 'window_g'] } },
      check: (result, nodes) => {
        const [doorId] = result.doorIds as string[]
        const [windowId] = result.windowIds as string[]
        const windowWall = nodes[nodes[windowId!]?.parentId ?? '']
        return problems(
          [nodes[doorId!]?.parentId === 'wall_u', `the door hangs off ${nodes[doorId!]?.parentId}`],
          [
            windowWall?.type === 'wall' && windowWall.parentId === 'level_u',
            `the window hangs off ${windowWall?.id} on ${windowWall?.parentId}`,
          ],
          [
            near(openingPlanPoint(nodes, doorId!)?.[0] ?? -1, 1),
            `the door is not a quarter along edge 0: ${openingPlanPoint(nodes, doorId!)}`,
          ],
        )
      },
    },
  },
  {
    name: 'a room across a wall splits it; the door and window stay where they stood',
    tool: 'create_room',
    scene: roomsScene,
    input: {
      levelId: 'level_g',
      name: 'Den',
      polygon: [
        [2, 0],
        [6, 0],
        [6, 3],
        [2, 3],
      ],
    },
    expect: {
      result: { ok: true },
      present: ['door_g', 'window_g'],
      check: (result, nodes) =>
        problems(
          ...(['door_g', 'window_g'] as const).map((id): [boolean, string] => {
            const wall = nodes[nodes[id]?.parentId ?? '']
            return [
              wall?.type === 'wall' && wall.parentId === 'level_g',
              `${id} hangs off ${wall?.id}, not a wall of level_g`,
            ]
          }),
          [near(openingPlanPoint(nodes, 'door_g')?.[0] ?? -1, 1), 'door_g moved'],
          [near(openingPlanPoint(nodes, 'window_g')?.[0] ?? -1, 3), 'window_g moved'],
          [
            !!nodes[result.zoneId as string] && !!nodes[result.ceilingId as string],
            'the room has no zone or no derived ceiling',
          ],
        ),
    },
  },
  {
    name: 'two declared doors that overlap: the second is skipped with its code, the room stands',
    tool: 'create_room',
    scene: roomsScene,
    input: room({
      levelId: 'level_g',
      doors: [
        { wallIndex: 0, t: 0.5 },
        { wallIndex: 0, t: 0.55 },
      ],
    }),
    expect: {
      result: { ok: true },
      contains: { skippedOpenings: [{ kind: 'door', index: 1, code: 'opening_overlap' }] },
      check: (result) =>
        problems([(result.doorIds as string[]).length === 1, 'not exactly one door built']),
    },
  },
  {
    name: 'a door wider than its edge is skipped: wall_too_short',
    tool: 'create_room',
    scene: roomsScene,
    input: room({
      levelId: 'level_g',
      name: 'Closet',
      polygon: [
        [0, 5],
        [0.8, 5],
        [0.8, 8],
        [0, 8],
      ],
      doors: [{ wallIndex: 0 }],
    }),
    expect: {
      result: { ok: true, doorIds: [] },
      contains: { skippedOpenings: [{ kind: 'door', index: 0, code: 'wall_too_short' }] },
    },
  },
  {
    name: 'an edge the polygon does not have is skipped: edge_out_of_range',
    tool: 'create_room',
    scene: roomsScene,
    input: room({ levelId: 'level_g', windows: [{ wallIndex: 7 }] }),
    expect: {
      result: { ok: true, windowIds: [] },
      contains: { skippedOpenings: [{ kind: 'window', index: 0, code: 'edge_out_of_range' }] },
    },
  },
  {
    name: 'a window is centred on its wall, as add_window places it; a door takes its size, hinge, swing and style',
    tool: 'create_room',
    scene: roomsScene,
    input: room({
      levelId: 'level_g',
      windows: [{ wallIndex: 2 }],
      doors: [
        {
          wallIndex: 0,
          width: '36 in',
          hingesSide: 'right',
          swingDirection: 'outward',
          style: 'glass',
        },
      ],
    }),
    expect: {
      result: { ok: true },
      check: (result, nodes) => {
        const window = nodes[(result.windowIds as string[])[0]!]
        const door = nodes[(result.doorIds as string[])[0]!]
        // Centred on the wall as it stands when the room is made, the storey's 2.8 m: the floor plate
        // is derived afterwards, and a later add_window sees the slab (a window 2.5 cm lower).
        const wall = window?.type === 'window' && window.wallId ? nodes[window.wallId] : undefined
        const level = wall?.parentId ? nodes[wall.parentId] : undefined
        const ceiling = level?.type === 'level' ? (level.height ?? Number.NaN) : Number.NaN
        return problems(
          [
            window?.type === 'window' &&
              near(window.position[1], ceiling / 2) &&
              window.width === 1.5,
            `window ${JSON.stringify(window)} is not 1.5 m wide and centred on its ${ceiling} m wall`,
          ],
          [
            door?.type === 'door' &&
              Math.abs(door.width - 0.9144) < 1e-4 &&
              door.hingesSide === 'right' &&
              door.swingDirection === 'outward',
            `door ${JSON.stringify(door)} is not 36 in, hinged right, opening outward`,
          ],
        )
      },
    },
  },
  {
    name: 'level is the same field as levelId',
    tool: 'create_room',
    scene: roomsScene,
    input: room({ level: 'level_u' }),
    expect: { result: { ok: true }, check: roomOn('level_u') },
  },
  {
    name: 'without a level, the floor the person is viewing',
    tool: 'create_room',
    scene: roomsScene,
    input: room({}),
    context: { activeLevelId: 'level_u' },
    surfaces: ['core', 'chat'],
    expect: { result: { ok: true }, check: roomOn('level_u') },
  },
  {
    name: 'without a level or a viewed floor, the lowest storey',
    tool: 'create_room',
    scene: roomsScene,
    input: room({}),
    expect: { result: { ok: true }, check: roomOn('level_g') },
  },
  {
    name: 'outdoor: a terrace closed by separators, no walls of its own and no ceiling',
    tool: 'create_room',
    scene: roomsScene,
    input: {
      levelId: 'level_g',
      name: 'Terrace',
      outdoor: true,
      polygon: [
        [0, 10],
        [4, 10],
        [4, 13],
        [0, 13],
      ],
    },
    expect: {
      result: { ok: true, wallIds: [null, null, null, null], ceilingId: null },
      check: (result, nodes) => {
        const zone = nodes[result.zoneId as string]
        const separators = Object.values(nodes).filter(
          (node) => node.type === 'separator' && node.parentId === 'level_g',
        )
        return problems(
          [
            zone?.type === 'zone' && zone.name === 'Terrace' && zone.hasCeiling === false,
            'no terrace zone without a ceiling',
          ],
          [separators.length === 4, `${separators.length} separators, not 4`],
          [wallsOn(nodes, 'level_g').length === 1, 'the terrace built walls'],
          [nodes[result.slabId as string]?.type === 'slab', 'the terrace has no derived floor'],
        )
      },
    },
  },
  {
    name: 'outdoor over a room is refused and names it',
    tool: 'create_room',
    scene: roomsScene,
    input: {
      levelId: 'level_g',
      name: 'Terrace',
      outdoor: true,
      polygon: [
        [11, 1],
        [13, 1],
        [13, 2],
        [11, 2],
      ],
    },
    expect: { refusal: 'outdoor_room_overlap', mentions: ['Kitchen'] },
  },
  // Run 6: 54 walls drawn first, then 14 create_room calls, each stacking its named zone on the
  // "Room N" the walls had made: 16 twins.
  {
    name: 'a room over walls that already enclose it names the room they made, never a second zone',
    tool: 'create_room',
    scene: walledScene(),
    input: room({ levelId: 'level_g' }),
    expect: {
      result: { ok: true, reusedWalls: 4, zoneId: 'zone_walled' },
      after: { zone_walled: { name: 'Bedroom' } },
      check: (result, nodes) => [
        ...roomBuilt('level_g', 'Bedroom', 4)(result, nodes),
        ...problems([
          roomsInClear(nodes).length === 1,
          `${roomsInClear(nodes).map((zone) => zone.name).join(', ')} stand over one walled room`,
        ]),
      ],
    },
  },
  {
    name: 'the walled room is named whichever way round and from whichever corner the polygon runs',
    tool: 'create_room',
    scene: walledScene(),
    input: {
      levelId: 'level_g',
      name: 'Study',
      polygon: [
        [4, 8],
        [4, 5],
        [0, 5],
        [0, 8],
      ],
    },
    expect: {
      result: { ok: true, zoneId: 'zone_walled' },
      check: (_, nodes) =>
        problems([
          roomsInClear(nodes).map((zone) => zone.name).join() === 'Study',
          `${roomsInClear(nodes).map((zone) => zone.name).join(', ')} stand there, not Study alone`,
        ]),
    },
  },
  {
    name: 'a polygon over two walled spaces names the one holding most of it; the other keeps its name',
    tool: 'create_room',
    scene: walledScene({
      extra: [
        [
          [3, 5],
          [3, 8],
        ],
      ],
    }),
    input: room({ levelId: 'level_g', name: 'Master Bedroom' }),
    expect: {
      result: { ok: true },
      check: (result, nodes) => {
        const rooms = roomsInClear(nodes)
        const master = nodes[result.zoneId as string] as ZoneNode | undefined
        return problems(
          [rooms.length === 2, `${rooms.length} rooms over two walled spaces`],
          [
            master?.name === 'Master Bedroom' && Math.abs(area(master.polygon) - 9) < 0.05,
            `the named room is ${master?.name} over ${master && area(master.polygon)} m², not the 9 m² space`,
          ],
          [
            rooms.some((zone) => /^Room \d+$/.test(zone.name ?? '')),
            'the smaller space lost its own name',
          ],
        )
      },
    },
  },
  // The owner (7 October): a room a person named is never renamed silently, and never twinned: the
  // refusal names it, and the agent either passes rename: true or asks the person.
  {
    name: 'a room a person named is refused with a choice, never twinned or renamed silently',
    tool: 'create_room',
    scene: walledScene({ renamed: 'Library' }),
    input: room({ levelId: 'level_g' }),
    expect: { refusal: 'room_named_by_person', mentions: ['Library', 'rename: true only if the person asked', 'ask them'] },
  },
  {
    name: 'rename: true names the room a person named, in place, with no second zone',
    tool: 'create_room',
    scene: walledScene({ renamed: 'Library' }),
    input: room({ levelId: 'level_g', rename: true }),
    expect: {
      result: { ok: true, zoneId: 'zone_walled' },
      after: { zone_walled: { name: 'Bedroom' } },
      check: (_, nodes) =>
        problems([roomsInClear(nodes).length === 1, 'a second zone stands beside the renamed room']),
    },
  },
  {
    name: 'the same name over a room a person named has nothing to create',
    tool: 'create_room',
    scene: walledScene({ renamed: 'Bedroom' }),
    input: room({ levelId: 'level_g' }),
    expect: { refusal: 'room_named_by_person', mentions: ['already', 'Bedroom'] },
  },
  {
    name: 'outdoor over a space walls already enclose names that room and drops its ceiling',
    tool: 'create_room',
    scene: walledScene(),
    input: room({ levelId: 'level_g', name: 'Courtyard', outdoor: true }),
    expect: {
      result: { ok: true, zoneId: 'zone_walled', ceilingId: null },
      after: { zone_walled: { name: 'Courtyard', hasCeiling: false } },
      check: (_, nodes) =>
        problems([roomsInClear(nodes).length === 1, 'the courtyard stands beside its room']),
    },
  },
  {
    name: 'a roof level takes no room',
    tool: 'create_room',
    scene: roomsScene,
    input: room({ levelId: 'level_r' }),
    expect: { refusal: 'roof_level' },
  },
  {
    name: 'a made-up level id is refused',
    tool: 'create_room',
    scene: roomsScene,
    input: room({ levelId: 'level_1' }),
    expect: { refusal: 'level_not_found' },
  },
  {
    name: 'a polygon that crosses itself is refused',
    tool: 'create_room',
    scene: roomsScene,
    input: room({
      levelId: 'level_g',
      polygon: [
        [0, 5],
        [4, 8],
        [4, 5],
        [0, 8],
      ],
    }),
    expect: { refusal: 'invalid_polygon' },
  },
]

// ─── furnish_room ─────────────────────────────────────────────────────────────────────────────

const item = (id: string, dimensions: [number, number, number]): AssetInput => ({
  id,
  name: id,
  category: 'furniture',
  thumbnail: `/items/${id}/thumbnail.webp`,
  src: `/items/${id}/model.glb`,
  dimensions,
})

const CATALOG: AssetInput[] = [
  item('double-bed', [1.6, 0.5, 2.1]),
  item('single-bed', [1, 0.5, 2]),
  item('bedside-table', [0.5, 0.5, 0.4]),
  item('dresser', [1.2, 0.8, 0.5]),
  item('closet', [1.5, 2, 0.6]),
]

/** A 5 × 4 m bedroom: walls south (edge 0), east, north (edge 2), west; a door where asked. */
const BEDROOM: Pt[] = [
  [0, 0],
  [5, 0],
  [5, 4],
  [0, 4],
]
const BEDROOM_WALLS = ['wall_s', 'wall_e', 'wall_n', 'wall_w'] as const

function bedroomScene({ doorOn, desk }: { doorOn?: 'wall_s' | 'wall_n'; desk?: boolean } = {}) {
  return (): SceneGraph => {
    const door = doorOn
      ? DoorNode.parse({ id: 'door_bed', parentId: doorOn, wallId: doorOn, position: [2.5, 1.05, 0] })
      : null
    const walls = BEDROOM.map((start, i) =>
      WallNode.parse({
        id: BEDROOM_WALLS[i],
        parentId: 'level_f',
        start,
        end: BEDROOM[(i + 1) % BEDROOM.length]!,
        children: door && door.parentId === BEDROOM_WALLS[i] ? [door.id] : [],
      }),
    )
    const zone = ZoneNode.parse({
      id: 'zone_bed',
      parentId: 'level_f',
      name: 'Bedroom',
      polygon: BEDROOM,
      spaceRole: 'room',
    })
    // Where the bed would stand against the north wall.
    const deskItem = desk
      ? ItemNode.parse({
          id: 'item_desk',
          parentId: 'level_f',
          position: [2.5, 0, 3.5],
          asset: item('desk', [1.6, 0.8, 0.8]),
        })
      : null
    const level = LevelNode.parse({
      id: 'level_f',
      parentId: 'building_f',
      level: 0,
      height: 2.8,
      children: [...walls.map((wall) => wall.id), zone.id, ...(deskItem ? [deskItem.id] : [])],
    })
    const building = BuildingNode.parse({ id: 'building_f', children: [level.id] })
    return graph(building, level, ...walls, zone, ...(door ? [door] : []), ...(deskItem ? [deskItem] : []))
  }
}

const furnished = (result: Record<string, unknown>, nodes: Nodes) => {
  const items = Object.values(nodes)
  const itemIds = result.itemIds as string[]
  return problems(
    [itemIds.length > 0, 'nothing placed'],
    [
      itemIds.every((id) => nodes[id]?.type === 'item' && nodes[id]?.parentId === 'level_f'),
      'an item is not on the room level',
    ],
    [findBlockedDoors({ nodes: items }).length === 0, 'an item blocks a door'],
    [findItemItemCollisions({ nodes: items }).length === 0, 'two items overlap'],
  )
}

const bedPosition = (nodes: Nodes) => {
  const bed = Object.values(nodes).find(
    (node) => node.type === 'item' && node.asset.id === 'double-bed',
  )
  return bed?.type === 'item' ? bed.position : null
}

export const FURNISH_ROOM_CASES: AgentToolCase[] = [
  {
    name: 'a room named by its zone: its level and outline; the bed faces the door from the far wall',
    tool: 'furnish_room',
    scene: bedroomScene({ doorOn: 'wall_s' }),
    input: { zoneId: 'zone_bed', roomType: 'bedroom' },
    context: { catalog: CATALOG },
    expect: {
      result: { ok: true, doorWallIndex: 0, doorsDetected: 1 },
      check: (result, nodes) => [
        ...furnished(result, nodes),
        ...problems([(bedPosition(nodes)?.[2] ?? 0) > 2, 'the bed is not against the north wall']),
      ],
    },
  },
  {
    name: 'the door it finds sets the furniture wall, whichever edge it is on',
    tool: 'furnish_room',
    scene: bedroomScene({ doorOn: 'wall_n' }),
    input: { zoneId: 'zone_bed', roomType: 'bedroom' },
    context: { catalog: CATALOG },
    expect: {
      result: { ok: true, doorWallIndex: 2, doorsDetected: 1 },
      check: (result, nodes) => [
        ...furnished(result, nodes),
        ...problems([(bedPosition(nodes)?.[2] ?? 4) < 2, 'the bed is not against the south wall']),
      ],
    },
  },
  {
    name: 'doorWallIndex names the door wall of a room with no door yet, and keeps it clear',
    tool: 'furnish_room',
    scene: bedroomScene(),
    input: { zoneId: 'zone_bed', roomType: 'bedroom', doorWallIndex: 1 },
    context: { catalog: CATALOG },
    expect: {
      result: { ok: true, doorWallIndex: 1, doorsDetected: 0 },
      check: (result, nodes) => [
        ...furnished(result, nodes),
        ...problems([(bedPosition(nodes)?.[0] ?? 5) < 2.5, 'the bed is not against the west wall']),
      ],
    },
  },
  {
    name: 'a polygon instead of a zone, on the lowest storey when no level is named',
    tool: 'furnish_room',
    scene: bedroomScene({ doorOn: 'wall_s' }),
    input: { polygon: BEDROOM, roomType: 'bedroom' },
    context: { catalog: CATALOG },
    expect: { result: { ok: true, doorWallIndex: 0 }, check: furnished },
  },
  {
    name: 'an item already in the room is never overlapped',
    tool: 'furnish_room',
    scene: bedroomScene({ doorOn: 'wall_s', desk: true }),
    input: { zoneId: 'zone_bed', roomType: 'bedroom' },
    context: { catalog: CATALOG },
    expect: { result: { ok: true }, check: furnished },
  },
  {
    name: 'a piece the catalog lacks is skipped and named',
    tool: 'furnish_room',
    scene: bedroomScene({ doorOn: 'wall_s' }),
    input: { zoneId: 'zone_bed', roomType: 'bedroom' },
    context: { catalog: CATALOG.filter((entry) => entry.id !== 'bedside-table') },
    expect: { result: { ok: true }, mentions: ['bedside-table: not in the catalog'] },
  },
  {
    name: 'no room named: room_required',
    tool: 'furnish_room',
    scene: bedroomScene(),
    input: { roomType: 'bedroom' },
    context: { catalog: CATALOG },
    expect: { refusal: 'room_required' },
  },
  {
    name: 'a wall id for the room: not_a_zone',
    tool: 'furnish_room',
    scene: bedroomScene(),
    input: { zoneId: 'wall_s', roomType: 'bedroom' },
    context: { catalog: CATALOG },
    expect: { refusal: 'not_a_zone', mentions: ['wall_s'] },
  },
  {
    name: 'a zone id that does not exist: zone_not_found',
    tool: 'furnish_room',
    scene: bedroomScene(),
    input: { zoneId: 'zone_nope', roomType: 'bedroom' },
    context: { catalog: CATALOG },
    expect: { refusal: 'zone_not_found' },
  },
  {
    name: 'a roof level takes no furniture',
    tool: 'furnish_room',
    scene: roomsScene,
    input: { levelId: 'level_r', polygon: CLEAR, roomType: 'bedroom' },
    context: { catalog: CATALOG },
    expect: { refusal: 'roof_level' },
  },
  // Every host has a catalog (the MCP its built-in list at least); an operation run without one
  // says so rather than placing nothing.
  {
    name: 'a host without a catalog: no_catalog',
    tool: 'furnish_room',
    scene: bedroomScene(),
    input: { zoneId: 'zone_bed', roomType: 'bedroom' },
    surfaces: ['core', 'chat'],
    expect: { refusal: 'no_catalog' },
  },
]
