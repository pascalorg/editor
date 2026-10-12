import { refuse } from '../agent-tools/refusal'
import { supportSegmentAt, wallSupportForNodes } from '../lib/opening-floor-datum'
import { type AnyNode, WallFeatureNode, type WallNode } from '../schema'
import type { WallFace } from '../schema/nodes/wall'
import { getWallPlaneTop } from '../services/storey'
import type { WallSlabSupport, WallSlabSupportSegment } from '../systems/slab/slab-support'
import { isCurvedWall } from '../systems/wall/wall-curve'
import { getWallThickness } from '../systems/wall/wall-footprint'
import { getWallFaceOffsets } from '../systems/wall/wall-frame'
import { resolveWallTop } from '../systems/wall/wall-top'

export const WALL_FEATURE_MIN_BACKING = 0.02
const TOUCHING = 1e-6
type Nodes = Readonly<Record<string, AnyNode>>
type V3 = [number, number, number]

/** The resolved root wall's live support/plane; omitted for persisted scene validation. */
export type WallFeaturePlacementContext = {
  support?: WallSlabSupport
  planeTop?: number
}

export type WallFeaturePlacement = {
  node: WallFeatureNode
  wall: WallNode
  face: WallFace
  /** Metres from wall.start, increasing towards wall.end on both faces. */
  u: number
  /** Level-local elevations, including the mounting face's own floor datum. */
  bottom: number
  wallBase: number
  wallTop: number
  hostWidth: number
  hostHeight: number
  /** Signed wall-local +z at the mouth/base and at the back/outer face. */
  mountOffset: number
  surfaceOffset: number
  /** Single-feature depth budget; opposing recesses are checked together. Null for bumps. */
  maxDepth: number | null
  /** Centre of the mounting rectangle, in the level frame. */
  position: V3
  tangent: V3
  normal: V3
  /** u and n are wall-local metres; y is level-local elevation. */
  bounds: { u0: number; u1: number; y0: number; y1: number; n0: number; n1: number }
}

function parseFeature(node: WallFeatureNode): WallFeatureNode {
  const parsed = WallFeatureNode.safeParse(node)
  if (!parsed.success) {
    refuse('wall_feature_invalid_data', 'Wall feature data is invalid.', {
      featureId: node.id,
      issues: parsed.error.issues.map(({ path, message }) => ({ path: path.join('.'), message })),
    })
  }
  return parsed.data
}

function datumAt(segments: readonly WallSlabSupportSegment[], t: number, fallback: number) {
  const segment =
    segments.find((run) => t >= run.start && t < run.end) ?? (t === 1 ? segments.at(-1) : undefined)
  return segment ? supportSegmentAt(segment, t) : fallback
}

function highestDatum(
  segments: readonly WallSlabSupportSegment[],
  from: number,
  to: number,
  fallback: number,
) {
  const elevations = segments.flatMap((run) => {
    const start = Math.max(from, run.start)
    const end = Math.min(to, run.end)
    return end > start ? [supportSegmentAt(run, start), supportSegmentAt(run, end)] : []
  })
  return elevations.length ? Math.max(...elevations) : fallback
}

