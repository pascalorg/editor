import type {
  AnyNode,
  AnyNodeId,
  CabinetModuleNode as CabinetModuleNodeType,
  CabinetNode as CabinetNodeType,
  DuplicateSubtreeCloneArgs,
  DuplicateSubtreeCloneResult,
  FloorPlacedFootprint,
  HandleDescriptor,
  LinearResizeHandle,
  NodeDefinition,
  SceneApi,
} from '@pascal-app/core'
import { findLevelAncestorId, selectionProxyIdFromMetadata } from '@pascal-app/core'
import { bakeCabinetAnimationClip } from './animation'
import { buildCabinetFloorplan, buildCabinetModuleFloorplan } from './floorplan'
import { cabinetModuleFloorplanMoveTarget } from './floorplan-move'
import { cabinetFloorplanSiblingOverrides } from './floorplan-overrides'
import { buildCabinetGeometry } from './geometry'
import { toggleCabinetOperationState } from './interaction'
import { cabinetModuleParentFrame } from './move-frame'
import { cabinetPaint } from './paint'
import { cabinetModuleParametrics, cabinetParametrics } from './parametrics'
import useCabinetPlacementType from './placement-type'
import { cabinetQuickActions } from './quick-actions'
import {
  cabinetConnectedDepthBounds,
  cabinetResizeUpperBound,
  MAX_CABINET_DEPTH,
  MAX_CABINET_WIDTH,
  MIN_CABINET_DEPTH,
  MIN_CABINET_WIDTH,
} from './resize-limits'
import { moduleSideOpen } from './run-layout'
import {
  backAlignedRunDepthOverrides,
  backAlignZ,
  bumpCabinetRunLayoutRevision,
  cabinetMetadataRecord,
  cabinetModulesForRun,
  totalCabinetHeight as cabinetTotalHeight,
  cornerSourceWidthOverridesForDerivedDepth,
  previewCornerRunsFromRunSources,
  resolveCabinetType,
  runModuleBaseY,
  syncCornerRunsFromRunSources,
  syncCornerRunsFromSourceModule,
  wallChildOf,
  wallCornerWidthOverridesForDepthTargets,
} from './run-ops'
import { cabinetSceneAction } from './scene-action'
import { CabinetModuleNode, CabinetNode } from './schema'
import { cabinetSlots } from './slots'
import {
  backAnchoredModuleZ,
  isHoodCompartmentType,
  minCabinetCarcassHeightForStack,
  stackForCabinet,
} from './stack'
import {
  cabinetFloorplanAffectedIds,
  cabinetTreeChildIds,
  cabinetTreeHidden,
  cabinetTreeLabel,
} from './tree-structure'
import { resolveCabinetModuleWallSnapLocal, resolveCabinetRunWallSnap } from './wall-snap'

type CabinetEditableNode = CabinetNodeType | CabinetModuleNodeType
type CabinetDuplicableNode = AnyNode & {
  type: 'cabinet' | 'cabinet-module'
  position: [number, number, number]
  rotation: number
}
type CabinetLocalBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
  size: [number, number, number]
  center: [number, number, number]
}

function isCabinetDuplicableNode(node: AnyNode | null | undefined): node is CabinetDuplicableNode {
  return (
    (node?.type === 'cabinet' || node?.type === 'cabinet-module') &&
    Array.isArray((node as { position?: unknown }).position) &&
    typeof (node as { rotation?: unknown }).rotation === 'number'
  )
}

function stripCabinetDuplicateMetadata(metadata: unknown): Record<string, unknown> {
  const {
    cabinetCornerDerivedRun: _derived,
    cabinetCornerSourceLink: _source,
    nodeSelectionProxyId: _proxy,
    ...rest
  } = cabinetMetadataRecord(metadata as CabinetEditableNode['metadata'])
  return rest
}

function cleanCabinetDuplicateNode<N extends AnyNode>(node: N): N {
  return {
    ...node,
    metadata: stripCabinetDuplicateMetadata(node.metadata),
  } as N
}

function composeCabinetDuplicatePose(
  parentPosition: readonly [number, number, number],
  parentRotation: number,
  childPosition: readonly [number, number, number],
  childRotation: number,
) {
  const cos = Math.cos(parentRotation)
  const sin = Math.sin(parentRotation)
  return {
    position: [
      parentPosition[0] + childPosition[0] * cos + childPosition[2] * sin,
      parentPosition[1] + childPosition[1],
      parentPosition[2] - childPosition[0] * sin + childPosition[2] * cos,
    ] as [number, number, number],
    rotation: parentRotation + childRotation,
  }
}

function cabinetDuplicateWorldPose(
  node: AnyNode,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): { position: [number, number, number]; rotation: number } | null {
  if (!isCabinetDuplicableNode(node)) return null
  const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : null
  if (isCabinetDuplicableNode(parent)) {
    const parentPose = cabinetDuplicateWorldPose(parent, nodes)
    return parentPose
      ? composeCabinetDuplicatePose(
          parentPose.position,
          parentPose.rotation,
          node.position,
          node.rotation,
        )
      : null
  }
  return { position: [...node.position], rotation: node.rotation }
}

function prepareCabinetSubtreeClone(args: DuplicateSubtreeCloneArgs): DuplicateSubtreeCloneResult {
  const parent = args.root.parentId ? args.nodes[args.root.parentId as AnyNodeId] : null
  const nestedRun = args.root.type === 'cabinet' && isCabinetDuplicableNode(parent)
  const worldPose = nestedRun ? cabinetDuplicateWorldPose(args.root, args.nodes) : null
  const levelId = nestedRun ? findLevelAncestorId(args.rootId, args.nodes) : null
  const root = {
    ...cleanCabinetDuplicateNode(args.root),
    ...(worldPose ? { position: worldPose.position, rotation: worldPose.rotation } : null),
    ...(levelId ? { parentId: levelId as AnyNodeId } : null),
  } as AnyNode
  return {
    root,
    descendants: args.descendants.map((node) => cleanCabinetDuplicateNode(node)),
    parentId: levelId ? (levelId as AnyNodeId) : undefined,
  }
}

function appendCabinetFloorPlacedFootprints(
  run: CabinetNodeType,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  parentPosition: [number, number, number],
  parentRotation: number,
  footprints: FloorPlacedFootprint[],
) {
  const cos = Math.cos(parentRotation)
  const sin = Math.sin(parentRotation)
  const runPosition: [number, number, number] = [
    parentPosition[0] + run.position[0] * cos + run.position[2] * sin,
    parentPosition[1] + run.position[1],
    parentPosition[2] - run.position[0] * sin + run.position[2] * cos,
  ]
  const runRotation = parentRotation + run.rotation

  const modules = cabinetModulesForRun(run, nodes)
  if (modules.length > 0) {
    const runCos = Math.cos(runRotation)
    const runSin = Math.sin(runRotation)
    for (const module of modules) {
      const modulePosition: [number, number, number] = [
        runPosition[0] + module.position[0] * runCos + module.position[2] * runSin,
        runPosition[1] + module.position[1],
        runPosition[2] - module.position[0] * runSin + module.position[2] * runCos,
      ]
      footprints.push({
        position: modulePosition,
        dimensions: [module.width, cabinetTotalHeight(module), module.depth],
        rotation: [0, runRotation + module.rotation, 0],
      })
    }
  } else {
    footprints.push({
      position: runPosition,
      dimensions: [run.width, cabinetTotalHeight(run), run.depth],
      rotation: [0, runRotation, 0],
    })
  }

  for (const childId of run.children ?? []) {
    const child = nodes[childId as AnyNodeId]
    if (isCabinetRun(child)) {
      appendCabinetFloorPlacedFootprints(child, nodes, runPosition, runRotation, footprints)
    }
  }
}

export function cabinetFloorPlacedFootprints(
  node: CabinetNodeType,
  nodes?: Readonly<Record<AnyNodeId, AnyNode>>,
): FloorPlacedFootprint[] {
  if (!nodes) {
    return [
      {
        position: [...node.position] as [number, number, number],
        dimensions: [node.width, cabinetTotalHeight(node), node.depth],
        rotation: [0, node.rotation, 0],
      },
    ]
  }

  const footprints: FloorPlacedFootprint[] = []
  appendCabinetFloorPlacedFootprints(node, nodes, [0, 0, 0], 0, footprints)
  return footprints
}

