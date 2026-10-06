import { BuildingNode, DoorNode, ItemNode, LevelNode, WallNode } from '../../schema'

/**
 * The edge cases of `add_door` / `add_window`, written before the operation: one table that the
 * core operation, the MCP tool and the hosted chat's executor all run, so the three layers cannot
 * disagree. The editor's manual tools are the reference for what is possible: curved walls take
 * no openings, overlapping placements need a force (Alt in the editor), positions clamp onto the
 * wall and windows under its ceiling. `wall_too_short` is the one guard the editor lacks.
 */

export const OPENING_SCENE = {
  buildingId: 'building_openings',
  levelId: 'level_openings',
  /** 4 m straight wall, 2.5 m tall. */
  main: 'wall_main',
  /** 0.8 m: shorter than a default door. */
  short: 'wall_short',
  /** 0.9 m: exactly a default door. */
  exact: 'wall_exact',
  /** 4 m wall with a door centred at 2.0 m (1.55–2.45 m, 0–2.1 m high). */
  busy: 'wall_busy',
  existingDoor: 'door_existing',
  /** 4 m wall bowed 0.5 m. */
  curved: 'wall_curved',
  /** 4 m wall with no height of its own: the 2.8 m storey decides. */
  storey: 'wall_storey',
  /** 4 m wall carrying a 1.2 m wall-mounted shelf centred at 2.0 m (1.4–2.6 m, 1.0–1.6 m high). */
  shelved: 'wall_shelved',
  wallShelf: 'item_wall_shelf',
  /** 4 m outside wall, its outside at the front (+normal). */
  outFront: 'wall_out_front',
  /** 4 m outside wall drawn the other way: its outside at the back, as run 3's garage wall. */
  outBack: 'wall_out_back',
} as const

const wall = (id: string, z: number, length: number, extra: Record<string, unknown> = {}) =>
  WallNode.parse({
    id,
    parentId: OPENING_SCENE.levelId,
    start: [0, z],
    end: [length, z],
    thickness: 0.2,
    height: 2.5,
    ...extra,
  })

/** A fresh scene graph for every case: one building, one 2.8 m storey, nine walls. */
export function openingScene() {
  // No height of its own: the storey decides.
  const { height: _height, ...storeyWall } = wall(OPENING_SCENE.storey, 10, 4)
  const walls = [
    wall(OPENING_SCENE.main, 0, 4),
    wall(OPENING_SCENE.short, 2, 0.8),
    wall(OPENING_SCENE.exact, 4, 0.9),
    { ...wall(OPENING_SCENE.busy, 6, 4), children: [OPENING_SCENE.existingDoor] },
    wall(OPENING_SCENE.curved, 8, 4, { curveOffset: 0.5 }),
    storeyWall as WallNode,
    { ...wall(OPENING_SCENE.shelved, 12, 4), children: [OPENING_SCENE.wallShelf] },
    wall(OPENING_SCENE.outFront, 14, 4, { frontSide: 'exterior', backSide: 'interior' }),
    wall(OPENING_SCENE.outBack, 16, 4, { frontSide: 'interior', backSide: 'exterior' }),
  ]
  const door = DoorNode.parse({
    id: OPENING_SCENE.existingDoor,
    parentId: OPENING_SCENE.busy,
    wallId: OPENING_SCENE.busy,
    position: [2, 1.05, 0],
    width: 0.9,
    height: 2.1,
  })
  const shelf = ItemNode.parse({
    id: OPENING_SCENE.wallShelf,
    parentId: OPENING_SCENE.shelved,
    wallId: OPENING_SCENE.shelved,
    position: [2, 1, 0],
    asset: {
      id: 'wall-shelf',
      name: 'Wall shelf',
      category: 'storage',
      thumbnail: '/items/wall-shelf/thumbnail.webp',
      src: '/items/wall-shelf/model.glb',
      dimensions: [1.2, 0.6, 0.3],
      attachTo: 'wall',
    },
  })
  const level = LevelNode.parse({
    id: OPENING_SCENE.levelId,
    parentId: OPENING_SCENE.buildingId,
    level: 0,
    height: 2.8,
    children: walls.map((w) => w.id),
  })
  const building = BuildingNode.parse({ id: OPENING_SCENE.buildingId, children: [level.id] })
  const nodes = Object.fromEntries([building, level, ...walls, door, shelf].map((node) => [node.id, node]))
  return { nodes, rootNodeIds: [building.id] }
}

