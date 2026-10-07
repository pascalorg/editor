import { resolveLevelId } from '../../lib/node-ancestry'
import { isFloorPlate } from '../../lib/plate-surface'
import { subtractPolygonsFromPolygon } from '../../lib/polygon-union'
import { getRenderableSlabPolygon } from '../../lib/slab-polygon'
import {
  isLevelAtSiteDatum,
  isLevelBaseConsumer,
  levelBaseElevationAt,
} from '../../lib/terrain-support'
import { nodeRegistry } from '../../registry'
import type { AnyNode, AnyNodeId, LevelNode, SiteNode, SlabNode, WallNode } from '../../schema'
import { getLevelBelow } from '../../services/storey'
import useLiveTerrain from '../../store/use-live-terrain'
import useScene from '../../store/use-scene'
import { getFloorPlacedFootprints } from './floor-placed-elevation'
import {
  itemOverlapsPolygon,
  spatialGridManager,
  wallOverlapsPolygon,
} from './spatial-grid-manager'
import { GROUND_SUPPORT_ID } from './support-host-id'

export {
  findLevelAncestorId,
  resolveBuildingForLevel,
  resolveLevelId,
} from '../../lib/node-ancestry'

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
  const unsubscribeScene = store.subscribe((state, prevState) => {
    if (state.nodes === prevState.nodes) return
    // A bulk slab change (scene load/reload, paste, import) used to run
    // markNodesOverlappingSlab per slab — two full node scans each, O(slabs ×
    // nodes). Above the threshold, dirty every possible slab dependent once (a
    // superset of the per-slab result) and skip the per-slab scans below.
    const bulkSlabs =
      countBulkSlabChanges(state.nodes, prevState.nodes) >= BULK_SLAB_CHANGE_THRESHOLD
    if (bulkSlabs) markAllSlabDependents(state.nodes, markDirty)
    const changedSlabContextLevels = new Set<string>()
    const changedRoomSupportLevels = new Set<string>()
    const checkSlabContext = (id: string) => {
      const previous = prevState.nodes[id as AnyNodeId]
      const next = state.nodes[id as AnyNodeId]
      if (previous === next) return
      const wallChanged =
        (previous?.type === 'wall' || next?.type === 'wall') &&
        (previous?.type !== 'wall' ||
          next?.type !== 'wall' ||
          previous.parentId !== next.parentId ||
          previous.start !== next.start ||
          previous.end !== next.end ||
          previous.thickness !== next.thickness ||
          previous.justification !== next.justification ||
          previous.curveOffset !== next.curveOffset)
      const slabChanged =
        (previous?.type === 'slab' || next?.type === 'slab') &&
        (previous?.type !== 'slab' ||
          next?.type !== 'slab' ||
          previous.parentId !== next.parentId ||
          previous.polygon !== next.polygon ||
          previous.elevation !== next.elevation)
      const roomChanged =
        (previous?.type === 'zone' || next?.type === 'zone') &&
        (previous?.type !== 'zone' ||
          next?.type !== 'zone' ||
          previous.parentId !== next.parentId ||
          previous.polygon !== next.polygon ||
          previous.holes !== next.holes ||
          previous.boundarySeparatorIds !== next.boundarySeparatorIds ||
          previous.boundaryWallIds !== next.boundaryWallIds ||
          previous.spaceRole !== next.spaceRole ||
          previous.floor?.elevation !== next.floor?.elevation ||
          previous.hasFloor !== next.hasFloor)
      const separatorChanged =
        (previous?.type === 'separator' || next?.type === 'separator') &&
        (previous?.type !== 'separator' ||
          next?.type !== 'separator' ||
          previous.parentId !== next.parentId ||
          previous.start !== next.start ||
          previous.end !== next.end)
      if (roomChanged || separatorChanged) {
        if (previous) changedRoomSupportLevels.add(resolveLevelId(previous, prevState.nodes))
        if (next) changedRoomSupportLevels.add(resolveLevelId(next, state.nodes))
      }
      if (!(wallChanged || slabChanged)) return
      if (previous) changedSlabContextLevels.add(resolveLevelId(previous, prevState.nodes))
      if (next) changedSlabContextLevels.add(resolveLevelId(next, state.nodes))
    }

    for (const id in prevState.nodes) {
      if (Object.hasOwn(prevState.nodes, id)) checkSlabContext(id)
    }
    for (const id in state.nodes) {
      if (!prevState.nodes[id as AnyNodeId]) checkSlabContext(id)
    }

    if (changedRoomSupportLevels.size)
      for (const node of Object.values(state.nodes)) {
        if (node.type === 'wall' && changedRoomSupportLevels.has(resolveLevelId(node, state.nodes)))
          markDirty(node.id)
      }

    // Detect added nodes
    for (const [id, node] of Object.entries(state.nodes)) {
      if (!prevState.nodes[id as AnyNode['id']]) {
        const levelId = resolveLevelId(node, state.nodes)
        spatialGridManager.handleNodeCreated(node, levelId)

        // When a slab is added, mark overlapping items/walls dirty
        if (node.type === 'slab' && !bulkSlabs) {
          markNodesOverlappingSlab(node as SlabNode, state.nodes, markDirty)
          markCoveringDependentsBelow(levelId, state.nodes, markDirty)
        }

        // A site arriving with terrain already on it (scene load, paste,
        // imported elevation data) is the same event as a stroke: ground exists
        // where flat ground was assumed.
        if (node.type === 'site' && (node as SiteNode).terrain) {
          markTerrainSupportDependents(state.nodes, markDirty)
        }
      }
    }

    // Detect removed nodes
    for (const [id, node] of Object.entries(prevState.nodes)) {
      if (!state.nodes[id as AnyNode['id']]) {
        const levelId = resolveLevelId(node, prevState.nodes)
        spatialGridManager.handleNodeDeleted(id, node.type, levelId)

        // When a slab is removed, mark items/walls that were on it dirty (using current state)
        if (node.type === 'slab' && !bulkSlabs) {
          markNodesOverlappingSlab(node as SlabNode, state.nodes, markDirty, prevState.nodes)
          markCoveringDependentsBelow(levelId, state.nodes, markDirty)
        }

        // Deleting a sculpted site drops the ground back to the datum, so its
        // contents have to come down with it.
        if (node.type === 'site' && (node as SiteNode).terrain) {
          markTerrainSupportDependents(state.nodes, markDirty)
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
        }
        if (!bulkSlabs) {
          markSlabChangeDependents(
            prev as SlabNode,
            node as SlabNode,
            state.nodes,
            markDirty,
            prevState.nodes,
          )
        }
      } else if (node.type === 'level' && prev.type === 'level') {
        if (node.height !== prev.height) {
          markLevelHeightDependents(node as LevelNode, state.nodes, markDirty)
        }
      } else if (node.type === 'site' && prev.type === 'site') {
        // Object identity, not deep equality: the store is
        // immutable-by-convention, so a sculpt commit necessarily produces a new
        // `terrain` object and an unrelated site edit (polygon, name) keeps the
        // old one. The same reasoning `terrain-source`'s field cache is keyed on.
        if ((node as SiteNode).terrain !== (prev as SiteNode).terrain) {
          markTerrainSupportDependents(state.nodes, markDirty)
        }
      } else if (node.type === 'wall' && prev.type === 'wall') {
        if (
          node.start !== prev.start ||
          node.end !== prev.end ||
          node.curveOffset !== prev.curveOffset ||
          node.thickness !== prev.thickness ||
          node.justification !== prev.justification
        ) {
          // Rendered slab polygons adopt wall bands, so a wall reshape
          // must reach the manager to refresh its wall map and drop the
          // level's rendered-polygon cache.
          spatialGridManager.handleNodeUpdated(node, resolveLevelId(node, state.nodes))
        }
      }
    }

    // Unchanged slabs can lose an adopted wall band or a sibling seam. Their
    // stored polygons cannot identify objects standing on the former boundary.
    if (changedSlabContextLevels.size === 0) return
    const beforeContext = slabBoundaryContext(prevState.nodes, changedSlabContextLevels)
    const afterContext = slabBoundaryContext(state.nodes, changedSlabContextLevels)
    for (const context of afterContext.values()) {
      for (const slab of context.slabs) {
        const previous = prevState.nodes[slab.id]
        if (previous?.type !== 'slab') continue
        if (
          slab.parentId !== previous.parentId ||
          slab.polygon !== previous.polygon ||
          slab.elevation !== previous.elevation ||
          slab.holes !== previous.holes
        )
          continue
        const previousContext = beforeContext.get(resolveLevelId(previous, prevState.nodes))!
        const beforePolygon = cachedSlabPolygon(previous, previousContext)
        const afterPolygon = cachedSlabPolygon(slab, context)
        if (
          beforePolygon.length === afterPolygon.length &&
          beforePolygon.every((point, i) => arraysEqual(point, afterPolygon[i]!))
        )
          continue
        // Support only changed in the gained/lost bands, not across the slab interior.
        const changedBands = [
          ...subtractPolygonsFromPolygon(beforePolygon, [afterPolygon]),
          ...subtractPolygonsFromPolygon(afterPolygon, [beforePolygon]),
        ]
        for (const polygon of changedBands) {
          markNodesOverlappingPolygon(
            resolveLevelId(slab, state.nodes),
            polygon,
            state.nodes,
            markDirty,
            context.consumers,
          )
        }
      }
    }
  })

  // Live terrain is deliberately not written into `useScene` per dab: doing so
  // would encode the whole field, flood history, and wake every scene subscriber.
  // Reuse the committed-terrain dependency sweep against the transient field
  // instead. Dirty marks coalesce in their Set until the next frame, while an
  // `end` notification also restores every dependent after an abandoned stroke.
  const unsubscribeLiveTerrain = useLiveTerrain.subscribe(() => {
    markTerrainSupportDependents(store.getState().nodes, markDirty)
  })

  return () => {
    unsubscribeScene()
    unsubscribeLiveTerrain()
  }
}

