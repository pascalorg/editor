import type {
  AnyNode,
  AnyNodeId,
  CabinetModuleNode as CabinetModuleNodeType,
  CabinetNode as CabinetNodeType,
  DuplicateSubtreeCloneArgs,
  DuplicateSubtreeCloneResult,
  FloorPlacedFootprint,
  GridSnapPositionArgs,
  GroupMoveSnapArgs,
  GroupMoveSnapResult,
  SceneApi,
} from '@pascal-app/core'

import {
  CABINET_METRIC_DEFAULTS,
  cabinetSlots,
  findLevelAncestorId,
  selectionProxyIdFromMetadata,
} from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { findWallOpeningConflicts } from '../shared/wall-opening-clearance'
import { bakeCabinetAnimationClip } from './animation'
import { cabinetBatchable } from './batchable'
import { buildCabinetFloorplan, buildCabinetModuleFloorplan } from './floorplan'
import { buildCabinetGeometry } from './geometry'
import { cabinetModuleParentFrame } from './move-frame'
import { resolveCabinetGridPosition } from './placement-snap'
import {
  cabinetMetadataRecord,
  cabinetModulesForRun,
  cabinetModuleTotalHeight,
  totalCabinetHeight as cabinetTotalHeight,
} from './run-ops'
import { cabinetSceneAction } from './scene-action'
import { CabinetModuleNode, CabinetNode } from './schema'
import { cabinetModuleSurfaceProvider, cabinetSurfaceProvider } from './surfaces'
import { cabinetTreeChildIds, cabinetTreeHidden, cabinetTreeLabel } from './tree-structure'
import {
  findClosestCabinetWallInPlan,
  resolveCabinetModuleWallSnapLocal,
  resolveCabinetRunWallSnap,
  resolveCabinetWallFaceOffset,
} from './wall-snap'

export type CabinetEditableNode = CabinetNodeType | CabinetModuleNodeType

export type CabinetDuplicableNode = AnyNode & {
  type: 'cabinet' | 'cabinet-module'
  position: [number, number, number]
  rotation: number
}

export type CabinetLocalBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
  size: [number, number, number]
  center: [number, number, number]
}

export function isCabinetDuplicableNode(
  node: AnyNode | null | undefined,
): node is CabinetDuplicableNode {
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

export function composeCabinetDuplicatePose(
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

export function cabinetDuplicateWorldPose(
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
        dimensions: [module.width, cabinetModuleTotalHeight(module), module.depth],
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

function cabinetRunOverlapsWallOpening({
  levelId,
  node,
  nodes,
  position,
  rotation,
}: {
  levelId: AnyNodeId | null
  node: CabinetNodeType
  nodes: Readonly<Record<AnyNodeId, AnyNode>>
  position: readonly [number, number, number]
  rotation: number
}): boolean {
  const parentLevelId = (levelId ??
    findLevelAncestorId(node.id as AnyNodeId, nodes)) as AnyNodeId | null
  if (!parentLevelId) return false

  const candidate = { ...node, position: [...position] as [number, number, number], rotation }
  return cabinetFloorPlacedFootprints(candidate, nodes).some((footprint) => {
    if (!footprint.position) return false
    const hit = findClosestCabinetWallInPlan({
      excludeIds: [],
      nodes: nodes as Record<AnyNodeId, AnyNode>,
      parentLevelId,
      planPoint: [footprint.position[0], footprint.position[2]],
      yaw: footprint.rotation[1],
    })
    if (!hit) return false

    const normalScale = hit.side === 'front' ? 1 : -1
    const expectedPerp =
      resolveCabinetWallFaceOffset({
        hit,
        nodes: nodes as Record<AnyNodeId, AnyNode>,
        parentLevelId,
      }) +
      normalScale * (footprint.dimensions[2] / 2)
    if (Math.abs(hit.perpDistance - expectedPerp) > 0.12) return false

    return (
      findWallOpeningConflicts({
        bottom: footprint.position[1],
        height: footprint.dimensions[1],
        localX: hit.localX,
        nodes,
        wall: hit.wall,
        width: footprint.dimensions[0],
      }).length > 0
    )
  })
}

export function isCabinetModule(node: AnyNode | undefined): node is CabinetModuleNodeType {
  return node?.type === 'cabinet-module'
}

export function isCabinetRun(node: AnyNode | undefined): node is CabinetNodeType {
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
  candidateRotation,
  levelId,
  movingIds,
  node,
  nodes,
}: GroupMoveSnapArgs): GroupMoveSnapResult | null {
  if (node.type !== 'cabinet' || !levelId) return null
  return resolveCabinetRunWallSnap({
    cabinet: node,
    candidatePosition,
    candidateRotation,
    excludeIds: movingIds,
    gridStep: 0,
    nodes: nodes as Record<AnyNodeId, AnyNode>,
    parentLevelId: levelId,
  })
}

function resolveCabinetMoveGridSnap({
  candidatePosition,
  candidateRotation,
  gridStep,
  node,
  nodes,
}: GridSnapPositionArgs): [number, number, number] {
  if (!isCabinetRun(node)) return candidatePosition
  const bounds = cabinetLocalBounds(node, nodes as Readonly<Record<AnyNodeId, AnyNode>>)
  const snapped = resolveCabinetGridPosition({
    raw: candidatePosition,
    dimensions: bounds.size,
    footprintOffset: [bounds.center[0], bounds.center[2]],
    yaw: candidateRotation,
    step: gridStep,
  })
  return [snapped[0], candidatePosition[1], snapped[2]]
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
}: GroupMoveSnapArgs): GroupMoveSnapResult | null {
  if (node.type !== 'cabinet-module' || !node.parentId) return null
  const run = nodes[node.parentId]
  if (!isCabinetRun(run)) return null
  const parentLevelId = (levelId ?? run.parentId ?? null) as AnyNodeId | null
  if (!parentLevelId) return null
  const position = resolveCabinetModuleWallSnapLocal({
    candidateLocal: candidatePosition,
    excludeIds: movingIds,
    module: node,
    nodes: nodes as Record<AnyNodeId, AnyNode>,
    parentLevelId,
    run,
  })
  return position ? { position } : null
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
    (run.children ?? []).filter(
      (id) => id.startsWith('cabinet_') || id.startsWith('cabinet-module_'),
    ),
    cabinetLayoutRevision(run.metadata),
  ])
}