function makeResolver(nodes: Nodes, context: WallFeaturePlacementContext = {}) {
  const resolved = new Map<string, WallFeaturePlacement>()
  const visiting = new Set<string>()

  function resolve(raw: WallFeatureNode): WallFeaturePlacement {
    const cached = resolved.get(raw.id)
    if (cached) return cached
    if (visiting.has(raw.id))
      refuse('wall_feature_host_cycle', 'Wall feature ownership contains a cycle.', {
        featureId: raw.id,
      })
    visiting.add(raw.id)
    const node = parseFeature(raw)
    if (!node.parentId)
      refuse('wall_feature_host_required', 'Choose a wall or bump to host this feature.', {
        featureId: node.id,
      })
    const host = nodes[node.parentId]
    if (!host)
      refuse('wall_feature_host_missing', `Host ${node.parentId} does not exist.`, {
        featureId: node.id,
        hostId: node.parentId,
      })
    if (host.type !== 'wall' && host.type !== 'wall-feature')
      refuse('wall_feature_invalid_host', 'A wall feature must belong to a wall or bump.', {
        featureId: node.id,
        hostId: host.id,
      })

    const parent = host.type === 'wall-feature' ? resolve(host) : undefined
    if (
      parent &&
      (node.mode !== 'niche' ||
        parent.node.mode !== 'bump' ||
        parent.node.parentId !== parent.wall.id)
    )
      refuse(
        'wall_feature_invalid_nesting',
        'Only a niche inside a wall-owned bump is supported.',
        {
          featureId: node.id,
          hostId: host.id,
        },
      )
    const wall = parent?.wall ?? (host as WallNode)
    if (wall.wallType === 'curtain' || isCurvedWall(wall))
      refuse('wall_feature_unsupported_wall', 'Niches and bumps require a straight, solid wall.', {
        featureId: node.id,
        wallId: wall.id,
      })
    const dx = wall.end[0] - wall.start[0]
    const dz = wall.end[1] - wall.start[1]
    const length = Math.hypot(dx, dz)
    const thickness = getWallThickness(wall)
    if (
      ![...wall.start, ...wall.end, length, thickness].every(Number.isFinite) ||
      length <= TOUCHING ||
      thickness <= 0
    )
      refuse(
        'wall_feature_invalid_wall',
        'The host wall needs a finite length and positive thickness.',
        {
          featureId: node.id,
          wallId: wall.id,
        },
      )
    const support = context.support ?? wallSupportForNodes(wall, nodes)
    const wallTop = resolveWallTop(
      wall,
      context.planeTop ?? getWallPlaneTop(wall, wall.parentId ?? '', nodes),
      support.elevation,
    )
    const face = parent?.face ?? node.face!
    const sign = face === 'a' ? 1 : -1
    const u = parent ? parent.bounds.u0 + node.u : node.u
    const faceBase = datumAt(support.faceDatum[face], u / length, support.elevation)
    const bottom = (parent?.bottom ?? faceBase) + node.bottom
    const hostWidth = parent?.node.width ?? length
    const hostHeight = parent?.node.height ?? wallTop - faceBase
    if (
      ![support.elevation, wallTop, u, bottom, hostWidth, hostHeight].every(Number.isFinite) ||
      hostHeight <= 0
    )
      refuse('wall_feature_invalid_wall', 'The host has no usable vertical span.', {
        featureId: node.id,
        wallId: wall.id,
      })
    const mountOffset = parent?.surfaceOffset ?? getWallFaceOffsets(wall)[face]
    const surfaceOffset = mountOffset + sign * (node.mode === 'bump' ? node.depth : -node.depth)
    const bounds = {
      u0: u - node.width / 2,
      u1: u + node.width / 2,
      y0: bottom,
      y1: bottom + node.height,
      n0: Math.min(mountOffset, surfaceOffset),
      n1: Math.max(mountOffset, surfaceOffset),
    }
    if (!Object.values(bounds).every(Number.isFinite))
      refuse(
        'wall_feature_invalid_data',
        'Wall feature coordinates exceed finite geometry bounds.',
        {
          featureId: node.id,
        },
      )
    if (
      node.u - node.width / 2 < -TOUCHING ||
      node.u + node.width / 2 > hostWidth + TOUCHING ||
      node.bottom + node.height > hostHeight + TOUCHING
    )
      refuse(
        'wall_feature_out_of_bounds',
        'The feature must fit within its host width and height.',
        {
          featureId: node.id,
          hostId: host.id,
          hostWidth,
          hostHeight,
        },
      )
    if (
      !parent &&
      bounds.y0 <
        highestDatum(support.faceDatum[face], bounds.u0 / length, bounds.u1 / length, faceBase) -
          TOUCHING
    )
      refuse(
        'wall_feature_out_of_bounds',
        'The feature must stay above the floor across its entire width.',
        {
          featureId: node.id,
          hostId: host.id,
        },
      )
    const maxDepth =
      node.mode === 'niche'
        ? thickness + (parent?.node.depth ?? 0) - WALL_FEATURE_MIN_BACKING
        : null
    if (maxDepth !== null && node.depth > maxDepth + TOUCHING)
      refuse('wall_feature_backing', 'The niche must leave at least 0.02 m of backing.', {
        featureId: node.id,
        maxDepth,
      })
    const tangent: V3 = [dx / length, 0, dz / length]
    const normal: V3 = [sign * -tangent[2], 0, sign * tangent[0]]
    const placement: WallFeaturePlacement = {
      node,
      wall,
      face,
      u,
      bottom,
      wallBase: support.elevation,
      wallTop,
      hostWidth,
      hostHeight,
      mountOffset,
      surfaceOffset,
      maxDepth,
      position: [
        wall.start[0] + tangent[0] * u - tangent[2] * mountOffset,
        bottom + node.height / 2,
        wall.start[1] + tangent[2] * u + tangent[0] * mountOffset,
      ],
      tangent,
      normal,
      bounds,
    }
    visiting.delete(node.id)
    resolved.set(node.id, placement)
    return placement
  }
  return resolve
}

