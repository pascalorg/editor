import { GROUND_SUPPORT_ID } from '../hooks/spatial-grid/floor-placed-elevation'
import { floorFootprintCreatorId, mintFloorFootprintKey } from '../lib/floor-footprint-key'
import { keyedFloorPlateId } from '../lib/floor-plate-id'
import {
  remapConstructionDimensionReferences,
  remapMeasurementReferences,
} from '../lib/measurement-geometry'
import { remapSurfaceSupportReferences } from '../lib/surface-support-references'
import type { AnyNode, AnyNodeId } from '../schema'
import { generateId } from '../schema/base'
import type { Collection, CollectionId } from '../schema/collections'
import type { SceneMaterial, SceneMaterialId } from '../schema/scene-material'

export type SceneGraph = {
  nodes: Record<AnyNodeId, AnyNode>
  rootNodeIds: AnyNodeId[]
  collections?: Record<CollectionId, Collection>
  materials?: Record<SceneMaterialId, SceneMaterial>
  installedPlugins?: string[]
}

/**
 * Extracts the type prefix from a node ID (e.g., "wall_abc123" -> "wall")
 */
function extractIdPrefix(id: string): string {
  const underscoreIndex = id.indexOf('_')
  return underscoreIndex === -1 ? 'node' : id.slice(0, underscoreIndex)
}

function remapFloorOpeningReferences(node: AnyNode, ids: Map<string, string>) {
  if ('hostZoneId' in node && typeof node.hostZoneId === 'string')
    node.hostZoneId = ids.get(node.hostZoneId) ?? node.hostZoneId
  if (node.type === 'floor-opening') {
    if (node.ownerId) {
      node.ownerId = ids.get(node.ownerId)
      if (!node.ownerId && node.source === 'plugin:pool') node.source = 'manual'
    }
    if (node.legacyPlateCuts)
      node.legacyPlateCuts = Object.fromEntries(
        Object.entries(node.legacyPlateCuts).flatMap(([id, cuts]) =>
          ids.has(id) ? [[ids.get(id)!, cuts]] : [],
        ),
      )
  }
  if ((node.type === 'slab' || node.type === 'ceiling') && node.holeMetadata)
    node.holeMetadata = node.holeMetadata.map((entry) =>
      entry.openingId && ids.has(entry.openingId)
        ? { ...entry, openingId: ids.get(entry.openingId) }
        : entry,
    )
}

/**
 * Rewrites every other node reference: node ids live in many fields that are
 * data rather than schema (hole metadata stair ids, stair level ids, room
 * boundaries and plates, plugin and metadata links, id-keyed maps), so a whole
 * graph clone swaps any string or key that is exactly a cloned node id.
 */
function remapNodeIdStrings(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value === 'string') return ids.get(value) ?? value
  if (Array.isArray(value)) return value.map((entry) => remapNodeIdStrings(entry, ids))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        ids.get(key) ?? key,
        remapNodeIdStrings(entry, ids),
      ]),
    )
  return value
}

// Id lists the structure kernel stores sorted; a remap must keep them sorted
// or the first load re-sorts them and the clone saves a change.
const SORTED_ID_LISTS = ['boundaryWallIds', 'boundarySeparatorIds', 'zoneIds', 'openingIds']

export function remapNodeReferences(node: AnyNode, ids: Map<string, string>): AnyNode {
  // Provenance source ids are history, not links: clones carry them verbatim (D5).
  const { provenance, ...links } = node as AnyNode & { provenance?: unknown }
  const remapped = remapNodeIdStrings(links, ids) as Record<string, unknown>
  if (provenance !== undefined) remapped.provenance = provenance
  for (const key of SORTED_ID_LISTS) {
    const before = (node as Record<string, unknown>)[key]
    const after = remapped[key]
    if (
      Array.isArray(before) &&
      Array.isArray(after) &&
      before.every((id, i) => i === 0 || String(before[i - 1]) <= String(id))
    )
      remapped[key] = [...after].sort()
  }
  return remapped as AnyNode
}