export function includeCabinetModuleBounds(
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
  bounds.maxY = Math.max(bounds.maxY, y + cabinetModuleTotalHeight(module))
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
export function includeChildRunBounds(
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

export function cabinetLocalBounds(
  node: CabinetEditableNode,
  nodes?: Readonly<Record<AnyNodeId, AnyNode>>,
): CabinetLocalBounds {
  const bounds = {
    minX: -node.width / 2,
    maxX: node.width / 2,
    minY: 0,
    maxY:
      node.type === 'cabinet-module' ? cabinetModuleTotalHeight(node) : cabinetTotalHeight(node),
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
      bounds.maxY = Math.max(bounds.maxY, cabinetTotalHeight(node))
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

  if (isCabinetModule(node) && nodes) {
    for (const childId of node.children ?? []) {
      const child = nodes[childId as AnyNodeId]
      if (isCabinetModule(child)) {
        includeCabinetModuleBounds(child, nodes, [0, 0, 0], bounds)
      } else if (isCabinetRun(child)) {
        includeChildRunBounds(child, nodes, bounds)
      }
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

export const cabinetRenderDefinition: NodeRenderDefinition<typeof CabinetNode> & {
  kind: 'cabinet'
} = {
  kind: 'cabinet',
  schemaVersion: 8,
  schema: CabinetNode,
  category: 'furnish',
  surfaceRole: 'joinery',
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
    depth: CABINET_METRIC_DEFAULTS.depth,
    carcassHeight: CABINET_METRIC_DEFAULTS.carcassHeight,
    operationState: 0,
    plinthHeight: CABINET_METRIC_DEFAULTS.plinthHeight,
    toeKickDepth: 0.075,
    boardThickness: 0.018,
    countertopThickness: CABINET_METRIC_DEFAULTS.countertopThickness,
    countertopOverhang: 0.02,
    countertopBackOverhang: 0,
    withFinishedBack: false,
    withWaterfall: false,
    withFinishedEnds: false,
    frontThickness: 0.018,
    frontGap: 0.003,
    frontStyle: 'slab',
    panelReady: false,
    handleStyle: 'bar',
    handlePosition: 'auto',
    frontOverlay: 'full',
    withBottomPanel: true,
    showPlinth: true,
    withCountertop: true,
    // material / materialPreset left undefined — paint mode writes slot refs.
  }),
  capabilities: {
    batchable: cabinetBatchable,
    reveal: { phase: 'furnishing', style: 'drop', height: 0.3 },
    revealOnEdit: ['width', 'depth', 'carcassHeight', 'plinthHeight'],
    surfacePlacement: 'floor-only',
    selectable: { hitVolume: 'bbox' },
    movable: {
      axes: ['x', 'z'],
      directDrag: true,
      gridSnap: true,
      gridSnapPosition: resolveCabinetMoveGridSnap,
      groupMoveSnapPose: resolveCabinetGroupMoveSnap,
      isValidPosition: ({ node, position, rotation, levelId, nodes }) =>
        node.type !== 'cabinet' ||
        !cabinetRunOverlapsWallOpening({
          levelId,
          node: node as CabinetNodeType,
          nodes: nodes as Readonly<Record<AnyNodeId, AnyNode>>,
          position,
          rotation,
        }),
      override: ({ node }) =>
        selectionProxyIdFromMetadata((node as { metadata?: unknown }).metadata)
          ? { axes: [], gridSnap: false }
          : null,
    },
    rotatable: { axes: ['y'], snapAngles: [Math.PI / 4] },
    duplicable: { subtree: true, prepareSubtreeClone: prepareCabinetSubtreeClone },
    deletable: true,
    surfaces: {
      hosting: cabinetSurfaceProvider,
      top: {
        height: (node, context) => cabinetLocalBounds(node as CabinetNodeType, context.nodes).maxY,
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
    sceneAction: cabinetSceneAction,
    slots: () => cabinetSlots(),
  },
  // Dirty-cascade: a dirtied run re-marks its hosted modules so their
  // composite geometry re-flows with the run (see `cascadeDirty`).
  relations: {
    hosts: ['cabinet', 'cabinet-module', 'item', 'procedural-item'],
  },
  geometry: buildCabinetGeometry,
  exportAnimation: ({ node, object }) => bakeCabinetAnimationClip(node, object),
  system: {
    module: () => import('./system'),
    priority: 2,
  },
  // `operationState` is deliberately absent — door/drawer poses are applied
  // per-frame by the cabinet animation system, not by geometry rebuilds.
  geometryChildTypes: ['cabinet', 'cabinet-module'],
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
      n.withFinishedEnds,
      JSON.stringify(n.barLedge ?? null),
      n.frontThickness,
      n.frontGap,
      n.frontStyle,
      n.panelReady,
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
      JSON.stringify(
        (n.children ?? []).filter(
          (id) => id.startsWith('cabinet_') || id.startsWith('cabinet-module_'),
        ),
      ),
      JSON.stringify(n.stack ?? null),
    ]),
  // Corner-derived leg runs hide their own tree rows; their modules are
  // flattened into the source run's hierarchy.
  tree: {
    label: cabinetTreeLabel,
    hidden: cabinetTreeHidden,
    childIds: cabinetTreeChildIds,
  },
  floorplan: buildCabinetFloorplan,
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

export const cabinetModuleRenderDefinition: NodeRenderDefinition<typeof CabinetModuleNode> & {
  kind: 'cabinet-module'
} = {
  kind: 'cabinet-module',
  schemaVersion: 5,
  schema: CabinetModuleNode,
  category: 'furnish',
  surfaceRole: 'joinery',
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
    depth: CABINET_METRIC_DEFAULTS.depth,
    carcassHeight: CABINET_METRIC_DEFAULTS.carcassHeight,
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
    topFinish: 'none' as const,
    topFinishHeight: CabinetModuleNode.parse({}).topFinishHeight,
    topFinishDepth: 0.32,
    frontStyle: 'slab',
    panelReady: false,
    handleStyle: 'bar',
    handlePosition: 'auto',
    frontOverlay: 'full',
    withBottomPanel: true,
    showPlinth: false,
    withCountertop: false,
    // material / materialPreset left undefined — paint mode writes slot refs.
  }),
  capabilities: {
    batchable: cabinetBatchable,
    selectable: { hitVolume: 'bbox' },
    surfaces: { hosting: cabinetModuleSurfaceProvider },
    movable: {
      axes: ['x', 'z'],
      directDrag: true,
      gridSnap: true,
      parentFrame: cabinetModuleParentFrame,
      groupMoveSnapPose: resolveCabinetModuleGroupMoveSnap,
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
          dimensions: [n.width, cabinetModuleTotalHeight(n), n.depth] as [number, number, number],
          rotation: [0, n.rotation, 0] as [number, number, number],
        }
      },
      collides: true,
    },
    dragBounds: (node, nodes) => {
      const bounds = cabinetLocalBounds(node as CabinetModuleNodeType, nodes)
      return { size: bounds.size, center: bounds.center }
    },
    sceneAction: cabinetSceneAction,
    slots: () => cabinetSlots(),
  },
  relations: { hosts: ['cabinet', 'cabinet-module', 'item', 'procedural-item'] },
  geometry: buildCabinetGeometry,
  exportAnimation: ({ node, object }) => bakeCabinetAnimationClip(node, object),
  // `operationState` is deliberately absent — see cabinetDefinition.geometryKey.
  geometryChildTypes: ['cabinet', 'cabinet-module'],
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
      n.panelReady,
      n.handleStyle,
      n.handlePosition,
      n.frontOverlay,
      n.withBottomPanel,
      n.showPlinth,
      n.withCountertop,
      n.openSide ?? null,
      n.cornerShelf ?? false,
      n.topFinish,
      n.topFinishHeight,
      n.topFinishDepth,
      JSON.stringify(n.material ?? null),
      JSON.stringify(n.materialPreset ?? null),
      JSON.stringify(n.slots ?? null),
      JSON.stringify(
        (n.children ?? []).filter(
          (id) => id.startsWith('cabinet_') || id.startsWith('cabinet-module_'),
        ),
      ),
      JSON.stringify(n.stack ?? null),
    ]),
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
  floorplan: buildCabinetModuleFloorplan,
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
