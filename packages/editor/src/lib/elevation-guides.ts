import {
  type AnyNode,
  type AnyNodeId,
  type FenceNode,
  findLevelAncestorId,
  getWallBaseElevationForNodes,
  getWallEffectiveHeightForNodes,
  levelBaseElevationAt,
  resolveCeilingHeight,
} from '@pascal-app/core'
import useElevationGuides from '../store/use-elevation-guides'

export const ELEVATION_ALIGNMENT_THRESHOLD_M = 0.08
const GUIDE_MATCH_EPSILON_M = 1e-4

export type ElevationGuideSource = {
  nodeId: string
  levelId: string | null | undefined
  anchor: readonly [number, number]
}

export type ElevationSnapTarget = {
  id: string
  elevation: number
  anchor: readonly [number, number]
  label: string
}

export type ElevationSnapMatch = {
  target: ElevationSnapTarget
  elevation: number
}

function polygonCenter(polygon: ReadonlyArray<readonly [number, number]>): [number, number] {
  if (polygon.length === 0) return [0, 0]
  let x = 0
  let z = 0
  for (const point of polygon) {
    x += point[0]
    z += point[1]
  }
  return [x / polygon.length, z / polygon.length]
}

function segmentCenter(
  start: readonly [number, number],
  end: readonly [number, number],
): [number, number] {
  return [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
}

// Mirrors `resolveFenceLiftElevationForNodes` in `@pascal-app/nodes`, which this
// package cannot import (the fence definition imports the guides from here).
// A stale host resolves to the level base — the sculpted ground under the
// fence's start point, sampled where the builder samples it, so the guide line
// lands on the rail it claims to describe.
export function getFenceBaseElevationForNodes(
  node: FenceNode,
  nodes: Record<string, AnyNode>,
): number {
  const host = node.supportSlabId ? nodes[node.supportSlabId as AnyNodeId] : undefined
  const hosted = host?.type === 'slab' && (host.parentId ?? null) === (node.parentId ?? null)
  const levelId = findLevelAncestorId(node.id as AnyNodeId, nodes)
  const support = hosted
    ? (host.elevation ?? 0)
    : levelId
      ? levelBaseElevationAt(nodes, levelId, node.start[0], node.start[1])
      : 0
  return support + (node.supportOffset ?? 0)
}

/**
 * Structural Y datums on the source node's level. This is editor-runtime
 * collection over authoritative vertical resolvers; matching remains a pure
 * scalar operation in {@link resolveElevationSnapMatch}.
 */
export function collectElevationSnapTargets(
  source: ElevationGuideSource,
  nodes: Record<string, AnyNode>,
): ElevationSnapTarget[] {
  if (!source.levelId) return []

  const targets: ElevationSnapTarget[] = [
    {
      id: `${source.levelId}:level`,
      elevation: 0,
      anchor: source.anchor,
      label: 'Level',
    },
  ]
  // Sculpted ground under the thing being dragged. A separate target rather than
  // a redefinition of `Level`: the storey plane is still a real datum a user may
  // want (a fence sunk to the building's floor line), and on a hillside the
  // ground is a second, different one. Emitted only when they actually differ,
  // so a flat scene keeps exactly one target at 0.
  const groundElevation = levelBaseElevationAt(
    nodes,
    source.levelId,
    source.anchor[0],
    source.anchor[1],
  )
  if (Math.abs(groundElevation) > GUIDE_MATCH_EPSILON_M) {
    targets.push({
      id: `${source.levelId}:ground`,
      elevation: groundElevation,
      anchor: source.anchor,
      label: 'Ground',
    })
  }
  const level = nodes[source.levelId as AnyNodeId]
  if (level?.type !== 'level') return targets

  for (const childId of level.children) {
    if (childId === source.nodeId) continue
    const node = nodes[childId as AnyNodeId]
    if (!node) continue

    if (node.type === 'slab') {
      const center = polygonCenter(node.polygon)
      const top = node.elevation ?? 0.05
      targets.push({
        id: `${node.id}:top`,
        elevation: top,
        anchor: center,
        label: 'Slab top',
      })
      if (!node.recessed) {
        targets.push({
          id: `${node.id}:base`,
          elevation: top - (node.thickness ?? 0.05),
          anchor: center,
          label: 'Slab underside',
        })
      }
      continue
    }

    if (node.type === 'ceiling') {
      targets.push({
        id: `${node.id}:ceiling`,
        elevation: resolveCeilingHeight(node, nodes as Record<AnyNodeId, AnyNode>),
        anchor: polygonCenter(node.polygon),
        label: 'Ceiling',
      })
      continue
    }

    if (node.type === 'wall') {
      const base = getWallBaseElevationForNodes(node, nodes)
      const center = segmentCenter(node.start, node.end)
      targets.push({
        id: `${node.id}:base`,
        elevation: base,
        anchor: center,
        label: 'Wall base',
      })
      if (node.endHeightOffset) {
        targets.push({
          id: `${node.id}:top-start`,
          elevation: base + getWallEffectiveHeightForNodes(node, nodes, 0),
          anchor: node.start,
          label: 'Wall top start',
        })
        targets.push({
          id: `${node.id}:top-end`,
          elevation: base + getWallEffectiveHeightForNodes(node, nodes, 1),
          anchor: node.end,
          label: 'Wall top end',
        })
      } else {
        targets.push({
          id: `${node.id}:top`,
          elevation: base + getWallEffectiveHeightForNodes(node, nodes, 0.5),
          anchor: center,
          label: 'Wall top',
        })
      }
      continue
    }

    if (node.type === 'fence') {
      const base = getFenceBaseElevationForNodes(node, nodes)
      const center = segmentCenter(node.start, node.end)
      targets.push({
        id: `${node.id}:base`,
        elevation: base,
        anchor: center,
        label: 'Fence base',
      })
      targets.push({
        id: `${node.id}:top`,
        elevation: base + (node.height ?? 1.8),
        anchor: center,
        label: 'Fence top',
      })
    }
  }

  return targets
}

export function resolveElevationSnapMatch(
  proposedElevation: number,
  sourceAnchor: readonly [number, number],
  targets: readonly ElevationSnapTarget[],
  threshold = ELEVATION_ALIGNMENT_THRESHOLD_M,
): ElevationSnapMatch | null {
  let best: ElevationSnapTarget | null = null
  let bestDelta = Number.POSITIVE_INFINITY
  let bestPlanDistance = Number.POSITIVE_INFINITY

  for (const target of targets) {
    const delta = Math.abs(target.elevation - proposedElevation)
    if (delta > threshold) continue
    const dx = target.anchor[0] - sourceAnchor[0]
    const dz = target.anchor[1] - sourceAnchor[1]
    const planDistance = dx * dx + dz * dz
    if (
      delta < bestDelta - 1e-9 ||
      (Math.abs(delta - bestDelta) <= 1e-9 && planDistance < bestPlanDistance)
    ) {
      best = target
      bestDelta = delta
      bestPlanDistance = planDistance
    }
  }

  return best ? { target: best, elevation: best.elevation } : null
}

export function resolveStructuralElevationSnap(
  source: ElevationGuideSource,
  proposedElevation: number,
  nodes: Record<string, AnyNode>,
): number {
  return (
    resolveElevationSnapMatch(
      proposedElevation,
      source.anchor,
      collectElevationSnapTargets(source, nodes),
    )?.elevation ?? proposedElevation
  )
}

export function publishStructuralElevationGuide(
  source: ElevationGuideSource,
  elevation: number,
  nodes: Record<string, AnyNode>,
): void {
  if (!source.levelId) {
    clearStructuralElevationGuide(source.nodeId)
    return
  }

  const match = resolveElevationSnapMatch(
    elevation,
    source.anchor,
    collectElevationSnapTargets(source, nodes),
    GUIDE_MATCH_EPSILON_M,
  )
  if (!match) {
    clearStructuralElevationGuide(source.nodeId)
    return
  }

  publishResolvedElevationGuide(source, match.target)
}

export function publishResolvedElevationGuide(
  source: ElevationGuideSource,
  target: ElevationSnapTarget,
): void {
  if (!source.levelId) {
    clearStructuralElevationGuide(source.nodeId)
    return
  }

  const dx = target.anchor[0] - source.anchor[0]
  const dz = target.anchor[1] - source.anchor[1]
  const length = Math.hypot(dx, dz)
  const direction: [number, number] = length > 1e-6 ? [dx / length, dz / length] : [1, 0]

  useElevationGuides.getState().publish({
    ownerId: source.nodeId,
    levelId: source.levelId,
    center: source.anchor,
    direction,
    elevation: target.elevation,
    label: target.label,
  })
}

export function clearStructuralElevationGuide(ownerId: string): void {
  useElevationGuides.getState().clear(ownerId)
}
