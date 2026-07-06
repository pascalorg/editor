import type {
  AnyNode,
  AnyNodeId,
  CabinetModuleNode as CabinetModuleNodeType,
  CabinetNode as CabinetNodeType,
  MovableParentFrame,
} from '@pascal-app/core'
import { planToRunLocal, runLocalToPlan } from './run-layout'
import { bumpCabinetRunLayoutRevision, syncCornerRunsFromSourceModule } from './run-ops'

/** Matches the generic move tool's Figma-alignment pull (8 cm). */
const MAGNETIC_THRESHOLD_M = 0.08

function runParent(
  node: AnyNode,
  nodes: Readonly<Record<string, AnyNode>>,
): CabinetNodeType | null {
  if (node.type !== 'cabinet-module' || !node.parentId) return null
  const parent = nodes[node.parentId]
  return parent?.type === 'cabinet' ? (parent as CabinetNodeType) : null
}

function localToPlan(
  parent: AnyNode,
  local: readonly [number, number, number],
): [number, number, number] {
  return runLocalToPlan(parent as CabinetNodeType, local)
}

function planToLocal(
  parent: AnyNode,
  planX: number,
  localY: number,
  planZ: number,
): [number, number, number] {
  return planToRunLocal(parent as CabinetNodeType, planX, localY, planZ)
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

export const cabinetModuleParentFrame: MovableParentFrame = {
  resolveParent: runParent,
  parentRotationY: (parent) => (parent as CabinetNodeType).rotation,
  localToPlan,
  planToLocal,
  magneticSnap,
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