const SIDE_HANDLE_OFFSET = 0.18
const HEIGHT_HANDLE_OFFSET = 0.22
const ROTATE_CORNER_OFFSET = 0.32
const ROTATE_RING_OFFSET = 0.04
const MIN_CABINET_CARCASS_HEIGHT = 0.4
const CABINET_ADJACENCY_EPSILON = 1e-4

function isCabinetModule(node: AnyNode | undefined): node is CabinetModuleNodeType {
  return node?.type === 'cabinet-module'
}

function isCabinetRun(node: AnyNode | undefined): node is CabinetNodeType {
  return node?.type === 'cabinet'
}

function hasCabinetParentId(node: Pick<CabinetEditableNode, 'parentId'>): boolean {
  const parentId = node.parentId
  return (
    typeof parentId === 'string' &&
    (parentId.startsWith('cabinet_') || parentId.startsWith('cabinet-module_'))
  )
}

function resolveCabinetGroupMoveSnap({
  candidatePosition,
  levelId,
  movingIds,
  node,
  nodes,
}: {
  candidatePosition: [number, number, number]
  levelId: AnyNodeId | null
  movingIds: readonly AnyNodeId[]
  node: AnyNode
  nodes: Readonly<Record<string, AnyNode>>
}): [number, number, number] | null {
  if (node.type !== 'cabinet' || !levelId) return null
  return resolveCabinetRunWallSnap({
    cabinet: node,
    candidatePosition,
    excludeIds: movingIds,
    gridStep: 0,
    nodes: nodes as Record<AnyNodeId, AnyNode>,
    parentLevelId: levelId,
  })
}

/**
 * Wall snap for a single dragged module. `parentFrame` kinds exchange
 * `candidatePosition` in the run's LOCAL frame with the move tool (it
 * converts through `planToLocal` before and `localToPlan` after), so this
 * resolver works local-in / local-out.
 */
function resolveCabinetModuleGroupMoveSnap({
  candidatePosition,
  levelId,
  movingIds,
  node,
  nodes,
}: {
  candidatePosition: [number, number, number]
  levelId: AnyNodeId | null
  movingIds: readonly AnyNodeId[]
  node: AnyNode
  nodes: Readonly<Record<string, AnyNode>>
}): [number, number, number] | null {
  if (node.type !== 'cabinet-module' || !node.parentId) return null
  const run = nodes[node.parentId]
  if (!isCabinetRun(run)) return null
  const parentLevelId = (levelId ?? run.parentId ?? null) as AnyNodeId | null
  if (!parentLevelId) return null
  return resolveCabinetModuleWallSnapLocal({
    candidateLocal: candidatePosition,
    excludeIds: movingIds,
    module: node,
    nodes: nodes as Record<AnyNodeId, AnyNode>,
    parentLevelId,
    run,
  })
}

function cabinetLayoutRevision(metadata: CabinetNodeType['metadata']): unknown {
  return cabinetMetadataRecord(metadata).cabinetLayoutRevision ?? null
}

function cabinetAdjacencyRevision(metadata: CabinetNodeType['metadata']): unknown {
  return cabinetMetadataRecord(metadata).cabinetAdjacencyRevision ?? null
}

// Margin added to each run's reach when deciding whether two sibling runs can
// influence each other's countertop join — generous relative to any plausible
// `countertopOverhang` so a run sliding away still re-keys the neighbor it
// just un-joined from.
const CABINET_NEIGHBOR_JOIN_MARGIN = 0.5

export type CabinetRunFootprint = {
  parentId: AnyNodeId | null
  x: number
  z: number
  reach: number
}

export function cabinetRunFootprint(
  run: CabinetNodeType,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): CabinetRunFootprint {
  const bounds = cabinetLocalBounds(run, nodes)
  return {
    parentId: (run.parentId ?? null) as AnyNodeId | null,
    x: run.position[0],
    z: run.position[2],
    reach:
      Math.hypot(bounds.size[0], bounds.size[2]) / 2 +
      Math.hypot(bounds.center[0], bounds.center[2]) +
      CABINET_NEIGHBOR_JOIN_MARGIN,
  }
}

/**
 * Re-key sibling cabinet runs whose countertop join could be affected by a
 * run that moved / resized / re-flowed. A run's overhang trims against
 * adjacent sibling runs (`siblingCabinetSpansInRunLocal`), but a neighbor's
 * own `geometryKey` doesn't change when THIS run moves — marking it dirty
 * alone would be swallowed by the geometry system's key-skip cache. Bumping
 * `cabinetAdjacencyRevision` (folded into the run geometryKey) both dirties
 * and re-keys it. History is paused: the counter is derived presentation
 * state, and an undo of the triggering move re-fires the watcher anyway.
 */
export function bumpCabinetRunsNear(
  sceneApi: SceneApi,
  footprints: readonly CabinetRunFootprint[],
  moverIds: ReadonlySet<string>,
) {
  const nodes = sceneApi.nodes()
  const targets = new Set<AnyNodeId>()
  for (const footprint of footprints) {
    if (!footprint.parentId) continue
    const parent = nodes[footprint.parentId]
    const childIds = (parent as unknown as { children?: AnyNodeId[] } | undefined)?.children
    if (!Array.isArray(childIds)) continue
    for (const childId of childIds) {
      if (moverIds.has(childId) || targets.has(childId)) continue
      const sibling = nodes[childId]
      if (!isCabinetRun(sibling)) continue
      const siblingFootprint = cabinetRunFootprint(sibling, nodes)
      const distance = Math.hypot(
        siblingFootprint.x - footprint.x,
        siblingFootprint.z - footprint.z,
      )
      if (distance <= siblingFootprint.reach + footprint.reach) targets.add(childId)
    }
  }
  if (targets.size === 0) return
  // A mover's own trim also depends on its offset to those neighbors, and
  // `position` is not in its geometryKey — re-key it alongside them. Movers
  // with no neighbors in range never reach here, keeping lone-cabinet moves
  // rebuild-free.
  for (const id of moverIds) {
    if (isCabinetRun(nodes[id as AnyNodeId])) targets.add(id as AnyNodeId)
  }

  sceneApi.pauseHistory()
  try {
    for (const id of targets) {
      const run = sceneApi.get(id)
      if (!isCabinetRun(run)) continue
      const metadataRecord = cabinetMetadataRecord(run.metadata)
      const currentRevision =
        typeof metadataRecord.cabinetAdjacencyRevision === 'number'
          ? metadataRecord.cabinetAdjacencyRevision
          : 0
      sceneApi.update(id, {
        metadata: { ...metadataRecord, cabinetAdjacencyRevision: currentRevision + 1 },
      } as Partial<AnyNode>)
      sceneApi.markDirty(id)
    }
  } finally {
    sceneApi.resumeHistory()
  }
}

/** Inputs of a run that can change a NEIGHBOR's countertop join. */
export function cabinetRunNeighborSignature(run: CabinetNodeType): string {
  return JSON.stringify([
    run.position[0],
    run.position[2],
    run.rotation,
    run.width,
    run.depth,
    run.carcassHeight,
    run.runTier,
    run.countertopOverhang,
    run.children ?? [],
    cabinetLayoutRevision(run.metadata),
  ])
}

function includeCabinetModuleBounds(
  module: CabinetModuleNodeType,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  origin: readonly [number, number, number],
  bounds: Pick<CabinetLocalBounds, 'minX' | 'maxX' | 'minY' | 'maxY' | 'minZ' | 'maxZ'>,
) {
  const x = origin[0] + module.position[0]
  const y = origin[1] + module.position[1]
  const z = origin[2] + module.position[2]
  bounds.minX = Math.min(bounds.minX, x - module.width / 2)
  bounds.maxX = Math.max(bounds.maxX, x + module.width / 2)
  bounds.minY = Math.min(bounds.minY, y - (module.showPlinth ? module.plinthHeight : 0))
  bounds.maxY = Math.max(
    bounds.maxY,
    y + module.carcassHeight + (module.withCountertop ? module.countertopThickness : 0),
  )
  bounds.minZ = Math.min(bounds.minZ, z - module.depth / 2)
  bounds.maxZ = Math.max(bounds.maxZ, z + module.depth / 2)

  for (const childId of module.children ?? []) {
    const child = nodes[childId as AnyNodeId]
    if (isCabinetModule(child)) includeCabinetModuleBounds(child, nodes, [x, y, z], bounds)
  }
}

