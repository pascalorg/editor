import {
  type AnyNode,
  CeilingNode,
  DoorNode,
  SeparatorNode,
  SiteNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '../../schema'
import type { AgentToolCase, SceneGraph } from './cases'
import { building, level, ROOM, room, scene } from './verify-scene-cases'

/**
 * One scene check (slice K of the tool catalogue): `verify_scene` covers every case the MCP's
 * `validate_scene` and the Architect's `check_rooms` served, so both retire. Each case names the
 * retiring tool's call and what it answered, and runs the `verify_scene` call that covers it on the
 * core, MCP and chat runners. `validate_scene` always took `{}`; `check_rooms` took a `levelId`,
 * where `verify_scene` reads every level. `check_rooms`' "walls touching nothing" is the Architect's
 * `design_check` (`wall_isolated`), its own test: `verify_scene` keeps a free-standing wall quiet.
 */

type Pt = [number, number]

/** A closed ring of walls on a level, with a door so the level has one. */
function wallRing(levelId: string, tag: string, ring: Pt[], open = false): AnyNode[] {
  const walls = (open ? ring.slice(0, -1) : ring).map((start, i) =>
    WallNode.parse({
      id: `wall_${tag}_${i}`,
      parentId: levelId,
      start,
      end: ring[(i + 1) % ring.length],
      height: 2.5,
    }),
  )
  const host = walls[0]!
  const door = DoorNode.parse({
    id: `door_${tag}`,
    parentId: host.id,
    wallId: host.id,
    position: [1, 1.05, 0],
  })
  return [...walls, door]
}

const rect = (x0: number, z0: number, x1: number, z1: number): Pt[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]

const roomZone = (id: string, levelId: string, name: string, polygon: Pt[], extra = {}) =>
  ZoneNode.parse({ id, parentId: levelId, name, polygon, spaceRole: 'room', ...extra })

const ground = (...nodes: AnyNode[]) => scene(building(), level('level_0', 0), ...nodes)

/** A finished room on the ground floor: its walls, a door, its room zone, floor and ceiling. */
const finished = (tag: string, name: string, ring: Pt[] = ROOM) => [
  ...wallRing('level_0', tag, ring),
  roomZone(`zone_${tag}`, 'level_0', name, ring),
  SlabNode.parse({ id: `slab_${tag}`, parentId: 'level_0', polygon: ring }),
  CeilingNode.parse({ id: `ceiling_${tag}`, parentId: 'level_0', polygon: ring }),
]

const living = () => finished('living', 'Living')

/** A finished storey, but nodes as a stored scene may hold them: rejected by their schema. */
const withNodes = (...extra: Record<string, unknown>[]) =>
  ({
    nodes: {
      ...ground(...room('level_0', 'ground')).nodes,
      ...Object.fromEntries(extra.map((node) => [node.id as string, node])),
    },
    rootNodeIds: ['building_main'],
  }) satisfies SceneGraph

const badZone = (id: string, fields: Record<string, unknown>) => ({
  ...ZoneNode.parse({ id, parentId: 'level_0', name: 'Patio', polygon: rect(10, 0, 12, 2) }),
  ...fields,
})

type Expect = {
  surfaces?: AgentToolCase['surfaces']
  result?: Record<string, unknown>
  contains?: Record<string, unknown>[]
  lacks?: Record<string, unknown>[]
  mentions?: string[]
  check?: (result: Record<string, unknown>) => string[]
}

const verify = (name: string, build: () => SceneGraph, expect: Expect): AgentToolCase => ({
  name,
  tool: 'verify_scene',
  scene: build,
  input: {},
  ...(expect.surfaces && { surfaces: expect.surfaces }),
  expect: {
    result: expect.result ?? {},
    ...(expect.contains && { contains: { issues: expect.contains } }),
    ...(expect.lacks && { lacks: { issues: expect.lacks } }),
    ...(expect.mentions && { mentions: expect.mentions }),
    ...(expect.check && { check: (result) => expect.check!(result) }),
  },
})

const issuesOf = (result: Record<string, unknown>, type: string) =>
  (result.issues as { type: string; [key: string]: unknown }[]).filter(
    (issue) => issue.type === type,
  )

export const VALIDATE_SCENE_CASES: AgentToolCase[] = [
  verify(
    'validate_scene {} on a valid scene ({ valid: true, errors: [], warnings: [] }): valid, no schema_invalid, no site_hidden',
    () => ground(...room('level_0', 'ground')),
    {
      result: { valid: true, hasIssues: false },
      lacks: [{ type: 'schema_invalid' }, { type: 'site_hidden' }],
    },
  ),
  verify(
    "validate_scene {} with a hidden site (valid, a warning on the site's visible): valid, site_hidden (info) on the site, the scene still clean",
    () => {
      const site = SiteNode.parse({ id: 'site_lot', visible: false })
      return { nodes: { [site.id]: site }, rootNodeIds: [site.id] }
    },
    {
      result: { valid: true, hasIssues: false },
      contains: [{ type: 'site_hidden', nodeId: 'site_lot', severity: 'info' }],
      mentions: ['stay visible'],
    },
  ),
  verify(
    'validate_scene {} with a field its schema rejects (valid: false, the error by node and path): valid false, schema_invalid with nodeId and path',
    () => withNodes(badZone('zone_bad', { color: 5 })),
    {
      result: { valid: false, hasIssues: true },
      contains: [{ type: 'schema_invalid', nodeId: 'zone_bad', path: 'color' }],
      mentions: ['Schema: zone_bad.color'],
    },
  ),
  verify(
    'validate_scene {} on a node with two rejected fields (one error per path): one schema_invalid per path',
    () => withNodes(badZone('zone_bad', { color: 5, roomNumber: 7 })),
    {
      contains: [
        { type: 'schema_invalid', nodeId: 'zone_bad', path: 'color' },
        { type: 'schema_invalid', nodeId: 'zone_bad', path: 'roomNumber' },
      ],
    },
  ),
  verify(
    'validate_scene {} with seven rejected nodes (all seven listed): all seven schema_invalid, where verify_scene listed five',
    () =>
      withNodes(
        ...Array.from({ length: 7 }, (_, i) => badZone(`zone_bad${i}`, { color: i })),
      ),
    {
      result: { valid: false },
      check: (result) => {
        const ids = issuesOf(result, 'schema_invalid').map((issue) => issue.nodeId)
        const expected = Array.from({ length: 7 }, (_, i) => `zone_bad${i}`)
        return expected.every((id) => ids.includes(id)) && ids.length === 7
          ? []
          : [`schema_invalid on ${ids.join(', ')}, not one on each of the seven zones`]
      },
    },
  ),
  verify(
    'validate_scene {} with a node of no known kind (its type rejected): schema_invalid on that node',
    () =>
      withNodes({
        object: 'node',
        id: 'gadget_odd',
        type: 'gadget',
        parentId: 'level_0',
        visible: true,
        metadata: {},
      }),
    {
      result: { valid: false },
      contains: [{ type: 'schema_invalid', nodeId: 'gadget_odd' }],
    },
  ),
  verify(
    "validate_scene {} with malformed geometry (a zone's polygon, a wall's start null): every error, the other checks reading around those nodes",
    () => {
      const graph = withNodes(badZone('zone_bad', { polygon: null }))
      const wall = graph.nodes.wall_ground as Record<string, unknown>
      graph.nodes.wall_ground = { ...wall, start: null }
      return graph
    },
    {
      result: { valid: false, hasIssues: true },
      contains: [
        { type: 'schema_invalid', nodeId: 'zone_bad', path: 'polygon' },
        { type: 'schema_invalid', nodeId: 'wall_ground', path: 'start' },
      ],
    },
  ),
]

export const CHECK_ROOMS_CASES: AgentToolCase[] = [
  verify(
    'check_rooms { levelId } counts ("4 walls, 1 detected spaces, 1 zones"): the level\'s content.walls, spaces and content.zones',
    () => ground(...living()),
    {
      result: {
        hasIssues: false,
        levels: [{ levelId: 'level_0', content: { walls: 4, zones: 1 }, spaces: 1 }],
      },
      lacks: [{ type: 'space_no_room' }, { type: 'room_not_enclosed' }, { type: 'room_unnamed' }],
    },
  ),
  // A store (the MCP's, the editor's) numbers a room for every space its walls enclose when it
  // loads a scene, and the reconciler after every edit, so a space with no zone is a graph read as
  // stored or a level mid-edit: these run on the core runner, which reads the graph as declared.
  verify(
    'check_rooms { levelId } on a space the walls enclose with no zone ("space … NO ZONE"): space_no_room with the level, its walls, area and a point in it',
    () => ground(...wallRing('level_0', 'bare', ROOM)),
    {
      surfaces: ['core'],
      result: { hasIssues: true, levels: [{ levelId: 'level_0', spaces: 1 }] },
      contains: [{ type: 'space_no_room', levelId: 'level_0' }],
      check: (result) => {
        const [found] = issuesOf(result, 'space_no_room')
        const walls = ['wall_bare_0', 'wall_bare_1', 'wall_bare_2', 'wall_bare_3']
        const [x, z] = found!.at as Pt
        return [
          ...([...(found!.wallIds as string[])].sort().join() === walls.join()
            ? []
            : [`walls ${found!.wallIds}, not ${walls}`]),
          ...((found!.area as number) > 10 && (found!.area as number) <= 12
            ? []
            : [`area ${found!.area} m², not the 4 × 3 m room inside its walls`]),
          ...(x > 0 && x < 4 && z > 0 && z < 3 ? [] : [`(${x}, ${z}) is outside the space`]),
        ]
      },
    },
  ),
  verify(
    'check_rooms { levelId } on a room a new wall split in two, its zone over one half ("space … NO ZONE" for the other): space_no_room on the uncovered half only',
    () =>
      ground(
        ...wallRing('level_0', 'hall', rect(0, 0, 6, 3)),
        WallNode.parse({ id: 'wall_split', parentId: 'level_0', start: [3, 0], end: [3, 3] }),
        roomZone('zone_west', 'level_0', 'Study', rect(0, 0, 3, 3)),
      ),
    {
      surfaces: ['core'],
      result: { levels: [{ levelId: 'level_0', spaces: 2 }] },
      check: (result) => {
        const found = issuesOf(result, 'space_no_room')
        const [x] = (found[0]?.at ?? [0, 0]) as Pt
        return found.length === 1 && x > 3
          ? []
          : [`${found.length} space_no_room, the first at x ${x}: one, east of the new wall`]
      },
    },
  ),
  verify(
    'check_rooms { levelId } on a zone its walls do not close ("zone … walls do not close around it"): room_not_enclosed on the room',
    () =>
      ground(
        ...wallRing('level_0', 'open', ROOM, true),
        roomZone('zone_open', 'level_0', 'Kitchen', ROOM),
      ),
    {
      result: { hasIssues: true, levels: [{ levelId: 'level_0', spaces: 0 }] },
      contains: [{ type: 'room_not_enclosed', levelId: 'level_0', zoneId: 'zone_open' }],
      mentions: ['Kitchen'],
    },
  ),
  verify(
    'check_rooms { levelId } on a zone named Room ("zone "Room" … unnamed"): room_unnamed (info) on the room',
    () => ground(...finished('placeholder', 'Room')),
    {
      result: { hasIssues: false },
      contains: [
        { type: 'room_unnamed', levelId: 'level_0', zoneId: 'zone_placeholder', severity: 'info' },
      ],
    },
  ),
  verify(
    'check_rooms { levelId } on a zone with a blank name ("zone "" … unnamed"): room_unnamed on the room',
    () => ground(...finished('blank', ' ')),
    { contains: [{ type: 'room_unnamed', zoneId: 'zone_blank' }] },
  ),
  verify(
    'check_rooms { levelId } on an upper storey: verify_scene reads every level, the finding names its level',
    () =>
      scene(
        building(),
        level('level_0', 0),
        level('level_1', 1),
        ...living(),
        ...wallRing('level_1', 'loft', ROOM, true),
        roomZone('zone_loft', 'level_1', 'Loft', ROOM),
      ),
    {
      contains: [{ type: 'room_not_enclosed', levelId: 'level_1', zoneId: 'zone_loft' }],
      lacks: [{ type: 'room_not_enclosed', levelId: 'level_0' }],
    },
  ),
  verify(
    'check_rooms { levelId } on a room the reconciler opened when a wall went ("… walls do not close around it"): room_not_enclosed',
    () =>
      ground(
        ...wallRing('level_0', 'gone', ROOM, true),
        roomZone('zone_gone', 'level_0', 'Kitchen', ROOM, {
          autoFromWalls: true,
          enclosureStatus: 'open',
        }),
      ),
    { contains: [{ type: 'room_not_enclosed', zoneId: 'zone_gone' }] },
  ),
  verify(
    'check_rooms { levelId } on a zone three walls bound, left generic as set_zone draws one no room adopts ("… walls do not close around it"): room_not_enclosed',
    () =>
      ground(
        ...wallRing('level_0', 'drawn', ROOM, true),
        ZoneNode.parse({ id: 'zone_drawn', parentId: 'level_0', name: 'Kitchen', polygon: ROOM }),
      ),
    { contains: [{ type: 'room_not_enclosed', zoneId: 'zone_drawn' }] },
  ),
  verify(
    'check_rooms { levelId } on such a zone named Zone ("… walls do not close around it unnamed"): room_not_enclosed and room_unnamed',
    () =>
      ground(
        ...wallRing('level_0', 'drawn', ROOM, true),
        ZoneNode.parse({ id: 'zone_drawn', parentId: 'level_0', name: 'Zone', polygon: ROOM }),
      ),
    {
      contains: [
        { type: 'room_not_enclosed', zoneId: 'zone_drawn' },
        { type: 'room_unnamed', zoneId: 'zone_drawn' },
      ],
    },
  ),
  // What check_rooms called open or unnamed and Pascal does not: a terrace closes with
  // separators; a person can declare a room open; a zone no walls bound (a garden, a site or
  // analysis area, one along a single house wall) is no room.
  verify(
    'a terrace closed by separators, no walls of its own, is enclosed',
    () =>
      ground(
        ...living(),
        ...rect(6, 0, 9, 3).map((start, i, ring) =>
          SeparatorNode.parse({
            id: `separator_terrace_${i}`,
            parentId: 'level_0',
            start,
            end: ring[(i + 1) % ring.length],
          }),
        ),
        roomZone('zone_terrace', 'level_0', 'Terrace', rect(6, 0, 9, 3), { hasCeiling: false }),
      ),
    { lacks: [{ type: 'room_not_enclosed' }, { type: 'space_no_room' }] },
  ),
  verify(
    'a room declared open, and zones no walls bound, need no walls',
    () =>
      ground(
        ...living(),
        roomZone('zone_porch', 'level_0', 'Porch', rect(0, -2, 4, 0), {
          enclosureStatus: 'open',
        }),
        ZoneNode.parse({
          id: 'zone_garden',
          parentId: 'level_0',
          name: 'Zone',
          polygon: rect(6, 0, 10, 4),
        }),
        ZoneNode.parse({
          id: 'zone_yard',
          parentId: 'level_0',
          name: 'Yard',
          polygon: rect(0, 3, 4, 7),
        }),
      ),
    { lacks: [{ type: 'room_not_enclosed' }, { type: 'room_unnamed' }] },
  ),
]