/** Resolves one feature's frame and host fit without checking sibling collisions. */
export function resolveWallFeaturePlacement(
  nodes: Nodes,
  feature: WallFeatureNode,
  context?: WallFeaturePlacementContext,
): WallFeaturePlacement {
  return makeResolver(nodes, context)(feature)
}

function overlaps(a: WallFeaturePlacement, b: WallFeaturePlacement) {
  return (
    a.bounds.u0 < b.bounds.u1 - TOUCHING &&
    b.bounds.u0 < a.bounds.u1 - TOUCHING &&
    a.bounds.y0 < b.bounds.y1 - TOUCHING &&
    b.bounds.y0 < a.bounds.y1 - TOUCHING
  )
}

/** Validate the features owned by a proposed wall graph, including parent edits and both faces. */
export function validateWallFeatures(nodes: Nodes, wallId: string): WallFeaturePlacement[] {
  const wall = nodes[wallId]
  if (wall?.type !== 'wall')
    refuse('wall_feature_invalid_host', `Wall ${wallId} does not exist.`, { wallId })
  const byHost = new Map<string, WallFeatureNode[]>()
  for (const node of Object.values(nodes)) {
    if (node.type !== 'wall-feature' || !node.parentId) continue
    const children = byHost.get(node.parentId) ?? []
    children.push(node)
    byHost.set(node.parentId, children)
  }
  const resolve = makeResolver(nodes)
  const placements: WallFeaturePlacement[] = []
  const pending = [...(byHost.get(wallId) ?? [])]
  for (let i = 0; i < pending.length; i++) {
    const node = pending[i]!
    placements.push(resolve(node))
    pending.push(...(byHost.get(node.id) ?? []))
  }
  for (let i = 0; i < placements.length; i++) {
    const a = placements[i]!
    for (let j = i + 1; j < placements.length; j++) {
      const b = placements[j]!
      if (!overlaps(a, b)) continue
      if (a.face === b.face) {
        if (a.node.parentId === b.node.id || b.node.parentId === a.node.id) continue
        refuse('wall_feature_overlap', 'Unrelated wall features cannot overlap on the same face.', {
          featureId: a.node.id,
          otherFeatureId: b.node.id,
        })
      }
      if (a.node.mode !== 'niche' || b.node.mode !== 'niche') continue
      const front = a.face === 'a' ? a : b
      const back = a.face === 'b' ? a : b
      const remainingBacking = front.surfaceOffset - back.surfaceOffset
      if (remainingBacking < WALL_FEATURE_MIN_BACKING - TOUCHING)
        refuse(
          'wall_feature_backing',
          'Opposing niches must leave at least 0.02 m of backing between them.',
          {
            featureId: a.node.id,
            otherFeatureId: b.node.id,
            remainingBacking,
          },
        )
    }
  }
  return placements
}

/** Checks a create/edit proposal and its descendants without changing the input graph or clamping. */
export function planWallFeaturePlacement(
  nodes: Nodes,
  feature: WallFeatureNode,
): WallFeaturePlacement {
  const node = parseFeature(feature)
  const proposed = { ...nodes, [node.id]: node }
  const placement = resolveWallFeaturePlacement(proposed, node)
  validateWallFeatures(proposed, placement.wall.id)
  return placement
}