/**
 * Bulk slab-change guard. A scene load, reload, paste or import changes tens to
 * thousands of slabs in one store write, and scanning every node twice per slab
 * is O(slabs × nodes): a 4,600-slab scene blocked the main thread for ~5 s on
 * every load. When at least this many slabs are added, removed or reshaped in
 * one write, `markAllSlabDependents` dirties every node any slab could affect,
 * once, and the per-slab scans are skipped. The marks are a superset of the
 * per-slab result — and `setScene` marks every node dirty right after `set()`
 * regardless — so load-time behaviour is unchanged; the saving is the scans.
 */
export const BULK_SLAB_CHANGE_THRESHOLD = 32

export function countBulkSlabChanges(
  nodes: Record<string, AnyNode>,
  prevNodes: Record<string, AnyNode>,
): number {
  let count = 0
  for (const id in nodes) {
    if (!Object.hasOwn(nodes, id)) continue
    const node = nodes[id]!
    if (node.type !== 'slab') continue
    const prev = prevNodes[id]
    if (
      prev?.type !== 'slab' ||
      (prev as SlabNode).polygon !== (node as SlabNode).polygon ||
      (prev as SlabNode).elevation !== (node as SlabNode).elevation ||
      (prev as SlabNode).holes !== (node as SlabNode).holes
    ) {
      count++
    }
  }
  for (const id in prevNodes) {
    if (prevNodes[id]!.type === 'slab' && !nodes[id]) count++
  }
  return count
}

