import {
  type AnyNode,
  type AnyNodeId,
  getEffectiveWallSurfaceMaterial,
  getWallSurfaceMaterialSignature,
  type WallNode,
} from '../../schema'
import type { CollectionId } from '../../schema/collections'
import type { SceneState } from '../use-scene'

type AnyContainerNode = AnyNode & { children: string[] }
type WallAttachmentUpdate = { id: AnyNodeId; data: Partial<AnyNode> }
type WallMergePlan = {
  primaryWallId: AnyNodeId
  secondaryWallId: AnyNodeId
  mergedStart: [number, number]
  mergedEnd: [number, number]
  mergedChildren: WallNode['children']
  attachmentUpdates: WallAttachmentUpdate[]
}

// Track pending RAF for updateNodesAction to prevent multiple queued callbacks
let pendingRafId: number | null = null
let pendingUpdates: Set<AnyNodeId> = new Set()

function pointsEqual(a: [number, number], b: [number, number], tolerance = 1e-6) {
  const dx = a[0] - b[0]
  const dz = a[1] - b[1]
  return dx * dx + dz * dz <= tolerance * tolerance
}

function wallLength(wall: Pick<WallNode, 'start' | 'end'>) {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

function getWallEndpointAtPoint(
  wall: Pick<WallNode, 'start' | 'end'>,
  point: [number, number],
): 'start' | 'end' | null {
  if (pointsEqual(wall.start, point)) return 'start'
  if (pointsEqual(wall.end, point)) return 'end'
  return null
}

function getWallFreeEndpoint(wall: Pick<WallNode, 'start' | 'end'>, sharedPoint: [number, number]) {
  return pointsEqual(wall.start, sharedPoint) ? wall.end : wall.start
}

function areWallStylesCompatible(a: WallNode, b: WallNode) {
  const aInterior = getWallSurfaceMaterialSignature(getEffectiveWallSurfaceMaterial(a, 'interior'))
  const bInterior = getWallSurfaceMaterialSignature(getEffectiveWallSurfaceMaterial(b, 'interior'))
  const aExterior = getWallSurfaceMaterialSignature(getEffectiveWallSurfaceMaterial(a, 'exterior'))
  const bExterior = getWallSurfaceMaterialSignature(getEffectiveWallSurfaceMaterial(b, 'exterior'))

  return (
    (a.parentId ?? null) === (b.parentId ?? null) &&
    Math.abs((a.curveOffset ?? 0) - (b.curveOffset ?? 0)) <= 1e-6 &&
    Math.abs((a.thickness ?? 0.2) - (b.thickness ?? 0.2)) <= 1e-6 &&
    Math.abs((a.height ?? 2.5) - (b.height ?? 2.5)) <= 1e-6 &&
    aInterior === bInterior &&
    aExterior === bExterior &&
    a.frontSide === b.frontSide &&
    a.backSide === b.backSide &&
    a.visible === b.visible
  )
}

function areWallsCollinearAcrossPoint(a: WallNode, b: WallNode, sharedPoint: [number, number]) {
  const freeA = getWallFreeEndpoint(a, sharedPoint)
  const freeB = getWallFreeEndpoint(b, sharedPoint)
  const ax = freeA[0] - sharedPoint[0]
  const az = freeA[1] - sharedPoint[1]
  const bx = freeB[0] - sharedPoint[0]
  const bz = freeB[1] - sharedPoint[1]
  const lenA = Math.hypot(ax, az)
  const lenB = Math.hypot(bx, bz)

  if (lenA < 1e-6 || lenB < 1e-6) return false

  const cross = (ax * bz - az * bx) / (lenA * lenB)
  const dot = (ax * bx + az * bz) / (lenA * lenB)
  return Math.abs(cross) <= 1e-4 && dot < -0.999
}

function resolveMergedWallEndpoints(
  primary: WallNode,
  secondary: WallNode,
  sharedPoint: [number, number],
): { start: [number, number]; end: [number, number] } {
  const primaryEndpoint = getWallEndpointAtPoint(primary, sharedPoint)
  const secondaryEndpoint = getWallEndpointAtPoint(secondary, sharedPoint)

  if (primaryEndpoint === 'end' && secondaryEndpoint === 'start') {
    return { start: primary.start, end: secondary.end }
  }
  if (primaryEndpoint === 'start' && secondaryEndpoint === 'end') {
    return { start: secondary.start, end: primary.end }
  }
  if (primaryEndpoint === 'start' && secondaryEndpoint === 'start') {
    return { start: primary.end, end: secondary.end }
  }

  return { start: primary.start, end: secondary.start }
}

function buildMergedWallAttachmentUpdates(
  primary: WallNode,
  secondary: WallNode,
  mergedWallId: AnyNodeId,
  mergedStart: [number, number],
  mergedEnd: [number, number],
  nodes: Record<AnyNodeId, AnyNode>,
): WallAttachmentUpdate[] {
  const mergedLength = Math.max(
    Math.hypot(mergedEnd[0] - mergedStart[0], mergedEnd[1] - mergedStart[1]),
    1e-6,
  )
  const tangentX = (mergedEnd[0] - mergedStart[0]) / mergedLength
  const tangentZ = (mergedEnd[1] - mergedStart[1]) / mergedLength
  const updates: WallAttachmentUpdate[] = []

  const wallChildren = [...(primary.children ?? []), ...(secondary.children ?? [])] as AnyNodeId[]
  for (const childId of wallChildren) {
    const child = nodes[childId]
    if (!child || !('position' in child) || !Array.isArray(child.position)) {
      continue
    }

    const sourceWall = child.parentId === secondary.id ? secondary : primary
    const sourceLength = Math.max(wallLength(sourceWall), 1e-6)
    const localX = typeof child.position[0] === 'number' ? child.position[0] : 0
    const worldX =
      sourceWall.start[0] + ((sourceWall.end[0] - sourceWall.start[0]) * localX) / sourceLength
    const worldZ =
      sourceWall.start[1] + ((sourceWall.end[1] - sourceWall.start[1]) * localX) / sourceLength
    const nextLocalX = Math.max(
      0,
      Math.min(
        mergedLength,
        (worldX - mergedStart[0]) * tangentX + (worldZ - mergedStart[1]) * tangentZ,
      ),
    )

    updates.push({
      id: childId,
      data: {
        parentId: mergedWallId,
        wallId: mergedWallId,
        position: [nextLocalX, child.position[1], child.position[2]] as typeof child.position,
        ...('wallT' in child ? { wallT: nextLocalX / mergedLength } : {}),
      } as Partial<AnyNode>,
    })
  }

  return updates
}

function buildWallMergePlans(
  nodes: Record<AnyNodeId, AnyNode>,
  idsToDelete: AnyNodeId[],
): WallMergePlan[] {
  const deletedWalls = idsToDelete
    .map((id) => nodes[id])
    .filter((node): node is WallNode => node?.type === 'wall')
  const skippedWallIds = new Set(idsToDelete)
  const usedWallIds = new Set<AnyNodeId>()
  const mergePlans: WallMergePlan[] = []

  for (const deletedWall of deletedWalls) {
    const junctions: Array<[number, number]> = [deletedWall.start, deletedWall.end]

    for (const junction of junctions) {
      const candidates = Object.values(nodes).filter((node): node is WallNode => {
        if (node?.type !== 'wall') return false
        if (skippedWallIds.has(node.id) || usedWallIds.has(node.id)) return false
        if ((node.parentId ?? null) !== (deletedWall.parentId ?? null)) return false
        return pointsEqual(node.start, junction) || pointsEqual(node.end, junction)
      })

      if (candidates.length !== 2) {
        continue
      }

      const sortedCandidates = [...candidates].sort((a, b) => {
        const attachmentDiff = (b.children?.length ?? 0) - (a.children?.length ?? 0)
        if (attachmentDiff !== 0) {
          return attachmentDiff
        }
        return a.id.localeCompare(b.id)
      })
      const [primary, secondary] = sortedCandidates
      if (
        !primary ||
        !secondary ||
        !areWallStylesCompatible(primary, secondary) ||
        !areWallsCollinearAcrossPoint(primary, secondary, junction)
      ) {
        continue
      }

      const { start, end } = resolveMergedWallEndpoints(primary, secondary, junction)
      const mergedChildren = Array.from(
        new Set([...(primary.children ?? []), ...(secondary.children ?? [])]),
      ) as WallNode['children']
      const attachmentUpdates = buildMergedWallAttachmentUpdates(
        primary,
        secondary,
        primary.id,
        start,
        end,
        nodes,
      )

      mergePlans.push({
        primaryWallId: primary.id,
        secondaryWallId: secondary.id,
        mergedStart: start,
        mergedEnd: end,
        mergedChildren,
        attachmentUpdates,
      })
      usedWallIds.add(primary.id)
      usedWallIds.add(secondary.id)
    }
  }

  return mergePlans
}

export const createNodesAction = (
  set: (fn: (state: SceneState) => Partial<SceneState>) => void,
  get: () => SceneState,
  ops: { node: AnyNode; parentId?: AnyNodeId }[],
) => {
  if (get().readOnly) return
  set((state) => {
    const nextNodes = { ...state.nodes }
    const nextRootIds = [...state.rootNodeIds]

    for (const { node, parentId } of ops) {
      // 1. Assign parentId to the child (Safe because BaseNode has parentId)
      const newNode = {
        ...node,
        parentId: parentId ?? null,
      }

      nextNodes[newNode.id] = newNode

      // 2. Update the Parent's children list
      if (parentId && nextNodes[parentId]) {
        const parent = nextNodes[parentId]

        // Type Guard: Check if the parent node is a container that supports children
        if ('children' in parent && Array.isArray(parent.children)) {
          nextNodes[parentId] = {
            ...parent,
            // Use Set to prevent duplicate IDs if createNode is called twice
            children: Array.from(new Set([...parent.children, newNode.id])) as any, // We don't verify child types here
          }
        }
      } else if (!parentId) {
        // 3. Handle Root nodes
        if (!nextRootIds.includes(newNode.id)) {
          nextRootIds.push(newNode.id)
        }
      }
    }

    return { nodes: nextNodes, rootNodeIds: nextRootIds }
  })

  // 4. System Sync
  ops.forEach(({ node, parentId }) => {
    get().markDirty(node.id)
    if (parentId) get().markDirty(parentId)
  })
}

export const updateNodesAction = (
  set: (fn: (state: SceneState) => Partial<SceneState>) => void,
  get: () => SceneState,
  updates: { id: AnyNodeId; data: Partial<AnyNode> }[],
) => {
  if (get().readOnly) return
  const parentsToUpdate = new Set<AnyNodeId>()

  set((state) => {
    const nextNodes = { ...state.nodes }

    for (const { id, data } of updates) {
      const currentNode = nextNodes[id]
      if (!currentNode) continue

      // Handle Reparenting Logic
      if (data.parentId !== undefined && data.parentId !== currentNode.parentId) {
        // 1. Remove from old parent
        const oldParentId = currentNode.parentId as AnyNodeId | null
        if (oldParentId && nextNodes[oldParentId]) {
          const oldParent = nextNodes[oldParentId] as AnyContainerNode
          nextNodes[oldParent.id] = {
            ...oldParent,
            children: oldParent.children.filter((childId) => childId !== id),
          } as AnyNode
          parentsToUpdate.add(oldParent.id)
        }

        // 2. Add to new parent
        const newParentId = data.parentId as AnyNodeId | null
        if (newParentId && nextNodes[newParentId]) {
          const newParent = nextNodes[newParentId] as AnyContainerNode
          nextNodes[newParent.id] = {
            ...newParent,
            children: Array.from(new Set([...newParent.children, id])),
          } as AnyNode
          parentsToUpdate.add(newParent.id)
        }
      }

      // Apply the update
      nextNodes[id] = { ...nextNodes[id], ...data } as AnyNode
    }

    return { nodes: nextNodes }
  })

  // Batch dirty-marking into a single RAF to avoid redundant callbacks during rapid updates
  for (const u of updates) {
    pendingUpdates.add(u.id)
  }
  for (const pId of parentsToUpdate) {
    pendingUpdates.add(pId)
  }

  if (pendingRafId !== null) {
    cancelAnimationFrame(pendingRafId)
  }

  pendingRafId = requestAnimationFrame(() => {
    pendingUpdates.forEach((id) => {
      get().markDirty(id)
    })
    pendingUpdates.clear()
    pendingRafId = null
  })
}

export const deleteNodesAction = (
  set: (fn: (state: SceneState) => Partial<SceneState>) => void,
  get: () => SceneState,
  ids: AnyNodeId[],
) => {
  if (get().readOnly) return
  const parentsToMarkDirty = new Set<AnyNodeId>()
  const nodesToMarkDirty = new Set<AnyNodeId>()
  const mergePlans = buildWallMergePlans(get().nodes, ids)

  set((state) => {
    const nextNodes = { ...state.nodes }
    const nextCollections = { ...state.collections }
    let nextRootIds = [...state.rootNodeIds]

    // Collect all ids to delete (the requested ids + all their descendants) before
    // mutating anything, so the recursive walk reads consistent state.
    const allIds = new Set<AnyNodeId>()
    const collect = (id: AnyNodeId) => {
      if (allIds.has(id)) return
      allIds.add(id)
      const node = nextNodes[id]
      if (node && 'children' in node) {
        for (const cid of node.children as AnyNodeId[]) collect(cid)
      }
    }
    for (const id of ids) collect(id)
    for (const plan of mergePlans) {
      allIds.add(plan.secondaryWallId)
    }

    for (const plan of mergePlans) {
      const primaryWall = nextNodes[plan.primaryWallId]
      if (!(primaryWall && primaryWall.type === 'wall') || allIds.has(plan.primaryWallId)) {
        continue
      }

      nextNodes[plan.primaryWallId] = {
        ...primaryWall,
        start: plan.mergedStart,
        end: plan.mergedEnd,
        children: plan.mergedChildren,
      }
      nodesToMarkDirty.add(plan.primaryWallId)

      for (const update of plan.attachmentUpdates) {
        if (allIds.has(update.id)) continue
        const child = nextNodes[update.id]
        if (!child) continue
        nextNodes[update.id] = { ...child, ...update.data } as AnyNode
        nodesToMarkDirty.add(update.id)
      }
    }

    for (const id of allIds) {
      const node = nextNodes[id]
      if (!node) continue

      // 1. Remove reference from parent — only if the parent itself is NOT also being deleted
      const parentId = node.parentId as AnyNodeId | null
      if (parentId && nextNodes[parentId] && !allIds.has(parentId)) {
        const parent = nextNodes[parentId] as AnyContainerNode
        if (parent.children) {
          nextNodes[parent.id] = {
            ...parent,
            children: parent.children.filter((cid) => cid !== id),
          } as AnyNode
          parentsToMarkDirty.add(parent.id)
        }
      }

      // 2. Remove from root list
      nextRootIds = nextRootIds.filter((rid) => rid !== id)

      // 3. Remove from any collections it belongs to
      if ('collectionIds' in node && node.collectionIds) {
        for (const cid of node.collectionIds as CollectionId[]) {
          const col = nextCollections[cid]
          if (col) {
            nextCollections[cid] = { ...col, nodeIds: col.nodeIds.filter((nid) => nid !== id) }
          }
        }
      }

      // 4. Delete the node itself
      delete nextNodes[id]
    }

    return { nodes: nextNodes, rootNodeIds: nextRootIds, collections: nextCollections }
  })

  // Mark affected nodes dirty: parents of deleted nodes and their remaining children
  // (e.g. deleting a slab affects sibling walls via level elevation changes)
  parentsToMarkDirty.forEach((parentId) => {
    get().markDirty(parentId)
    const parent = get().nodes[parentId]
    if (parent && 'children' in parent && Array.isArray(parent.children)) {
      for (const childId of parent.children) {
        get().markDirty(childId as AnyNodeId)
      }
    }
  })
  nodesToMarkDirty.forEach((id) => {
    get().markDirty(id)
  })
}
