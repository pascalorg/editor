import { getRenderableSlabPolygon } from '../../lib/slab-polygon'
import { nodeRegistry } from '../../registry'
import type { AnyNode, AnyNodeId, LevelNode, SlabNode, WallNode } from '../../schema'
import { getLevelBelow } from '../../services/storey'
import useScene from '../../store/use-scene'
import { getFloorPlacedFootprints } from './floor-placed-elevation'
import {
  itemOverlapsPolygon,
  spatialGridManager,
  wallOverlapsPolygon,
} from './spatial-grid-manager'

export function resolveLevelId(node: AnyNode, nodes: Record<string, AnyNode>): string {
  // If the node itself is a level
  if (node.type === 'level') return node.id

  // Walk up parent chain to find level
  // This assumes you track parentId or can derive it
  let current: AnyNode | undefined = node

  while (current) {
    if (current.type === 'level') return current.id
    // Find parent (you might need to add parentId to your schema or derive it)
    if (current.parentId) {
      current = nodes[current.parentId]
    } else {
      current = undefined
    }
  }

  return 'default' // fallback for orphaned items
}

/**
 * Walks the parent chain of `nodeId` and returns the id of the first ancestor
 * whose `type` is `'level'`, or `null` when no level ancestor exists (orphaned
 * node, top-level building node, etc.). Unlike `resolveLevelId`, this variant:
 *
 * - accepts a node **id** rather than a resolved node, saving the caller a
 *   `nodes[id]` lookup when only the id is at hand.
 * - returns `null` instead of the `'default'` fallback, which lets callers
 *   distinguish "genuinely has no level" from "is a level".
 * - has a loop guard (16 iterations) so a corrupt parent-chain cycle cannot
 *   hang the frame loop.
 */
export function findLevelAncestorId(
  nodeId: AnyNodeId,
  nodes: Record<string, AnyNode>,
): string | null {
  let current: AnyNode | undefined = nodes[nodeId]
  let guard = 0
  while (current && guard < 16) {
    if (current.type === 'level') return current.id
    current = current.parentId ? nodes[current.parentId] : undefined
    guard += 1
  }
  return null
}

/**
 * Returns the building id that contains the given level, or `null` if
 * the level is unparented or no enclosing building exists.
 *
 * Most scenes record the relationship via `level.parentId →
 * building.id`, but older serialisations occasionally drop `parentId`
 * even though the building's `children` array still references the
 * level. The fallback scan covers that case.
 *
 * Used by `FloorplanRegistryLayer` to discover building-scoped kinds
 * (`def.floorplanScope === 'building'`) without hardcoding any kind
 * name in the editor layer.
 */
export function resolveBuildingForLevel(
  levelId: AnyNodeId,
  nodes: Record<AnyNodeId, AnyNode>,
): AnyNodeId | null {
  const level = nodes[levelId] as AnyNode | undefined
  if (!level) return null
  const directParent = (level as { parentId?: AnyNodeId | null }).parentId ?? null
  if (directParent) {
    const candidate = nodes[directParent]
    if (candidate?.type === 'building') return candidate.id as AnyNodeId
  }
  for (const candidate of Object.values(nodes)) {
    if (candidate?.type !== 'building') continue
    const children = (candidate as { children?: AnyNodeId[] }).children
    if (Array.isArray(children) && children.includes(levelId)) {
      return candidate.id as AnyNodeId
    }
  }
  return null
}

