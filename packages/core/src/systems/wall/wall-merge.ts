import { getWallEffectiveHeightForNodes } from '../../hooks/spatial-grid/spatial-grid-manager'
import {
  type AnyNode,
  type AnyNodeId,
  getEffectiveWallSurfaceMaterial,
  getWallSurfaceMaterialSignature,
  type WallNode,
} from '../../schema'
import type { WallTopologyChanges } from './wall-topology'

// Joining two walls that continue each other at a shared end: the delete heal
// (store `deleteNodes`) and the explicit merge share the geometry and style checks.

export type WallAttachmentUpdate = { id: AnyNodeId; data: Partial<AnyNode> }

function pointsEqual(a: [number, number], b: [number, number], tolerance = 1e-6) {
  const dx = a[0] - b[0]
  const dz = a[1] - b[1]
  return dx * dx + dz * dz <= tolerance * tolerance
}

function wallLength(wall: Pick<WallNode, 'start' | 'end'>) {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

export function getWallEndpointAtPoint(
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

/**
 * The first thing two walls disagree on (for the merge's explanation), or null.
 * The delete heal is strict: room sides must match, and a wall following the
 * storey never joins one with an explicit height. An explicit merge compares
 * what is visible instead — `heightOf` resolves each wall's actual height — and
 * leaves the sides to room detection, which reclassifies the merged wall.
 */
export function wallStyleMismatch(
  a: WallNode,
  b: WallNode,
  options: { sides: boolean; heightOf?: (wall: WallNode) => number },
): string | null {
  if ((a.parentId ?? null) !== (b.parentId ?? null)) return 'floor'
  if (Math.abs((a.curveOffset ?? 0) - (b.curveOffset ?? 0)) > 1e-6) return 'curve'
  if (Math.abs((a.thickness ?? 0.2) - (b.thickness ?? 0.2)) > 1e-6) return 'thickness'
  const { heightOf } = options
  if (
    heightOf
      ? Math.abs(heightOf(a) - heightOf(b)) > 1e-6
      : (a.height == null) !== (b.height == null) ||
        Math.abs((a.height ?? 0) - (b.height ?? 0)) > 1e-6
  )
    return 'height'
  for (const side of ['interior', 'exterior'] as const) {
    if (
      getWallSurfaceMaterialSignature(getEffectiveWallSurfaceMaterial(a, side)) !==
      getWallSurfaceMaterialSignature(getEffectiveWallSurfaceMaterial(b, side))
    )
      return `${side} finish`
  }
  if (options.sides && (a.frontSide !== b.frontSide || a.backSide !== b.backSide))
    return 'room sides'
  if (a.visible !== b.visible) return 'visibility'
  return null
}

export function areWallStylesCompatible(a: WallNode, b: WallNode) {
  return wallStyleMismatch(a, b, { sides: true }) === null
}

export function areWallsCollinearAcrossPoint(
  a: WallNode,
  b: WallNode,
  sharedPoint: [number, number],
) {
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

export function resolveMergedWallEndpoints(
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
  // The kept wall never turns around: its sides, finishes and hosted faces stay
  // where they are. Meeting start-to-start or end-to-end, the absorbed wall is
  // the one read backwards.
  if (primaryEndpoint === 'start' && secondaryEndpoint === 'start') {
    return { start: secondary.end, end: primary.end }
  }

  return { start: primary.start, end: secondary.start }
}

/**
 * Hosted nodes live in the wall's local frame (+X along it, +Z its front, yaw
 * 0 front / π back). A wall read backwards turns that frame by 180° about Y,
 * so the face and the yaw swap and the caller mirrors depth. Hinges, handles
 * and swing hang off the node's own yaw (the plan symbol flips them from it),
 * so they stay as stored.
 */
function reversedWallChildPatch(child: AnyNode): Partial<AnyNode> {
  const patch: Record<string, unknown> = {}
  if ('side' in child && (child.side === 'front' || child.side === 'back')) {
    patch.side = child.side === 'front' ? 'back' : 'front'
  }
  if ('rotation' in child && Array.isArray(child.rotation)) {
    const yaw = child.rotation[1] + Math.PI
    patch.rotation = [
      child.rotation[0],
      Math.atan2(Math.sin(yaw), Math.cos(yaw)),
      child.rotation[2],
    ]
  }
  return patch as Partial<AnyNode>
}

export function buildMergedWallAttachmentUpdates(
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
    if (!child) continue
    // Every child moves to the kept wall: deleting the absorbed wall would
    // otherwise take a child left on it along. Only positioned ones re-place.
    const rehost = { parentId: mergedWallId, wallId: mergedWallId }
    if (!('position' in child && Array.isArray(child.position))) {
      updates.push({ id: childId, data: rehost as Partial<AnyNode> })
      continue
    }

    const sourceWall = child.parentId === secondary.id ? secondary : primary
    const sourceLength = Math.max(wallLength(sourceWall), 1e-6)
    const reversed =
      (sourceWall.end[0] - sourceWall.start[0]) * tangentX +
        (sourceWall.end[1] - sourceWall.start[1]) * tangentZ <
      0
    const mirrored = reversed ? reversedWallChildPatch(child) : {}
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
        ...rehost,
        ...mirrored,
        position: [
          nextLocalX,
          child.position[1],
          reversed ? -child.position[2] : child.position[2],
        ] as typeof child.position,
        ...('wallT' in child ? { wallT: nextLocalX / mergedLength } : {}),
      } as Partial<AnyNode>,
    })
  }

  return updates
}

