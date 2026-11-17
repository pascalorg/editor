import { encodeTerrainField } from '../../lib/terrain-codec'
import { createTerrainField, heightAt } from '../../lib/terrain-field'
import { persistedTerrainFieldOf } from '../../lib/terrain-source-persisted'
import {
  type AnyNode,
  BuildingNode,
  DoorNode,
  LevelNode,
  SiteNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '../../schema'
import { generateId } from '../../schema/base'
import { reconcileSceneStructure } from '../../lib/structure-reconcile'
import { filterDerivedNodeWrites } from '../../store/derived-node-guard'
import { applySceneChanges } from '../apply-changes'
import { applyAgentOutcome } from '../apply-outcome'
import { AGENT_OPERATIONS } from '../index'
import type { AgentOperation, SceneChanges, SceneNodes } from '../types'

/**
 * Sloped lots and a small house on them, for the rules of seating a house on the ground. The lot is
 * 30 x 40 m (x -15..15, z -20..20), its street on +z; the house is a 12 x 8 m plate (building-local
 * x -6..6, z -4..4) whose front wall (z = +4) faces the street, with a front and a rear door.
 */

export type Pt = [number, number]
export type Ground = (x: number, z: number) => number

export const LOT: Pt[] = [
  [-15, -20],
  [15, -20],
  [15, 20],
  [-15, 20],
]
export const PLATE: Pt[] = [
  [-6, -4],
  [6, -4],
  [6, 4],
  [-6, 4],
]

/** Natural grounds, metres above the datum at site-frame (x, z). `null` is a site nobody shaped. */
export const GROUNDS = {
  flat: null,
  /** 2 m of fall from the street to the rear, the datum at the street: -1 m under the house. */
  fallToRear: ((_x, z) => (z - 20) / 20) as Ground,
  /** 2 m of rise from the street to the rear, the datum at the street: +1 m under the house. */
  riseToRear: ((_x, z) => (20 - z) / 20) as Ground,
  /** A cross slope: +1 m at x = +15, -1 m at x = -15, the datum under the house. */
  cross: ((x) => x / 15) as Ground,
  /** A hillside, 20 %, rising to the rear, the datum under the house. */
  steep: ((_x, z) => -z * 0.2) as Ground,
} as const

export type SlopedHouse = {
  ground?: Ground | null
  /** The building's place on the site and its turn about the vertical, radians. */
  at?: [number, number, number]
  turn?: number
  /** Top of the floor slab over the level's plane. */
  slabElevation?: number
  /** Leave the house out: the lot alone. */
  house?: boolean
  doors?: boolean
  extra?: AnyNode[]
}

function link(nodes: AnyNode[]): Record<string, AnyNode> {
  const byId = Object.fromEntries(nodes.map((node) => [node.id, { ...node }])) as Record<
    string,
    AnyNode & { children?: string[] }
  >
  for (const node of Object.values(byId)) {
    const parent = node.parentId ? byId[node.parentId] : undefined
    if (parent && Array.isArray(parent.children) && !parent.children.includes(node.id))
      parent.children = [...parent.children, node.id]
  }
  return byId
}

export function slopedLot({
  ground = null,
  at = [0, 0, 0],
  turn = 0,
  slabElevation = 0.15,
  house = true,
  doors = true,
  extra = [],
}: SlopedHouse = {}): Record<string, AnyNode> {
  let terrain: ReturnType<typeof encodeTerrainField> | undefined
  if (ground) {
    const field = createTerrainField({ origin: [-20, -24], spacing: 0.5, cols: 81, rows: 97 })
    for (let row = 0; row < field.rows; row++)
      for (let col = 0; col < field.cols; col++)
        field.heights[row * field.cols + col] = Math.round(
          ground(-20 + col * 0.5, -24 + row * 0.5) / field.step,
        )
    terrain = encodeTerrainField(field)
  }
  const site = SiteNode.parse({
    id: 'site_lot',
    polygon: { type: 'polygon', points: LOT },
    frontEdge: 2,
    ...(terrain ? { terrain } : {}),
  })
  if (!house) return link([site, ...extra])
  const names = ['rear', 'right', 'front', 'left']
  return link([
    site,
    BuildingNode.parse({
      id: 'building_house',
      parentId: site.id,
      position: at,
      rotation: [0, turn, 0],
    }),
    LevelNode.parse({
      id: 'level_ground',
      parentId: 'building_house',
      level: 0,
      name: 'Ground floor',
      height: 2.7,
    }),
    ...PLATE.map((start, i) =>
      WallNode.parse({
        id: `wall_${names[i]}`,
        parentId: 'level_ground',
        start,
        end: PLATE[(i + 1) % 4],
        height: 2.7,
        frontSide: 'exterior',
      }),
    ),
    SlabNode.parse({
      id: 'slab_floor',
      parentId: 'level_ground',
      polygon: PLATE,
      elevation: slabElevation,
    }),
    ZoneNode.parse({
      id: 'zone_living',
      parentId: 'level_ground',
      name: 'Living',
      spaceRole: 'room',
      polygon: PLATE,
    }),
    ...(doors
      ? [
          // The front wall runs from [6, 4] to [-6, 4]: 6 m along it is x = 0.
          DoorNode.parse({
            id: 'door_front',
            parentId: 'wall_front',
            wallId: 'wall_front',
            position: [6, 1.05, 0],
          }),
          // The rear wall runs from [-6, -4] to [6, -4]: 9 m along it is x = 3.
          DoorNode.parse({
            id: 'door_rear',
            parentId: 'wall_rear',
            wallId: 'wall_rear',
            position: [9, 1.05, 0],
          }),
        ]
      : []),
    ...extra,
  ])
}

/**
 * One tool through the executor every surface shares, on a scene of drawn nodes: the outcome is
 * applied and the operation answers. Nothing is derived afterwards: the hand-built house of
 * `slopedLot` is what it is drawn as.
 */
export function runTool(
  nodes: SceneNodes,
  tool: string,
  input: Record<string, unknown> = {},
): { nodes: Record<string, AnyNode>; result: Record<string, unknown> } {
  return run(nodes, tool, input, (scene) => scene)
}

/**
 * One tool as both surfaces run it on a scene the editor made: the outcome is applied, the scene
 * settles through the pure reconciler (a floor that rests on the ground takes its height there)
 * and the operation answers once it has. For `agentHouse`.
 */
export function runSettled(
  nodes: SceneNodes,
  tool: string,
  input: Record<string, unknown> = {},
): { nodes: Record<string, AnyNode>; result: Record<string, unknown> } {
  return run(nodes, tool, input, settle)
}

/**
 * One tool as the editor's own store takes it: the write passes the store's rules for derived
 * nodes first (a patch to a floor plate is read as an intent and expanded), then settles.
 */
export function runInStore(
  nodes: SceneNodes,
  tool: string,
  input: Record<string, unknown> = {},
): { nodes: Record<string, AnyNode>; result: Record<string, unknown> } {
  return run(nodes, tool, input, settle, true)
}

function run(
  nodes: SceneNodes,
  tool: string,
  input: Record<string, unknown>,
  settled: (nodes: Record<string, AnyNode>) => Record<string, AnyNode>,
  storeRules = false,
) {
  const operation = (AGENT_OPERATIONS as Record<string, AgentOperation<never>>)[tool]
  if (!operation) throw new Error(`no operation ${tool}`)
  let after = nodes as Record<string, AnyNode>
  const outcome = operation(nodes, input as never, { activeLevelId: null })
  const result = applyAgentOutcome(outcome, {
    getNodes: () => after,
    applyChanges: (changes) => {
      after = applySceneChanges(
        after,
        storeRules ? (filterDerivedNodeWrites(after, changes as never) as SceneChanges) : changes,
      ) as Record<string, AnyNode>
    },
    reconcile: () => {
      after = settled(after)
    },
  })
  return { nodes: outcome.changes ? settled(after) : after, result }
}

/**
 * The scene as it settles after a write: rooms, floor plates and what derives from them. A new
 * record, as a store hands one out: the reconciler reads wall supports while it works, and those
 * reads are remembered against the record it returns, from before a floor plate took its height.
 */
export function settle(nodes: SceneNodes): Record<string, AnyNode> {
  return {
    ...(reconcileSceneStructure({ nodes, mintId: (kind) => generateId(kind) }).nodes as Record<
      string,
      AnyNode
    >),
  }
}

/**
 * The same lot with a house made the way an agent makes one: `create_room` on an empty level, so
 * its floor is an automatic plate that rests on the ground and follows it, and its walls stand on
 * that floor up to the storey's top. One room on the plate, a door in the front wall (toward the
 * street) and one in the rear wall; ids are the editor's own.
 */
export function agentHouse(options: Omit<SlopedHouse, 'house' | 'doors' | 'slabElevation'> = {}) {
  const bare = slopedLot({ ...options, house: false })
  const site = bare.site_lot as SiteNode
  const building = BuildingNode.parse({
    id: 'building_house',
    parentId: site.id,
    position: options.at ?? [0, 0, 0],
    rotation: [0, options.turn ?? 0, 0],
    children: ['level_ground'],
  })
  const level = LevelNode.parse({
    id: 'level_ground',
    parentId: building.id,
    level: 0,
    name: 'Ground floor',
    height: 2.7,
  })
  const empty = settle({
    ...bare,
    [site.id]: { ...site, children: [...(site.children ?? []), building.id] } as AnyNode,
    [building.id]: building,
    [level.id]: level,
  })
  return runSettled(empty, 'create_room', {
    levelId: 'level_ground',
    name: 'Living',
    polygon: PLATE,
    doors: [
      { wallIndex: 2, t: 0.5 },
      { wallIndex: 0, t: 0.75 },
    ],
  }).nodes
}

/** The ground at a site-frame point: the persisted field, or the datum where nobody shaped any. */
export function groundAt(nodes: SceneNodes, x: number, z: number): number {
  const field = persistedTerrainFieldOf(nodes.site_lot as SiteNode, nodes)
  return field ? heightAt(field, x, z) : 0
}