/**
 * Fold a child cabinet run (an L-corner leg parented to this run) into the
 * parent's local bounds: take the child's own local bounds, rotate its XZ
 * corners by the child's local rotation, and offset by its local position.
 */
function includeChildRunBounds(
  child: CabinetNodeType,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  bounds: Pick<CabinetLocalBounds, 'minX' | 'maxX' | 'minY' | 'maxY' | 'minZ' | 'maxZ'>,
) {
  const childBounds = cabinetLocalBounds(child, nodes)
  const cos = Math.cos(child.rotation)
  const sin = Math.sin(child.rotation)
  for (const [lx, lz] of [
    [childBounds.minX, childBounds.minZ],
    [childBounds.maxX, childBounds.minZ],
    [childBounds.maxX, childBounds.maxZ],
    [childBounds.minX, childBounds.maxZ],
  ] as const) {
    const x = child.position[0] + lx * cos + lz * sin
    const z = child.position[2] - lx * sin + lz * cos
    bounds.minX = Math.min(bounds.minX, x)
    bounds.maxX = Math.max(bounds.maxX, x)
    bounds.minZ = Math.min(bounds.minZ, z)
    bounds.maxZ = Math.max(bounds.maxZ, z)
  }
  bounds.minY = Math.min(bounds.minY, child.position[1] + childBounds.minY)
  bounds.maxY = Math.max(bounds.maxY, child.position[1] + childBounds.maxY)
}

function cabinetLocalBounds(
  node: CabinetEditableNode,
  nodes?: Readonly<Record<AnyNodeId, AnyNode>>,
): CabinetLocalBounds {
  const bounds = {
    minX: -node.width / 2,
    maxX: node.width / 2,
    minY: 0,
    maxY: cabinetTotalHeight(node),
    minZ: -node.depth / 2,
    maxZ: node.depth / 2,
  }

  if (isCabinetRun(node) && nodes) {
    const modules = cabinetModulesForRun(node, nodes)
    if (modules.length > 0) {
      bounds.minX = Number.POSITIVE_INFINITY
      bounds.maxX = Number.NEGATIVE_INFINITY
      bounds.minY = 0
      bounds.maxY = (node.showPlinth ? node.plinthHeight : 0) + node.carcassHeight
      bounds.minZ = Number.POSITIVE_INFINITY
      bounds.maxZ = Number.NEGATIVE_INFINITY
      for (const module of modules) {
        includeCabinetModuleBounds(module, nodes, [0, 0, 0], bounds)
      }
      bounds.maxY += node.withCountertop ? node.countertopThickness : 0
      // A seating back overhang (unlike the small front/side overhang) is
      // deep enough to matter for selection and collision.
      if (node.withCountertop && node.barLedge?.edge !== 'back') {
        bounds.minZ -= node.countertopBackOverhang
      }
      if (node.withFinishedBack) bounds.minZ -= node.boardThickness
      if (node.barLedge) {
        const edge = node.barLedge.edge
        if (edge === 'back') bounds.minZ -= node.barLedge.depth
        if (edge === 'left') bounds.minX -= node.barLedge.depth
        if (edge === 'right') bounds.maxX += node.barLedge.depth
        bounds.maxY = Math.max(bounds.maxY, node.barLedge.height)
      }
    }
    // L-corner leg runs are cabinet children of the source run — fold them in
    // so the run's rotate ring / pivot / drag box covers the whole L.
    for (const childId of node.children ?? []) {
      const child = nodes[childId as AnyNodeId]
      if (isCabinetRun(child)) includeChildRunBounds(child, nodes, bounds)
    }
  }

  const width = Math.max(0.01, bounds.maxX - bounds.minX)
  const height = Math.max(0.01, bounds.maxY - bounds.minY)
  const depth = Math.max(0.01, bounds.maxZ - bounds.minZ)
  return {
    ...bounds,
    size: [width, height, depth],
    center: [
      (bounds.minX + bounds.maxX) / 2,
      (bounds.minY + bounds.maxY) / 2,
      (bounds.minZ + bounds.maxZ) / 2,
    ],
  }
}

function cabinetPlanBoundsAabb(
  node: CabinetNodeType,
  nodes?: Readonly<Record<AnyNodeId, AnyNode>>,
) {
  const bounds = cabinetLocalBounds(node, nodes)
  const cos = Math.cos(node.rotation)
  const sin = Math.sin(node.rotation)
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  for (const [lx, lz] of [
    [bounds.minX, bounds.minZ],
    [bounds.maxX, bounds.minZ],
    [bounds.maxX, bounds.maxZ],
    [bounds.minX, bounds.maxZ],
  ] as const) {
    const x = node.position[0] + lx * cos + lz * sin
    const z = node.position[2] - lx * sin + lz * cos
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }

  return { minX, maxX, minZ, maxZ }
}

function cabinetModuleSideOpen(
  module: CabinetModuleNodeType,
  side: 'left' | 'right',
  sceneApi: SceneApi,
) {
  const parent = module.parentId ? sceneApi.get(module.parentId as AnyNodeId) : undefined
  if (!isCabinetRun(parent)) return true
  return moduleSideOpen(
    cabinetModulesForRun(parent, sceneApi.nodes()),
    module.id,
    side,
    CABINET_ADJACENCY_EPSILON,
  )
}

function commitRunResize(
  run: CabinetNodeType,
  patch: Partial<CabinetNodeType>,
  sceneApi: SceneApi,
  options: { cornerSync?: 'full' | 'width-only' } = {},
) {
  sceneApi.update(run.id as AnyNodeId, patch as Partial<AnyNode>)
  const nextRun = { ...run, ...patch }
  const syncDepth = typeof patch.depth === 'number'
  const syncHeight = typeof patch.carcassHeight === 'number'
  const syncPosition = patch.showPlinth !== undefined || typeof patch.plinthHeight === 'number'

  if (syncDepth || syncHeight || syncPosition) {
    const depthOverrides = new Map(
      syncDepth ? backAlignedRunDepthOverrides(run, sceneApi.nodes(), nextRun.depth) : [],
    )
    for (const module of cabinetModulesForRun(run, sceneApi.nodes())) {
      const modulePatch: Partial<CabinetModuleNodeType> = {}
      if (syncDepth) {
        Object.assign(modulePatch, depthOverrides.get(module.id as AnyNodeId))
      }
      if (syncHeight) {
        modulePatch.carcassHeight = Math.max(
          nextRun.carcassHeight,
          minCabinetCarcassHeightForStack(module),
        )
      }
      if (syncPosition) {
        modulePatch.position = [
          modulePatch.position?.[0] ?? module.position[0],
          runModuleBaseY(nextRun),
          modulePatch.position?.[2] ?? module.position[2],
        ]
      }
      if (Object.keys(modulePatch).length > 0) {
        sceneApi.update(module.id as AnyNodeId, modulePatch as Partial<AnyNode>)
        const wallChild = wallChildOf(module, sceneApi.nodes())
        if (wallChild && typeof modulePatch.depth === 'number') {
          sceneApi.update(
            wallChild.id as AnyNodeId,
            {
              position: [
                wallChild.position[0],
                wallChild.position[1],
                backAlignZ(modulePatch.depth, wallChild.depth),
              ],
            } as Partial<AnyNode>,
          )
        }
      }
    }
    if (syncDepth) {
      for (const [id, depthPatch] of depthOverrides) {
        if (sceneApi.get(id)?.type !== 'cabinet') continue
        sceneApi.update(id, depthPatch as Partial<AnyNode>)
      }
    }
  }

  if (syncDepth || syncHeight || syncPosition) {
    bumpCabinetRunLayoutRevision(sceneApi, nextRun)
    syncCornerRunsFromRunSources({
      baseLayout: options.cornerSync ?? 'full',
      run: nextRun,
      sceneApi,
    })
  }
}

