import {
  type AnyNode,
  CeilingNode,
  DoorNode,
  ItemNode,
  SeparatorNode,
  SiteNode,
  SlabNode,
  StairNode,
  StairSegmentNode,
  WallNode,
  ZoneNode,
} from '../../schema'
import type { AgentToolCase, SceneGraph } from './cases'
import { building, level, ROOM, room, scene, stairOn } from './verify-scene-cases'

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

/** A node of a plugin's kind no schema here knows. */
const pluginNode = (id: string, type: string) => ({
  object: 'node',
  id,
  type,
  parentId: 'level_0',
  visible: true,
  metadata: {},
})

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
  // A plugin's node on a surface without the plugin: method.ts calls these expected, so they are
  // named once per kind, as info, where validate_scene listed zod's whole list of kinds per node.
  verify(
    'validate_scene {} with a node of no known kind (its type rejected): schema_unknown_kind (info) names the kind and the node, and the scene stays valid',
    () => withNodes(pluginNode('gadget_odd', 'gadget')),
    {
      result: { valid: true, hasIssues: false },
      contains: [
        {
          type: 'schema_unknown_kind',
          severity: 'info',
          kind: 'gadget',
          count: 1,
          nodeIds: ['gadget_odd'],
        },
      ],
      lacks: [{ type: 'schema_invalid' }],
    },
  ),
  verify(
    "validate_scene {} with 300 nodes of a plugin's kind (300 errors of the whole list of kinds): one schema_unknown_kind with the count and five ids, the answer small",
    () =>
      withNodes(...Array.from({ length: 300 }, (_, i) => pluginNode(`beam_${i}`, 'acme:beam'))),
    {
      result: { valid: true, hasIssues: false },
      contains: [{ type: 'schema_unknown_kind', kind: 'acme:beam', count: 300 }],
      check: (result) => {
        const found = issuesOf(result, 'schema_unknown_kind')
        const size = JSON.stringify(result).length
        return [
          ...(found.length === 1 && (found[0]!.nodeIds as string[]).length === 5
            ? []
            : [`${found.length} schema_unknown_kind, not one naming five of the nodes`]),
          ...(size < 8_000 ? [] : [`the answer is ${size} bytes`]),
        ]
      },
    },
  ),
  verify(
    'validate_scene {} with a node whose type is empty (its type rejected): schema_invalid on it, no kind of that name',
    () => withNodes(pluginNode('wall_garbage', '')),
    {
      result: { valid: false },
      contains: [{ type: 'schema_invalid', nodeId: 'wall_garbage' }],
      lacks: [{ type: 'schema_unknown_kind' }],
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
  verify(
    "validate_scene {} with a hidden site its schema rejects (the error and the hidden site's warning): schema_invalid and site_hidden on the site",
    () => {
      const site = { ...SiteNode.parse({ id: 'site_lot', visible: false }), children: null }
      return { nodes: { [site.id]: site }, rootNodeIds: [site.id] }
    },
    {
      result: { valid: false },
      contains: [
        { type: 'schema_invalid', nodeId: 'site_lot', path: 'children' },
        { type: 'site_hidden', nodeId: 'site_lot' },
      ],
    },
  ),
  verify(
    'validate_scene {} on a level stored with no children, which its schema fills (valid): valid, the level read with none',
    () => {
      const graph = ground()
      const { children: _, ...stored } = graph.nodes.level_0 as Record<string, unknown>
      graph.nodes.level_0 = stored
      return graph
    },
    { result: { valid: true, levels: [{ levelId: 'level_0' }] } },
  ),
  // Measured around a wall it could not read, the room would read open, its door off its wall and
  // the level with no door: the level waits for the fix.
  verify(
    "validate_scene {} with a finished room's wall its schema rejects (the error alone): schema_invalid on the wall, the level unread, no finding read around it",
    () => {
      const graph = ground(...living())
      graph.nodes.wall_living_0 = { ...(graph.nodes.wall_living_0 as object), thickness: 'thick' }
      return graph
    },
    {
      result: { valid: false, levels: [{ levelId: 'level_0', unread: ['wall_living_0'] }] },
      contains: [{ type: 'schema_invalid', nodeId: 'wall_living_0', path: 'thickness' }],
      lacks: [
        { type: 'room_not_enclosed' },
        { type: 'space_no_room' },
        { type: 'opening_not_on_wall' },
        { type: 'walls_no_doors' },
        { type: 'wall_open_end' },
      ],
    },
  ),
  verify(
    "validate_scene {} with the wall a fridge stands against rejected by its schema (the error alone): no item_mid_room read around it",
    () => {
      const graph = withNodes(
        ItemNode.parse({
          id: 'item_fridge',
          parentId: 'level_0',
          position: [3.6, 0, 1.5],
          asset: {
            id: 'fridge',
            name: 'fridge',
            category: 'furniture',
            thumbnail: '/items/fridge/thumbnail.webp',
            src: '/items/fridge/model.glb',
            dimensions: [0.7, 1.8, 0.72],
          },
        }),
      )
      graph.nodes.wall_ground_1 = { ...(graph.nodes.wall_ground_1 as object), thickness: 'thick' }
      return graph
    },
    {
      result: { valid: false, levels: [{ levelId: 'level_0', unread: ['wall_ground_1'] }] },
      lacks: [{ type: 'item_mid_room' }],
    },
  ),
  verify(
    "validate_scene {} with the slab a stair arrives on rejected by its schema (the error alone): no stair finding read around it",
    () => {
      const graph = scene(
        building(),
        level('level_0', 0),
        level('level_1', 1),
        StairNode.parse({
          id: 'stair_main',
          parentId: 'level_0',
          fromLevelId: 'level_0',
          toLevelId: 'level_1',
          position: [2, 0, 0],
          slabOpeningMode: 'destination',
        }),
        StairSegmentNode.parse({
          id: 'sseg_main',
          parentId: 'stair_main',
          height: 3.8,
          length: 5,
          stepCount: 20,
        }),
        SlabNode.parse({
          id: 'slab_upper',
          parentId: 'level_1',
          polygon: rect(-2, -2, 8, 8),
          plateRole: 'base',
          elevation: 1,
        }),
      )
      graph.nodes.slab_upper = { ...(graph.nodes.slab_upper as object), thickness: 'thick' }
      return graph
    },
    {
      result: { valid: false },
      check: (result) => {
        const stairs = (result.issues as { type: string }[]).filter((issue) =>
          issue.type.startsWith('stair_'),
        )
        return stairs.length === 0 ? [] : [`stair findings ${stairs.map((issue) => issue.type)}`]
      },
    },
  ),
  verify(
    'validate_scene {} with a storey its schema rejects, the one stair on it (the error alone): schema_invalid on the level, no missing_stair read around it',
    () => {
      const graph = scene(
        building(),
        level('level_0', 0),
        level('level_1', 1),
        level('level_2', 2),
        ...room('level_0', 'ground'),
        ...room('level_1', 'first'),
        ...room('level_2', 'second'),
        ...stairOn('level_0'),
      )
      graph.nodes.level_0 = { ...(graph.nodes.level_0 as object), height: 'tall' }
      return graph
    },
    {
      result: { valid: false },
      contains: [{ type: 'schema_invalid', nodeId: 'level_0', path: 'height' }],
      lacks: [{ type: 'missing_stair' }],
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
      lacks: [
        { type: 'space_no_room' },
        { type: 'space_many_rooms' },
        { type: 'room_not_enclosed' },
        { type: 'room_unnamed' },
      ],
    },
  ),
  verify(
    'check_rooms { levelId } on a space two drawn zones split beside the room the walls gave it ("space … : Room 1 + Kitchen + Dining"): space_many_rooms with the three zones',
    () =>
      ground(
        ...wallRing('level_0', 'plan', ROOM),
        roomZone('zone_room1', 'level_0', 'Room 1', ROOM, { autoFromWalls: true }),
        ZoneNode.parse({
          id: 'zone_kitchen',
          parentId: 'level_0',
          name: 'Kitchen',
          polygon: rect(0, 0, 2, 3),
        }),
        ZoneNode.parse({
          id: 'zone_dining',
          parentId: 'level_0',
          name: 'Dining',
          polygon: rect(2, 0, 4, 3),
        }),
      ),
    {
      result: { hasIssues: true, levels: [{ levelId: 'level_0', spaces: 1 }] },
      contains: [{ type: 'space_many_rooms', levelId: 'level_0' }],
      check: (result) => {
        const found = issuesOf(result, 'space_many_rooms')
        const ids = (found[0]?.zoneIds ?? []) as string[]
        return found.length === 1 &&
          ids.length === 3 &&
          ids.includes('zone_kitchen') &&
          ids.includes('zone_dining')
          ? []
          : [`${found.length} space_many_rooms over ${ids.join(', ')}: one, over the three zones`]
      },
    },
  ),
  verify(
    'check_rooms { levelId } on a room drawn inside the room the walls gave a space, its twin ("space … : Room 1 + Kitchen"): space_many_rooms with both',
    () =>
      ground(
        ...wallRing('level_0', 'twin', ROOM),
        roomZone('zone_room1', 'level_0', 'Room 1', ROOM, { autoFromWalls: true }),
        roomZone('zone_kitchen', 'level_0', 'Kitchen', rect(0.5, 0.5, 3.5, 2.5)),
      ),
    {
      contains: [{ type: 'space_many_rooms', levelId: 'level_0' }],
      check: (result) => {
        const ids = (issuesOf(result, 'space_many_rooms')[0]?.zoneIds ?? []) as string[]
        return ids.length === 2 && ids.includes('zone_kitchen')
          ? []
          : [`space_many_rooms over ${ids.join(', ')}: the room and its twin`]
      },
    },
  ),
  verify(
    'zones no room inside a room (areas no walls bound, an open-air study) do not split the space',
    () =>
      ground(
        ...living(),
        ZoneNode.parse({
          id: 'zone_daylight',
          parentId: 'level_0',
          name: 'Daylight study',
          polygon: rect(1, 1, 3, 2),
          hasFloor: false,
          hasCeiling: false,
        }),
        ZoneNode.parse({
          id: 'zone_reading',
          parentId: 'level_0',
          name: 'Reading area',
          polygon: rect(1, 1.2, 2, 2.2),
        }),
      ),
    { lacks: [{ type: 'space_many_rooms' }] },
  ),
  verify(
    'a mezzanine over its room does not split the space',
    () =>
      ground(
        ...living(),
        roomZone('zone_mezzanine', 'level_0', 'Mezzanine', rect(0, 0, 2, 3), {
          floor: { support: 'open', elevation: 1.4 },
        }),
      ),
    { lacks: [{ type: 'space_many_rooms' }] },
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
    'check_rooms { levelId } on a zone three walls bound, left generic as set_zone draws one no room adopts ("… walls do not close around it"): room_not_enclosed, info, as it may be a courtyard',
    () =>
      ground(
        ...wallRing('level_0', 'drawn', ROOM, true),
        ZoneNode.parse({ id: 'zone_drawn', parentId: 'level_0', name: 'Kitchen', polygon: ROOM }),
      ),
    {
      contains: [{ type: 'room_not_enclosed', zoneId: 'zone_drawn', severity: 'info' }],
      mentions: ['a room missing a wall or a courtyard'],
    },
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
  verify(
    "a courtyard the house's rooms bound on three sides is no defect: room_not_enclosed on it is info, and the scene clean",
    () =>
      ground(
        ...finished('west', 'Living', rect(0, 0, 3, 5)),
        ...finished('east', 'Kitchen', rect(7, 0, 10, 5)),
        ...finished('north', 'Hall', rect(3, -3, 7, 0)),
        ZoneNode.parse({
          id: 'zone_court',
          parentId: 'level_0',
          name: 'Courtyard',
          polygon: rect(3, 0, 7, 5),
        }),
      ),
    {
      result: { hasIssues: false },
      contains: [{ type: 'room_not_enclosed', zoneId: 'zone_court', severity: 'info' }],
    },
  ),
  verify(
    'a courtyard behind 0.6 m garden walls is no room',
    () => {
      const court = rect(6, 0, 10, 3)
      return ground(
        ...living(),
        ...court.slice(0, -1).map((start, i) =>
          WallNode.parse({
            id: `wall_garden_${i}`,
            parentId: 'level_0',
            start,
            end: court[i + 1],
            height: 0.6,
          }),
        ),
        ZoneNode.parse({
          id: 'zone_court',
          parentId: 'level_0',
          name: 'Courtyard',
          polygon: court,
        }),
      )
    },
    { lacks: [{ type: 'room_not_enclosed' }] },
  ),
]
