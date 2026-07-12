import type {
  AnyNode,
  AnyNodeId,
  CabinetModuleNode as CabinetModuleNodeType,
  CabinetNode as CabinetNodeType,
  MovableParentFrame,
  ParentFrameSnapMatch,
} from '@pascal-app/core'
import { planToRunLocal, runLocalToPlan } from './run-layout'
import { bumpCabinetRunLayoutRevision, syncCornerRunsFromSourceModule } from './run-ops'

/** Matches the generic move tool's Figma-alignment pull (8 cm). */
const MAGNETIC_THRESHOLD_M = 0.08
const GUIDE_EPSILON_M = 1e-4
type PlanTransform = { position: [number, number, number]; rotation: number }
type PlanPoint = { x: number; z: number }

function runParent(
  node: AnyNode,
  nodes: Readonly<Record<string, AnyNode>>,
): CabinetNodeType | null {
  if (node.type !== 'cabinet-module' || !node.parentId) return null
  const parent = nodes[node.parentId]
  return parent?.type === 'cabinet' ? (parent as CabinetNodeType) : null
}

function isCabinetFrameNode(
  node: AnyNode | undefined,
): node is CabinetNodeType | CabinetModuleNodeType {
  return node?.type === 'cabinet' || node?.type === 'cabinet-module'
}

function nodeRotationY(node: CabinetNodeType | CabinetModuleNodeType): number {
  const rotation = (node as { rotation?: unknown }).rotation
  if (typeof rotation === 'number') return rotation
  if (Array.isArray(rotation)) return (rotation[1] as number | undefined) ?? 0
  return 0
}

function composePlanTransform(parent: PlanTransform, child: PlanTransform): PlanTransform {
  const cos = Math.cos(parent.rotation)
  const sin = Math.sin(parent.rotation)
  const [x, y, z] = child.position
  return {
    position: [
      parent.position[0] + x * cos + z * sin,
      parent.position[1] + y,
      parent.position[2] - x * sin + z * cos,
    ],
    rotation: parent.rotation + child.rotation,
  }
}

function frameWorldTransform(
  node: CabinetNodeType | CabinetModuleNodeType,
  nodes?: Readonly<Record<string, AnyNode>>,
  visited = new Set<string>(),
): PlanTransform {
  const own: PlanTransform = {
    position: [...node.position] as [number, number, number],
    rotation: nodeRotationY(node),
  }
  if (!nodes || !node.parentId || visited.has(node.id)) return own
  visited.add(node.id)
  const parent = nodes[node.parentId]
  if (!isCabinetFrameNode(parent)) return own
  return composePlanTransform(frameWorldTransform(parent, nodes, visited), own)
}

function localToPlan(
  parent: AnyNode,
  local: readonly [number, number, number],
  nodes?: Readonly<Record<string, AnyNode>>,
): [number, number, number] {
  const run = parent as CabinetNodeType
  if (!nodes || !run.parentId || !isCabinetFrameNode(nodes[run.parentId])) {
    return runLocalToPlan(run, local)
  }
  const transform = frameWorldTransform(run, nodes)
  const cos = Math.cos(transform.rotation)
  const sin = Math.sin(transform.rotation)
  const [lx, ly, lz] = local
  return [
    transform.position[0] + lx * cos + lz * sin,
    transform.position[1] + ly,
    transform.position[2] - lx * sin + lz * cos,
  ]
}

function planToLocal(
  parent: AnyNode,
  planX: number,
  localY: number,
  planZ: number,
  nodes?: Readonly<Record<string, AnyNode>>,
): [number, number, number] {
  const run = parent as CabinetNodeType
  if (!nodes || !run.parentId || !isCabinetFrameNode(nodes[run.parentId])) {
    return planToRunLocal(run, planX, localY, planZ)
  }
  const transform = frameWorldTransform(run, nodes)
  const dx = planX - transform.position[0]
  const dz = planZ - transform.position[2]
  const cos = Math.cos(transform.rotation)
  const sin = Math.sin(transform.rotation)
  return [dx * cos - dz * sin, localY, dx * sin + dz * cos]
}

/**
 * Edge-mating snap between sibling modules in the run's local frame: pull the
 * dragged module flush against a sibling's side when within the magnetic
 * threshold, and align depth (Z center / front / back) when width bands touch.
 */