/**
 * Merges a straight run of adjoining walls into one — the inverse of a split.
 * Every joint must hold exactly these walls (a T or a cross stays split), and
 * neighbours must continue in line and look alike (`wallStyleMismatch`: same
 * thickness, visible height and finish). The wall with the most attachments
 * keeps its id and height mode; openings and wall items keep their world
 * position on it.
 */
export function planWallMerge(
  nodes: Record<AnyNodeId, AnyNode>,
  wallIds: readonly AnyNodeId[],
): { changes: WallTopologyChanges; wallId: WallNode['id'] } {
  const walls = [...new Set(wallIds)]
    .map((id) => nodes[id])
    .filter((node): node is WallNode => node?.type === 'wall')
  if (walls.length < 2 || walls.length !== new Set(wallIds).size)
    throw Error('Select two or more walls to merge.')
  if (walls.some((wall) => (wall.curveOffset ?? 0) !== 0))
    throw Error('Only straight walls can be merged.')
  const levelId = walls[0]!.parentId ?? null
  if (walls.some((wall) => (wall.parentId ?? null) !== levelId))
    throw Error('Merge walls on the same floor.')

  const virtual = { ...nodes }
  const [primary, ...rest] = [...walls].sort(
    (a, b) => (b.children?.length ?? 0) - (a.children?.length ?? 0) || a.id.localeCompare(b.id),
  )
  let merged = primary!
  let remaining = rest
  while (remaining.length > 0) {
    let next: WallNode | undefined
    let joint: [number, number] | undefined
    for (const wall of remaining) {
      joint = [merged.start, merged.end].find((end) => getWallEndpointAtPoint(wall, end) !== null)
      if (joint) {
        next = wall
        break
      }
    }
    if (!(next && joint)) throw Error('Merge walls that touch end to end.')
    const atJoint = Object.values(virtual).filter(
      (node) =>
        node?.type === 'wall' &&
        (node.parentId ?? null) === levelId &&
        getWallEndpointAtPoint(node, joint) !== null,
    )
    if (atJoint.length !== 2)
      throw Error('Another wall meets this joint, so merging would disconnect it.')
    if (!areWallsCollinearAcrossPoint(merged, next, joint))
      throw Error('Merge walls that continue in a straight line.')
    const mismatch = wallStyleMismatch(merged, next, {
      sides: false,
      heightOf: (wall) => getWallEffectiveHeightForNodes(wall, virtual),
    })
    if (mismatch) throw Error(`These walls have a different ${mismatch}.`)

    const { start, end } = resolveMergedWallEndpoints(merged, next, joint)
    for (const update of buildMergedWallAttachmentUpdates(
      merged,
      next,
      merged.id,
      start,
      end,
      virtual,
    )) {
      virtual[update.id] = { ...virtual[update.id]!, ...update.data } as AnyNode
    }
    merged = {
      ...merged,
      start,
      end,
      // Ids without a node are dropped rather than carried onto the kept wall.
      children: [
        ...new Set([
          ...(merged.children ?? []),
          ...(next.children ?? []).filter((id) => virtual[id as AnyNodeId]),
        ]),
      ],
    } as WallNode
    virtual[merged.id] = merged
    delete virtual[next.id]
    for (const node of Object.values(virtual)) {
      if (node?.type !== 'zone' || !node.boundaryWallIds?.includes(next.id)) continue
      virtual[node.id] = {
        ...node,
        boundaryWallIds: [
          ...new Set(node.boundaryWallIds.map((id) => (id === next.id ? merged.id : id))),
        ],
      }
    }
    remaining = remaining.filter((wall) => wall !== next)
  }

  return {
    changes: {
      create: [],
      update: Object.values(virtual)
        .filter((node) => nodes[node.id] && node !== nodes[node.id])
        .map((node) => ({ id: node.id, data: node })),
      delete: walls.filter((wall) => !virtual[wall.id]).map((wall) => wall.id),
    },
    wallId: merged.id,
  }
}