// Call this once at app initialization. Returns an unsubscribe function that
// detaches the scene-store listener (useful when the editor is unmounted so
// the spatial grid singleton does not hold stale references to old scenes).
export function initSpatialGridSync(): () => void {
  const store = useScene
  // 1. Initial sync - process all existing nodes
  const state = store.getState()
  for (const node of Object.values(state.nodes)) {
    const levelId = resolveLevelId(node, state.nodes)
    spatialGridManager.handleNodeCreated(node, levelId)
  }

  // 2. Then subscribe to future changes
  const markDirty = (id: AnyNodeId) => store.getState().markDirty(id)

  // Subscribe to all changes
  const unsubscribe = store.subscribe((state, prevState) => {
    // Detect added nodes
    for (const [id, node] of Object.entries(state.nodes)) {
      if (!prevState.nodes[id as AnyNode['id']]) {
        const levelId = resolveLevelId(node, state.nodes)
        spatialGridManager.handleNodeCreated(node, levelId)

        // When a slab is added, mark overlapping items/walls dirty
        if (node.type === 'slab') {
          markNodesOverlappingSlab(node as SlabNode, state.nodes, markDirty)
          markCoveringDependentsBelow(levelId, state.nodes, markDirty)
        }
      }
    }

    // Detect removed nodes
    for (const [id, node] of Object.entries(prevState.nodes)) {
      if (!state.nodes[id as AnyNode['id']]) {
        const levelId = resolveLevelId(node, prevState.nodes)
        spatialGridManager.handleNodeDeleted(id, node.type, levelId)

        // When a slab is removed, mark items/walls that were on it dirty (using current state)
        if (node.type === 'slab') {
          markNodesOverlappingSlab(node as SlabNode, state.nodes, markDirty)
          markCoveringDependentsBelow(levelId, state.nodes, markDirty)
        }
      }
    }

    // Detect updated nodes (items with position/rotation/parentId/side changes, slabs with polygon/elevation changes)
    for (const [id, node] of Object.entries(state.nodes)) {
      const prev = prevState.nodes[id as AnyNode['id']]
      if (!prev) continue

      if (node.type === 'item' && prev.type === 'item') {
        if (
          !(
            arraysEqual(node.position, prev.position) &&
            arraysEqual(node.rotation, prev.rotation) &&
            arraysEqual(node.scale, prev.scale)
          ) ||
          node.parentId !== prev.parentId ||
          node.side !== prev.side
        ) {
          const levelId = resolveLevelId(node, state.nodes)
          spatialGridManager.handleNodeUpdated(node, levelId)
          // Scale changes affect footprint size — mark dirty so slab elevation recalculates
          if (!arraysEqual(node.scale, prev.scale)) {
            markDirty(node.id)
          }
        }
      } else if (node.type === 'slab' && prev.type === 'slab') {
        const supportChanged =
          node.polygon !== prev.polygon ||
          node.elevation !== prev.elevation ||
          node.holes !== prev.holes
        if (supportChanged) {
          const levelId = resolveLevelId(node, state.nodes)
          spatialGridManager.handleNodeUpdated(node, levelId)

          // Mark nodes overlapping old polygon and new polygon as dirty
          markNodesOverlappingSlab(prev as SlabNode, state.nodes, markDirty)
          markNodesOverlappingSlab(node as SlabNode, state.nodes, markDirty)
        }
        if (node.elevation !== prev.elevation) {
          markDeckAttachedStairs(node.id, state.nodes, markDirty)
        }
        // The covering bound over the level below also moves with thickness
        // (underside = elevation − thickness) and recessed (pools never
        // cover), which same-level support ignores.
        if (
          supportChanged ||
          node.thickness !== prev.thickness ||
          node.recessed !== prev.recessed
        ) {
          markCoveringDependentsBelow(resolveLevelId(node, state.nodes), state.nodes, markDirty)
        }
      } else if (node.type === 'level' && prev.type === 'level') {
        if (node.height !== prev.height) {
          markLevelHeightDependents(node as LevelNode, state.nodes, markDirty)
        }
      } else if (node.type === 'wall' && prev.type === 'wall') {
        if (
          node.start !== prev.start ||
          node.end !== prev.end ||
          node.curveOffset !== prev.curveOffset ||
          node.thickness !== prev.thickness
        ) {
          // Rendered slab polygons adopt wall bands, so a wall reshape
          // must reach the manager to refresh its wall map and drop the
          // level's rendered-polygon cache.
          spatialGridManager.handleNodeUpdated(node, resolveLevelId(node, state.nodes))
        }
      }
    }
  })

  return unsubscribe
}

function arraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * A level's stored height moved: plane-bound walls follow the new plane,
 * stair rise re-derives, and ceilings/fences re-resolve their clamp — mark
 * them all so their systems rebuild. Restacking the level containers alone
 * leaves their geometry stale.
 */
export function markLevelHeightDependents(
  level: LevelNode,
  nodes: Record<string, AnyNode>,
  markDirty: (id: AnyNodeId) => void,
) {
  for (const childId of level.children) {
    const child = nodes[childId]
    if (!child) continue
    if (
      child.type === 'wall' ||
      child.type === 'stair' ||
      child.type === 'ceiling' ||
      child.type === 'fence'
    ) {
      markDirty(child.id)
    }
  }
}

