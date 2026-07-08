import type {
  AnyNode,
  AnyNodeId,
  CabinetModuleNode as CabinetModuleNodeType,
  CabinetNode as CabinetNodeType,
  FloorPlacedFootprint,
  HandleDescriptor,
  NodeDefinition,
  SceneApi,
} from '@pascal-app/core'
import { selectionProxyIdFromMetadata } from '@pascal-app/core'
import { buildCabinetFloorplan, buildCabinetModuleFloorplan } from './floorplan'
import { cabinetModuleFloorplanMoveTarget } from './floorplan-move'
import { cabinetFloorplanSiblingOverrides } from './floorplan-overrides'
import { buildCabinetGeometry } from './geometry'
import { toggleCabinetOperationState } from './interaction'
import { cabinetModuleParentFrame } from './move-frame'
import { cabinetPaint } from './paint'
import { cabinetModuleParametrics, cabinetParametrics } from './parametrics'
import { cabinetQuickActions } from './quick-actions'
import { moduleSideOpen } from './run-layout'
import {
  backAlignZ,
  bumpCabinetRunLayoutRevision,
  cabinetMetadataRecord,
  cabinetModulesForRun,
  totalCabinetHeight as cabinetTotalHeight,
  cornerLinkedSourceModuleForRun,
  resolveCabinetType,
  runModuleBaseY,
  syncCornerRunsFromSourceModule,
  wallChildOf,
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
const MIN_CABINET_WIDTH = 0.3
const MIN_CABINET_DEPTH = 0.3
const MIN_CABINET_CARCASS_HEIGHT = 0.4
const CABINET_ADJACENCY_EPSILON = 1e-4

function isCabinetModule(node: AnyNode | undefined): node is CabinetModuleNodeType {
  return node?.type === 'cabinet-module'
}

function isCabinetRun(node: AnyNode | undefined): node is CabinetNodeType {
  return node?.type === 'cabinet'
}

function hasCabinetParentId(node: CabinetModuleNodeType): boolean {
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
) {
  sceneApi.update(run.id as AnyNodeId, patch as Partial<AnyNode>)
  const nextRun = { ...run, ...patch }
  const syncDepth = typeof patch.depth === 'number'
  const syncHeight = typeof patch.carcassHeight === 'number'
  const syncPosition = patch.showPlinth !== undefined || typeof patch.plinthHeight === 'number'

  if (syncDepth || syncHeight || syncPosition) {
    for (const module of cabinetModulesForRun(run, sceneApi.nodes())) {
      const modulePatch: Partial<CabinetModuleNodeType> = {}
      if (syncDepth) {
        modulePatch.depth = nextRun.depth
        modulePatch.position = [
          module.position[0],
          module.position[1],
          backAnchoredModuleZ(module.position[2], module.depth, nextRun.depth),
        ]
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
  }

  if (syncDepth || syncHeight || syncPosition) {
    bumpCabinetRunLayoutRevision(sceneApi, nextRun)
    const cornerSource = cornerLinkedSourceModuleForRun(nextRun, sceneApi.nodes())
    if (cornerSource) {
      syncCornerRunsFromSourceModule({
        module: cornerSource,
        run: nextRun,
        sceneApi,
      })
    }
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

function cabinetDepthHandle(): HandleDescriptor<CabinetEditableNode> {
  return {
    kind: 'linear-resize',
    axis: 'z',
    anchor: 'min',
    min: MIN_CABINET_DEPTH,
    currentValue: (node) => node.depth,
    apply: (node, depth) => ({
      depth,
      position: [node.position[0], node.position[1], node.position[2] + (depth - node.depth) / 2],
    }),
    commit: commitCabinetResize,
    placement: {
      position: (node) => [0, cabinetTotalHeight(node) / 2, node.depth / 2 + SIDE_HANDLE_OFFSET],
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

function cabinetHandles(node: CabinetNodeType): HandleDescriptor<CabinetNodeType>[] {
  if ((node.children ?? []).length > 0) {
    return [cabinetRotateHandle()] as HandleDescriptor<CabinetNodeType>[]
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
): HandleDescriptor<CabinetModuleNodeType>[] {
  const handles: HandleDescriptor<CabinetEditableNode>[] = [
    cabinetWidthHandle('left'),
    cabinetWidthHandle('right'),
    cabinetRotateHandle(),
  ]
  if (!isHoodOnlyCabinet(node)) {
    handles.splice(1, 0, cabinetDepthHandle(), cabinetHeightHandle())
  }
  return handles as HandleDescriptor<CabinetModuleNodeType>[]
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
    width: 0.6,
    depth: 0.58,
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
    duplicable: true,
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
    { key: 'R / T', label: 'Rotate' },
    { key: 'I', label: 'Island mode' },
    { key: 'Esc', label: 'Cancel run / exit' },
  ],

  presentation: {
    label: 'Modular Cabinet',
    description: 'A configurable parametric base cabinet.',
    icon: { kind: 'url', src: '/icons/furniture.webp' },
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
    width: 0.6,
    depth: 0.58,
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
    duplicable: true,
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
    paint: cabinetPaint,
    sceneAction: cabinetSceneAction,
    slots: () => cabinetSlots(),
  },

  parametrics: cabinetModuleParametrics,
  handles: cabinetModuleHandles,
  geometry: buildCabinetGeometry,
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
    icon: { kind: 'url', src: '/icons/furniture.webp' },
    paletteSection: 'furnish',
    paletteOrder: 35,
  },

  mcp: {
    description: 'A single editable cabinet module inside a modular cabinet run.',
  },
}