function commitModuleResize(
  module: CabinetModuleNodeType,
  patch: Partial<CabinetModuleNodeType>,
  sceneApi: SceneApi,
) {
  const nodes = sceneApi.nodes()
  const parent = module.parentId ? nodes[module.parentId as AnyNodeId] : undefined
  const parentRun = isCabinetRun(parent) ? parent : undefined

  if (!parentRun) {
    sceneApi.update(module.id as AnyNodeId, patch as Partial<AnyNode>)
    const parentModule = isCabinetModule(parent) ? parent : undefined
    if (parentModule) sceneApi.markDirty(parentModule.id as AnyNodeId)
    return
  }

  if (typeof patch.width === 'number') {
    sceneApi.update(module.id as AnyNodeId, patch as Partial<AnyNode>)
    const wallChild = wallChildOf(module, sceneApi.nodes())
    if (wallChild) {
      sceneApi.update(
        wallChild.id as AnyNodeId,
        {
          width: patch.width,
          position: [
            wallChild.position[0],
            wallChild.position[1],
            backAlignZ(patch.depth ?? module.depth, wallChild.depth),
          ],
        } as Partial<AnyNode>,
      )
    }
    bumpCabinetRunLayoutRevision(sceneApi, parentRun)
    syncCornerRunsFromSourceModule({
      module: sceneApi.get<CabinetModuleNodeType>(module.id as AnyNodeId) ?? module,
      run: sceneApi.get<CabinetNodeType>(parentRun.id as AnyNodeId) ?? parentRun,
      sceneApi,
    })
    return
  }

  const modulePatch: Partial<CabinetModuleNodeType> = { ...patch }
  if (typeof patch.depth === 'number') {
    modulePatch.position = [
      patch.position?.[0] ?? module.position[0],
      patch.position?.[1] ?? module.position[1],
      backAnchoredModuleZ(module.position[2], module.depth, patch.depth),
    ]
  }

  sceneApi.update(module.id as AnyNodeId, modulePatch as Partial<AnyNode>)

  if (resolveCabinetType(module, parentRun) === 'base') {
    const runPatch: Partial<CabinetNodeType> = {}
    if (typeof patch.depth === 'number') runPatch.depth = patch.depth
    if (typeof patch.carcassHeight === 'number') {
      runPatch.carcassHeight = patch.carcassHeight
    }
    if (Object.keys(runPatch).length > 0) {
      commitRunResize(parentRun, runPatch, sceneApi)
    } else {
      bumpCabinetRunLayoutRevision(sceneApi, parentRun)
    }
  } else {
    bumpCabinetRunLayoutRevision(sceneApi, parentRun)
  }

  syncCornerRunsFromSourceModule({
    module: sceneApi.get<CabinetModuleNodeType>(module.id as AnyNodeId) ?? module,
    run: sceneApi.get<CabinetNodeType>(parentRun.id as AnyNodeId) ?? parentRun,
    sceneApi,
  })

  const wallChild = wallChildOf(module, sceneApi.nodes())
  if (wallChild && typeof modulePatch.depth === 'number') {
    sceneApi.update(
      wallChild.id as AnyNodeId,
      {
        position: [
          wallChild.position[0],
          wallChild.position[1],
          backAlignZ(modulePatch.depth, wallChild.depth),
        ],
      } as Partial<AnyNode>,
    )
  }
}

function commitCabinetResize(
  node: CabinetEditableNode,
  patch: Partial<CabinetEditableNode>,
  sceneApi: SceneApi,
) {
  const liveNode = sceneApi.get(node.id as AnyNodeId) ?? node
  if (isCabinetRun(liveNode)) {
    commitRunResize(liveNode, patch as Partial<CabinetNodeType>, sceneApi)
    return
  }
  if (isCabinetModule(liveNode)) {
    commitModuleResize(liveNode, patch as Partial<CabinetModuleNodeType>, sceneApi)
    return
  }
  sceneApi.update(node.id as AnyNodeId, patch as Partial<AnyNode>)
}

function cabinetWidthHandle(side: 'left' | 'right'): HandleDescriptor<CabinetEditableNode> {
  const sign = side === 'right' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: side === 'right' ? 'min' : 'max',
    min: MIN_CABINET_WIDTH,
    max: (node) => cabinetResizeUpperBound(node.width, MAX_CABINET_WIDTH),
    currentValue: (node) => node.width,
    apply: (node, width) => ({
      width,
      position: [
        node.position[0] + (sign * (width - node.width)) / 2,
        node.position[1],
        node.position[2],
      ],
    }),
    commit: commitCabinetResize,
    visible: (node, sceneApi) =>
      !isCabinetModule(node) || cabinetModuleSideOpen(node, side, sceneApi),
    placement: {
      position: (node) => [
        sign * (node.width / 2 + SIDE_HANDLE_OFFSET),
        cabinetTotalHeight(node) / 2,
        0,
      ],
      rotationY: () => (side === 'left' ? Math.PI : 0),
    },
  }
}

function cabinetDepthResizePatch<N extends CabinetEditableNode>(
  node: N,
  depth: number,
): Partial<N> {
  return {
    depth,
    position: [node.position[0], node.position[1], node.position[2] + (depth - node.depth) / 2],
  } as Partial<N>
}

function cabinetDepthHandle(): LinearResizeHandle<CabinetEditableNode> {
  return {
    kind: 'linear-resize',
    axis: 'z',
    anchor: 'min',
    min: MIN_CABINET_DEPTH,
    max: (node) => cabinetResizeUpperBound(node.depth, MAX_CABINET_DEPTH),
    currentValue: (node) => node.depth,
    apply: cabinetDepthResizePatch,
    commit: commitCabinetResize,
    placement: {
      position: (node) => [0, cabinetTotalHeight(node) / 2, node.depth / 2 + SIDE_HANDLE_OFFSET],
    },
  }
}

function cornerBaseSourceRunId(node: CabinetNodeType): AnyNodeId | null {
  const value = cabinetMetadataRecord(node.metadata).cabinetCornerDerivedRun
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const role = (value as { role?: unknown }).role
  const sourceRunId = (value as { sourceRunId?: unknown }).sourceRunId
  return role === 'base-leg' && typeof sourceRunId === 'string' ? (sourceRunId as AnyNodeId) : null
}

function connectedBaseRuns(node: CabinetNodeType, sceneApi: SceneApi): CabinetNodeType[] {
  const runs = new Map<AnyNodeId, CabinetNodeType>()
  for (const candidate of Object.values(sceneApi.nodes())) {
    if (isCabinetRun(candidate) && candidate.runTier === 'base') {
      runs.set(candidate.id as AnyNodeId, candidate)
    }
  }
  runs.set(node.id as AnyNodeId, node)

  const neighbors = new Map<AnyNodeId, Set<AnyNodeId>>()
  const connect = (a: AnyNodeId, b: AnyNodeId) => {
    const aNeighbors = neighbors.get(a) ?? new Set<AnyNodeId>()
    const bNeighbors = neighbors.get(b) ?? new Set<AnyNodeId>()
    aNeighbors.add(b)
    bNeighbors.add(a)
    neighbors.set(a, aNeighbors)
    neighbors.set(b, bNeighbors)
  }
  for (const run of runs.values()) {
    const sourceRunId = cornerBaseSourceRunId(run)
    if (sourceRunId && runs.has(sourceRunId)) connect(sourceRunId, run.id as AnyNodeId)
  }

  const connected: CabinetNodeType[] = []
  const pending: AnyNodeId[] = [node.id as AnyNodeId]
  const visited = new Set<AnyNodeId>()
  while (pending.length > 0) {
    const id = pending.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    const run = runs.get(id)
    if (run) connected.push(run)
    for (const neighbor of neighbors.get(id) ?? []) pending.push(neighbor)
  }
  return connected
}

function cabinetRunFrontCenter(run: CabinetNodeType, sceneApi: SceneApi): [number, number, number] {
  const modules = cabinetModulesForRun(run, sceneApi.nodes())
  if (modules.length === 0) {
    return [0, cabinetTotalHeight(run) / 2, run.depth / 2 + SIDE_HANDLE_OFFSET]
  }
  const minX = Math.min(...modules.map((module) => module.position[0] - module.width / 2))
  const maxX = Math.max(...modules.map((module) => module.position[0] + module.width / 2))
  const maxZ = Math.max(...modules.map((module) => module.position[2] + module.depth / 2))
  return [(minX + maxX) / 2, cabinetTotalHeight(run) / 2, maxZ + SIDE_HANDLE_OFFSET]
}