function copiedFloorKeys(nodes: Record<AnyNodeId, AnyNode>, ids: Map<string, string>) {
  const keys = new Map<string, string>()
  const identity = (level: string, key: string) => JSON.stringify([level, key])
  for (const node of Object.values(nodes)) {
    if (node.type !== 'zone' || !node.floor?.footprint || !node.parentId || !ids.has(node.parentId))
      continue
    const old = identity(node.parentId, node.floor.footprint)
    if (!keys.has(old)) {
      const creatorId = floorFootprintCreatorId(node.floor.footprint)
      keys.set(old, mintFloorFootprintKey(creatorId ? ids.get(creatorId) : undefined))
    }
  }
  const plates = Object.values(nodes).filter(
    (node) => node.type === 'slab' && node.plateRole === 'base',
  )
  for (const plate of plates) {
    if (plate.type !== 'slab' || !plate.parentId || !ids.has(plate.id)) continue
    const room = (plate.zoneIds ?? [])
      .map((id) => nodes[id as AnyNodeId])
      .find((node) => node?.type === 'zone' && node.floor?.footprint)
    if (room?.type !== 'zone' || !room.floor?.footprint) continue
    const key = keys.get(identity(plate.parentId, room.floor.footprint))
    if (!key) continue
    for (let component = 0; component <= plates.length; component++) {
      if (plate.id !== keyedFloorPlateId(plate.parentId, room.floor.footprint, component)) continue
      ids.set(plate.id, keyedFloorPlateId(ids.get(plate.parentId)!, key, component))
      break
    }
  }
  return (source: AnyNode, copy: AnyNode) => {
    if (
      source.type !== 'zone' ||
      copy.type !== 'zone' ||
      !source.parentId ||
      !source.floor?.footprint
    )
      return
    const key = keys.get(identity(source.parentId, source.floor.footprint))
    if (key) copy.floor = { ...copy.floor, footprint: key }
  }
}

/**
 * Deep clones a scene graph with all node IDs regenerated while preserving
 * parent-child relationships and other internal references.
 *
 * The hand-written remaps here and in `cloneLevelSubtree` are inventoried in
 * `contracts/reference-inventory.ts`, which records the references they miss;
 * `contracts/fidelity.test.ts` fails when either drifts from the inventory.
 * P-03 replaces both passes with the one extractor over `capabilities.refs`.
 *
 * This is useful for:
 * - Duplicating a project (host app creates a new project record, then loads the cloned scene)
 * - Copying nodes between different projects
 * - Multi-scene in-memory scenarios
 */
