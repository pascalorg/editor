import { getWallEffectiveHeightForNodes } from '../../hooks/spatial-grid/spatial-grid-manager'
import {
  type AnyNode,
  type AnyNodeId,
  getWallTrimFaces,
  getWallTrimSlotId,
  WALL_FACE_REGION_LIMIT,
  WALL_TRIM_DEFAULTS,
  type WallFace,
  type WallFaceRegion,
  type WallNode,
  type ZoneNode,
} from '../../schema'
import { getWallZoneSpans, resolveWallFaceChain } from './wall-finish'
import { reverseWallDirection } from './wall-frame'
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
  const opposite =
    (a.end[0] - a.start[0]) * (b.end[0] - b.start[0]) +
      (a.end[1] - a.start[1]) * (b.end[1] - b.start[1]) <
    0
  const alignedB = opposite ? { ...b, ...reverseWallDirection(b) } : b
  if (a.justification !== alignedB.justification) return 'justification'
  const { heightOf } = options
  if (
    heightOf
      ? Math.abs(heightOf(a) - heightOf(b)) > 1e-6
      : (a.height == null) !== (b.height == null) ||
        Math.abs((a.height ?? 0) - (b.height ?? 0)) > 1e-6
  )
    return 'height'
  // Faces are compared as the merged wall will carry them: b read in a's direction.
  for (const face of ['a', 'b'] as const) {
    if (
      JSON.stringify(resolveWallFaceChain(a, face)) !==
      JSON.stringify(resolveWallFaceChain(alignedB, face))
    )
      return `side ${face.toUpperCase()} finish`
  }
  if (wallTrimSignature(a) !== wallTrimSignature(alignedB)) return 'trim'
  if (options.sides && (a.frontSide !== b.frontSide || a.backSide !== b.backSide))
    return 'room sides'
  if (a.visible !== b.visible) return 'visibility'
  return null
}

/** Every trim as it draws: which faces, which profile and size, which finish per face. */
function wallTrimSignature(wall: WallNode): string {
  return JSON.stringify(
    (['skirting', 'crown', 'chairRail'] as const).map((kind) => {
      const trim = { ...WALL_TRIM_DEFAULTS[kind], ...(wall[kind] ?? {}) }
      if (!trim.enabled) return null
      const faces = getWallTrimFaces(trim.sides)
      return {
        faces,
        profile: trim.profile,
        height: trim.height,
        proud: trim.proud,
        offsetY: trim.offsetY ?? null,
        finishes: faces.map((face) => wall.slots?.[getWallTrimSlotId(face, kind)] ?? null),
      }
    }),
  )
}

function readsBackwards(
  wall: Pick<WallNode, 'start' | 'end'>,
  start: [number, number],
  end: [number, number],
) {
  return (
    (wall.end[0] - wall.start[0]) * (end[0] - start[0]) +
      (wall.end[1] - wall.start[1]) * (end[1] - start[1]) <
    0
  )
}

const REGION_EPSILON = 1e-6

function sameRegionBody(left: WallFaceRegion, right: WallFaceRegion) {
  return (
    left.face === right.face &&
    left.finish === right.finish &&
    left.v0 === right.v0 &&
    left.v1 === right.v1
  )
}

/**
 * Both walls' paint regions in the merged wall's coordinates: faces read in its
 * direction, stations measured from its start, each region clipped to the stretch
 * its own wall covered (an open bound stays open only at a merged-wall end), and
 * matching regions that meet at the joint joined into one. Null when a face would
 * exceed the region limit.
 */
export function mergeWallFaceRegions(
  walls: readonly WallNode[],
  mergedStart: [number, number],
  mergedEnd: [number, number],
): WallFaceRegion[] | null {
  const mergedLength = Math.hypot(mergedEnd[0] - mergedStart[0], mergedEnd[1] - mergedStart[1])
  if (mergedLength < 1e-9) return []
  const tx = (mergedEnd[0] - mergedStart[0]) / mergedLength
  const tz = (mergedEnd[1] - mergedStart[1]) / mergedLength
  const station = (point: [number, number]) =>
    (point[0] - mergedStart[0]) * tx + (point[1] - mergedStart[1]) * tz
  const seenIds = new Set<string>()
  const out: WallFaceRegion[] = []
  for (const wall of walls) {
    const regions = wall.faceRegions ?? []
    if (regions.length === 0) continue
    const length = wallLength(wall)
    const backwards = readsBackwards(wall, mergedStart, mergedEnd)
    const from = Math.min(station(wall.start), station(wall.end))
    const to = Math.max(station(wall.start), station(wall.end))
    const toMerged = (u: number) => (backwards ? to - u : from + u)
    for (const region of regions) {
      const low = backwards ? region.u1 : region.u0
      const high = backwards ? region.u0 : region.u1
      const u0 = Math.max(from, low === undefined ? from : toMerged(low))
      const u1 = Math.min(to, high === undefined ? to : toMerged(high))
      if (u1 - u0 <= REGION_EPSILON && length > REGION_EPSILON) continue
      let id = region.id
      if (seenIds.has(id)) id = `${region.id}-${wall.id}`
      seenIds.add(id)
      const { u0: _u0, u1: _u1, ...body } = region
      out.push({
        ...body,
        id,
        face: backwards ? (region.face === 'a' ? 'b' : 'a') : region.face,
        ...(u0 <= REGION_EPSILON ? {} : { u0 }),
        ...(u1 >= mergedLength - REGION_EPSILON ? {} : { u1 }),
      })
    }
  }
  // Coalesce a region that continues another across the joint.
  const merged: WallFaceRegion[] = []
  for (const region of out) {
    const joined = merged.findIndex(
      (other) =>
        sameRegionBody(other, region) &&
        ((other.u1 !== undefined &&
          Math.abs(other.u1 - (region.u0 ?? 0)) <= REGION_EPSILON &&
          region.u0 !== undefined) ||
          (region.u1 !== undefined &&
            Math.abs(region.u1 - (other.u0 ?? 0)) <= REGION_EPSILON &&
            other.u0 !== undefined)),
    )
    if (joined < 0) {
      merged.push(region)
      continue
    }
    const other = merged[joined]!
    const u0 =
      other.u0 === undefined || region.u0 === undefined ? undefined : Math.min(other.u0, region.u0)
    const u1 =
      other.u1 === undefined || region.u1 === undefined ? undefined : Math.max(other.u1, region.u1)
    const { u0: _a, u1: _b, ...body } = other
    merged[joined] = {
      ...body,
      ...(u0 === undefined ? {} : { u0 }),
      ...(u1 === undefined ? {} : { u1 }),
    }
  }
  for (const face of ['a', 'b'] as const) {
    if (merged.filter((region) => region.face === face).length > WALL_FACE_REGION_LIMIT) return null
  }
  return merged
}

