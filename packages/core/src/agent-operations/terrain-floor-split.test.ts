import { afterEach, describe, expect, test } from 'bun:test'
import { pauseSpaceDetection, resumeSpaceDetection } from '../lib/space-detection'
import { applyStructureReconciliation } from '../lib/structure-commit'
import { closeLiveScene, openLiveScene, snapshotOf } from '../runtime/__fixtures__/live-scene'
import {
  type AnyNode,
  BuildingNode,
  DoorNode,
  generateId,
  LevelNode,
  type SiteNode,
  type SlabNode,
  type WallNode,
  type ZoneNode,
} from '../schema'
import useScene, { clearSceneHistory } from '../store/use-scene'
import { runSettled, settle, slopedLot } from './__fixtures__/sloped-lots'
import { applyAgentOutcome } from './apply-outcome'
import { AGENT_OPERATIONS } from './index'

/**
 * The neutral test house of the terrain series (16 Nov), made by tool calls: a 9 x 16 m L whose
 * garage wing stands at the street (+z), built the standard way (one shell over the footprint, then
 * three rooms; the shell's leftover is the living room), then the lot raised 20 % to the rear.
 */

type Nodes = Record<string, AnyNode>
type Pt = [number, number]
const LEVEL = 'level_ground'
const FOOTPRINT: Pt[] = [
  [-4.5, -8],
  [4.5, -8],
  [4.5, 8],
  [-1.5, 8],
  [-1.5, 2],
  [-4.5, 2],
]
const ROOMS: [string, Pt[]][] = [
  [
    'Room 1',
    [
      [-4.5, -8],
      [0, -8],
      [0, -4],
      [-4.5, -4],
    ],
  ],
  [
    'Room 2',
    [
      [0, -8],
      [4.5, -8],
      [4.5, -4],
      [0, -4],
    ],
  ],
  [
    'Garage',
    [
      [-1.5, 2],
      [4.5, 2],
      [4.5, 8],
      [-1.5, 8],
    ],
  ],
]
const LIVING: Pt[] = [
  [-4.5, -4],
  [4.5, -4],
  [4.5, 2],
  [-1.5, 2],
  [-4.5, 2],
]
/** 20 % rising to the rear (-z), level with the datum mid-house: +1.6 m at the rear wall. */
const HILL = {
  scope: 'lot',
  area: [
    [-15, -20],
    [15, -20],
    [15, 20],
    [-15, 20],
  ],
  through: [
    { at: [0, 10], heightM: -2 },
    { at: [0, -10], heightM: 2 },
  ],
}

type Tool = (name: string, input: Record<string, unknown>) => Record<string, unknown>

/** An empty level on the flat 30 x 40 m lot. */
function emptyLot(): Nodes {
  const bare = slopedLot({ ground: null, house: false })
  const site = bare.site_lot as SiteNode
  const building = BuildingNode.parse({
    id: 'building_house',
    parentId: site.id,
    children: [LEVEL],
  })
  const level = LevelNode.parse({ id: LEVEL, parentId: building.id, level: 0, height: 2.5 })
  return settle({
    ...bare,
    [site.id]: { ...site, children: [...(site.children ?? []), building.id] } as AnyNode,
    [building.id]: building,
    [level.id]: level,
  })
}

/**
 * The shell and its three rooms. A story shell records its floor height on the room it encloses
 * (create_story_shell's slabElevation, here 0.05 m: where the floor rests on flat ground).
 */
function neutralHouse(tool: Tool): string {
  const shell = tool('create_room', { levelId: LEVEL, name: 'Room', polygon: FOOTPRINT })
  const shellId = shell.zoneId as string
  tool('set_zone_intent', { zoneId: shellId, patch: { floor: { elevation: 0.05 } } })
  for (const [name, polygon] of ROOMS) tool('create_room', { levelId: LEVEL, name, polygon })
  return shellId
}

/** Each call applied and settled by the pure reconciler, as the core and MCP runners do. */
function pureRunner(start: Nodes) {
  let nodes = start
  const tool: Tool = (name, input) => {
    const run = runSettled(nodes, name, input)
    nodes = run.nodes
    return run.result
  }
  return { tool, nodes: () => nodes, set: (next: Nodes) => (nodes = next) }
}

