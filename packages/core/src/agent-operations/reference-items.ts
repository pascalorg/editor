import { refuse } from '../agent-tools/refusal'
import type { AnyNode } from '../schema'
import type { AgentOperation, SceneNodes } from './types'
import { registerSceneReport } from './verify-scene'

type Status = 'to_build' | 'built' | 'approximated' | 'not_possible'
export type ReferenceItem = {
  image: string
  id: string
  kind: string
  what: string
  where?: string
  count?: number
  status: Status
  nodeIds?: string[]
  why?: string
}
type RecordInput = {
  image: string
  items: (Omit<ReferenceItem, 'image' | 'status'> & { status?: Status })[]
}

const buildingOf = (nodes: SceneNodes) =>
  (Object.values(nodes) as AnyNode[]).find((node) => node.type === 'building')

const itemsOf = (nodes: SceneNodes) =>
  ((buildingOf(nodes)?.metadata as { referenceInventory?: { items?: ReferenceItem[] } } | undefined)
    ?.referenceInventory?.items ?? []) as ReferenceItem[]

/** A tool that can still build an item of a kind, and how. */
export type BuildPath = { tool: string; how: string }

const BUILD_PATHS = new Map<string, BuildPath[]>()

/**
 * What still builds an item recorded approximated or not possible, by its kind (L52, L60): run 3
 * wrote its front door's glass strips off while add_door takes code, and run 4 left the door's
 * slits, the pillars' reveal lines and the bay's timber soffit approximated, never built. Each
 * tool's own slice registers its path (paint registers finishes), so this module names only the
 * tools it ships with. A kind with no path says nothing.
 */
export function registerBuildPath(kind: string, path: BuildPath) {
  BUILD_PATHS.set(kind, [...(BUILD_PATHS.get(kind) ?? []), path])
}

const pathsOf = (item: Pick<ReferenceItem, 'kind' | 'status'>) =>
  item.status === 'approximated' || item.status === 'not_possible'
    ? (BUILD_PATHS.get(item.kind) ?? [])
    : []

const SCRIPTED: BuildPath = {
  tool: 'add_object',
  how: 'add_object builds it from a three.js module, named for what it is',
}
const RELIEF: BuildPath = {
  tool: 'add_object',
  how: 'add_object builds the part the type does not draw (grooves, reveals, a lined soffit, a fascia band, a raised deck) at its size',
}
registerBuildPath('opening', {
  tool: 'add_door',
  how: 'add_door and add_window take code: a three.js module for what outline, type and style cannot express',
})
for (const kind of ['fixture', 'signage', 'screen']) registerBuildPath(kind, SCRIPTED)
for (const kind of ['material', 'roof', 'soffit', 'paving']) registerBuildPath(kind, RELIEF)

/** An item still to build: never built, or built (or approximated) by nodes that are gone. */
const unbuilt = (nodes: SceneNodes, item: ReferenceItem) =>
  item.status === 'to_build' ||
  ((item.status === 'built' || item.status === 'approximated') &&
    !(item.nodeIds ?? []).some((id) => nodes[id]))

/** What an approximated item asks before it counts as built (L15, L51). */
const CLOSE_UP =
  'Compare a close-up of it with the reference (view_scene with target set to its node) before calling it built.'

/**
 * `record_reference`: what a reference image shows, item by item, kept on the scene's building.
 * The image is the specification (L15): verify_scene lists what is not built yet.
 */
export const recordReference: AgentOperation<RecordInput> = (nodes, { image, items }) => {
  const building = buildingOf(nodes)
  if (!building) refuse('no_building', 'The scene has no building to keep the inventory on.')
  for (const item of items) {
    const status = item.status ?? 'to_build'
    if ((status === 'built' || status === 'approximated') && !item.nodeIds?.length)
      refuse(
        'nodes_required',
        `${item.id} is ${status}: name the nodes that ${status === 'built' ? 'build it' : 'stand in for it'} (nodeIds).`,
        { id: item.id },
      )
    if (status === 'not_possible' && !item.why?.trim())
      refuse(
        'why_required',
        `${item.id} is not possible: say why (the tool or type Pascal lacks).`,
        {
          id: item.id,
        },
      )
    const missing = (item.nodeIds ?? []).find((id) => !nodes[id])
    if (missing) refuse('node_not_found', `Node not found: ${missing}.`, { id: missing })
  }
  const kept = [...itemsOf(nodes)]
  for (const item of items) {
    const next: ReferenceItem = { image, ...item, status: item.status ?? 'to_build' }
    const at = kept.findIndex((old) => old.image === image && old.id === item.id)
    if (at >= 0) kept[at] = next
    else kept.push(next)
  }
  const stillBuildable = items.flatMap((item) =>
    pathsOf({ kind: item.kind, status: item.status ?? 'to_build' }).map((path) => ({
      id: item.id,
      ...path,
    })),
  )
  return {
    result: {
      status: 'recorded',
      image,
      items: items.length,
      total: kept.length,
      unbuilt: kept.filter((item) => unbuilt(nodes, item)).length,
      ...(stillBuildable.length ? { stillBuildable } : {}),
    },
    changes: {
      update: [
        {
          id: building!.id,
          data: { metadata: { ...building!.metadata, referenceInventory: { items: kept } } },
        },
      ],
    },
  }
}

/**
 * Where the agent looks, until it records one (run 3, 2026-10-05, called verify_scene and
 * view_scene and never met record_reference, which only the guide named).
 */
export const INVENTORY_INVITATION =
  'Working from a photo or render? record_reference lists what it shows (to build, built, not possible); verify_scene then lists what is still unbuilt.'

/** Whether the building carries an inventory of what its references show. */
export const hasReferenceInventory = (nodes: SceneNodes) => itemsOf(nodes).length > 0

/** For verify_scene: the inventory's counts, and every item not built yet, as advice. */
export function inventoryReport(nodes: SceneNodes) {
  const items = itemsOf(nodes)
  if (!items.length) return { inventoryNext: INVENTORY_INVITATION }
  const left = items.filter((item) => unbuilt(nodes, item))
  const approximated = items.filter(
    (item) => item.status === 'approximated' && !unbuilt(nodes, item),
  )
  return {
    inventory: {
      items: items.length,
      built: items.filter((item) => item.status === 'built' && !unbuilt(nodes, item)).length,
      approximated: approximated.length,
      notPossible: items.filter((item) => item.status === 'not_possible').length,
      unbuilt: left.length,
    },
    ...(approximated.length
      ? {
          inventoryApproximated: approximated.map((item) => ({
            image: item.image,
            id: item.id,
            kind: item.kind,
            what: item.what,
            nodeIds: item.nodeIds,
            next: CLOSE_UP,
            ...(pathsOf(item).length ? { buildWith: pathsOf(item) } : {}),
          })),
        }
      : {}),
    inventoryUnbuilt: left.map(({ image, id, kind, what, where, status }) => ({
      image,
      id,
      kind,
      what,
      ...(where ? { where } : {}),
      ...(status === 'built' || status === 'approximated' ? { lost: true } : {}),
    })),
  }
}

// verify_scene reports the inventory: its counts and every item not built yet.
registerSceneReport({ name: 'inventory', run: inventoryReport })