/**
 * Zone references after `secondary` is absorbed into `primary` (which spans
 * `mergedStart → mergedEnd`): boundary ids follow the kept wall, and override
 * entries move onto it with their face read in its direction. Null when the two
 * walls disagree on a room's override for a face they both border — joining
 * would repaint part of that room.
 */
export function planMergedZoneReferences(
  nodes: Record<AnyNodeId, AnyNode>,
  primary: WallNode,
  secondary: WallNode,
  mergedStart: [number, number],
  mergedEnd: [number, number],
): Array<{ id: AnyNodeId; data: Partial<ZoneNode> }> | null {
  const faceOf = (wall: WallNode, face: WallFace): WallFace =>
    readsBackwards(wall, mergedStart, mergedEnd) ? (face === 'a' ? 'b' : 'a') : face
  const updates: Array<{ id: AnyNodeId; data: Partial<ZoneNode> }> = []
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'zone') continue
    const touchesBoundary = node.boundaryWallIds?.includes(secondary.id as never) ?? false
    const entries = node.wallOverrides ?? []
    const touchesOverrides = entries.some(
      (entry) => entry.wallId === secondary.id || entry.wallId === primary.id,
    )
    if (!(touchesBoundary || touchesOverrides)) continue
    const data: Partial<ZoneNode> = {}
    if (touchesBoundary)
      data.boundaryWallIds = [
        ...new Set(node.boundaryWallIds.map((id) => (id === secondary.id ? primary.id : id))),
      ]
    if (touchesOverrides) {
      const byFace = new Map<WallFace, Map<WallNode['id'], string>>()
      for (const entry of entries) {
        const wall =
          entry.wallId === primary.id ? primary : entry.wallId === secondary.id ? secondary : null
        if (!wall) continue
        const face = faceOf(wall, entry.face)
        const faces = byFace.get(face) ?? new Map()
        faces.set(wall.id, entry.finish)
        byFace.set(face, faces)
      }
      const merged: NonNullable<ZoneNode['wallOverrides']> = entries.filter(
        (entry) => entry.wallId !== primary.id && entry.wallId !== secondary.id,
      )
      for (const [face, finishes] of byFace) {
        const values = [...new Set(finishes.values())]
        if (values.length > 1) return null
        for (const wall of [primary, secondary]) {
          if (finishes.has(wall.id)) continue
          // The other wall borders this room on the same face without the override.
          const spans = getWallZoneSpans(wall, [node])
          if (spans.some((span) => faceOf(wall, span.face) === face)) return null
        }
        merged.push({ wallId: primary.id, face, finish: values[0]! })
      }
      data.wallOverrides = merged
    }
    updates.push({ id: node.id as AnyNodeId, data })
  }
  return updates
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
    return { start: reverseWallDirection(secondary).start!, end: primary.end }
  }

  return { start: primary.start, end: reverseWallDirection(secondary).end! }
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
    const faceRegions = mergeWallFaceRegions([merged, next], start, end)
    if (!faceRegions)
      throw Error(
        `Merging would leave more than ${WALL_FACE_REGION_LIMIT} paint regions on a side.`,
      )
    const zoneUpdates = planMergedZoneReferences(virtual, merged, next, start, end)
    if (!zoneUpdates) throw Error('These walls have a different room finish.')
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
    const { faceRegions: _regions, ...kept } = merged
    merged = {
      ...kept,
      ...(faceRegions.length > 0 ? { faceRegions } : {}),
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
    for (const update of zoneUpdates)
      virtual[update.id] = { ...virtual[update.id]!, ...update.data } as AnyNode
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