export function cloneSceneGraph(sceneGraph: SceneGraph): SceneGraph {
  const { nodes, rootNodeIds, collections, materials, installedPlugins } = sceneGraph

  // Build ID mapping: old ID -> new ID
  const idMap = new Map<string, string>()

  // Pass 1: Generate new IDs for all nodes
  for (const nodeId of Object.keys(nodes)) {
    const prefix = extractIdPrefix(nodeId)
    idMap.set(nodeId, generateId(prefix))
  }

  const copyFloor = copiedFloorKeys(nodes, idMap)

  // Pass 2: Deep clone nodes with remapped references
  const clonedNodes = {} as Record<AnyNodeId, AnyNode>

  for (const [oldId, node] of Object.entries(nodes)) {
    const newId = idMap.get(oldId)! as AnyNodeId
    let clonedNode = structuredClone({ ...node, id: newId }) as AnyNode

    // Remap parentId
    if (clonedNode.parentId && typeof clonedNode.parentId === 'string') {
      clonedNode.parentId = (idMap.get(clonedNode.parentId) ?? null) as AnyNodeId | null
    }

    // Remap children array (buildings, levels, walls, items, etc.)
    // Children can be either string IDs or embedded node objects (with an `id` property).
    // Normalize both forms to remapped string IDs.
    if ('children' in clonedNode && Array.isArray(clonedNode.children)) {
      ;(clonedNode as Record<string, unknown>).children = (clonedNode.children as unknown[])
        .map((child) => {
          if (typeof child === 'string') return idMap.get(child)
          if (
            child &&
            typeof child === 'object' &&
            'id' in child &&
            typeof (child as any).id === 'string'
          ) {
            return idMap.get((child as any).id)
          }
          return undefined
        })
        .filter((id): id is string => id !== undefined)
    }

    // Remap wallId (items/doors/windows attached to walls)
    if ('wallId' in clonedNode && typeof clonedNode.wallId === 'string') {
      ;(clonedNode as Record<string, unknown>).wallId = idMap.get(clonedNode.wallId) as
        | string
        | undefined
    }

    // Remap roofSegmentId (doors/windows/items hosted on roof wall faces)
    if ('roofSegmentId' in clonedNode && typeof clonedNode.roofSegmentId === 'string') {
      ;(clonedNode as Record<string, unknown>).roofSegmentId = idMap.get(
        clonedNode.roofSegmentId,
      ) as string | undefined
    }

    if ('hostRoofId' in clonedNode && typeof clonedNode.hostRoofId === 'string') {
      ;(clonedNode as Record<string, unknown>).hostRoofId = idMap.get(clonedNode.hostRoofId) as
        | string
        | undefined
    }

    if ('hostRoofSegmentId' in clonedNode && typeof clonedNode.hostRoofSegmentId === 'string') {
      ;(clonedNode as Record<string, unknown>).hostRoofSegmentId = idMap.get(
        clonedNode.hostRoofSegmentId,
      ) as string | undefined
    }

    if (clonedNode.type === 'roof' && clonedNode.support?.kind === 'roof') {
      clonedNode.support.roofSegmentId = (idMap.get(clonedNode.support.roofSegmentId) ??
        clonedNode.support.roofSegmentId) as typeof clonedNode.support.roofSegmentId
    }

    // Remap supportSlabId (persisted slab-support hosts). The 'ground'
    // sentinel is not a node id — keep it as-is.
    if (
      'supportSlabId' in clonedNode &&
      typeof clonedNode.supportSlabId === 'string' &&
      clonedNode.supportSlabId !== GROUND_SUPPORT_ID
    ) {
      ;(clonedNode as Record<string, unknown>).supportSlabId = idMap.get(
        clonedNode.supportSlabId,
      ) as string | undefined
    }

    if (clonedNode.type === 'unit') {
      clonedNode.members = clonedNode.members.flatMap((id) => {
        const remapped = idMap.get(id)
        return remapped ? [remapped as typeof id] : []
      })
    }

    if ('deckSlabId' in clonedNode && typeof clonedNode.deckSlabId === 'string') {
      ;(clonedNode as Record<string, unknown>).deckSlabId = idMap.get(clonedNode.deckSlabId) as
        | string
        | undefined
    }
    remapFloorOpeningReferences(clonedNode, idMap)

    if (clonedNode.type === 'measurement') {
      clonedNode.measurement = remapMeasurementReferences(clonedNode.measurement, idMap)
    }
    if (clonedNode.type === 'construction-dimension') {
      clonedNode = remapConstructionDimensionReferences(clonedNode, idMap)
    }
    copyFloor(node, clonedNode)
    clonedNodes[newId] = remapNodeReferences(clonedNode, idMap)
  }

  // Remap root node IDs
  const clonedRootNodeIds = rootNodeIds
    .map((id) => idMap.get(id))
    .filter((id): id is string => id !== undefined) as AnyNodeId[]

  // Clone and remap collections if present
  const collectionIdMap = new Map<string, CollectionId>()
  let clonedCollections: Record<CollectionId, Collection> | undefined
  if (collections) {
    clonedCollections = {} as Record<CollectionId, Collection>

    for (const collectionId of Object.keys(collections)) {
      collectionIdMap.set(collectionId, generateId('collection'))
    }

    for (const [oldCollectionId, collection] of Object.entries(collections)) {
      const newCollectionId = collectionIdMap.get(oldCollectionId)!
      clonedCollections[newCollectionId] = {
        ...collection,
        id: newCollectionId,
        nodeIds: collection.nodeIds
          .map((nodeId) => idMap.get(nodeId))
          .filter((id): id is string => id !== undefined) as AnyNodeId[],
        controlNodeId: collection.controlNodeId
          ? (idMap.get(collection.controlNodeId) as AnyNodeId | undefined)
          : undefined,
      }
    }
  }

  for (const node of Object.values(clonedNodes)) {
    if ('collectionIds' in node && node.collectionIds)
      node.collectionIds = node.collectionIds
        .map((id) => collectionIdMap.get(id))
        .filter((id): id is CollectionId => id !== undefined)
  }

  return {
    nodes: clonedNodes,
    rootNodeIds: clonedRootNodeIds,
    ...(clonedCollections && { collections: clonedCollections }),
    // Material ids are deliberately *not* remapped. Nodes point at these
    // through `slots` values shaped `scene:mat_…` — opaque strings that the
    // node remapping above copies verbatim, since `idMap` only covers node
    // ids. Minting fresh material ids here would orphan every one of those
    // refs and the clone would render with default materials.
    ...(materials && { materials: structuredClone(materials) }),
    ...(installedPlugins && { installedPlugins: [...installedPlugins] }),
  }
}

/**
 * Deep clones a level node and all its descendants with fresh IDs.
 * All internal references (parentId, children, wallId) are remapped to the new IDs.
 * The cloned level node's parentId is preserved (building ID) — not remapped.
 *
 * Unlike `cloneSceneGraph` (which operates on serialized data), this function works
 * on live runtime nodes that may have non-serializable properties (Three.js objects,
 * etc.). It uses JSON roundtrip to safely strip them.
 *
 * @returns clonedNodes - flat array of all cloned nodes (level + descendants)
 * @returns newLevelId - the ID of the cloned level node
 * @returns idMap - old ID → new ID mapping
 */