/**
 * A deck slab's walking surface moved: stairs attached to it via
 * `deckSlabId` derive their rise from that elevation, so their geometry
 * (and rise-derived affordances) must rebuild.
 */
export function markDeckAttachedStairs(
  slabId: string,
  nodes: Record<string, AnyNode>,
  markDirty: (id: AnyNodeId) => void,
) {
  for (const node of Object.values(nodes)) {
    if (node.type === 'stair' && node.deckSlabId === slabId) {
      markDirty(node.id)
    }
  }
}

/**
 * A slab on `slabLevelId` was created/deleted or changed shape/placement:
 * the covering bound (slab underside) over the level BELOW moved, so that
 * level's plane-bound walls and clamped ceilings must rebuild.
 */
export function markCoveringDependentsBelow(
  slabLevelId: string,
  nodes: Record<string, AnyNode>,
  markDirty: (id: AnyNodeId) => void,
) {
  const below = getLevelBelow(slabLevelId, nodes)
  if (!below) return
  for (const childId of below.children) {
    const child = nodes[childId]
    if (child?.type === 'wall' || child?.type === 'ceiling') {
      markDirty(child.id)
    }
  }
}

/**
 * Mark all floor items and walls that may be affected by a slab change as dirty.
 */
function markNodesOverlappingSlab(
  slab: SlabNode,
  nodes: Record<string, AnyNode>,
  markDirty: (id: AnyNodeId) => void,
) {
  if (slab.polygon.length < 3) return
  const slabLevelId = resolveLevelId(slab, nodes)

  // Walls AND floor-placed nodes follow the slab's RENDERED footprint
  // (band-adopted edges reach the wall's outer face), so the dirty gate
  // must test the same polygon the support queries re-evaluate — a stored
  // polygon that stops short of the wall body would otherwise never
  // re-elevate nodes sitting over the adopted band.
  const levelWalls: WallNode[] = []
  const siblingSlabs: SlabNode[] = []
  for (const node of Object.values(nodes)) {
    if (node.type === 'wall' && resolveLevelId(node, nodes) === slabLevelId) {
      levelWalls.push(node as WallNode)
    } else if (
      node.type === 'slab' &&
      node.id !== slab.id &&
      resolveLevelId(node, nodes) === slabLevelId
    ) {
      siblingSlabs.push(node as SlabNode)
    }
  }
  const renderedPolygon = getRenderableSlabPolygon(slab, { walls: levelWalls, siblingSlabs })

  for (const node of Object.values(nodes)) {
    if (node.type === 'wall') {
      const wall = node as WallNode
      if (resolveLevelId(node, nodes) !== slabLevelId) continue
      if (
        wallOverlapsPolygon(
          {
            start: wall.start,
            end: wall.end,
            curveOffset: wall.curveOffset ?? 0,
            thickness: wall.thickness,
          },
          renderedPolygon,
        )
      ) {
        markDirty(node.id)
      }
      continue
    }
    // Generic floor-placed sweep: any registry kind that opts in via
    // `capabilities.floorPlaced` (item / shelf / column / spawn / …)
    // re-elevates through `<FloorElevationSystem>` when a slab below
    // changes. We dirty-mark when the kind's footprint overlaps the
    // changed slab so the system picks it up next frame.
    const def = nodeRegistry.get(node.type)
    const floorPlaced = def?.capabilities?.floorPlaced
    if (!floorPlaced) continue
    if (floorPlaced.applies && !floorPlaced.applies(node)) continue
    const parentId = node.parentId as AnyNodeId | null
    const parent = parentId ? nodes[parentId] : null
    if (parent && parent.type !== 'level') continue
    if (resolveLevelId(node, nodes) !== slabLevelId) continue
    const position = (node as { position?: [number, number, number] }).position
    if (!position) continue
    for (const footprint of getFloorPlacedFootprints(floorPlaced, node, { nodes })) {
      if (
        itemOverlapsPolygon(
          footprint.position ?? position,
          footprint.dimensions,
          footprint.rotation,
          renderedPolygon,
          0.01,
        )
      ) {
        markDirty(node.id)
        break
      }
    }
  }
}