/**
 * Every node a slab change can dirty, without looking at any slab: walls and
 * ceilings (overlap and covering-below rules), stairs (deck attachment) and
 * level-hosted floor-placed kinds (the generic re-elevation sweep).
 */
export function markAllSlabDependents(
  nodes: Record<string, AnyNode>,
  markDirty: (id: AnyNodeId) => void,
) {
  for (const id in nodes) {
    if (!Object.hasOwn(nodes, id)) continue
    const node = nodes[id]!
    if (node.type === 'wall' || node.type === 'ceiling' || node.type === 'stair') {
      markDirty(node.id)
      continue
    }
    const floorPlaced = nodeRegistry.get(node.type)?.capabilities?.floorPlaced
    if (!floorPlaced) continue
    if (floorPlaced.applies && !floorPlaced.applies(node)) continue
    const parentId = node.parentId as AnyNodeId | null
    const parent = parentId ? nodes[parentId] : null
    if (parent && parent.type !== 'level') continue
    markDirty(node.id)
  }
}

function arraysEqual(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b
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
 * Dirty every consumer of a slab's top or underside. Kept pure so committed
 * scene writes and live handle previews use the same dependency boundary.
 */
export function markSlabChangeDependents(
  previous: SlabNode,
  next: SlabNode,
  nodes: Record<string, AnyNode>,
  markDirty: (id: AnyNodeId) => void,
  previousNodes = nodes,
) {
  const supportChanged =
    next.parentId !== previous.parentId ||
    next.polygon !== previous.polygon ||
    next.elevation !== previous.elevation ||
    next.holes !== previous.holes

  if (supportChanged) {
    markNodesOverlappingSlab(previous, nodes, markDirty, previousNodes)
    markNodesOverlappingSlab(next, nodes, markDirty)
  }
  if (next.elevation !== previous.elevation) {
    markDeckAttachedStairs(next.id, nodes, markDirty)
  }
  if (
    supportChanged ||
    next.thickness !== previous.thickness ||
    next.recessed !== previous.recessed
  ) {
    const nextLevelId = resolveLevelId(next, nodes)
    markCoveringDependentsBelow(nextLevelId, nodes, markDirty)
    if (next.parentId !== previous.parentId) {
      const previousLevelId = resolveLevelId(previous, previousNodes)
      if (previousLevelId !== nextLevelId) {
        markCoveringDependentsBelow(previousLevelId, nodes, markDirty)
      }
    }
  }
}

/**
 * The sculpted ground moved: every node the terrain *supports* must re-elevate.
 *
 * The other rules in this file gate on a footprint overlapping the changed
 * surface. Terrain has no such gate — a stroke rewrites a field that spans the
 * whole lot, and the resolver samples it at each node's own XZ — so the sweep is
 * every floor-placed node on a storey at grade, plus every wall whose explicit
 * terrain infill samples that field. During a live stroke it fires per dab, but
 * dirty ids coalesce in a Set until the frame systems consume them; the scene
 * graph itself is still written only once on commit.
 *
 * Without this a sculpt silently desyncs the scene from its own ground. Nothing
 * re-runs `getFloorPlacedElevation`, so the React commit that rebinds a node
 * group's base Y leaves it there: a column that was resting on a hillside drops
 * to the datum and stays buried under the terrain it used to stand on.
 *
 * Gated on `isLevelAtSiteDatum` — the same predicate `terrainSupportLift` uses to
 * decide whether it drapes at all, so the two cannot disagree about which storey
 * is on the ground.
 */
const terrainPlateDependents = new WeakMap<object, Set<string>>()

export function markTerrainSupportDependents(
  nodes: Record<string, AnyNode>,
  markDirty: (id: AnyNodeId) => void,
) {
  const plates = Object.values(nodes).filter(
    (node): node is SlabNode =>
      node.type === 'slab' &&
      isFloorPlate(node) &&
      !node.recessed &&
      (node.elevation - node.thickness > 1e-4 || node.elevation < -1e-4),
  )
  const previous = terrainPlateDependents.get(nodes) ?? new Set<string>()
  const active = new Set<string>()
  for (const plate of plates) {
    if (
      plate.elevation < -1e-4 ||
      plate.polygon.some(([x, z], i) => {
        const [endX, endZ] = plate.polygon[(i + 1) % plate.polygon.length]!
        const count = Math.max(1, Math.ceil(Math.hypot(endX - x, endZ - z) / 0.25))
        for (let j = 0; j <= count; j++)
          if (
            plate.elevation - plate.thickness >
            levelBaseElevationAt(
              nodes,
              resolveLevelId(plate, nodes),
              x + ((endX - x) * j) / count,
              z + ((endZ - z) * j) / count,
            ) +
              1e-4
          )
            return true
        return false
      })
    )
      active.add(plate.id)
  }
  terrainPlateDependents.set(nodes, active)
  // Retain one sweep of former dependents when a dab closes their last ground gap.
  const affected = plates.filter((plate) => active.has(plate.id) || previous.has(plate.id))
  const gradeLevels = new Map<string, boolean>()
  const isGrade = (levelId: string) => {
    let cached = gradeLevels.get(levelId)
    if (cached === undefined) {
      cached = isLevelAtSiteDatum(nodes, levelId)
      gradeLevels.set(levelId, cached)
    }
    return cached
  }

  for (const node of Object.values(nodes)) {
    if (node.type === 'slab') {
      const level = nodes[resolveLevelId(node, nodes)]
      if (
        node.plateRole === 'base' &&
        node.foundation?.type === 'solid' &&
        (isGrade(resolveLevelId(node, nodes)) || (level?.type === 'level' && level.level === 0))
      ) {
        markDirty(node.id)
        continue
      }
      if (
        (node.fillToTerrain === true || (node.elevation > 0 && affected.includes(node))) &&
        isGrade(resolveLevelId(node, nodes))
      )
        markDirty(node.id)
      continue
    }

    if (node.type === 'wall') {
      if (
        node.supportSlabId !== GROUND_SUPPORT_ID &&
        node.fillToTerrain !== true &&
        !affected.some(
          (plate) => plate.parentId === node.parentId && wallOverlapsPolygon(node, plate.polygon),
        )
      )
        continue
      if (!isGrade(resolveLevelId(node, nodes))) continue
      markDirty(node.id)
      continue
    }

    const floorPlaced = nodeRegistry.get(node.type)?.capabilities?.floorPlaced
    if (!floorPlaced) {
      // A kind whose geometry builder resolved its own origin from the ground
      // (`ctx.levelBaseAt`) has that ground baked into its meshes, so it has to
      // rebuild even though nothing about the node changed. This is the
      // invalidation half of the builder seam: without it a fence keeps the
      // hillside it was built on and floats after the next stroke. Kinds that
      // are `floorPlaced` need no entry here — the sweep below already covers
      // them, through a mesh transform rather than a rebuild.
      if (isLevelBaseConsumer(node.type) && isGrade(resolveLevelId(node, nodes))) {
        markDirty(node.id)
      }
      continue
    }
    if (floorPlaced.applies && !floorPlaced.applies(node)) continue
    // Items hosted on a shelf or table inherit Y from the parent group; only
    // level-parented nodes read the ground. Mirrors the resolver's own gate.
    const parentId = node.parentId as AnyNodeId | null
    const parent = parentId ? nodes[parentId] : null
    if (parent && parent.type !== 'level') continue
    if (!isGrade(resolveLevelId(node, nodes))) continue
    markDirty(node.id)
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

function renderableSlabPolygon(slab: SlabNode, nodes: Record<string, AnyNode>) {
  const slabLevelId = resolveLevelId(slab, nodes)
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
  return getRenderableSlabPolygon(slab, { walls: levelWalls, siblingSlabs })
}

/**
 * Mark all floor items and walls that may be affected by a slab change as dirty.
 */
function markNodesOverlappingSlab(
  slab: SlabNode,
  nodes: Record<string, AnyNode>,
  markDirty: (id: AnyNodeId) => void,
  contextNodes = nodes,
) {
  if (slab.polygon.length < 3) return
  const slabLevelId = resolveLevelId(slab, contextNodes)
  const renderedPolygon = renderableSlabPolygon(slab, contextNodes)

  markNodesOverlappingPolygon(slabLevelId, renderedPolygon, nodes, markDirty)
}

function markNodesOverlappingPolygon(
  slabLevelId: string,
  renderedPolygon: [number, number][],
  nodes: Record<string, AnyNode>,
  markDirty: (id: AnyNodeId) => void,
  candidates: Iterable<AnyNode> = Object.values(nodes),
) {
  for (const node of candidates) {
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
            justification: wall.justification,
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

type SlabBoundaryContext = {
  walls: WallNode[]
  slabs: SlabNode[]
  consumers: AnyNode[]
  polygons: Map<string, [number, number][]>
}

function slabBoundaryContext(nodes: Record<string, AnyNode>, levels: Set<string>) {
  const contexts = new Map<string, SlabBoundaryContext>()
  for (const id in nodes) {
    if (!Object.hasOwn(nodes, id)) continue
    const node = nodes[id]!
    const floorPlaced = nodeRegistry.get(node.type)?.capabilities?.floorPlaced
    if (node.type !== 'wall' && node.type !== 'slab' && !floorPlaced) continue
    const levelId = resolveLevelId(node, nodes)
    if (!levels.has(levelId)) continue
    let context = contexts.get(levelId)
    if (!context) {
      context = { walls: [], slabs: [], consumers: [], polygons: new Map() }
      contexts.set(levelId, context)
    }
    if (node.type === 'wall') context.walls.push(node)
    if (node.type === 'slab') context.slabs.push(node)
    if (node.type === 'wall' || floorPlaced) context.consumers.push(node)
  }
  return contexts
}

function cachedSlabPolygon(slab: SlabNode, context: SlabBoundaryContext) {
  let polygon = context.polygons.get(slab.id)
  if (!polygon) {
    polygon = getRenderableSlabPolygon(slab, {
      walls: context.walls,
      siblingSlabs: context.slabs.filter((sibling) => sibling.id !== slab.id),
    })
    context.polygons.set(slab.id, polygon)
  }
  return polygon
}