export function cloneLevelSubtree(
  nodes: Record<AnyNodeId, AnyNode>,
  levelId: AnyNodeId,
): { clonedNodes: AnyNode[]; newLevelId: AnyNodeId; idMap: Map<string, string> } {
  const levelNode = nodes[levelId]
  if (levelNode?.type !== 'level') {
    throw new Error(`Node "${levelId}" is not a level`)
  }

  // Recursively collect the level node + all descendants via children arrays
  const subtreeIds = new Set<AnyNodeId>()
  const collect = (id: AnyNodeId) => {
    if (subtreeIds.has(id)) return
    const node = nodes[id]
    if (!node) return
    subtreeIds.add(id)
    if ('children' in node && Array.isArray(node.children)) {
      for (const childId of node.children as AnyNodeId[]) {
        collect(childId)
      }
    }
  }
  collect(levelId)

  // Build ID mapping: old → new
  const idMap = new Map<string, string>()
  for (const oldId of subtreeIds) {
    const prefix = extractIdPrefix(oldId)
    idMap.set(oldId, generateId(prefix))
  }

  const copyFloor = copiedFloorKeys(nodes, idMap)
  const newLevelId = idMap.get(levelId)! as AnyNodeId

  // Clone each node with remapped references.
  // Use JSON roundtrip instead of structuredClone because live runtime nodes may
  // carry non-serializable properties (Three.js Object3D refs, functions, etc.)
  // that structuredClone would throw on.
  const clonedNodes: AnyNode[] = []
  for (const oldId of subtreeIds) {
    const node = nodes[oldId]
    if (!node) continue

    const newId = idMap.get(oldId)! as AnyNodeId

    // JSON roundtrip: safely strips functions, Object3D, circular refs, etc.
    let cloned = JSON.parse(JSON.stringify(node)) as AnyNode
    ;(cloned as Record<string, unknown>).id = newId

    // Remap parentId — but only for descendants, not the level node itself
    // (the level's parentId points to the building, which is outside the subtree)
    if (oldId !== levelId && cloned.parentId && typeof cloned.parentId === 'string') {
      cloned.parentId = (idMap.get(cloned.parentId) ?? cloned.parentId) as AnyNodeId | null
    }

    // Remap children array
    if ('children' in cloned && Array.isArray(cloned.children)) {
      ;(cloned as Record<string, unknown>).children = (cloned.children as unknown[])
        .map((child) => {
          if (typeof child === 'string') return idMap.get(child) ?? child
          if (
            child &&
            typeof child === 'object' &&
            'id' in child &&
            typeof (child as any).id === 'string'
          ) {
            return idMap.get((child as any).id) ?? (child as any).id
          }
          return child
        })
        .filter((id): id is string => typeof id === 'string')
    }

    // Remap wallId (doors/windows attached to walls)
    if ('wallId' in cloned && typeof cloned.wallId === 'string') {
      ;(cloned as Record<string, unknown>).wallId = idMap.get(cloned.wallId) ?? cloned.wallId
    }

    // Remap roofSegmentId (doors/windows/items hosted on roof wall faces)
    if ('roofSegmentId' in cloned && typeof cloned.roofSegmentId === 'string') {
      ;(cloned as Record<string, unknown>).roofSegmentId =
        idMap.get(cloned.roofSegmentId) ?? cloned.roofSegmentId
    }

    if ('hostRoofId' in cloned && typeof cloned.hostRoofId === 'string') {
      ;(cloned as Record<string, unknown>).hostRoofId =
        idMap.get(cloned.hostRoofId) ?? cloned.hostRoofId
    }

    if ('hostRoofSegmentId' in cloned && typeof cloned.hostRoofSegmentId === 'string') {
      ;(cloned as Record<string, unknown>).hostRoofSegmentId =
        idMap.get(cloned.hostRoofSegmentId) ?? cloned.hostRoofSegmentId
    }

    if (cloned.type === 'roof' && cloned.support?.kind === 'roof') {
      cloned.support.roofSegmentId = (idMap.get(cloned.support.roofSegmentId) ??
        cloned.support.roofSegmentId) as typeof cloned.support.roofSegmentId
    }

    // Remap supportSlabId when the host slab is inside the cloned subtree;
    // preserve it otherwise (like wallId, the reference may point outside).
    if ('supportSlabId' in cloned && typeof cloned.supportSlabId === 'string') {
      ;(cloned as Record<string, unknown>).supportSlabId =
        idMap.get(cloned.supportSlabId) ?? cloned.supportSlabId
    }

    if ('deckSlabId' in cloned && typeof cloned.deckSlabId === 'string') {
      ;(cloned as Record<string, unknown>).deckSlabId =
        idMap.get(cloned.deckSlabId) ?? cloned.deckSlabId
    }
    remapSurfaceSupportReferences(cloned, idMap)
    remapFloorOpeningReferences(cloned, idMap)

    // A copied plate or ceiling stands for the copied rooms, so the guard
    // accepts it as derived and the reconciler adopts it on the new level.
    if (cloned.type === 'slab' && cloned.zoneIds)
      cloned.zoneIds = cloned.zoneIds.map((id) => idMap.get(id) ?? id).sort()
    if (cloned.type === 'ceiling' && cloned.zoneId)
      cloned.zoneId = idMap.get(cloned.zoneId) ?? cloned.zoneId

    if (cloned.type === 'measurement') {
      cloned.measurement = remapMeasurementReferences(cloned.measurement, idMap)
    }
    if (cloned.type === 'construction-dimension') {
      cloned = remapConstructionDimensionReferences(cloned, idMap)
    }
    copyFloor(node, cloned)
    clonedNodes.push(cloned)
  }

  return { clonedNodes, newLevelId, idMap }
}