function cabinetRunPointInSelectedFrame(
  selected: CabinetEditableNode,
  target: CabinetEditableNode,
  point: readonly [number, number, number],
  sceneApi: SceneApi,
): [number, number, number] {
  const nodes = sceneApi.nodes() as Readonly<Record<AnyNodeId, AnyNode>>
  const selectedWorld = cabinetDuplicateWorldPose(selected, nodes)
  const targetWorld = cabinetDuplicateWorldPose(target, nodes)
  if (!selectedWorld || !targetWorld) return [point[0], point[1], point[2]]
  const worldPoint = composeCabinetDuplicatePose(
    targetWorld.position,
    targetWorld.rotation,
    point,
    0,
  ).position
  const dx = worldPoint[0] - selectedWorld.position[0]
  const dz = worldPoint[2] - selectedWorld.position[2]
  const cos = Math.cos(selectedWorld.rotation)
  const sin = Math.sin(selectedWorld.rotation)
  return [cos * dx - sin * dz, worldPoint[1] - selectedWorld.position[1], sin * dx + cos * dz]
}

function cabinetRootRun(node: CabinetEditableNode, sceneApi: SceneApi): CabinetNodeType | null {
  let current: CabinetEditableNode = node
  let root: CabinetNodeType | null = isCabinetRun(current) ? current : null
  const visited = new Set<AnyNodeId>()
  while (current.parentId && !visited.has(current.parentId as AnyNodeId)) {
    visited.add(current.parentId as AnyNodeId)
    const parent = sceneApi.get(current.parentId as AnyNodeId)
    if (!isCabinetRun(parent) && !isCabinetModule(parent)) break
    current = parent
    if (isCabinetRun(current)) root = current
  }
  return root
}

function cabinetWallTargets(node: CabinetEditableNode, sceneApi: SceneApi): CabinetEditableNode[] {
  const root = cabinetRootRun(node, sceneApi)
  if (!root) return []
  const targets: CabinetEditableNode[] = []
  const visited = new Set<AnyNodeId>()
  const visit = (current: CabinetEditableNode) => {
    if (visited.has(current.id as AnyNodeId)) return
    visited.add(current.id as AnyNodeId)
    if (isCabinetRun(current) && current.runTier === 'wall') {
      targets.push(current)
      return
    }
    const parent = current.parentId ? sceneApi.get(current.parentId as AnyNodeId) : undefined
    if (isCabinetModule(current) && isCabinetModule(parent)) {
      if (!isHoodOnlyCabinet(current)) targets.push(current)
      return
    }
    for (const childId of current.children ?? []) {
      const child = sceneApi.get(childId as AnyNodeId)
      if (isCabinetRun(child) || isCabinetModule(child)) visit(child)
    }
  }
  visit(root)
  return targets
}

function cabinetWallDepthPreview(
  targets: readonly CabinetEditableNode[],
  depth: number,
  sceneApi: SceneApi,
  adjustCornerWidths: boolean,
): ReadonlyArray<readonly [AnyNodeId, Partial<AnyNode>]> {
  const overrides = new Map<AnyNodeId, Partial<AnyNode>>()
  const liveTargets = targets.map(
    (target) => sceneApi.get<CabinetEditableNode>(target.id as AnyNodeId) ?? target,
  )
  for (const live of liveTargets) {
    if (isCabinetRun(live)) {
      overrides.set(live.id as AnyNodeId, { depth } as Partial<AnyNode>)
      for (const [id, patch] of backAlignedRunDepthOverrides(live, sceneApi.nodes(), depth)) {
        overrides.set(id, { ...(overrides.get(id) ?? {}), ...patch } as Partial<AnyNode>)
      }
      continue
    }
    overrides.set(live.id as AnyNodeId, cabinetDepthResizePatch(live, depth) as Partial<AnyNode>)
  }
  if (adjustCornerWidths) {
    for (const [id, patch] of wallCornerWidthOverridesForDepthTargets({
      depth,
      nodes: sceneApi.nodes(),
      targets: liveTargets,
    })) {
      overrides.set(id, { ...(overrides.get(id) ?? {}), ...patch } as Partial<AnyNode>)
    }
  }
  return [...overrides]
}

function commitCabinetWallDepth(
  targets: readonly CabinetEditableNode[],
  depth: number,
  sceneApi: SceneApi,
  adjustCornerWidths: boolean,
) {
  const preview = cabinetWallDepthPreview(targets, depth, sceneApi, adjustCornerWidths)
  for (const [id, patch] of preview) {
    sceneApi.update(id, patch)
  }
  const bumpedRuns = new Set<AnyNodeId>()
  for (const [id] of preview) {
    const live = sceneApi.get(id)
    if (isCabinetRun(live)) {
      if (!bumpedRuns.has(live.id as AnyNodeId)) {
        bumpedRuns.add(live.id as AnyNodeId)
        bumpCabinetRunLayoutRevision(sceneApi, live)
      }
      continue
    }
    const parent = live?.parentId ? sceneApi.get(live.parentId as AnyNodeId) : undefined
    if (isCabinetRun(parent) && !bumpedRuns.has(parent.id as AnyNodeId)) {
      bumpedRuns.add(parent.id as AnyNodeId)
      bumpCabinetRunLayoutRevision(sceneApi, parent)
    } else if (isCabinetModule(parent)) {
      sceneApi.markDirty(parent.id as AnyNodeId)
    }
  }
}

function cabinetWallDepthBounds(
  targets: readonly CabinetEditableNode[],
  sceneApi: SceneApi,
  adjustCornerWidths: boolean,
): { min: number; max: number } {
  const liveTargets = targets.map(
    (target) => sceneApi.get<CabinetEditableNode>(target.id as AnyNodeId) ?? target,
  )
  const currentDepth = liveTargets[0]?.depth ?? MIN_CABINET_DEPTH
  let min = MIN_CABINET_DEPTH
  let max = cabinetResizeUpperBound(currentDepth, MAX_CABINET_DEPTH)
  if (!adjustCornerWidths) return { min, max }
  const baselineAdjustments = new Map(
    wallCornerWidthOverridesForDepthTargets({
      clampWidths: false,
      depth: currentDepth,
      nodes: sceneApi.nodes(),
      targets: liveTargets,
    }),
  )
  const unitAdjustments = wallCornerWidthOverridesForDepthTargets({
    clampWidths: false,
    depth: currentDepth + 1,
    nodes: sceneApi.nodes(),
    targets: liveTargets,
  })
  for (const [id, patch] of unitAdjustments) {
    const cabinetPatch = patch as Partial<CabinetModuleNodeType>
    if (typeof cabinetPatch.width !== 'number') continue
    const node = sceneApi.get<CabinetModuleNodeType>(id)
    if (!isCabinetModule(node)) continue
    const baselinePatch = baselineAdjustments.get(id) as Partial<CabinetModuleNodeType> | undefined
    const baselineWidth =
      typeof baselinePatch?.width === 'number' ? baselinePatch.width : node.width
    const factor = cabinetPatch.width - baselineWidth
    if (Math.abs(factor) <= CABINET_ADJACENCY_EPSILON) continue
    const minWidth =
      node.name === 'Wall Bridge Filler'
        ? 0
        : node.name?.includes('Filler')
          ? 0.05
          : MIN_CABINET_WIDTH
    const maxWidth = cabinetResizeUpperBound(baselineWidth, MAX_CABINET_WIDTH)
    const firstDepth = currentDepth + (minWidth - baselineWidth) / factor
    const secondDepth = currentDepth + (maxWidth - baselineWidth) / factor
    min = Math.max(min, Math.min(firstDepth, secondDepth))
    max = Math.min(max, Math.max(firstDepth, secondDepth))
  }
  return {
    min: Math.min(currentDepth, min),
    max: Math.max(currentDepth, max),
  }
}