/**
 * Each call as the chat runs it on the editor's store: the editor's own reconciliation paused for
 * the call, the outcome applied by the store's actions and settled by the derived writer, then
 * the reconciliation resumed (`apps/community/.../ai/shared-tools.ts`).
 */
async function chatRunner(start: Nodes) {
  await openLiveScene(snapshotOf({ nodes: start, rootNodeIds: ['site_lot'] }))
  const tool: Tool = (name, input) => {
    pauseSpaceDetection()
    try {
      const operation = (AGENT_OPERATIONS as Record<string, (...args: never[]) => unknown>)[name]!
      const outcome = (operation as never as typeof AGENT_OPERATIONS.create_room)(
        useScene.getState().nodes,
        input as never,
        { activeLevelId: null },
      )
      return applyAgentOutcome(outcome, {
        getNodes: () => useScene.getState().nodes,
        applyChanges: (changes) =>
          useScene.getState().applyNodeChanges({
            create: changes.create as never,
            update: changes.update as never,
            delete: changes.delete as never,
          }),
        reconcile: () => {
          applyStructureReconciliation(useScene, { mintId: (kind) => generateId(kind) })
        },
      }) as Record<string, unknown>
    } finally {
      resumeSpaceDetection()
    }
  }
  return { tool, nodes: () => useScene.getState().nodes as Nodes }
}

const zoneNamed = (nodes: Nodes, name: string) =>
  Object.values(nodes).find(
    (node): node is ZoneNode => node.type === 'zone' && node.name === name,
  ) as ZoneNode
const basePlates = (nodes: Nodes) =>
  Object.values(nodes).filter(
    (node): node is SlabNode => node.type === 'slab' && node.plateRole === 'base',
  )
const wallAt = (nodes: Nodes, from: Pt, to: Pt) =>
  Object.values(nodes).find(
    (node): node is WallNode =>
      node.type === 'wall' &&
      [
        [node.start, node.end],
        [node.end, node.start],
      ].some(
        ([a, b]) =>
          Math.hypot(a![0] - from[0], a![1] - from[1]) < 1e-6 &&
          Math.hypot(b![0] - to[0], b![1] - to[1]) < 1e-6,
      ),
  ) as WallNode
type Finding = { code: string; id: string; value: number; message: string }
type Facts = {
  houses: {
    walls: { wallId: string; floorOverGroundM: { min: number; max: number } }[]
    doors: { doorId: string; stepM: number }[]
  }[]
  open: Finding[]
}

afterEach(() => {
  closeLiveScene()
  clearSceneHistory()
})

describe('a later call never switches off a floor the derivation merged back (D43)', () => {
  test('delete_zone keep, then the room drawn again: every other room keeps its floor', async () => {
    const run = await chatRunner(emptyLot())
    const shellId = neutralHouse(run.tool)
    run.tool('delete_zone', { zoneId: shellId, contents: 'keep' })
    // The open outline split the floor: the garage block stands on a plate of its own...
    expect(basePlates(run.nodes()).length).toBe(2)
    // ...which the living room, drawn again, closes back into one.
    run.tool('create_room', { levelId: LEVEL, name: 'Living', polygon: LIVING })
    const nodes = run.nodes()
    for (const name of ['Room 1', 'Room 2', 'Garage', 'Living'])
      expect({ name, hasFloor: zoneNamed(nodes, name).hasFloor }).toEqual({
        name,
        hasFloor: undefined,
      })
    const plates = basePlates(nodes)
    expect(plates.length).toBe(1)
    expect(plates[0]!.zoneIds?.includes(zoneNamed(nodes, 'Garage').id)).toBe(true)
  })
})