export type ForkSceneGraphOptions = {
  preserveScans?: boolean
}

/**
 * Forks a scene graph for use as a new project: clones with new IDs and, by
 * default, strips scan and guide nodes since they contain user-uploaded imagery.
 */
export function forkSceneGraph(
  sceneGraph: SceneGraph,
  options: ForkSceneGraphOptions = {},
): SceneGraph {
  if (options.preserveScans) {
    return cloneSceneGraph(sceneGraph)
  }

  const { nodes, rootNodeIds, collections, materials, installedPlugins } = sceneGraph

  // First, identify scan and guide node IDs to exclude (user-uploaded imagery)
  const excludedNodeIds = new Set<string>()
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (node.type === 'scan' || node.type === 'guide') {
      excludedNodeIds.add(nodeId)
    }
  }

  // Build a filtered scene graph without scan nodes
  const filteredNodes = {} as Record<AnyNodeId, AnyNode>
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (excludedNodeIds.has(nodeId)) continue

    const clonedNode = structuredClone(node) as AnyNode

    // Remove scan children from any parent that references them.
    // Children can be string IDs or embedded node objects.
    if ('children' in clonedNode && Array.isArray(clonedNode.children)) {
      ;(clonedNode as Record<string, unknown>).children = (clonedNode.children as unknown[]).filter(
        (child) => {
          const childId =
            typeof child === 'string'
              ? child
              : child && typeof child === 'object' && 'id' in child
                ? (child as any).id
                : null
          return childId ? !excludedNodeIds.has(childId) : true
        },
      )
    }

    filteredNodes[nodeId as AnyNodeId] = clonedNode
  }

  const filteredRootNodeIds = rootNodeIds.filter((id) => !excludedNodeIds.has(id))

  // Filter collections to remove references to scan nodes
  let filteredCollections: Record<CollectionId, Collection> | undefined
  if (collections) {
    filteredCollections = {} as Record<CollectionId, Collection>
    for (const [collectionId, collection] of Object.entries(collections)) {
      const filteredNodeIds = collection.nodeIds.filter((id) => !excludedNodeIds.has(id))
      if (filteredNodeIds.length > 0) {
        filteredCollections[collectionId as CollectionId] = {
          ...collection,
          nodeIds: filteredNodeIds as AnyNodeId[],
          controlNodeId:
            collection.controlNodeId && excludedNodeIds.has(collection.controlNodeId)
              ? undefined
              : collection.controlNodeId,
        }
      }
    }
  }

  // Now clone the filtered graph with new IDs
  return cloneSceneGraph({
    nodes: filteredNodes,
    rootNodeIds: filteredRootNodeIds,
    ...(filteredCollections && { collections: filteredCollections }),
    // Kept whole rather than filtered to the surviving nodes: a palette entry
    // is authored content in its own right, and dropping the scan node that
    // happened to be its only user would silently delete a material the fork's
    // owner can still pick from the palette.
    ...(materials && { materials }),
    ...(installedPlugins && { installedPlugins }),
  })
}