function cabinetWallGroupDepthHandles(
  selected: CabinetEditableNode,
  sceneApi: SceneApi,
): LinearResizeHandle<CabinetEditableNode>[] {
  const targets = cabinetWallTargets(selected, sceneApi)
  if (targets.length < 2) return []

  const groups: Array<{ rotation: number; targets: CabinetEditableNode[] }> = []
  for (const target of targets) {
    const rotation =
      cabinetDuplicateWorldPose(target, sceneApi.nodes())?.rotation ?? target.rotation
    const group = groups.find(
      (candidate) =>
        Math.abs(
          Math.atan2(
            Math.sin(rotation - candidate.rotation),
            Math.cos(rotation - candidate.rotation),
          ),
        ) < 1e-3,
    )
    if (group) group.targets.push(target)
    else groups.push({ rotation, targets: [target] })
  }

  const selectedRotation = cabinetDuplicateWorldPose(selected, sceneApi.nodes())?.rotation ?? 0
  return groups.map((group) => {
    const representative = group.targets[0]!
    const relativeRotation = group.rotation - selectedRotation
    const frontX = Math.sin(relativeRotation)
    const frontZ = Math.cos(relativeRotation)
    const axis = Math.abs(frontX) > Math.abs(frontZ) ? 'x' : 'z'
    const positive = axis === 'x' ? frontX >= 0 : frontZ >= 0
    const adjustCornerWidths = !(Math.abs(frontX) < 1e-3 && frontZ > 0)
    const depthBounds = () => cabinetWallDepthBounds(group.targets, sceneApi, adjustCornerWidths)
    const clampedDepth = (requestedDepth: number, liveSceneApi: SceneApi) => {
      const bounds = cabinetWallDepthBounds(group.targets, liveSceneApi, adjustCornerWidths)
      return Math.min(bounds.max, Math.max(bounds.min, requestedDepth))
    }
    return {
      kind: 'linear-resize',
      axis,
      anchor: positive ? 'min' : 'max',
      min: () => depthBounds().min,
      max: () => depthBounds().max,
      currentValue: () =>
        sceneApi.get<CabinetEditableNode>(representative.id as AnyNodeId)?.depth ??
        representative.depth,
      overrideTarget: () => representative.id as AnyNodeId,
      apply: (_node, depth) => ({ depth }),
      previewOverrides: (_node, depth, liveSceneApi) =>
        cabinetWallDepthPreview(
          group.targets,
          clampedDepth(depth, liveSceneApi),
          liveSceneApi,
          adjustCornerWidths,
        ),
      commit: (_node, patch, liveSceneApi) => {
        if (typeof patch.depth === 'number') {
          commitCabinetWallDepth(
            group.targets,
            clampedDepth(patch.depth, liveSceneApi),
            liveSceneApi,
            adjustCornerWidths,
          )
        }
      },
      placement: {
        position: (node, liveSceneApi) => {
          const points = group.targets.map((target) => {
            const liveTarget =
              liveSceneApi.get<CabinetEditableNode>(target.id as AnyNodeId) ?? target
            const point = isCabinetRun(liveTarget)
              ? cabinetRunFrontCenter(liveTarget, liveSceneApi)
              : ([
                  0,
                  cabinetTotalHeight(liveTarget) / 2,
                  liveTarget.depth / 2 + SIDE_HANDLE_OFFSET,
                ] as const)
            return cabinetRunPointInSelectedFrame(node, liveTarget, point, liveSceneApi)
          })
          return [
            points.reduce((sum, point) => sum + point[0], 0) / points.length,
            points.reduce((sum, point) => sum + point[1], 0) / points.length,
            points.reduce((sum, point) => sum + point[2], 0) / points.length,
          ]
        },
        rotationY: () => (axis === 'x' ? relativeRotation - Math.PI / 2 : relativeRotation),
      },
    }
  })
}

function cabinetConnectedRunDepthHandle(
  selected: CabinetNodeType,
  target: CabinetNodeType,
  sceneApi: SceneApi,
): LinearResizeHandle<CabinetNodeType> {
  const nodes = sceneApi.nodes() as Readonly<Record<AnyNodeId, AnyNode>>
  const selectedWorld = cabinetDuplicateWorldPose(selected, nodes)
  const targetWorld = cabinetDuplicateWorldPose(target, nodes)
  const relativeRotation = (targetWorld?.rotation ?? 0) - (selectedWorld?.rotation ?? 0)
  const frontX = Math.sin(relativeRotation)
  const frontZ = Math.cos(relativeRotation)
  const axis = Math.abs(frontX) > Math.abs(frontZ) ? 'x' : 'z'
  const positive = axis === 'x' ? frontX >= 0 : frontZ >= 0
  const targetDepthBounds = () => {
    const compensatedWidths: number[] = []
    const derived = cabinetMetadataRecord(target.metadata).cabinetCornerDerivedRun
    if (derived && typeof derived === 'object' && !Array.isArray(derived)) {
      const role = (derived as { role?: unknown }).role
      const side = (derived as { side?: unknown }).side
      const turnSide = (derived as { turnSide?: unknown }).turnSide
      const sourceModuleId = (derived as { sourceModuleId?: unknown }).sourceModuleId
      const sourceModule =
        role === 'base-leg' &&
        (turnSide === side || (turnSide !== 'left' && turnSide !== 'right')) &&
        typeof sourceModuleId === 'string'
          ? sceneApi.get<CabinetModuleNodeType>(sourceModuleId as AnyNodeId)
          : undefined
      if (sourceModule?.type === 'cabinet-module') {
        compensatedWidths.push(sourceModule.width)
      }
    }
    for (const childId of target.children ?? []) {
      const child = sceneApi.get<CabinetNodeType>(childId as AnyNodeId)
      if (child?.type !== 'cabinet') continue
      const childDerived = cabinetMetadataRecord(child.metadata).cabinetCornerDerivedRun
      if (!childDerived || typeof childDerived !== 'object' || Array.isArray(childDerived)) continue
      if (
        (childDerived as { role?: unknown }).role !== 'base-leg' ||
        (childDerived as { sourceRunId?: unknown }).sourceRunId !== target.id
      ) {
        continue
      }
      const connectedModule = cabinetModulesForRun(child, sceneApi.nodes()).find(
        (module) => module.name === 'Base Cabinet',
      )
      if (connectedModule) compensatedWidths.push(connectedModule.width)
    }
    return cabinetConnectedDepthBounds(target.depth, compensatedWidths)
  }
  return {
    kind: 'linear-resize',
    axis,
    anchor: positive ? 'min' : 'max',
    min: () => targetDepthBounds().min,
    max: () => targetDepthBounds().max,
    currentValue: (node) =>
      node.id === target.id
        ? node.depth
        : (sceneApi.get<CabinetNodeType>(target.id as AnyNodeId)?.depth ?? target.depth),
    overrideTarget: () => target.id as AnyNodeId,
    apply: (_node, depth) => ({ depth }),
    previewOverrides: (_node, depth, liveSceneApi) => {
      const liveTarget = liveSceneApi.get<CabinetNodeType>(target.id as AnyNodeId) ?? target
      const moduleOverrides = backAlignedRunDepthOverrides(liveTarget, liveSceneApi.nodes(), depth)
      const sourceOverrides = cornerSourceWidthOverridesForDerivedDepth(
        liveTarget,
        liveSceneApi.nodes(),
        depth,
      )
      return previewCornerRunsFromRunSources({
        baseLayout: 'width-only',
        initialOverrides: [...moduleOverrides, ...sourceOverrides],
        run: { ...liveTarget, depth },
        sceneApi: liveSceneApi,
      })
    },
    commit: (_node, patch, liveSceneApi) => {
      if (typeof patch.depth !== 'number') return
      const liveTarget = liveSceneApi.get<CabinetNodeType>(target.id as AnyNodeId) ?? target
      for (const [id, sourcePatch] of cornerSourceWidthOverridesForDerivedDepth(
        liveTarget,
        liveSceneApi.nodes(),
        patch.depth,
      )) {
        liveSceneApi.update(id, sourcePatch)
      }
      commitRunResize(liveTarget, { depth: patch.depth }, liveSceneApi, {
        cornerSync: 'width-only',
      })
    },
    placement: {
      position: (node, liveSceneApi) => {
        const liveTarget = liveSceneApi.get<CabinetNodeType>(target.id as AnyNodeId) ?? target
        return cabinetRunPointInSelectedFrame(
          node,
          liveTarget,
          cabinetRunFrontCenter(liveTarget, liveSceneApi),
          liveSceneApi,
        )
      },
      rotationY: () => (axis === 'x' ? relativeRotation - Math.PI / 2 : relativeRotation),
    },
  }
}