function magneticSnap(
  node: AnyNode,
  parent: AnyNode,
  local: readonly [number, number, number],
  nodes: Readonly<Record<string, AnyNode>>,
): [number, number, number] {
  const run = parent as CabinetNodeType
  const moving = node as CabinetModuleNodeType
  const movingHalfWidth = moving.width / 2
  const movingHalfDepth = moving.depth / 2
  const movingMinX = local[0] - movingHalfWidth
  const movingMaxX = local[0] + movingHalfWidth
  const movingMinZ = local[2] - movingHalfDepth
  const movingMaxZ = local[2] + movingHalfDepth
  let bestDeltaX = 0
  let bestDistanceX = Number.POSITIVE_INFINITY
  let bestDeltaZ = 0
  let bestDistanceZ = Number.POSITIVE_INFINITY

  const considerX = (delta: number) => {
    const distance = Math.abs(delta)
    if (distance > MAGNETIC_THRESHOLD_M) return
    if (distance < bestDistanceX) {
      bestDeltaX = delta
      bestDistanceX = distance
    }
  }
  const considerZ = (delta: number) => {
    const distance = Math.abs(delta)
    if (distance > MAGNETIC_THRESHOLD_M) return
    if (distance < bestDistanceZ) {
      bestDeltaZ = delta
      bestDistanceZ = distance
    }
  }

  for (const childId of run.children ?? []) {
    if (childId === node.id) continue
    const sibling = nodes[childId as AnyNodeId]
    if (sibling?.type !== 'cabinet-module') continue
    const module = sibling as CabinetModuleNodeType
    const siblingHalfWidth = module.width / 2
    const siblingHalfDepth = module.depth / 2
    const siblingMinX = module.position[0] - siblingHalfWidth
    const siblingMaxX = module.position[0] + siblingHalfWidth
    const siblingMinZ = module.position[2] - siblingHalfDepth
    const siblingMaxZ = module.position[2] + siblingHalfDepth

    const depthBandsTouch =
      movingMinZ <= siblingMaxZ + MAGNETIC_THRESHOLD_M &&
      movingMaxZ >= siblingMinZ - MAGNETIC_THRESHOLD_M
    if (depthBandsTouch) {
      considerX(siblingMinX - movingMaxX)
      considerX(siblingMaxX - movingMinX)
    }

    const widthBandsTouch =
      movingMinX <= siblingMaxX + MAGNETIC_THRESHOLD_M &&
      movingMaxX >= siblingMinX - MAGNETIC_THRESHOLD_M
    if (widthBandsTouch) {
      considerZ(module.position[2] - local[2])
      considerZ(siblingMinZ - movingMinZ)
      considerZ(siblingMaxZ - movingMaxZ)
    }
  }

  if (!Number.isFinite(bestDistanceX) && !Number.isFinite(bestDistanceZ)) {
    return [local[0], local[1], local[2]]
  }
  return [local[0] + bestDeltaX, local[1], local[2] + bestDeltaZ]
}

function planPoint(
  parent: AnyNode,
  localX: number,
  localZ: number,
  nodes: Readonly<Record<string, AnyNode>>,
): PlanPoint {
  const [x, , z] = localToPlan(parent, [localX, 0, localZ], nodes)
  return { x, z }
}

function makeSnapMatch({
  axis,
  candidateNodeId,
  from,
  to,
}: {
  axis: 'x' | 'z'
  candidateNodeId: AnyNodeId
  from: PlanPoint
  to: PlanPoint
}): ParentFrameSnapMatch {
  return {
    axis,
    candidateNodeId,
    from,
    to,
  }
}

