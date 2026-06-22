import {
  type AnyNodeId,
  DEFAULT_WALL_HEIGHT,
  getMaterialPresetByRef,
  parseMaterialRef,
  resolveMaterial,
  type SceneMaterialId,
  useScene,
  type WallMoveBridgePlan,
  type WallNode,
  type WallPlanPoint,
  WallNode as WallSchema,
} from '@pascal-app/core'
import { isSegmentLongEnough } from '@pascal-app/editor'

/**
 * Pure helpers shared by the 3D `MoveWallTool` and the 2D
 * `wallFloorplanMoveTarget`. Lives in `packages/nodes` because the
 * bridge / ghost helpers depend on `WallSchema.parse` and material
 * preset resolution; kept React-free so both call sites can import
 * cleanly.
 */

const POINT_EPSILON = 1e-6

export function samePoint(a: WallPlanPoint, b: WallPlanPoint) {
  return Math.abs(a[0] - b[0]) <= POINT_EPSILON && Math.abs(a[1] - b[1]) <= POINT_EPSILON
}

function pointKey(point: WallPlanPoint) {
  return `${point[0]}:${point[1]}`
}

export function stripWallIsNewMetadata(meta: WallNode['metadata']): WallNode['metadata'] {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return meta
  }

  const nextMeta = { ...(meta as Record<string, unknown>) } as Record<string, unknown>
  delete nextMeta.isNew
  return nextMeta as WallNode['metadata']
}

export type LinkedWallSnapshot = WallNode

/**
 * Walls in the same level that share an endpoint with the moving wall,
 * plus walls one hop further out that share an endpoint with a
 * directly-linked wall — needed so the junction planner can resolve
 * pivot-point context when a same-direction wall is consumed.
 */
export function getLinkedWallSnapshots(args: {
  wallId: WallNode['id']
  wallParentId: string | null
  originalStart: WallPlanPoint
  originalEnd: WallPlanPoint
}): LinkedWallSnapshot[] {
  const { wallId, wallParentId, originalStart, originalEnd } = args
  const { nodes } = useScene.getState()
  const walls = Object.values(nodes).filter(
    (node): node is WallNode =>
      node?.type === 'wall' && node.id !== wallId && (node.parentId ?? null) === wallParentId,
  )
  const directlyLinkedWalls = walls.filter(
    (wall) =>
      samePoint(wall.start, originalStart) ||
      samePoint(wall.start, originalEnd) ||
      samePoint(wall.end, originalStart) ||
      samePoint(wall.end, originalEnd),
  )
  const contextPoints = new Set([pointKey(originalStart), pointKey(originalEnd)])

  for (const wall of directlyLinkedWalls) {
    contextPoints.add(pointKey(wall.start))
    contextPoints.add(pointKey(wall.end))
  }

  const snapshots: LinkedWallSnapshot[] = []
  const seenWallIds = new Set<WallNode['id']>()

  for (const node of walls) {
    if (!contextPoints.has(pointKey(node.start)) && !contextPoints.has(pointKey(node.end))) {
      continue
    }

    if (seenWallIds.has(node.id)) {
      continue
    }
    seenWallIds.add(node.id)

    snapshots.push({
      ...node,
      start: [...node.start] as [number, number],
      end: [...node.end] as [number, number],
      children: [...(node.children ?? [])],
    })
  }

  return snapshots
}

function wallSegmentExists(
  walls: Array<Pick<WallNode, 'start' | 'end'>>,
  start: WallPlanPoint,
  end: WallPlanPoint,
) {
  return walls.some(
    (wall) =>
      (samePoint(wall.start, start) && samePoint(wall.end, end)) ||
      (samePoint(wall.start, end) && samePoint(wall.end, start)),
  )
}

// Resolve a wall slot ref (`library:`/`scene:`) to a swatch colour, or
// undefined when the ref is absent / dangling / colourless.
function resolveWallSlotRefColor(ref: string | undefined): string | undefined {
  const parsed = parseMaterialRef(ref)
  if (!parsed) return undefined
  if (parsed.kind === 'library') {
    return getMaterialPresetByRef(ref)?.mapProperties.color ?? undefined
  }
  const sceneMaterial = useScene.getState().materials[parsed.id as SceneMaterialId]
  return sceneMaterial ? resolveMaterial(sceneMaterial.material).color : undefined
}