function cabinetHeightHandle(): HandleDescriptor<CabinetEditableNode> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: MIN_CABINET_CARCASS_HEIGHT,
    currentValue: (node) => node.carcassHeight,
    apply: (_node, carcassHeight) => ({ carcassHeight }),
    commit: commitCabinetResize,
    placement: {
      position: (node) => [0, cabinetTotalHeight(node) + HEIGHT_HANDLE_OFFSET, 0],
    },
  }
}

function cabinetRotateHandle(): HandleDescriptor<CabinetEditableNode> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    apply: (initial, delta, sceneApi) => {
      const rotation = (initial.rotation ?? 0) - delta
      const bounds = cabinetLocalBounds(initial, sceneApi.nodes())
      const [centerX, , centerZ] = bounds.center
      const previousRotation = initial.rotation ?? 0
      const previousCos = Math.cos(previousRotation)
      const previousSin = Math.sin(previousRotation)
      const nextCos = Math.cos(rotation)
      const nextSin = Math.sin(rotation)
      const pivotWorldX = initial.position[0] + centerX * previousCos + centerZ * previousSin
      const pivotWorldZ = initial.position[2] - centerX * previousSin + centerZ * previousCos
      return {
        rotation,
        position: [
          pivotWorldX - centerX * nextCos - centerZ * nextSin,
          initial.position[1],
          pivotWorldZ + centerX * nextSin - centerZ * nextCos,
        ],
      }
    },
    placement: {
      position: (node, sceneApi) => {
        const bounds = cabinetLocalBounds(node, sceneApi.nodes())
        return [bounds.maxX, bounds.center[1], bounds.maxZ + ROTATE_CORNER_OFFSET]
      },
      rotationY: () => -Math.PI / 4,
    },
    rotationCenter: (node, sceneApi) => cabinetLocalBounds(node, sceneApi.nodes()).center,
    decoration: {
      kind: 'ring',
      radius: (node, sceneApi) => {
        const bounds = cabinetLocalBounds(node, sceneApi.nodes())
        return Math.hypot(bounds.size[0] / 2, bounds.size[2] / 2) + ROTATE_RING_OFFSET
      },
      y: (node) => cabinetTotalHeight(node) / 2,
      center: (node, sceneApi) => cabinetLocalBounds(node, sceneApi.nodes()).center,
    },
  }
}

function cabinetHandles(
  node: CabinetNodeType,
  sceneApi?: SceneApi,
): HandleDescriptor<CabinetNodeType>[] {
  if ((node.children ?? []).length > 0) {
    const connectedRuns = sceneApi ? connectedBaseRuns(node, sceneApi) : [node]
    const depthHandles =
      sceneApi && connectedRuns.length > 1
        ? connectedRuns.map((run) => cabinetConnectedRunDepthHandle(node, run, sceneApi))
        : []
    const wallDepthHandles = sceneApi ? cabinetWallGroupDepthHandles(node, sceneApi) : []
    return [
      ...depthHandles,
      ...wallDepthHandles,
      cabinetRotateHandle(),
    ] as HandleDescriptor<CabinetNodeType>[]
  }
  const handles: HandleDescriptor<CabinetEditableNode>[] = [
    cabinetDepthHandle(),
    cabinetHeightHandle(),
    cabinetRotateHandle(),
  ]
  if ((node.children ?? []).length === 0) {
    handles.unshift(cabinetWidthHandle('left'), cabinetWidthHandle('right'))
  }
  return handles as HandleDescriptor<CabinetNodeType>[]
}

function isHoodOnlyCabinet(node: CabinetEditableNode): boolean {
  const stack = stackForCabinet(node)
  return stack.length > 0 && stack.every((compartment) => isHoodCompartmentType(compartment.type))
}

function cabinetModuleHandles(
  node: CabinetModuleNodeType,
  sceneApi?: SceneApi,
): HandleDescriptor<CabinetModuleNodeType>[] {
  const parent = node.parentId && sceneApi ? sceneApi.get(node.parentId as AnyNodeId) : undefined
  const isWallCabinet =
    isCabinetModule(parent) || (isCabinetRun(parent) && parent.runTier === 'wall')
  if (isWallCabinet) {
    return [cabinetRotateHandle() as HandleDescriptor<CabinetModuleNodeType>]
  }
  const handles: HandleDescriptor<CabinetModuleNodeType>[] = [
    cabinetWidthHandle('left') as HandleDescriptor<CabinetModuleNodeType>,
    cabinetWidthHandle('right') as HandleDescriptor<CabinetModuleNodeType>,
    cabinetRotateHandle() as HandleDescriptor<CabinetModuleNodeType>,
  ]
  if (!isHoodOnlyCabinet(node)) {
    handles.splice(
      1,
      0,
      cabinetDepthHandle() as LinearResizeHandle<CabinetModuleNodeType>,
      cabinetHeightHandle() as HandleDescriptor<CabinetModuleNodeType>,
    )
  }
  return handles
}

export const cabinetDefinition: NodeDefinition<typeof CabinetNode> = {
  kind: 'cabinet',
  schemaVersion: 7,
  schema: CabinetNode,
  category: 'furnish',
  surfaceRole: 'joinery',
  snapProfile: 'item',
  facingIndicator: true,

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    runTier: 'base',
    children: [],
    width: 0.5,
    depth: 0.5,
    carcassHeight: 0.72,
    operationState: 0,
    plinthHeight: 0.1,
    toeKickDepth: 0.075,
    boardThickness: 0.018,
    countertopThickness: 0.02,
    countertopOverhang: 0.02,
    countertopBackOverhang: 0,
    withFinishedBack: false,
    withWaterfall: false,
    frontThickness: 0.018,
    frontGap: 0.003,
    frontStyle: 'slab',
    handleStyle: 'bar',
    handlePosition: 'auto',
    frontOverlay: 'full',
    withBottomPanel: true,
    showPlinth: true,
    withCountertop: true,
    // material / materialPreset left undefined — paint mode writes slot refs.
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: {
      axes: ['x', 'z'],
      gridSnap: true,
      groupMoveSnap: resolveCabinetGroupMoveSnap,
      override: ({ node }) =>
        selectionProxyIdFromMetadata((node as { metadata?: unknown }).metadata)
          ? { axes: [], gridSnap: false }
          : null,
    },
    rotatable: { axes: ['y'], snapAngles: [Math.PI / 4] },
    duplicable: { subtree: true, prepareSubtreeClone: prepareCabinetSubtreeClone },
    deletable: true,
    surfaces: {
      top: {
        height: (node) => {
          const n = node as CabinetNodeType
          return n.plinthHeight + n.carcassHeight + (n.withCountertop ? n.countertopThickness : 0)
        },
      },
    },
    floorPlaced: {
      applies: (node) => !hasCabinetParentId(node as CabinetNodeType),
      footprints: (node, ctx) =>
        cabinetFloorPlacedFootprints(
          node as CabinetNodeType,
          ctx?.nodes as Readonly<Record<AnyNodeId, AnyNode>> | undefined,
        ),
      collides: true,
    },
    alignmentFootprint: (node, nodes) => {
      const n = node as CabinetNodeType
      return { shape: 'aabb', ...cabinetPlanBoundsAabb(n, nodes) }
    },
    dragBounds: (node, nodes) => {
      const bounds = cabinetLocalBounds(node as CabinetNodeType, nodes)
      return { size: bounds.size, center: bounds.center }
    },
    paint: cabinetPaint,
    sceneAction: cabinetSceneAction,
    slots: () => cabinetSlots(),
  },

  // Dirty-cascade: a dirtied run re-marks its hosted modules so their
  // composite geometry re-flows with the run (see `cascadeDirty`).
  relations: {
    hosts: ['cabinet-module'],
  },

  parametrics: cabinetParametrics,
  handles: cabinetHandles,
  geometry: buildCabinetGeometry,
  exportAnimation: ({ node, object }) => bakeCabinetAnimationClip(node, object),
  system: {
    module: () => import('./system'),
    priority: 2,
  },
  // `operationState` is deliberately absent — door/drawer poses are applied
  // per-frame by the cabinet animation system, not by geometry rebuilds.
  geometryKey: (n) =>
    JSON.stringify([
      n.width,
      n.depth,
      n.carcassHeight,
      n.runTier,
      n.plinthHeight,
      n.toeKickDepth,
      n.boardThickness,
      n.countertopThickness,
      n.countertopOverhang,
      n.countertopBackOverhang,
      n.withFinishedBack,
      n.withWaterfall,
      JSON.stringify(n.barLedge ?? null),
      n.frontThickness,
      n.frontGap,
      n.frontStyle,
      n.handleStyle,
      n.handlePosition,
      n.frontOverlay,
      n.withBottomPanel,
      n.showPlinth,
      n.withCountertop,
      JSON.stringify(n.material ?? null),
      JSON.stringify(n.materialPreset ?? null),
      JSON.stringify(n.slots ?? null),
      JSON.stringify(cabinetLayoutRevision(n.metadata)),
      // Bumped when a sibling run moves/resizes nearby, so the countertop
      // overhang re-trims against the neighbor's new spans (the neighbor's
      // own fields never appear in this key).
      JSON.stringify(cabinetAdjacencyRevision(n.metadata)),
      JSON.stringify(n.children ?? []),
      JSON.stringify(n.stack ?? null),
    ]),
  floorplan: buildCabinetFloorplan,
  floorplanSiblingOverrides: cabinetFloorplanSiblingOverrides,
  floorplanAffectedIds: cabinetFloorplanAffectedIds,
  quickActions: cabinetQuickActions,
  // Corner-derived leg runs hide their own tree rows; their modules are
  // flattened into the source run's hierarchy.
  tree: {
    label: cabinetTreeLabel,
    hidden: cabinetTreeHidden,
    childIds: cabinetTreeChildIds,
  },
  // E operates the run: every child module's doors/drawers swing together.
  keyboardActions: {
    e: {
      appliesTo: (node: AnyNode) => node.type === 'cabinet',
      run: (node: AnyNode) => toggleCabinetOperationState(node.id as AnyNodeId),
    },
  },
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Place cabinet' },
    {
      key: 'I',
      label: 'Placement type',
      chip: {
        subscribe: (onChange) => useCabinetPlacementType.subscribe(onChange),
        value: () => useCabinetPlacementType.getState().type,
        cycle: () => void useCabinetPlacementType.getState().cycleType(),
        labels: { cabinet: 'Type: Cabinet', island: 'Type: Island' },
        icons: { cabinet: 'lucide:rectangle-horizontal', island: 'lucide:table-2' },
        tooltip: 'Placement type — click or press I to toggle',
      },
    },
    { key: 'Alt', label: 'Force place' },
    { key: 'R / T', label: 'Rotate' },
    { key: 'Esc', label: 'Cancel run / exit' },
  ],

  presentation: {
    label: 'Modular Cabinet',
    description: 'A configurable parametric base cabinet.',
    icon: { kind: 'url', src: '/icons/item.webp' },
    paletteSection: 'furnish',
    paletteOrder: 34,
  },

  mcp: {
    description:
      'A configurable parametric base cabinet with plinth, carcass, front panels, optional countertop, and editable dimensions.',
  },
}