function magneticSnapMatches(
  node: AnyNode,
  parent: AnyNode,
  _local: readonly [number, number, number],
  snappedLocal: readonly [number, number, number],
  nodes: Readonly<Record<string, AnyNode>>,
): ParentFrameSnapMatch[] {
  const run = parent as CabinetNodeType
  const moving = node as CabinetModuleNodeType
  const movingHalfWidth = moving.width / 2
  const movingHalfDepth = moving.depth / 2
  const movingMinX = snappedLocal[0] - movingHalfWidth
  const movingMaxX = snappedLocal[0] + movingHalfWidth
  const movingMinZ = snappedLocal[2] - movingHalfDepth
  const movingMaxZ = snappedLocal[2] + movingHalfDepth
  const matches: ParentFrameSnapMatch[] = []

  for (const childId of run.children ?? []) {
    if (matches.length >= 2) break
    if (childId === node.id) continue
    const sibling = nodes[childId as AnyNodeId]
    if (sibling?.type !== 'cabinet-module') continue
    const module = sibling as CabinetModuleNodeType
    const siblingHalfWidth = module.width / 2
    const siblingHalfDepth = module.depth / 2
    const siblingMinX = module.position[0] - siblingHalfWidth
    const siblingMaxX = module.position[0] + siblingHalfWidth
    const siblingMinZ = module.position[2] - siblingHalfDepth
    const siblingMaxZ = module.position[2] + siblingHalfDepth

    if (
      matches.every((match) => match.axis !== 'x') &&
      movingMinZ <= siblingMaxZ + MAGNETIC_THRESHOLD_M &&
      movingMaxZ >= siblingMinZ - MAGNETIC_THRESHOLD_M
    ) {
      const sharedX =
        Math.abs(movingMinX - siblingMaxX) <= GUIDE_EPSILON_M
          ? movingMinX
          : Math.abs(movingMaxX - siblingMinX) <= GUIDE_EPSILON_M
            ? movingMaxX
            : null
      if (sharedX !== null) {
        matches.push(
          makeSnapMatch({
            axis: 'x',
            candidateNodeId: module.id,
            from: planPoint(parent, sharedX, Math.min(movingMinZ, siblingMinZ), nodes),
            to: planPoint(parent, sharedX, Math.max(movingMaxZ, siblingMaxZ), nodes),
          }),
        )
      }
    }

    if (
      matches.every((match) => match.axis !== 'z') &&
      movingMinX <= siblingMaxX + MAGNETIC_THRESHOLD_M &&
      movingMaxX >= siblingMinX - MAGNETIC_THRESHOLD_M
    ) {
      const sharedZ =
        Math.abs(snappedLocal[2] - module.position[2]) <= GUIDE_EPSILON_M
          ? snappedLocal[2]
          : Math.abs(movingMinZ - siblingMinZ) <= GUIDE_EPSILON_M
            ? movingMinZ
            : Math.abs(movingMaxZ - siblingMaxZ) <= GUIDE_EPSILON_M
              ? movingMaxZ
              : null
      if (sharedZ !== null) {
        matches.push(
          makeSnapMatch({
            axis: 'z',
            candidateNodeId: module.id,
            from: planPoint(parent, Math.min(movingMinX, siblingMinX), sharedZ, nodes),
            to: planPoint(parent, Math.max(movingMaxX, siblingMaxX), sharedZ, nodes),
          }),
        )
      }
    }
  }

  return matches
}

export const cabinetModuleParentFrame: MovableParentFrame = {
  resolveParent: runParent,
  parentRotationY: (parent, nodes) =>
    frameWorldTransform(parent as CabinetNodeType, nodes).rotation,
  localToPlan,
  planToLocal,
  magneticSnap,
  magneticSnapMatches,
  // Module position isn't in the run's geometryKey, so a committed move must
  // bump the layout revision to re-flow spans/countertop — and re-anchor any
  // linked L-corner runs to the module's new edge.
  onCommit: (node, parent, sceneApi) => {
    if (node.type !== 'cabinet-module' || parent.type !== 'cabinet') return
    bumpCabinetRunLayoutRevision(sceneApi, parent as CabinetNodeType)
    syncCornerRunsFromSourceModule({
      module: node as CabinetModuleNodeType,
      run: sceneApi.get<CabinetNodeType>(parent.id as AnyNodeId) ?? (parent as CabinetNodeType),
      sceneApi,
    })
  },
  floorplanLiveTransform: ({ node, live }) => {
    const rotation = (node as { rotation?: unknown }).rotation
    return {
      ...node,
      position: live.position,
      rotation: Array.isArray(rotation)
        ? [(rotation[0] as number) ?? 0, live.rotation, (rotation[2] as number) ?? 0]
        : typeof rotation === 'number'
          ? live.rotation
          : rotation,
    } as AnyNode
  },
}