export function getWallGhostColor(wall: WallNode) {
  const slotColor =
    resolveWallSlotRefColor(wall.slots?.interior) ?? resolveWallSlotRefColor(wall.slots?.exterior)
  if (slotColor) {
    return slotColor
  }

  const presetColor =
    getMaterialPresetByRef(wall.materialPreset)?.mapProperties.color ??
    getMaterialPresetByRef(wall.interiorMaterialPreset)?.mapProperties.color ??
    getMaterialPresetByRef(wall.exteriorMaterialPreset)?.mapProperties.color

  if (presetColor) {
    return presetColor
  }

  return resolveMaterial(wall.material ?? wall.interiorMaterial ?? wall.exteriorMaterial).color
}

export function getWallsAfterUpdates(
  nodes: ReturnType<typeof useScene.getState>['nodes'],
  updates: Array<{ id: AnyNodeId; data: Partial<WallNode> }>,
): WallNode[] {
  const updateById = new Map(updates.map((update) => [update.id, update.data]))

  return Object.values(nodes)
    .filter((node): node is WallNode => node?.type === 'wall')
    .map((wall) => {
      const update = updateById.get(wall.id as AnyNodeId)
      return update ? ({ ...wall, ...update } as WallNode) : wall
    })
}

export function buildBridgeWallCreates(args: {
  bridgePlans: Array<WallMoveBridgePlan<LinkedWallSnapshot>>
  nextStart: WallPlanPoint
  nextEnd: WallPlanPoint
  existingWalls: WallNode[]
  wallCount: number
}): Array<{ node: WallNode; parentId?: AnyNodeId }> {
  const { bridgePlans, nextStart, nextEnd, existingWalls, wallCount } = args
  const wallsForDuplicateCheck = [...existingWalls]
  const creates: Array<{ node: WallNode; parentId?: AnyNodeId }> = []

  for (const plan of bridgePlans) {
    const nextPoint = plan.movedEndpoint === 'start' ? nextStart : nextEnd

    if (!isSegmentLongEnough(plan.originalPoint, nextPoint)) {
      continue
    }

    if (wallSegmentExists(wallsForDuplicateCheck, plan.originalPoint, nextPoint)) {
      continue
    }

    const { id: _id, parentId: _parentId, children: _children, ...sourceWall } = plan.wall
    const bridgeWall = WallSchema.parse({
      ...sourceWall,
      name: `Wall ${wallCount + creates.length + 1}`,
      start: plan.originalPoint,
      end: nextPoint,
      children: [],
      metadata: stripWallIsNewMetadata(plan.wall.metadata),
    })

    creates.push({
      node: bridgeWall,
      parentId: (plan.wall.parentId ?? undefined) as AnyNodeId | undefined,
    })
    wallsForDuplicateCheck.push(bridgeWall)
  }

  return creates
}

export type GhostWallPreview = {
  id: string
  start: WallPlanPoint
  end: WallPlanPoint
  color: string
  height: number
}

export function buildBridgeWallPreviews(args: {
  bridgePlans: Array<WallMoveBridgePlan<LinkedWallSnapshot>>
  nextStart: WallPlanPoint
  nextEnd: WallPlanPoint
  existingWalls: WallNode[]
}): Array<{ ghost: GhostWallPreview; wall: WallNode }> {
  const { bridgePlans, nextStart, nextEnd, existingWalls } = args
  const wallsForDuplicateCheck: Array<Pick<WallNode, 'start' | 'end'>> = [...existingWalls]
  const previews: Array<{ ghost: GhostWallPreview; wall: WallNode }> = []

  for (const plan of bridgePlans) {
    const nextPoint = plan.movedEndpoint === 'start' ? nextStart : nextEnd

    if (!isSegmentLongEnough(plan.originalPoint, nextPoint)) {
      continue
    }

    if (wallSegmentExists(wallsForDuplicateCheck, plan.originalPoint, nextPoint)) {
      continue
    }

    const { id: _id, children: _children, ...sourceWall } = plan.wall
    const wall = WallSchema.parse({
      ...sourceWall,
      name: 'Wall Preview',
      start: plan.originalPoint,
      end: nextPoint,
      children: [],
      metadata: stripWallIsNewMetadata(plan.wall.metadata),
    })
    const ghost: GhostWallPreview = {
      id: `${plan.wall.id}:${plan.movedEndpoint}:${previews.length}`,
      start: [...plan.originalPoint] as WallPlanPoint,
      end: [...nextPoint] as WallPlanPoint,
      color: getWallGhostColor(plan.wall),
      height: plan.wall.height ?? DEFAULT_WALL_HEIGHT,
    }
    previews.push({ ghost, wall })
    wallsForDuplicateCheck.push(wall)
  }

  return previews
}