export const cabinetModuleDefinition: NodeDefinition<typeof CabinetModuleNode> = {
  kind: 'cabinet-module',
  schemaVersion: 4,
  schema: CabinetModuleNode,
  category: 'furnish',
  surfaceRole: 'joinery',
  snapProfile: 'item',
  facingIndicator: true,

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    children: [],
    cabinetType: 'base',
    width: 0.5,
    depth: 0.5,
    carcassHeight: 0.72,
    operationState: 0,
    plinthHeight: 0,
    toeKickDepth: 0.075,
    boardThickness: 0.018,
    countertopThickness: 0,
    countertopOverhang: 0.02,
    countertopBackOverhang: 0,
    withFinishedBack: false,
    frontThickness: 0.018,
    frontGap: 0.003,
    moduleKind: 'standard' as const,
    openSide: undefined,
    cornerShelf: false,
    frontStyle: 'slab',
    handleStyle: 'bar',
    handlePosition: 'auto',
    frontOverlay: 'full',
    withBottomPanel: true,
    showPlinth: false,
    withCountertop: false,
    // material / materialPreset left undefined — paint mode writes slot refs.
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: {
      axes: ['x', 'z'],
      gridSnap: true,
      parentFrame: cabinetModuleParentFrame,
      groupMoveSnap: resolveCabinetModuleGroupMoveSnap,
      override: ({ node }) =>
        selectionProxyIdFromMetadata((node as { metadata?: unknown }).metadata)
          ? { axes: [], gridSnap: false }
          : null,
    },
    rotatable: { axes: ['y'], snapAngles: [Math.PI / 4] },
    duplicable: { subtree: true, prepareSubtreeClone: prepareCabinetSubtreeClone },
    deletable: true,
    floorPlaced: {
      applies: (node) => !hasCabinetParentId(node as CabinetModuleNodeType),
      footprint: (node) => {
        const n = node as CabinetModuleNodeType
        return {
          dimensions: [
            n.width,
            (n.showPlinth ? n.plinthHeight : 0) +
              n.carcassHeight +
              (n.withCountertop ? n.countertopThickness : 0),
            n.depth,
          ] as [number, number, number],
          rotation: [0, n.rotation, 0] as [number, number, number],
        }
      },
      collides: true,
    },
    dragBounds: (node) => {
      const n = node as CabinetModuleNodeType
      const height = cabinetTotalHeight(n)
      return {
        size: [n.width, height, n.depth] as [number, number, number],
        center: [0, height / 2, 0] as [number, number, number],
      }
    },
    paint: cabinetPaint,
    sceneAction: cabinetSceneAction,
    slots: () => cabinetSlots(),
  },

  parametrics: cabinetModuleParametrics,
  handles: cabinetModuleHandles,
  geometry: buildCabinetGeometry,
  exportAnimation: ({ node, object }) => bakeCabinetAnimationClip(node, object),
  // `operationState` is deliberately absent — see cabinetDefinition.geometryKey.
  geometryKey: (n) =>
    JSON.stringify([
      n.cabinetType,
      n.moduleKind,
      n.width,
      n.depth,
      n.carcassHeight,
      n.plinthHeight,
      n.toeKickDepth,
      n.boardThickness,
      n.countertopThickness,
      n.countertopOverhang,
      n.frontThickness,
      n.frontGap,
      n.frontStyle,
      n.handleStyle,
      n.handlePosition,
      n.frontOverlay,
      n.withBottomPanel,
      n.showPlinth,
      n.withCountertop,
      n.openSide ?? null,
      n.cornerShelf ?? false,
      JSON.stringify(n.material ?? null),
      JSON.stringify(n.materialPreset ?? null),
      JSON.stringify(n.slots ?? null),
      JSON.stringify(n.children ?? []),
      JSON.stringify(n.stack ?? null),
    ]),
  floorplan: buildCabinetModuleFloorplan,
  floorplanSiblingOverrides: cabinetFloorplanSiblingOverrides,
  floorplanAffectedIds: cabinetFloorplanAffectedIds,
  // 2D ↔ 3D parity: module position is run-local, so the generic overlay's
  // plan-space translate would corrupt it on any rotated / offset run.
  floorplanMoveTarget: cabinetModuleFloorplanMoveTarget,
  quickActions: cabinetQuickActions,
  tree: {
    label: cabinetTreeLabel,
    childIds: cabinetTreeChildIds,
  },
  // Corner-generated modules keep a proxy so grouped move/rotate
  // affordances can still key off the run, but a direct body click should
  // stay on the clicked module so added legs / wall cabinets remain
  // individually selectable.
  selectionProxy: {
    bypassDirectPick: (node, proxyTarget) =>
      node.type === 'cabinet-module' && proxyTarget.type === 'cabinet',
  },
  // E animates this module's doors/drawers open ↔ closed (hood-only
  // modules have nothing to operate).
  keyboardActions: {
    e: {
      appliesTo: (node: AnyNode) =>
        node.type === 'cabinet-module' && !isHoodOnlyCabinet(node as CabinetModuleNodeType),
      run: (node: AnyNode) => toggleCabinetOperationState(node.id as AnyNodeId),
    },
  },

  presentation: {
    label: 'Cabinet Module',
    description: 'An editable module inside a modular cabinet run.',
    icon: { kind: 'url', src: '/icons/item.webp' },
    paletteSection: 'furnish',
    paletteOrder: 35,
  },

  mcp: {
    description: 'A single editable cabinet module inside a modular cabinet run.',
  },
}