describe('a split floor is said (D41)', () => {
  test("a room's stored floor elevation left behind by the ground is a finding", () => {
    const run = pureRunner(emptyLot())
    const shellId = neutralHouse(run.tool)
    run.tool('set_terrain_plane', HILL)
    const facts = run.tool('read_terrain_facts', {}) as unknown as Facts
    const split = facts.open.find((finding) => finding.id === shellId)
    expect(split?.code).toBe('floor_split')
    // The floor that rests on the ground has followed it to 1.65 m; the room stayed at 0.05 m.
    expect(split?.value).toBeCloseTo(1.6, 1)
  })

  test('base plates of one floor at two heights are a finding', () => {
    const run = pureRunner(emptyLot())
    const shellId = neutralHouse(run.tool)
    // The living room between the wings without a floor: the rear block and the garage block
    // each rest on their own ground.
    run.tool('set_zone_intent', { zoneId: shellId, patch: { floor: { elevation: null } } })
    run.tool('set_zone_intent', { zoneId: shellId, patch: { hasFloor: false } })
    run.tool('set_terrain_plane', HILL)
    const plates = basePlates(run.nodes())
    expect(plates.length).toBe(2)
    const facts = run.tool('read_terrain_facts', {}) as unknown as Facts
    const split = facts.open.find(
      (finding) => finding.code === 'floor_split' && finding.id === LEVEL,
    )
    const tops = plates.map((plate) => plate.elevation)
    expect(split?.value).toBeCloseTo(Math.max(...tops) - Math.min(...tops), 1)
  })

  test('a flat site with the same house says nothing of a split', () => {
    const run = pureRunner(emptyLot())
    neutralHouse(run.tool)
    const facts = run.tool('read_terrain_facts', {}) as unknown as Facts
    expect(facts.open.filter((finding) => finding.code === 'floor_split')).toEqual([])
  })
})

describe('a room with no floor plate is read and named by the terraforming tools (D43)', () => {
  /** The neutral house with its garage made floorless, a garage door at the street, on the hill. */
  function floorlessGarage() {
    const run = pureRunner(emptyLot())
    const shellId = neutralHouse(run.tool)
    run.tool('set_zone_intent', { zoneId: shellId, patch: { floor: { elevation: null } } })
    const garage = zoneNamed(run.nodes(), 'Garage')
    run.tool('set_zone_intent', { zoneId: garage.id, patch: { hasFloor: false } })
    const street = wallAt(run.nodes(), [4.5, 8], [-1.5, 8])
    const door = DoorNode.parse({
      id: 'door_garage',
      parentId: street.id,
      wallId: street.id,
      position: [3, 1.05, 0],
      width: 4.8,
      height: 2.1,
    })
    run.set({
      ...run.nodes(),
      [door.id]: door,
      [street.id]: { ...street, children: [...(street.children ?? []), door.id] } as AnyNode,
    })
    run.tool('set_terrain_plane', HILL)
    return { run, garage, street }
  }

  test('read_terrain_facts lists the walls and the door of a floorless garage, read from their own foot', () => {
    const { run, garage, street } = floorlessGarage()
    const facts = run.tool('read_terrain_facts', {}) as unknown as Facts
    const house = facts.houses[0]!
    const listed = new Set(house.walls.map((wall) => wall.wallId))
    const nodes = run.nodes()
    for (const [from, to] of [
      [
        [4.5, 2],
        [4.5, 8],
      ],
      [
        [4.5, 8],
        [-1.5, 8],
      ],
      [
        [-1.5, 8],
        [-1.5, 2],
      ],
    ] as [Pt, Pt][])
      expect(listed.has(wallAt(nodes, from, to)?.id ?? 'missing')).toBe(true)
    // The street wall is read from its own foot, which stands on the ground there (-1.6 m), not
    // against the floor plate of the rear block at 1.65 m (3.3 m over the ground).
    const front = house.walls.find((wall) => wall.wallId === street.id)!
    expect(Math.abs(front.floorOverGroundM.max)).toBeLessThan(0.2)
    expect(house.doors.some((each) => each.doorId === 'door_garage')).toBe(true)
    const named = facts.open.find(
      (finding) => finding.code === 'room_without_floor' && finding.id === garage.id,
    )
    expect(named?.message).toContain('has no floor plate')
  })

  test('seat_house says the floorless garage is not seated, and keeps its findings after', () => {
    const { run, garage } = floorlessGarage()
    const seat = run.tool('seat_house', {}) as {
      unmet: string[]
      after: { open: Finding[] }
    }
    expect(
      seat.unmet.some((line) => line.includes(`(${garage.id}) has no floor plate: not seated`)),
    ).toBe(true)
    expect(
      seat.after.open.some(
        (finding) => finding.code === 'room_without_floor' && finding.id === garage.id,
      ),
    ).toBe(true)
  })
})