export const WALL_OPENING_REFUSALS = [
  'wall_not_found',
  'not_a_wall',
  'curved_wall',
  'position_required',
  'conflicting_position',
  'wall_too_short',
  'opening_overlap',
] as const
export type WallOpeningRefusal = (typeof WALL_OPENING_REFUSALS)[number]

export type WallOpeningCase = {
  name: string
  tool: 'add_door' | 'add_window'
  input: Record<string, unknown>
  expect:
    | { refusal: WallOpeningRefusal; mentions?: string[] }
    | {
        localX: number
        centerY: number
        clamped: boolean
        glassPanels?: boolean
        /** Fields the opening built has. */
        node?: Record<string, unknown>
      }
}

const {
  main,
  short,
  exact,
  busy,
  curved,
  storey,
  shelved,
  wallShelf,
  levelId,
  existingDoor,
  outFront,
  outBack,
} = OPENING_SCENE

export const WALL_OPENING_CASES: readonly WallOpeningCase[] = [
  // Which way it faces. A door's swing and a garage door's track run behind its facing, so a door
  // on an outside wall faces out whichever way the wall was drawn (run 3, 2026-10-05: the garage
  // door's track ran on the street). An inside wall keeps the wall's front.
  {
    name: 'a door on an outside wall faces out',
    tool: 'add_door',
    input: { wallId: outFront, t: 0.5 },
    expect: { localX: 2, centerY: 1.05, clamped: false, node: { side: 'front', rotation: [0, 0, 0] } },
  },
  {
    name: 'a garage door on an outside wall drawn the other way faces out, its track inside',
    tool: 'add_door',
    input: { wallId: outBack, t: 0.5, width: 2.4, doorType: 'garage-sectional' },
    expect: {
      localX: 2,
      centerY: 1.05,
      clamped: false,
      node: { side: 'back', rotation: [0, Math.PI, 0] },
    },
  },
  {
    name: "a door on an inside wall keeps the wall's front",
    tool: 'add_door',
    input: { wallId: main, t: 0.5 },
    expect: { localX: 2, centerY: 1.05, clamped: false, node: { rotation: [0, 0, 0] } },
  },
  // Where it goes
  {
    name: 'a door at t 0.5 is centred',
    tool: 'add_door',
    input: { wallId: main, t: 0.5 },
    expect: { localX: 2, centerY: 1.05, clamped: false },
  },
  {
    name: 'a door at the start slides onto the wall',
    tool: 'add_door',
    input: { wallId: main, t: 0 },
    expect: { localX: 0.45, centerY: 1.05, clamped: true },
  },
  {
    name: 'a door at the end slides onto the wall',
    tool: 'add_door',
    input: { wallId: main, t: 1 },
    expect: { localX: 3.55, centerY: 1.05, clamped: true },
  },
  {
    name: 'position is an alias of t',
    tool: 'add_door',
    input: { wallId: main, position: 0.25 },
    expect: { localX: 1, centerY: 1.05, clamped: false },
  },
  {
    name: 'equal t and position agree',
    tool: 'add_door',
    input: { wallId: main, t: 0.25, position: 0.25 },
    expect: { localX: 1, centerY: 1.05, clamped: false },
  },
  {
    name: 'a wall exactly as long as the door takes it',
    tool: 'add_door',
    input: { wallId: exact, t: 0.5 },
    expect: { localX: 0.45, centerY: 1.05, clamped: false },
  },
  {
    name: 'a wall with no height of its own takes a door',
    tool: 'add_door',
    input: { wallId: storey, t: 0.5 },
    expect: { localX: 2, centerY: 1.05, clamped: false },
  },
  // L45 (2026-10-05): L5's openGaps says to reopen a passage, and no tool made an opening with
  // no leaf; the editor's door panel has Door / Opening.
  {
    name: 'a passage with no leaf is an opening, in the outline asked',
    tool: 'add_door',
    input: { wallId: main, t: 0.5, openingKind: 'opening', openingShape: 'arch' },
    expect: {
      localX: 2,
      centerY: 1.05,
      clamped: false,
      node: { openingKind: 'opening', openingShape: 'arch' },
    },
  },
  {
    name: 'a door style changes the panels, not the size',
    tool: 'add_door',
    input: { wallId: main, t: 0.5, style: 'glass' },
    expect: { localX: 2, centerY: 1.05, clamped: false, glassPanels: true },
  },
  {
    name: 'a window sits on a 0.9 m sill by default',
    tool: 'add_window',
    input: { wallId: main, t: 0.5 },
    expect: { localX: 2, centerY: 1.65, clamped: false },
  },
  {
    name: 'a window keeps the sill it is given',
    tool: 'add_window',
    input: { wallId: main, t: 0.5, sillHeight: 1, height: 1.2 },
    expect: { localX: 2, centerY: 1.6, clamped: false },
  },
  {
    name: 'a window above the ceiling slides down under it',
    tool: 'add_window',
    input: { wallId: main, t: 0.5, sillHeight: 1.5, height: 1.5 },
    expect: { localX: 2, centerY: 1.75, clamped: true },
  },
  {
    name: 'a wall with no height uses the storey for its ceiling',
    tool: 'add_window',
    input: { wallId: storey, t: 0.5, sillHeight: 1.5, height: 1.2 },
    expect: { localX: 2, centerY: 2.1, clamped: false },
  },
  // Openings already on the wall
  {
    name: 'a door overlapping another is refused',
    tool: 'add_door',
    input: { wallId: busy, t: 0.55 },
    expect: { refusal: 'opening_overlap', mentions: [existingDoor] },
  },
  {
    name: 'a window overlapping a door is refused',
    tool: 'add_window',
    input: { wallId: busy, t: 0.5 },
    expect: { refusal: 'opening_overlap', mentions: [existingDoor] },
  },
  {
    name: 'a door over a wall-mounted item is refused with the item\'s span',
    tool: 'add_door',
    input: { wallId: shelved, t: 0.5 },
    expect: { refusal: 'opening_overlap', mentions: [wallShelf, '1.40 m–2.60 m'] },
  },
  {
    name: 'openings whose edges touch both fit',
    tool: 'add_door',
    input: { wallId: busy, t: 0.725 },
    expect: { localX: 2.9, centerY: 1.05, clamped: false },
  },
  {
    name: 'force places over another opening, like Alt in the editor',
    tool: 'add_door',
    input: { wallId: busy, t: 0.55, force: true },
    expect: { localX: 2.2, centerY: 1.05, clamped: false },
  },
  // Refusals
  {
    name: 'no position is refused',
    tool: 'add_door',
    input: { wallId: main },
    expect: { refusal: 'position_required' },
  },
  {
    name: 'different t and position are refused',
    tool: 'add_door',
    input: { wallId: main, t: 0.2, position: 0.6 },
    expect: { refusal: 'conflicting_position' },
  },
  {
    name: 'an unknown wall is refused',
    tool: 'add_door',
    input: { wallId: 'wall_missing', t: 0.5 },
    expect: { refusal: 'wall_not_found', mentions: ['wall_missing'] },
  },
  {
    name: 'a node that is not a wall is refused',
    tool: 'add_window',
    input: { wallId: levelId, t: 0.5 },
    expect: { refusal: 'not_a_wall', mentions: ['level'] },
  },
  {
    name: 'a wall shorter than the door is refused',
    tool: 'add_door',
    input: { wallId: short, t: 0.5 },
    expect: { refusal: 'wall_too_short', mentions: ['0.80 m', '0.90 m'] },
  },
  {
    name: 'a wall shorter than the window is refused',
    tool: 'add_window',
    input: { wallId: short, t: 0.5 },
    expect: { refusal: 'wall_too_short', mentions: ['0.80 m', '1.50 m'] },
  },
  {
    name: 'a curved wall takes no door, like in the editor',
    tool: 'add_door',
    input: { wallId: curved, t: 0.5 },
    expect: { refusal: 'curved_wall' },
  },
  {
    name: 'a curved wall takes no window, like in the editor',
    tool: 'add_window',
    input: { wallId: curved, t: 0.9 },
    expect: { refusal: 'curved_wall' },
  },
]
