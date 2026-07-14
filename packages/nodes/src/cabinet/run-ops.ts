import {
  type AnyNode,
  type AnyNodeId,
  type CabinetModuleNode,
  type CabinetNode,
  calculateLevelMiters,
  getWallPlanFootprint,
  resolveLevelId,
  type SceneApi,
  selectionProxyIdFromMetadata,
  type WallNode,
} from '@pascal-app/core'
import {
  moduleMaxX,
  moduleMinX,
  planToRunLocal,
  runLocalToPlan,
  runLocalXExtent,
  sideInsertX,
} from './run-layout'
import {
  CabinetModuleNode as CabinetModuleNodeSchema,
  CabinetNode as CabinetNodeSchema,
} from './schema'
import {
  backAnchoredModuleZ,
  hoodCompartmentHeight,
  newCabinetCompartment,
  stackForCabinet,
} from './stack'

/**
 * Kind-owned cabinet run mutations, shared by the properties panel, the
 * quick-action menu, and the placement tool. Everything routes through
 * `SceneApi` so each caller (panel with `useScene`, actions with the
 * registry's api) gets identical behavior — these used to be copy-pasted
 * per surface and had already drifted (gap checks, hood support, revision
 * scope).
 */

export const CABINET_BASE_WIDTH = 0.5
export const CABINET_WALL_DEPTH = 0.32
export const CABINET_WALL_CARCASS_HEIGHT = 0.72
export const CABINET_TALL_DEPTH = 0.58
export const CABINET_TALL_PLINTH_HEIGHT = 0.1
export const CABINET_TALL_CARCASS_HEIGHT = 2.07
export const CABINET_EDGE_EPSILON = 1e-4
const MIN_CORNER_CONNECTED_WIDTH = 0.3
const MIN_TRIMMED_CORNER_CONNECTED_WIDTH = 0.05
const CORNER_WIDTH_SEARCH_STEP = 0.01
const WALL_CLEARANCE_EPSILON = 1e-5

export type CabinetEditableNode = CabinetNode | CabinetModuleNode
type CornerSide = 'left' | 'right'
type CornerDerivedRunRole = 'base-leg' | 'wall-leg' | 'bridge'

type CornerSourceLink = {
  side: CornerSide
  linkedRunIds: AnyNodeId[]
}

type CornerDerivedRunLink = {
  role: CornerDerivedRunRole
  side: CornerSide
  turnSide: CornerSide
  sourceModuleId: AnyNodeId
  sourceRunId: AnyNodeId
}

type CabinetRunStylePatch = Pick<
  Partial<CabinetNode>,
  'frontStyle' | 'frontOverlay' | 'handleStyle' | 'handlePosition'
>

export function cabinetMetadataRecord(
  metadata: CabinetEditableNode['metadata'],
): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {}
}

function withSelectionProxyMetadata(
  metadata: CabinetEditableNode['metadata'],
  proxyId: AnyNodeId,
): Record<string, unknown> {
  return {
    ...cabinetMetadataRecord(metadata),
    nodeSelectionProxyId: proxyId,
  }
}

function cornerSourceLink(metadata: CabinetEditableNode['metadata']): CornerSourceLink | null {
  const record = cabinetMetadataRecord(metadata)
  const value = record.cabinetCornerSourceLink
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const side = (value as { side?: unknown }).side
  const linkedRunIds = (value as { linkedRunIds?: unknown }).linkedRunIds
  if ((side !== 'left' && side !== 'right') || !Array.isArray(linkedRunIds)) return null
  return {
    side,
    linkedRunIds: linkedRunIds.filter(
      (id): id is AnyNodeId => typeof id === 'string',
    ) as AnyNodeId[],
  }
}

function cornerDerivedRunLink(
  metadata: CabinetEditableNode['metadata'],
): CornerDerivedRunLink | null {
  const record = cabinetMetadataRecord(metadata)
  const value = record.cabinetCornerDerivedRun
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const role = (value as { role?: unknown }).role
  const side = (value as { side?: unknown }).side
  const turnSide = (value as { turnSide?: unknown }).turnSide
  const sourceModuleId = (value as { sourceModuleId?: unknown }).sourceModuleId
  const sourceRunId = (value as { sourceRunId?: unknown }).sourceRunId
  if (
    (role !== 'base-leg' && role !== 'wall-leg' && role !== 'bridge') ||
    (side !== 'left' && side !== 'right') ||
    typeof sourceModuleId !== 'string' ||
    typeof sourceRunId !== 'string'
  ) {
    return null
  }
  return {
    role,
    side,
    turnSide: turnSide === 'left' || turnSide === 'right' ? turnSide : side,
    sourceModuleId: sourceModuleId as AnyNodeId,
    sourceRunId: sourceRunId as AnyNodeId,
  }
}

/**
 * Deleting one member of an L-corner group removes ONLY that node (plus its
 * normal descendants) — never the other corner runs. These patches keep the
 * metadata links consistent afterwards:
 *  - deleting a derived leg run → drop its id from the source module's
 *    `cabinetCornerSourceLink.linkedRunIds` (drop the link when empty);
 *  - deleting the source module → strip `cabinetCornerDerivedRun` from the
 *    surviving legs so they become plain independent runs.
 * Patches targeting nodes that are also being deleted are skipped by the
 * store, so deleting the whole source run (subtree cascade) stays clean.
 */
export function cabinetCornerUnlinkPatchesOnDelete(
  node: CabinetNode | CabinetModuleNode,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): Array<{ id: AnyNodeId; data: Partial<AnyNode> }> {
  const patches: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = []

  const sourceLink = cornerSourceLink(node.metadata)
  if (sourceLink) {
    for (const runId of sourceLink.linkedRunIds) {
      const linkedRun = nodes[runId]
      if (linkedRun?.type !== 'cabinet') continue
      const metadata = cabinetMetadataRecord(linkedRun.metadata)
      if (!('cabinetCornerDerivedRun' in metadata)) continue
      const { cabinetCornerDerivedRun: _dropped, ...rest } = metadata
      patches.push({ id: runId, data: { metadata: rest } as Partial<AnyNode> })
    }
  }

  const derivedLink = cornerDerivedRunLink(node.metadata)
  if (derivedLink) {
    const sourceModule = nodes[derivedLink.sourceModuleId]
    if (sourceModule?.type === 'cabinet-module') {
      const sourceModuleLink = cornerSourceLink(sourceModule.metadata)
      if (sourceModuleLink) {
        const remaining = sourceModuleLink.linkedRunIds.filter((id) => id !== node.id)
        const metadata = cabinetMetadataRecord(sourceModule.metadata)
        const { cabinetCornerSourceLink: _dropped, ...rest } = metadata
        patches.push({
          id: sourceModule.id as AnyNodeId,
          data: {
            metadata:
              remaining.length > 0
                ? {
                    ...rest,
                    cabinetCornerSourceLink: {
                      side: sourceModuleLink.side,
                      linkedRunIds: remaining,
                    },
                  }
                : rest,
          } as Partial<AnyNode>,
        })
      }
    }
  }

  return patches
}

/**
 * A cabinet run is a grouping container — once its last child is deleted
 * the empty run must go too, so no orphan group lingers in the scene graph
 * or the persisted data. Children may be modules or derived corner leg
 * runs (which position themselves relative to the run), so ANY survivor
 * keeps the run alive. `pendingDeleteIds` covers multi-select deletes:
 * siblings already part of the same gesture count as gone.
 */
export function cabinetEmptyRunCascadeDeleteIds(
  node: CabinetEditableNode,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
  pendingDeleteIds: ReadonlySet<AnyNodeId>,
): AnyNodeId[] {
  const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
  if (parent?.type !== 'cabinet') return []
  const hasSurvivingChild = (parent.children ?? []).some((childId) => {
    const id = childId as AnyNodeId
    if (id === node.id || pendingDeleteIds.has(id)) return false
    return nodes[id] != null
  })
  return hasSurvivingChild ? [] : [parent.id as AnyNodeId]
}

/**
 * Bump the run's layout revision — the geometryKey input that forces its
 * composite geometry (spans, countertop, plinth) to re-flow when a child
 * module changes in a way the run's own fields don't capture. Sibling runs
 * are re-keyed separately by the adjacency watcher in `system.tsx`, so no
 * level-wide sweep is needed here.
 */
export function bumpCabinetRunLayoutRevision(sceneApi: SceneApi, run: CabinetNode) {
  const live = sceneApi.get<CabinetNode>(run.id as AnyNodeId) ?? run
  const metadata = cabinetMetadataRecord(live.metadata)
  const currentRevision =
    typeof metadata.cabinetLayoutRevision === 'number' ? metadata.cabinetLayoutRevision : 0
  sceneApi.update(
    run.id as AnyNodeId,
    {
      metadata: { ...metadata, cabinetLayoutRevision: currentRevision + 1 },
    } as Partial<AnyNode>,
  )
  sceneApi.markDirty(run.id as AnyNodeId)
}

export function runModuleBaseY(run: Pick<CabinetNode, 'showPlinth' | 'plinthHeight'>) {
  return run.showPlinth ? run.plinthHeight : 0
}

export function totalCabinetHeight(
  node: Pick<
    CabinetEditableNode,
    'showPlinth' | 'plinthHeight' | 'carcassHeight' | 'withCountertop' | 'countertopThickness'
  >,
) {
  return (
    (node.showPlinth ? node.plinthHeight : 0) +
    node.carcassHeight +
    (node.withCountertop ? node.countertopThickness : 0)
  )
}

/** Y where a wall cabinet's bottom lands so its top aligns with a tall unit's top. */
export function wallBottomHeightForTallAlignment() {
  return (
    totalCabinetHeight({
      showPlinth: true,
      plinthHeight: CABINET_TALL_PLINTH_HEIGHT,
      carcassHeight: CABINET_TALL_CARCASS_HEIGHT,
      withCountertop: false,
      countertopThickness: 0,
    }) - CABINET_WALL_CARCASS_HEIGHT
  )
}

/** Local Z offset that makes a shallower wall cabinet's back flush with its deeper base. */
export function backAlignZ(baseDepth: number, wallDepth: number) {
  return -(baseDepth - wallDepth) / 2
}

export function wallChildOf(
  module: CabinetModuleNode,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): CabinetModuleNode | null {
  for (const childId of module.children ?? []) {
    const child = nodes[childId as AnyNodeId]
    if (child?.type === 'cabinet-module') return child
  }
  return null
}

export function resolveCabinetType(module: CabinetModuleNode, run?: CabinetNode): 'base' | 'tall' {
  if (module.cabinetType) return module.cabinetType
  return run?.runTier === 'tall' ? 'tall' : 'base'
}

export function cabinetModulesForRun(
  run: CabinetNode,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): CabinetModuleNode[] {
  return (run.children ?? [])
    .map((id) => nodes[id as AnyNodeId])
    .filter((child): child is CabinetModuleNode => child?.type === 'cabinet-module')
}

export function backAlignedRunDepthOverrides(
  run: CabinetNode,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
  depth: number,
): ReadonlyArray<readonly [AnyNodeId, Partial<AnyNode>]> {
  const modules = cabinetModulesForRun(run, nodes)
  if (modules.length === 0) return []
  const backZ = runBackLineZ(modules)
  const overrides: Array<readonly [AnyNodeId, Partial<AnyNode>]> = []
  for (const module of modules) {
    const positionZ = backZ + depth / 2
    const parentShiftZ = positionZ - module.position[2]
    overrides.push([
      module.id as AnyNodeId,
      {
        depth,
        position: [module.position[0], module.position[1], positionZ],
      } as Partial<AnyNode>,
    ])
    for (const childId of module.children ?? []) {
      const child = nodes[childId as AnyNodeId]
      if (child?.type !== 'cabinet') continue
      overrides.push([
        child.id as AnyNodeId,
        {
          position: [child.position[0], child.position[1], child.position[2] - parentShiftZ],
        } as Partial<AnyNode>,
      ])
    }
    const wallChild = wallChildOf(module, nodes)
    if (wallChild) {
      overrides.push([
        wallChild.id as AnyNodeId,
        {
          position: [
            wallChild.position[0],
            wallChild.position[1],
            backAlignZ(depth, wallChild.depth),
          ],
        } as Partial<AnyNode>,
      ])
    }
  }
  return overrides
}

export function cornerSourceWidthOverridesForDerivedDepth(
  run: CabinetNode,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
  depth: number,
): ReadonlyArray<readonly [AnyNodeId, Partial<AnyNode>]> {
  const link = cornerDerivedRunLink(run.metadata)
  if (link?.role !== 'base-leg') return []
  const sourceModule = nodes[link.sourceModuleId]
  const sourceRun = nodes[link.sourceRunId]
  if (sourceModule?.type !== 'cabinet-module' || sourceRun?.type !== 'cabinet') return []

  const width = Math.max(
    MIN_TRIMMED_CORNER_CONNECTED_WIDTH,
    sourceModule.width - (depth - run.depth),
  )
  const widthDelta = width - sourceModule.width
  const direction = link.side === 'right' ? 1 : -1
  const overrides: Array<readonly [AnyNodeId, Partial<AnyNode>]> = [
    [
      sourceModule.id as AnyNodeId,
      {
        width,
        position: [
          sourceModule.position[0] + (direction * widthDelta) / 2,
          sourceModule.position[1],
          sourceModule.position[2],
        ],
      } as Partial<AnyNode>,
    ],
  ]
  const wallChild = wallChildOf(sourceModule, nodes)
  if (wallChild) {
    overrides.push([
      wallChild.id as AnyNodeId,
      {
        width,
        position: [
          wallChild.position[0],
          wallChild.position[1],
          backAlignZ(sourceModule.depth, wallChild.depth),
        ],
      } as Partial<AnyNode>,
    ])
  }
  const sourceLink = cornerSourceLink(sourceModule.metadata)
  for (const linkedRunId of sourceLink?.linkedRunIds ?? []) {
    const linkedRun = nodes[linkedRunId]
    if (linkedRun?.type !== 'cabinet') continue
    const derivedLink = cornerDerivedRunLink(linkedRun.metadata)
    if (
      derivedLink?.role !== 'bridge' ||
      derivedLink.side !== link.side ||
      derivedLink.sourceModuleId !== sourceModule.id
    ) {
      continue
    }
    const bridge = cabinetModulesForRun(linkedRun, nodes).find(
      (module) => module.name === 'Wall Bridge Filler',
    )
    if (!bridge) continue
    const bridgeWidth = Math.max(0.01, bridge.width - widthDelta)
    const bridgeWidthDelta = bridgeWidth - bridge.width
    overrides.push([
      bridge.id as AnyNodeId,
      {
        width: bridgeWidth,
        position: [
          bridge.position[0] - (direction * bridgeWidthDelta) / 2,
          bridge.position[1],
          bridge.position[2],
        ],
      } as Partial<AnyNode>,
    ])
    const linkedMetadata = cabinetMetadataRecord(linkedRun.metadata)
    const linkedRevision =
      typeof linkedMetadata.cabinetLayoutRevision === 'number'
        ? linkedMetadata.cabinetLayoutRevision
        : 0
    overrides.push([
      linkedRun.id as AnyNodeId,
      {
        metadata: {
          ...linkedMetadata,
          cabinetLayoutRevision: linkedRevision + 1,
        },
      } as Partial<AnyNode>,
    ])
  }
  const metadata = cabinetMetadataRecord(sourceRun.metadata)
  const revision =
    typeof metadata.cabinetLayoutRevision === 'number' ? metadata.cabinetLayoutRevision : 0
  overrides.push([
    sourceRun.id as AnyNodeId,
    { metadata: { ...metadata, cabinetLayoutRevision: revision + 1 } } as Partial<AnyNode>,
  ])
  return overrides
}

export function cornerSourceModulesForRun(
  run: CabinetNode,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): CabinetModuleNode[] {
  return cabinetModulesForRun(run, nodes).filter(
    (module) => cornerSourceLink(module.metadata) != null,
  )
}

function doorStack(shelfCount: number) {
  return [{ ...newCabinetCompartment('door'), shelfCount }]
}

function cloneWallCabinetStack(
  sourceWallTop: CabinetModuleNode | null,
  shelfCount: number,
): CabinetModuleNode['stack'] {
  if (!sourceWallTop) return doorStack(shelfCount)
  return stackForCabinet(sourceWallTop).map((compartment) => ({ ...compartment }))
}

function inheritedShelfCount(module: CabinetModuleNode): number {
  const door = stackForCabinet(module).find((compartment) => compartment.type === 'door')
  return typeof door?.shelfCount === 'number' && door.shelfCount >= 0 ? door.shelfCount : 1
}

function runBackLineZ(modules: readonly Pick<CabinetModuleNode, 'position' | 'depth'>[]) {
  return Math.min(...modules.map((module) => module.position[2] - module.depth / 2))
}

export function cornerLinkedSourceModuleForRun(
  run: CabinetNode,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): CabinetModuleNode | null {
  return cornerSourceModulesForRun(run, nodes)[0] ?? null
}

export function cornerStyleSourceForRun(
  run: CabinetNode,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): { module: CabinetModuleNode; run: CabinetNode } | null {
  const directSourceModule = cornerLinkedSourceModuleForRun(run, nodes)
  if (directSourceModule) return { module: directSourceModule, run }

  const derivedLink = cornerDerivedRunLink(run.metadata)
  if (!derivedLink) return null

  const sourceRun = nodes[derivedLink.sourceRunId]
  const sourceModule = nodes[derivedLink.sourceModuleId]
  if (sourceRun?.type !== 'cabinet' || sourceModule?.type !== 'cabinet-module') return null
  return { module: sourceModule, run: sourceRun }
}

function applyCabinetRunStylePatch(
  sceneApi: SceneApi,
  run: CabinetNode,
  patch: CabinetRunStylePatch,
) {
  if (Object.keys(patch).length === 0) return

  sceneApi.update(run.id as AnyNodeId, patch as Partial<AnyNode>)
  for (const module of cabinetModulesForRun(run, sceneApi.nodes())) {
    sceneApi.update(module.id as AnyNodeId, patch as Partial<AnyNode>)
    const wallChild = wallChildOf(module, sceneApi.nodes())
    if (wallChild) {
      sceneApi.update(wallChild.id as AnyNodeId, patch as Partial<AnyNode>)
    }
  }
}

/**
 * Push a style patch onto every corner run linked to a source module. Styles
 * must reach the legs even when `syncDerivedCornerRun`'s geometric re-layout
 * bails (a wall drawn later blocks the layout, a leg gained extra modules),
 * so this applies the patch directly instead of riding on the layout sync.
 */
function applyStylePatchToLinkedCornerRuns(
  sceneApi: SceneApi,
  sourceModule: CabinetModuleNode,
  patch: CabinetRunStylePatch,
) {
  const link = cornerSourceLink(sourceModule.metadata)
  if (!link) return
  for (const runId of link.linkedRunIds) {
    const linkedRun = sceneApi.get<CabinetNode>(runId)
    if (linkedRun?.type !== 'cabinet') continue
    applyCabinetRunStylePatch(sceneApi, linkedRun, patch)
  }
}

export function syncCornerStyleGroupFromRun({
  run,
  patch,
  sceneApi,
}: {
  run: CabinetNode
  patch: CabinetRunStylePatch
  sceneApi: SceneApi
}): boolean {
  if (Object.keys(patch).length === 0) return false

  const source = cornerStyleSourceForRun(run, sceneApi.nodes())
  if (!source) return false

  const sourceRun = sceneApi.get<CabinetNode>(source.run.id as AnyNodeId) ?? source.run

  applyCabinetRunStylePatch(sceneApi, sourceRun, patch)
  const cornerSources = cornerSourceModulesForRun(sourceRun, sceneApi.nodes())
  const sourceModules =
    cornerSources.length > 0
      ? cornerSources
      : [sceneApi.get<CabinetModuleNode>(source.module.id as AnyNodeId) ?? source.module]

  for (const sourceModule of sourceModules) {
    const liveModule = sceneApi.get<CabinetModuleNode>(sourceModule.id as AnyNodeId) ?? sourceModule
    applyStylePatchToLinkedCornerRuns(sceneApi, liveModule, patch)
    syncCornerRunsFromSourceModule({
      module: liveModule,
      run: sceneApi.get<CabinetNode>(sourceRun.id as AnyNodeId) ?? sourceRun,
      sceneApi,
    })
  }
  return true
}

function chainModuleCenters(widths: number[]): number[] {
  const centers: number[] = []
  for (let index = 0; index < widths.length; index += 1) {
    if (index === 0) {
      centers.push(0)
      continue
    }
    centers.push(centers[index - 1]! + (widths[index - 1]! + widths[index]!) / 2)
  }
  return centers
}

function moduleWidthsFromPatches(
  patches: Array<{
    width: number
  }>,
): number[] {
  return patches.map((patch) => patch.width)
}

function rangesOverlap(minA: number, maxA: number, minB: number, maxB: number, epsilon = 1e-4) {
  return Math.min(maxA, maxB) - Math.max(minA, minB) > epsilon
}

function angleDelta(a: number, b: number) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

function runPositionFromBackLeft({
  backLeft,
  rotation,
  firstWidth,
  depth,
  y,
}: {
  backLeft: readonly [number, number]
  rotation: number
  firstWidth: number
  depth: number
  y: number
}): [number, number, number] {
  const pseudoRun = {
    position: [backLeft[0], y, backLeft[1]] as [number, number, number],
    rotation,
  }
  return runLocalToPlan(pseudoRun, [firstWidth / 2, 0, depth / 2])
}

function composePose(
  parentPosition: readonly [number, number, number],
  parentRotation: number,
  childPosition: readonly [number, number, number],
  childRotation = 0,
) {
  const cos = Math.cos(parentRotation)
  const sin = Math.sin(parentRotation)
  const [lx, ly, lz] = childPosition
  return {
    position: [
      parentPosition[0] + lx * cos + lz * sin,
      parentPosition[1] + ly,
      parentPosition[2] - lx * sin + lz * cos,
    ] as [number, number, number],
    rotation: parentRotation + childRotation,
  }
}

function resolveCabinetWorldTransform(
  node: CabinetNode | CabinetModuleNode,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): { position: [number, number, number]; rotation: number } {
  const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : null
  if (parent?.type === 'cabinet' || parent?.type === 'cabinet-module') {
    const worldParent: { position: [number, number, number]; rotation: number } =
      resolveCabinetWorldTransform(parent, nodes)
    return composePose(worldParent.position, worldParent.rotation, node.position, node.rotation)
  }
  return {
    position: [...node.position] as [number, number, number],
    rotation: node.rotation,
  }
}

function worldToCabinetLocalPosition(
  parent: CabinetNode | CabinetModuleNode,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
  worldPosition: [number, number, number],
): [number, number, number] {
  const frame = resolveCabinetWorldTransform(parent, nodes)
  return planToRunLocal(
    frame,
    worldPosition[0],
    worldPosition[1] - frame.position[1],
    worldPosition[2],
  )
}

function worldToCabinetLocalRotation(
  parent: CabinetNode | CabinetModuleNode,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
  worldRotation: number,
) {
  return worldRotation - resolveCabinetWorldTransform(parent, nodes).rotation
}

function positionAlongWorldAxis(
  origin: readonly [number, number, number],
  axis: readonly [number, number],
  distance: number,
): [number, number, number] {
  return [origin[0] + axis[0] * distance, origin[1], origin[2] + axis[1] * distance]
}

function anchoredBridgeRunWorldPosition({
  sourceWallTop,
  sourceRun,
  bridgeWidth,
  side,
  fallbackPosition,
  nodes,
}: {
  sourceWallTop: CabinetModuleNode | null
  sourceRun: CabinetNode
  bridgeWidth: number
  side: CornerSide
  fallbackPosition: [number, number, number]
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>
}): [number, number, number] {
  const sourceWallWorld =
    sourceWallTop?.type === 'cabinet-module'
      ? resolveCabinetWorldTransform(sourceWallTop, nodes)
      : null
  const sourceRunWorld = resolveCabinetWorldTransform(sourceRun, nodes)
  const sourceAxis: [number, number] = [
    Math.cos(sourceRunWorld.rotation),
    -Math.sin(sourceRunWorld.rotation),
  ]

  return sourceWallWorld && typeof sourceWallTop?.width === 'number'
    ? positionAlongWorldAxis(
        sourceWallWorld.position,
        sourceAxis,
        (side === 'right' ? 1 : -1) * (sourceWallTop.width / 2 + bridgeWidth / 2),
      )
    : fallbackPosition
}

/** The cabinet-frame parent a derived corner run's placement is local to. */
function cabinetFrameParent(
  node: CabinetNode,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): CabinetNode | CabinetModuleNode | null {
  const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : null
  return parent?.type === 'cabinet' || parent?.type === 'cabinet-module' ? parent : null
}

function cornerSourceModulePatch({
  module,
  side,
  width,
}: {
  module: CabinetModuleNode
  side: CornerSide
  width: number
}): Pick<CabinetModuleNode, 'position' | 'width'> {
  const anchoredEdge = side === 'right' ? moduleMinX(module) : moduleMaxX(module)
  return {
    width,
    position: [
      side === 'right' ? anchoredEdge + width / 2 : anchoredEdge - width / 2,
      module.position[1],
      module.position[2],
    ],
  }
}

function adjustedCornerSourceModule(
  module: CabinetModuleNode,
  side: CornerSide,
  width: number,
): CabinetModuleNode {
  return {
    ...module,
    ...cornerSourceModulePatch({ module, side, width }),
  }
}

function resolveCornerEndSide({
  module,
  modules,
  preferredSide,
}: {
  module: CabinetModuleNode
  modules: CabinetModuleNode[]
  preferredSide: CornerSide
}): CornerSide | null {
  const extent = runLocalXExtent(modules)
  if (!extent) return null
  const atLeftEnd = Math.abs(moduleMinX(module) - extent.minX) <= CABINET_EDGE_EPSILON
  const atRightEnd = Math.abs(moduleMaxX(module) - extent.maxX) <= CABINET_EDGE_EPSILON

  if (preferredSide === 'left' && atLeftEnd) return 'left'
  if (preferredSide === 'right' && atRightEnd) return 'right'
  if (atLeftEnd !== atRightEnd) return atLeftEnd ? 'left' : 'right'
  return null
}

function resolveCabinetHostLevelId(
  node: CabinetNode | CabinetModuleNode,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): AnyNodeId | null {
  const levelId = resolveLevelId(node as AnyNode, nodes as Record<string, AnyNode>)
  return levelId ? (levelId as AnyNodeId) : null
}

function overlappingPolygonXRangeWithinStrip(
  points: ReadonlyArray<{ x: number; z: number }>,
  minZ: number,
  maxZ: number,
): { minX: number; maxX: number } | null {
  const xs: number[] = []
  const withinStrip = (z: number) =>
    z >= minZ - WALL_CLEARANCE_EPSILON && z <= maxZ + WALL_CLEARANCE_EPSILON

  for (const point of points) {
    if (withinStrip(point.z)) xs.push(point.x)
  }

  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!
    const b = points[(index + 1) % points.length]!
    const dz = b.z - a.z
    if (Math.abs(dz) <= WALL_CLEARANCE_EPSILON) continue
    for (const boundary of [minZ, maxZ]) {
      const t = (boundary - a.z) / dz
      if (t < -WALL_CLEARANCE_EPSILON || t > 1 + WALL_CLEARANCE_EPSILON) continue
      xs.push(a.x + (b.x - a.x) * t)
    }
  }

  if (xs.length === 0) return null
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
  }
}

function resolveWallLimitedWidth({
  backLeft,
  desiredWidth,
  depth,
  leadingOffset,
  nodes,
  rotation,
  sourceNode,
}: {
  backLeft: readonly [number, number]
  desiredWidth: number
  depth: number
  leadingOffset: number
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>
  rotation: number
  sourceNode: CabinetNode | CabinetModuleNode
}): number {
  const hostLevelId = resolveCabinetHostLevelId(sourceNode, nodes)
  if (!hostLevelId) return desiredWidth

  const walls = Object.values(nodes).filter(
    (node): node is WallNode =>
      node?.type === 'wall' &&
      resolveLevelId(node, nodes as Record<string, AnyNode>) === hostLevelId,
  )
  if (walls.length === 0) return desiredWidth

  const candidateRun = {
    position: [backLeft[0], 0, backLeft[1]] as [number, number, number],
    rotation,
  }
  const miterData = calculateLevelMiters(walls)
  let blockingDistance = Number.POSITIVE_INFINITY

  for (const wall of walls) {
    const footprint = getWallPlanFootprint(wall, miterData)
    if (footprint.length < 3) continue

    const localFootprint = footprint.map((point) => {
      const local = planToRunLocal(candidateRun, point.x, 0, point.y)
      return { x: local[0], z: local[2] }
    })
    const overlaps = [
      overlappingPolygonXRangeWithinStrip(localFootprint, 0, depth),
      overlappingPolygonXRangeWithinStrip(localFootprint, -depth, 0),
    ].filter((overlap): overlap is { minX: number; maxX: number } => overlap != null)
    if (overlaps.length === 0) continue

    for (const overlap of overlaps) {
      if (overlap.maxX <= WALL_CLEARANCE_EPSILON || overlap.minX <= WALL_CLEARANCE_EPSILON) {
        continue
      }
      blockingDistance = Math.min(blockingDistance, Math.max(0, overlap.minX))
    }
  }

  if (!Number.isFinite(blockingDistance)) return desiredWidth
  const cappedWidth = Math.min(desiredWidth, blockingDistance - leadingOffset)
  return Math.max(0, cappedWidth)
}

function resolveSideAddedModuleWidth({
  centerX,
  centerZ,
  depth,
  desiredWidth,
  nodes,
  run,
  side,
  sourceNode,
}: {
  centerX: number
  centerZ: number
  depth: number
  desiredWidth: number
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>
  run: CabinetNode
  side: 'left' | 'right'
  sourceNode: CabinetNode | CabinetModuleNode
}): number {
  const hostLevelId = resolveCabinetHostLevelId(sourceNode, nodes)
  if (!hostLevelId) {
    return desiredWidth
  }

  const walls = Object.values(nodes).filter(
    (node): node is WallNode =>
      node?.type === 'wall' &&
      resolveLevelId(node, nodes as Record<string, AnyNode>) === hostLevelId,
  )
  if (walls.length === 0) return desiredWidth

  const runWorld = resolveCabinetWorldTransform(run, nodes)
  const miterData = calculateLevelMiters(walls)
  const minZ = centerZ - depth / 2
  const maxZ = centerZ + depth / 2
  const anchorEdge = side === 'right' ? centerX - desiredWidth / 2 : centerX + desiredWidth / 2
  let cappedWidth = desiredWidth

  for (const wall of walls) {
    const footprint = getWallPlanFootprint(wall, miterData)
    if (footprint.length < 3) continue

    const overlap = overlappingPolygonXRangeWithinStrip(
      footprint.map((point) => {
        const local = planToRunLocal(runWorld, point.x, 0, point.y)
        return { x: local[0], z: local[2] }
      }),
      minZ,
      maxZ,
    )
    if (!overlap) continue

    if (side === 'right') {
      if (overlap.minX <= anchorEdge + WALL_CLEARANCE_EPSILON) continue
      cappedWidth = Math.min(cappedWidth, Math.max(0, overlap.minX - anchorEdge))
      continue
    }

    if (overlap.maxX >= anchorEdge - WALL_CLEARANCE_EPSILON) continue
    cappedWidth = Math.min(cappedWidth, Math.max(0, anchorEdge - overlap.maxX))
  }

  return cappedWidth
}

function resolveCornerSourceSideWallLimitedWidth({
  desiredWidth,
  module,
  nodes,
  run,
  side,
}: {
  desiredWidth: number
  module: CabinetModuleNode
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>
  run: CabinetNode
  side: CornerSide
}): number {
  const hostLevelId = resolveCabinetHostLevelId(module, nodes)
  if (!hostLevelId) return desiredWidth

  const walls = Object.values(nodes).filter(
    (node): node is WallNode =>
      node?.type === 'wall' &&
      resolveLevelId(node, nodes as Record<string, AnyNode>) === hostLevelId,
  )
  if (walls.length === 0) return desiredWidth

  const runWorld = resolveCabinetWorldTransform(run, nodes)
  const miterData = calculateLevelMiters(walls)
  const minZ = module.position[2] - module.depth / 2
  const maxZ = module.position[2] + module.depth / 2
  const centerZ = module.position[2]
  const fixedEdge = side === 'right' ? moduleMinX(module) : moduleMaxX(module)
  let cappedWidth = desiredWidth

  for (const wall of walls) {
    const footprint = getWallPlanFootprint(wall, miterData)
    if (footprint.length < 3) continue

    const localFootprint = footprint.map((point) => {
      const local = planToRunLocal(runWorld, point.x, 0, point.y)
      return { x: local[0], z: local[2] }
    })
    const footprintMinZ = Math.min(...localFootprint.map((point) => point.z))
    const footprintMaxZ = Math.max(...localFootprint.map((point) => point.z))
    if (
      centerZ < footprintMinZ - WALL_CLEARANCE_EPSILON ||
      centerZ > footprintMaxZ + WALL_CLEARANCE_EPSILON
    ) {
      continue
    }

    const overlap = overlappingPolygonXRangeWithinStrip(localFootprint, minZ, maxZ)
    if (!overlap) continue

    if (side === 'right') {
      if (overlap.maxX <= fixedEdge + WALL_CLEARANCE_EPSILON) continue
      const maxSourceRight = overlap.minX - run.depth
      if (maxSourceRight <= fixedEdge + desiredWidth + WALL_CLEARANCE_EPSILON) {
        cappedWidth = Math.min(cappedWidth, Math.max(0, maxSourceRight - fixedEdge))
      }
      continue
    }

    if (overlap.minX >= fixedEdge - WALL_CLEARANCE_EPSILON) continue
    const minSourceLeft = overlap.maxX + run.depth
    if (minSourceLeft >= fixedEdge - desiredWidth - WALL_CLEARANCE_EPSILON) {
      cappedWidth = Math.min(cappedWidth, Math.max(0, fixedEdge - minSourceLeft))
    }
  }

  return cappedWidth
}

function computeCornerRunLayout({
  module,
  run,
  nodes,
  side,
  turnSide = side,
  sourceModuleOverride,
  minConnectedWidth = MIN_CORNER_CONNECTED_WIDTH,
}: {
  module: CabinetModuleNode
  run: CabinetNode
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>
  side: CornerSide
  turnSide?: CornerSide
  sourceModuleOverride?: CabinetModuleNode
  minConnectedWidth?: number
}) {
  const sourceModule = sourceModuleOverride ?? module
  const modules = cabinetModulesForRun(run, nodes).map((entry) =>
    entry.id === sourceModule.id ? sourceModule : entry,
  )
  const extent = runLocalXExtent(modules)
  if (!extent || modules.length === 0) return null
  const runWorld = resolveCabinetWorldTransform(run, nodes)

  const backZ = runBackLineZ(modules)
  const cornerX = side === 'right' ? extent.maxX : extent.minX
  const corner = runLocalToPlan(runWorld, [cornerX, 0, backZ])
  const sourceAxis: [number, number] = [Math.cos(runWorld.rotation), -Math.sin(runWorld.rotation)]
  const sign = side === 'right' ? 1 : -1
  const shiftedCorner: [number, number] = [
    corner[0] + sign * run.depth * sourceAxis[0],
    corner[2] + sign * run.depth * sourceAxis[1],
  ]
  const legRotation =
    turnSide === 'right' ? runWorld.rotation - Math.PI / 2 : runWorld.rotation + Math.PI / 2
  const legAxis: [number, number] = [Math.cos(legRotation), -Math.sin(legRotation)]
  const connectedWidth = resolveWallLimitedWidth({
    backLeft:
      side === 'right'
        ? shiftedCorner
        : [
            shiftedCorner[0] - legAxis[0] * (run.depth + sourceModule.width),
            shiftedCorner[1] - legAxis[1] * (run.depth + sourceModule.width),
          ],
    desiredWidth: sourceModule.width,
    depth: run.depth,
    leadingOffset: run.depth,
    nodes,
    rotation: legRotation,
    sourceNode: sourceModule,
  })
  if (connectedWidth < minConnectedWidth - WALL_CLEARANCE_EPSILON) return null
  const connectedShelfCount = inheritedShelfCount(module)

  const baseLegLength = run.depth + connectedWidth
  const baseFirstWidth = side === 'right' ? run.depth : connectedWidth
  const baseBackLeft: [number, number] =
    side === 'right'
      ? shiftedCorner
      : [
          shiftedCorner[0] - legAxis[0] * baseLegLength,
          shiftedCorner[1] - legAxis[1] * baseLegLength,
        ]
  const baseRunPosition = runPositionFromBackLeft({
    backLeft: baseBackLeft,
    rotation: legRotation,
    firstWidth: baseFirstWidth,
    depth: run.depth,
    y: runWorld.position[1],
  })

  const wallLegLength = run.depth + connectedWidth
  const wallFirstWidth = side === 'right' ? run.depth : connectedWidth
  const wallBackLeft: [number, number] =
    side === 'right'
      ? shiftedCorner
      : [
          shiftedCorner[0] - legAxis[0] * wallLegLength,
          shiftedCorner[1] - legAxis[1] * wallLegLength,
        ]
  const wallRunPosition = runPositionFromBackLeft({
    backLeft: wallBackLeft,
    rotation: legRotation,
    firstWidth: wallFirstWidth,
    depth: CABINET_WALL_DEPTH,
    y: runWorld.position[1] + wallBottomHeightForTallAlignment(),
  })

  const bridgeWidth = Math.max(0.01, run.depth - CABINET_WALL_DEPTH)
  const sourceCornerModule = side === 'right' ? modules.at(-1) : modules[0]
  if (!sourceCornerModule) return null
  const bridgeStartX =
    side === 'right' ? moduleMinX(sourceCornerModule) : moduleMinX(sourceCornerModule) - bridgeWidth
  const bridgeBackLeftPlan = runLocalToPlan(runWorld, [bridgeStartX, 0, backZ])
  const bridgeRunPosition = runPositionFromBackLeft({
    backLeft: [bridgeBackLeftPlan[0], bridgeBackLeftPlan[2]],
    rotation: runWorld.rotation,
    firstWidth: side === 'right' ? sourceCornerModule.width : bridgeWidth,
    depth: CABINET_WALL_DEPTH,
    y: runWorld.position[1] + wallBottomHeightForTallAlignment(),
  })
  const bridgeFillerStartX =
    side === 'right' ? moduleMaxX(sourceCornerModule) : moduleMinX(sourceCornerModule) - bridgeWidth
  const bridgeFillerBackLeftPlan = runLocalToPlan(runWorld, [bridgeFillerStartX, 0, backZ])
  const bridgeFillerRunPosition = runPositionFromBackLeft({
    backLeft: [bridgeFillerBackLeftPlan[0], bridgeFillerBackLeftPlan[2]],
    rotation: runWorld.rotation,
    firstWidth: bridgeWidth,
    depth: CABINET_WALL_DEPTH,
    y: runWorld.position[1] + wallBottomHeightForTallAlignment(),
  })

  return {
    baseRunPosition,
    wallRunPosition,
    bridgeRunPosition,
    bridgeFillerRunPosition,
    legRotation,
    connectedWidth,
    connectedShelfCount,
    bridgeWidth,
    sourceCornerWidth: sourceCornerModule.width,
  }
}

function resolveCornerAdditionLayout({
  module,
  run,
  nodes,
  side,
}: {
  module: CabinetModuleNode
  run: CabinetNode
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>
  side: CornerSide
}): {
  sourceModule: CabinetModuleNode
  layout: NonNullable<ReturnType<typeof computeCornerRunLayout>>
  endSide: CornerSide
  turnSide: CornerSide
} | null {
  const modules = cabinetModulesForRun(run, nodes)
  const endSide = resolveCornerEndSide({ module, modules, preferredSide: side })
  if (!endSide) return null
  const turnSide = side
  const maxSourceWidth = resolveCornerSourceSideWallLimitedWidth({
    desiredWidth: module.width,
    module,
    nodes,
    run,
    side: endSide,
  })
  const sourceWasSideWallTrimmed = maxSourceWidth < module.width - CABINET_EDGE_EPSILON
  const minConnectedWidth = sourceWasSideWallTrimmed
    ? MIN_TRIMMED_CORNER_CONNECTED_WIDTH
    : MIN_CORNER_CONNECTED_WIDTH
  if (maxSourceWidth < minConnectedWidth - WALL_CLEARANCE_EPSILON) return null
  const initialSourceModule = sourceWasSideWallTrimmed
    ? adjustedCornerSourceModule(module, endSide, Number(maxSourceWidth.toFixed(4)))
    : module
  const directLayout = computeCornerRunLayout({
    module,
    run,
    nodes,
    side: endSide,
    turnSide,
    sourceModuleOverride: initialSourceModule,
    minConnectedWidth,
  })
  if (directLayout)
    return { sourceModule: initialSourceModule, layout: directLayout, endSide, turnSide }

  for (
    let sourceWidth = initialSourceModule.width - CORNER_WIDTH_SEARCH_STEP;
    sourceWidth >= minConnectedWidth - WALL_CLEARANCE_EPSILON;
    sourceWidth -= CORNER_WIDTH_SEARCH_STEP
  ) {
    const candidateModule = adjustedCornerSourceModule(
      module,
      endSide,
      Number(sourceWidth.toFixed(4)),
    )
    const layout = computeCornerRunLayout({
      module,
      run,
      nodes,
      side: endSide,
      turnSide,
      sourceModuleOverride: candidateModule,
      minConnectedWidth,
    })
    if (layout) return { sourceModule: candidateModule, layout, endSide, turnSide }
  }

  return null
}

type CabinetModulePatch = {
  name: string
  width: number
  moduleKind?: CabinetModuleNode['moduleKind']
  openSide?: CabinetModuleNode['openSide']
  cornerShelf?: boolean
  stack?: CabinetModuleNode['stack']
}

function uncoveredWallRunSegments({
  depth,
  modulePatches,
  parentId,
  position,
  rotation,
  sceneApi,
}: {
  depth: number
  modulePatches: CabinetModulePatch[]
  parentId: AnyNodeId
  position: [number, number, number]
  rotation: number
  sceneApi: SceneApi
}): Array<{ modulePatches: CabinetModulePatch[]; position: [number, number, number] }> {
  const moduleWidths = moduleWidthsFromPatches(modulePatches)
  const centers = chainModuleCenters(moduleWidths)
  const candidateModules = centers.map((center, index) => ({
    index,
    minX: center - moduleWidths[index]! / 2,
    maxX: center + moduleWidths[index]! / 2,
    minZ: -depth / 2,
    maxZ: depth / 2,
  }))

  const candidateRun = { position, rotation }
  const existingModules: Array<{
    minX: number
    maxX: number
    minZ: number
    maxZ: number
  }> = []

  for (const node of Object.values(sceneApi.nodes())) {
    if (node.type !== 'cabinet' || node.runTier !== 'wall') continue
    const nodeWorld = resolveCabinetWorldTransform(node, sceneApi.nodes())
    if (Math.abs(angleDelta(nodeWorld.rotation, rotation)) > 1e-3) continue
    if (Math.abs(nodeWorld.position[1] - position[1]) > 1e-3) continue

    const modules = cabinetModulesForRun(node, sceneApi.nodes())
    if (modules.length === 0) continue
    existingModules.push(
      ...modules.map((module) => {
        const world = runLocalToPlan(nodeWorld, module.position)
        const local = planToRunLocal(candidateRun, world[0], 0, world[2])
        return {
          minX: local[0] - module.width / 2,
          maxX: local[0] + module.width / 2,
          minZ: local[2] - module.depth / 2,
          maxZ: local[2] + module.depth / 2,
        }
      }),
    )
  }

  const uncoveredIndices = candidateModules
    .filter(
      (candidate) =>
        !existingModules.some(
          (existing) =>
            rangesOverlap(candidate.minX, candidate.maxX, existing.minX, existing.maxX) &&
            rangesOverlap(candidate.minZ, candidate.maxZ, existing.minZ, existing.maxZ),
        ),
    )
    .map((candidate) => candidate.index)

  if (uncoveredIndices.length === 0) return []

  const segments: Array<{
    modulePatches: CabinetModulePatch[]
    position: [number, number, number]
  }> = []
  let segmentStart = uncoveredIndices[0]!
  let previous = uncoveredIndices[0]!

  const pushSegment = (startIndex: number, endIndex: number) => {
    segments.push({
      modulePatches: modulePatches.slice(startIndex, endIndex + 1),
      position: runLocalToPlan(candidateRun, [centers[startIndex] ?? 0, 0, 0]),
    })
  }

  for (let index = 1; index < uncoveredIndices.length; index += 1) {
    const current = uncoveredIndices[index]!
    if (current === previous + 1) {
      previous = current
      continue
    }
    pushSegment(segmentStart, previous)
    segmentStart = current
    previous = current
  }

  pushSegment(segmentStart, previous)
  return segments
}

function upsertCabinetRunWithModules({
  depth,
  modulePatches,
  name,
  parentId,
  position,
  rotation,
  runTier,
  sceneApi,
  sourceRun,
}: {
  depth: number
  modulePatches: CabinetModulePatch[]
  name: string
  parentId: AnyNodeId
  position: [number, number, number]
  rotation: number
  runTier: CabinetNode['runTier']
  sceneApi: SceneApi
  sourceRun: CabinetNode
}): { runId: AnyNodeId; moduleIds: AnyNodeId[] } {
  const run = CabinetNodeSchema.parse({
    ...sourceRun,
    id: undefined,
    children: [],
    parentId,
    name,
    position,
    rotation,
    runTier,
    depth,
    carcassHeight: runTier === 'wall' ? CABINET_WALL_CARCASS_HEIGHT : sourceRun.carcassHeight,
    plinthHeight: runTier === 'base' ? sourceRun.plinthHeight : 0,
    toeKickDepth: runTier === 'base' ? sourceRun.toeKickDepth : 0,
    countertopThickness: runTier === 'base' ? sourceRun.countertopThickness : 0,
    countertopOverhang: runTier === 'base' ? sourceRun.countertopOverhang : 0,
    countertopBackOverhang: runTier === 'base' ? sourceRun.countertopBackOverhang : 0,
    withFinishedBack: runTier === 'base' ? sourceRun.withFinishedBack : false,
    showPlinth: runTier === 'base' ? sourceRun.showPlinth : false,
    withCountertop: runTier === 'base' ? sourceRun.withCountertop : false,
    barLedge: undefined,
    withWaterfall: false,
  })
  sceneApi.upsert(run as AnyNode, parentId)

  const centers = chainModuleCenters(modulePatches.map((module) => module.width))
  const moduleIds = modulePatches.map((patch, index) => {
    const module = CabinetModuleNodeSchema.parse({
      ...CabinetModuleNodeSchema.parse({}),
      name: patch.name,
      parentId: run.id,
      position: [centers[index] ?? 0, runTier === 'base' ? runModuleBaseY(run) : 0, 0],
      cabinetType: runTier === 'tall' ? 'tall' : 'base',
      width: patch.width,
      depth,
      carcassHeight: runTier === 'wall' ? CABINET_WALL_CARCASS_HEIGHT : run.carcassHeight,
      plinthHeight: 0,
      toeKickDepth: runTier === 'base' ? sourceRun.toeKickDepth : 0,
      countertopThickness: runTier === 'base' ? sourceRun.countertopThickness : 0,
      countertopOverhang: runTier === 'base' ? sourceRun.countertopOverhang : 0,
      showPlinth: false,
      withCountertop: false,
      moduleKind: patch.moduleKind ?? 'standard',
      ...(patch.openSide ? { openSide: patch.openSide } : {}),
      ...(patch.cornerShelf ? { cornerShelf: true } : {}),
      ...(patch.stack ? { stack: patch.stack } : {}),
    })
    sceneApi.upsert(module as AnyNode, run.id as AnyNodeId)
    return module.id as AnyNodeId
  })

  return { runId: run.id as AnyNodeId, moduleIds }
}

function childModuleByName(
  parent: CabinetNode | CabinetModuleNode,
  name: string,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): CabinetModuleNode | null {
  for (const childId of parent.children ?? []) {
    const child = nodes[childId as AnyNodeId]
    if (child?.type === 'cabinet-module' && child.name === name) return child
  }
  return null
}

export function previewCornerAdditionLayout({
  module,
  run,
  nodes,
  side,
}: {
  module: CabinetModuleNode
  run: CabinetNode
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>
  side: CornerSide
}): {
  connectedWidth: number
  sourceWidth: number
} | null {
  const resolved = resolveCornerAdditionLayout({ module, run, nodes, side })
  if (!resolved) return null
  return {
    connectedWidth: resolved.layout.connectedWidth,
    sourceWidth: Math.min(resolved.sourceModule.width, resolved.layout.connectedWidth),
  }
}

function setCabinetSelectionProxy(sceneApi: SceneApi, id: AnyNodeId, proxyId: AnyNodeId) {
  const live = sceneApi.get<CabinetNode | CabinetModuleNode>(id)
  if (!live || (live.type !== 'cabinet' && live.type !== 'cabinet-module')) return
  sceneApi.update(id, {
    metadata: withSelectionProxyMetadata(live.metadata, proxyId),
  } as Partial<AnyNode>)
}

function cornerSelectionRootId(sourceRun: CabinetNode, derivedRunId: AnyNodeId): AnyNodeId {
  return selectionProxyIdFromMetadata(sourceRun.metadata)
    ? derivedRunId
    : (sourceRun.id as AnyNodeId)
}

function syncDerivedCornerRun({
  baseLayout,
  role,
  run,
  sourceModule,
  sourceRun,
  side,
  turnSide,
  sceneApi,
}: {
  baseLayout: 'full' | 'width-only'
  role: CornerDerivedRunRole
  run: CabinetNode
  sourceModule: CabinetModuleNode
  sourceRun: CabinetNode
  side: CornerSide
  turnSide: CornerSide
  sceneApi: SceneApi
}) {
  if (baseLayout === 'width-only' && role === 'bridge') return

  const layout = computeCornerRunLayout({
    module: sourceModule,
    run: sourceRun,
    nodes: sceneApi.nodes(),
    side,
    turnSide,
  })
  if (!layout) return

  const modules = [...cabinetModulesForRun(run, sceneApi.nodes())].sort(
    (a, b) => a.position[0] - b.position[0],
  )
  if (modules.length === 0) return

  const fullSpecs =
    role === 'base-leg'
      ? side === 'right'
        ? [
            ['Corner Filler', sourceRun.depth, 'right', 'corner-filler', true],
            ['Base Cabinet', layout.connectedWidth, 'left', 'standard', false],
          ]
        : [
            ['Base Cabinet', layout.connectedWidth, 'right', 'standard', false],
            ['Corner Filler', sourceRun.depth, 'left', 'corner-filler', true],
          ]
      : role === 'wall-leg'
        ? side === 'right'
          ? [
              ['Corner Wall Filler', sourceRun.depth, 'right', 'corner-filler', true],
              ['Wall Cabinet', layout.connectedWidth, 'left', 'standard', false],
            ]
          : [
              ['Wall Cabinet', layout.connectedWidth, 'right', 'standard', false],
              ['Corner Wall Filler', sourceRun.depth, 'left', 'corner-filler', true],
            ]
        : side === 'right'
          ? [
              ['Wall Corner Cabinet', layout.sourceCornerWidth, 'right', 'standard', false],
              ['Wall Bridge Filler', layout.bridgeWidth, 'left', 'corner-filler', true],
            ]
          : [
              ['Wall Bridge Filler', layout.bridgeWidth, 'right', 'corner-filler', true],
              ['Wall Corner Cabinet', layout.sourceCornerWidth, 'left', 'standard', false],
            ]

  const fullNames = fullSpecs.map(([name]) => name)
  const fullWidths = fullSpecs.map(([, width]) => width as number)
  const fullCenters = chainModuleCenters(fullWidths)
  const specByName = new Map(
    fullSpecs.map(([name, width, openSide, moduleKind, cornerShelf]) => [
      name,
      {
        width: width as number,
        openSide: openSide as CabinetModuleNode['openSide'],
        moduleKind: moduleKind as CabinetModuleNode['moduleKind'],
        cornerShelf: cornerShelf as boolean,
      },
    ]),
  )

  const currentSpecs = modules.map((entry) => specByName.get(entry.name)).filter(Boolean)
  if (currentSpecs.length !== modules.length) return
  const currentWidths = currentSpecs.map((entry) => entry!.width)
  const currentCenters = chainModuleCenters(currentWidths)
  const firstName = modules[0]!.name
  const firstIndex = fullNames.indexOf(firstName)
  if (firstIndex < 0) return

  if (baseLayout === 'width-only' && (role === 'base-leg' || role === 'wall-leg')) {
    const fixedEdge =
      side === 'right'
        ? Math.min(...modules.map((entry) => entry.position[0] - entry.width / 2))
        : Math.max(...modules.map((entry) => entry.position[0] + entry.width / 2)) -
          currentWidths.reduce((sum, width) => sum + width, 0)
    let cursor = fixedEdge
    modules.forEach((entry, index) => {
      const spec = currentSpecs[index]
      if (!spec) return
      const positionX = cursor + spec.width / 2
      cursor += spec.width
      sceneApi.update(
        entry.id as AnyNodeId,
        {
          width: spec.width,
          position: [positionX, entry.position[1], entry.position[2]],
        } as Partial<AnyNode>,
      )
      const parentShiftX = positionX - entry.position[0]
      for (const childId of entry.children ?? []) {
        const child = sceneApi.get<CabinetNode>(childId as AnyNodeId)
        if (child?.type !== 'cabinet') continue
        sceneApi.update(
          child.id as AnyNodeId,
          {
            position: [child.position[0] - parentShiftX, child.position[1], child.position[2]],
          } as Partial<AnyNode>,
        )
      }
      const wallChild = wallChildOf(entry, sceneApi.nodes())
      if (wallChild) {
        sceneApi.update(wallChild.id as AnyNodeId, { width: spec.width } as Partial<AnyNode>)
      }
    })
    bumpCabinetRunLayoutRevision(sceneApi, sceneApi.get<CabinetNode>(run.id as AnyNodeId) ?? run)
    return
  }

  const sourceWallTop = wallChildOf(sourceModule, sceneApi.nodes())
  const isStandaloneBridgeFillerRun =
    role === 'bridge' && modules.length === 1 && modules[0]?.name === 'Wall Bridge Filler'
  const bridgeAnchorPosition = isStandaloneBridgeFillerRun
    ? anchoredBridgeRunWorldPosition({
        sourceWallTop,
        sourceRun,
        bridgeWidth: layout.bridgeWidth,
        side,
        fallbackPosition: layout.bridgeFillerRunPosition,
        nodes: sceneApi.nodes(),
      })
    : null

  const anchorPosition =
    role === 'base-leg'
      ? layout.baseRunPosition
      : role === 'wall-leg'
        ? layout.wallRunPosition
        : isStandaloneBridgeFillerRun
          ? (bridgeAnchorPosition ?? layout.bridgeFillerRunPosition)
          : layout.bridgeRunPosition
  const sourceRunWorld = resolveCabinetWorldTransform(sourceRun, sceneApi.nodes())
  const rotation = role === 'bridge' ? sourceRunWorld.rotation : layout.legRotation
  const depth = role === 'base-leg' ? run.depth : CABINET_WALL_DEPTH
  const runWorldPosition = isStandaloneBridgeFillerRun
    ? anchorPosition
    : runLocalToPlan({ position: anchorPosition, rotation }, [fullCenters[firstIndex] ?? 0, 0, 0])
  // Place relative to the derived run's ACTUAL parent frame — source run for
  // new scenes, source module for legacy scenes that nested legs under it.
  const frameParent = cabinetFrameParent(run, sceneApi.nodes()) ?? sourceRun
  const runPosition = worldToCabinetLocalPosition(frameParent, sceneApi.nodes(), runWorldPosition)
  const localRotation = worldToCabinetLocalRotation(frameParent, sceneApi.nodes(), rotation)

  sceneApi.update(
    run.id as AnyNodeId,
    {
      position: runPosition,
      rotation: localRotation,
      depth,
      carcassHeight: role === 'base-leg' ? sourceRun.carcassHeight : CABINET_WALL_CARCASS_HEIGHT,
      plinthHeight: role === 'base-leg' ? sourceRun.plinthHeight : 0,
      toeKickDepth: role === 'base-leg' ? sourceRun.toeKickDepth : 0,
      countertopThickness: role === 'base-leg' ? sourceRun.countertopThickness : 0,
      countertopOverhang: role === 'base-leg' ? sourceRun.countertopOverhang : 0,
      countertopBackOverhang: role === 'base-leg' ? sourceRun.countertopBackOverhang : 0,
      withFinishedBack: role === 'base-leg' ? sourceRun.withFinishedBack : false,
      showPlinth: role === 'base-leg' ? sourceRun.showPlinth : false,
      withCountertop: role === 'base-leg' ? sourceRun.withCountertop : false,
      frontStyle: sourceRun.frontStyle,
      frontOverlay: sourceRun.frontOverlay,
      handleStyle: sourceRun.handleStyle,
      handlePosition: sourceRun.handlePosition,
    } as Partial<AnyNode>,
  )

  modules.forEach((entry, index) => {
    const spec = specByName.get(entry.name)
    if (!spec) return
    sceneApi.update(
      entry.id as AnyNodeId,
      {
        width: spec.width,
        depth,
        carcassHeight: role === 'base-leg' ? sourceRun.carcassHeight : CABINET_WALL_CARCASS_HEIGHT,
        position: [
          currentCenters[index] ?? 0,
          role === 'base-leg' ? runModuleBaseY(sourceRun) : 0,
          role === 'base-leg' ? backAnchoredModuleZ(entry.position[2], entry.depth, depth) : 0,
        ],
        toeKickDepth: role === 'base-leg' ? sourceRun.toeKickDepth : 0,
        countertopThickness: role === 'base-leg' ? sourceRun.countertopThickness : 0,
        countertopOverhang: role === 'base-leg' ? sourceRun.countertopOverhang : 0,
        moduleKind: spec.moduleKind,
        openSide: spec.openSide,
        cornerShelf: spec.cornerShelf,
        frontStyle: sourceRun.frontStyle,
        frontOverlay: sourceRun.frontOverlay,
        handleStyle: sourceRun.handleStyle,
        handlePosition: sourceRun.handlePosition,
        stack: doorStack(layout.connectedShelfCount),
        metadata: entry.metadata,
      } as Partial<AnyNode>,
    )
  })

  if (role === 'base-leg') {
    const connectedBaseModule = childModuleByName(
      sceneApi.get<CabinetNode>(run.id as AnyNodeId) ?? run,
      'Base Cabinet',
      sceneApi.nodes(),
    )
    if (connectedBaseModule) {
      ensureWallCabinetAbove({
        module: connectedBaseModule,
        run: sceneApi.get<CabinetNode>(run.id as AnyNodeId) ?? run,
        sceneApi,
        shelfCount: layout.connectedShelfCount,
        openSide: connectedBaseModule.openSide,
      })
    }
  }

  bumpCabinetRunLayoutRevision(sceneApi, sceneApi.get<CabinetNode>(run.id as AnyNodeId) ?? run)
}

export function syncCornerRunsFromSourceModule({
  baseLayout = 'full',
  module,
  run,
  sceneApi,
}: {
  baseLayout?: 'full' | 'width-only'
  module: CabinetModuleNode
  run: CabinetNode
  sceneApi: SceneApi
}) {
  const link = cornerSourceLink(module.metadata)
  if (!link) return
  for (const runId of link.linkedRunIds) {
    const linkedRun = sceneApi.get<CabinetNode>(runId)
    if (linkedRun?.type !== 'cabinet') continue
    const derivedLink = cornerDerivedRunLink(linkedRun.metadata)
    if (!derivedLink) continue
    syncDerivedCornerRun({
      baseLayout,
      role: derivedLink.role,
      run: linkedRun,
      sourceModule: module,
      sourceRun: run,
      side: derivedLink.side,
      turnSide: derivedLink.turnSide,
      sceneApi,
    })
  }
}

export function syncCornerRunsFromRunSources({
  baseLayout = 'full',
  run,
  sceneApi,
}: {
  baseLayout?: 'full' | 'width-only'
  run: CabinetNode
  sceneApi: SceneApi
}) {
  for (const sourceModule of cornerSourceModulesForRun(run, sceneApi.nodes())) {
    syncCornerRunsFromSourceModule({
      baseLayout,
      module: sourceModule,
      run,
      sceneApi,
    })
  }
}

export function previewCornerRunsFromRunSources({
  baseLayout = 'full',
  initialOverrides = [],
  run,
  sceneApi,
}: {
  baseLayout?: 'full' | 'width-only'
  initialOverrides?: ReadonlyArray<readonly [AnyNodeId, Partial<AnyNode>]>
  run: CabinetNode
  sceneApi: SceneApi
}): ReadonlyArray<readonly [AnyNodeId, Partial<AnyNode>]> {
  const overrides = new Map<AnyNodeId, Partial<AnyNode>>()
  for (const [id, patch] of initialOverrides) {
    overrides.set(id, { ...(overrides.get(id) ?? {}), ...patch } as Partial<AnyNode>)
  }
  const previewNodes = { ...sceneApi.nodes() }
  for (const [id, patch] of overrides) {
    const current = previewNodes[id]
    if (current) previewNodes[id] = { ...current, ...patch } as AnyNode
  }
  const previewSceneApi: SceneApi = {
    ...sceneApi,
    get: <N extends AnyNode = AnyNode>(id: AnyNodeId) => previewNodes[id] as N | undefined,
    nodes: () => previewNodes,
    update: (id, patch) => {
      overrides.set(id, { ...(overrides.get(id) ?? {}), ...patch } as Partial<AnyNode>)
      const current = previewNodes[id]
      if (current) previewNodes[id] = { ...current, ...patch } as AnyNode
    },
    markDirty: () => {},
  }

  syncCornerRunsFromRunSources({ baseLayout, run, sceneApi: previewSceneApi })
  return [...overrides]
}

/**
 * Insert a new base module flush against the anchor's side (or the run's
 * outer edge with no anchor). Gap-checked — returns null when a flush
 * neighbor leaves no room for a standard-width unit.
 */
export function planCabinetModuleSideAddition({
  anchorModule,
  nodes,
  run,
  side,
}: {
  anchorModule: CabinetModuleNode | null
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>
  run: CabinetNode
  side: 'left' | 'right'
}): CabinetModuleNode | null {
  const modules = cabinetModulesForRun(run, nodes)
  const x = sideInsertX({
    anchorModule,
    modules,
    side,
    width: CABINET_BASE_WIDTH,
    epsilon: CABINET_EDGE_EPSILON,
  })
  if (x == null) return null
  const depth = run.depth
  const z = anchorModule
    ? backAnchoredModuleZ(anchorModule.position[2], anchorModule.depth, depth)
    : 0
  const width = resolveSideAddedModuleWidth({
    centerX: x,
    centerZ: z,
    depth,
    desiredWidth: CABINET_BASE_WIDTH,
    nodes,
    run,
    side,
    sourceNode: anchorModule ?? run,
  })
  if (width < MIN_CORNER_CONNECTED_WIDTH - WALL_CLEARANCE_EPSILON) return null
  return CabinetModuleNodeSchema.parse({
    name: `Base Cabinet ${modules.length + 1}`,
    parentId: run.id,
    position: [
      side === 'left' ? x + (CABINET_BASE_WIDTH - width) / 2 : x - (CABINET_BASE_WIDTH - width) / 2,
      runModuleBaseY(run),
      z,
    ],
    width,
    depth,
    carcassHeight: run.carcassHeight,
    plinthHeight: run.plinthHeight,
    toeKickDepth: run.toeKickDepth,
    countertopThickness: 0,
    countertopOverhang: run.countertopOverhang,
    showPlinth: false,
    withCountertop: false,
  })
}

export function addCabinetModuleSide({
  anchorModule,
  run,
  sceneApi,
  side,
}: {
  anchorModule: CabinetModuleNode | null
  run: CabinetNode
  sceneApi: SceneApi
  side: 'left' | 'right'
}): AnyNodeId | null {
  const module = planCabinetModuleSideAddition({
    anchorModule,
    nodes: sceneApi.nodes(),
    run,
    side,
  })
  if (!module) return null
  sceneApi.upsert(module as AnyNode, run.id as AnyNodeId)
  bumpCabinetRunLayoutRevision(sceneApi, run)
  return module.id
}

/**
 * Spawn an L corner off one open end of a base run: a perpendicular base leg
 * with a corner pocket filler plus cabinet, a matching wall leg, and a short
 * wall bridge above the source run's corner cabinet so the top corner doesn't
 * read empty.
 */
export function addCornerRun({
  module,
  run,
  sceneApi,
  side,
}: {
  module: CabinetModuleNode
  run: CabinetNode
  sceneApi: SceneApi
  side: 'left' | 'right'
}): AnyNodeId | null {
  const liveRun = sceneApi.get<CabinetNode>(run.id as AnyNodeId) ?? run
  const liveModule = sceneApi.get<CabinetModuleNode>(module.id as AnyNodeId) ?? module
  if (liveRun.runTier !== 'base' || resolveCabinetType(liveModule, liveRun) !== 'base') {
    return null
  }

  const resolved = resolveCornerAdditionLayout({
    module: liveModule,
    run: liveRun,
    nodes: sceneApi.nodes(),
    side,
  })
  if (!resolved) return null
  const { layout, sourceModule: resolvedSourceModule, endSide, turnSide } = resolved
  let sourceModule = liveModule
  let sourceRun = liveRun
  if (
    resolvedSourceModule.width < liveModule.width - CABINET_EDGE_EPSILON ||
    layout.connectedWidth < liveModule.width - CABINET_EDGE_EPSILON
  ) {
    const sourcePatch = cornerSourceModulePatch({
      module: liveModule,
      side: endSide,
      width: Math.min(resolvedSourceModule.width, layout.connectedWidth),
    })
    sceneApi.update(liveModule.id as AnyNodeId, sourcePatch as Partial<AnyNode>)
    const existingWallTop = wallChildOf(liveModule, sceneApi.nodes())
    if (existingWallTop) {
      sceneApi.update(
        existingWallTop.id as AnyNodeId,
        {
          width: layout.connectedWidth,
        } as Partial<AnyNode>,
      )
    }
    sourceModule = sceneApi.get<CabinetModuleNode>(liveModule.id as AnyNodeId) ?? liveModule
    sourceRun = sceneApi.get<CabinetNode>(liveRun.id as AnyNodeId) ?? liveRun
  }
  const resolvedLayout = computeCornerRunLayout({
    module: sourceModule,
    run: sourceRun,
    nodes: sceneApi.nodes(),
    side: endSide,
    turnSide,
    minConnectedWidth:
      sourceModule.width < MIN_CORNER_CONNECTED_WIDTH - CABINET_EDGE_EPSILON
        ? MIN_TRIMMED_CORNER_CONNECTED_WIDTH
        : MIN_CORNER_CONNECTED_WIDTH,
  })
  if (!resolvedLayout) return null
  const {
    baseRunPosition,
    wallRunPosition,
    bridgeFillerRunPosition,
    legRotation,
    connectedWidth,
    connectedShelfCount,
    bridgeWidth,
  } = resolvedLayout
  const runWorld = resolveCabinetWorldTransform(sourceRun, sceneApi.nodes())
  const sourceWallChildId = ensureWallCabinetAbove({
    module: sourceModule,
    run: sourceRun,
    sceneApi,
    shelfCount: connectedShelfCount,
    openSide: endSide,
  })
  const existingWallTop = sourceWallChildId
    ? (sceneApi.get<CabinetModuleNode>(sourceWallChildId) ?? null)
    : wallChildOf(sourceModule, sceneApi.nodes())
  // Legs are siblings of the source module under the SOURCE RUN — the run is
  // the modular cabinet group; the clicked module must not become a container.
  const baseLocalPosition = worldToCabinetLocalPosition(
    sourceRun,
    sceneApi.nodes(),
    baseRunPosition,
  )
  const baseLocalRotation = worldToCabinetLocalRotation(sourceRun, sceneApi.nodes(), legRotation)
  const baseModules =
    endSide === 'right'
      ? [
          {
            name: 'Corner Filler',
            width: sourceRun.depth,
            moduleKind: 'corner-filler' as const,
            openSide: 'right' as const,
            cornerShelf: true,
            stack: doorStack(connectedShelfCount),
          },
          {
            name: 'Base Cabinet',
            width: connectedWidth,
            openSide: 'left' as const,
            stack: doorStack(connectedShelfCount),
          },
        ]
      : [
          {
            name: 'Base Cabinet',
            width: connectedWidth,
            openSide: 'right' as const,
            stack: doorStack(connectedShelfCount),
          },
          {
            name: 'Corner Filler',
            width: sourceRun.depth,
            moduleKind: 'corner-filler' as const,
            openSide: 'left' as const,
            cornerShelf: true,
            stack: doorStack(connectedShelfCount),
          },
        ]

  const baseLeg = upsertCabinetRunWithModules({
    depth: sourceRun.depth,
    modulePatches: baseModules,
    name: 'Corner Base Run',
    parentId: sourceRun.id as AnyNodeId,
    position: baseLocalPosition,
    rotation: baseLocalRotation,
    runTier: 'base',
    sceneApi,
    sourceRun,
  })
  const selectionRootId = cornerSelectionRootId(sourceRun, baseLeg.runId)
  const linkedRunIds: AnyNodeId[] = [baseLeg.runId]
  const baseLegLiveMetadata = sceneApi.get<CabinetNode>(baseLeg.runId)?.metadata ?? null
  const baseLegMetadata = cabinetMetadataRecord(baseLegLiveMetadata)
  sceneApi.update(baseLeg.runId, {
    metadata: {
      ...(selectionRootId === baseLeg.runId
        ? baseLegMetadata
        : withSelectionProxyMetadata(baseLegLiveMetadata, selectionRootId)),
      cabinetCornerDerivedRun: {
        role: 'base-leg',
        side: endSide,
        turnSide,
        sourceModuleId: sourceModule.id as AnyNodeId,
        sourceRunId: sourceRun.id as AnyNodeId,
      },
    },
  } as Partial<AnyNode>)
  for (const moduleId of baseLeg.moduleIds) {
    setCabinetSelectionProxy(sceneApi, moduleId, selectionRootId)
  }
  const baseLegRunNode = sceneApi.get<CabinetNode>(baseLeg.runId) ?? sourceRun
  const cornerFillerModule =
    childModuleByName(baseLegRunNode, 'Corner Filler', sceneApi.nodes()) ??
    sceneApi.get<CabinetModuleNode>(
      baseLeg.moduleIds[endSide === 'right' ? 0 : 1] ?? baseLeg.moduleIds[0]!,
    )
  const connectedBaseModule =
    childModuleByName(baseLegRunNode, 'Base Cabinet', sceneApi.nodes()) ??
    sceneApi.get<CabinetModuleNode>(
      baseLeg.moduleIds[endSide === 'right' ? 1 : 0] ?? baseLeg.moduleIds[0]!,
    )

  if (cornerFillerModule) {
    const bridgeRunWorldPosition = anchoredBridgeRunWorldPosition({
      sourceWallTop: existingWallTop,
      sourceRun,
      bridgeWidth,
      side: endSide,
      fallbackPosition: bridgeFillerRunPosition,
      nodes: sceneApi.nodes(),
    })
    const bridgeRunLocalPosition = worldToCabinetLocalPosition(
      cornerFillerModule,
      sceneApi.nodes(),
      bridgeRunWorldPosition,
    )
    const bridgeRunLocalRotation = worldToCabinetLocalRotation(
      cornerFillerModule,
      sceneApi.nodes(),
      runWorld.rotation,
    )
    const bridgeRun = upsertCabinetRunWithModules({
      depth: CABINET_WALL_DEPTH,
      modulePatches: [
        {
          name: 'Wall Bridge Filler',
          width: bridgeWidth,
          moduleKind: 'corner-filler',
          openSide: endSide === 'right' ? 'left' : 'right',
          cornerShelf: true,
          stack: doorStack(connectedShelfCount),
        },
      ],
      name: 'Corner Wall Bridge',
      parentId: cornerFillerModule.id as AnyNodeId,
      position: bridgeRunLocalPosition,
      rotation: bridgeRunLocalRotation,
      runTier: 'wall',
      sceneApi,
      sourceRun,
    })
    linkedRunIds.push(bridgeRun.runId)
    const bridgeRunLiveMetadata = sceneApi.get<CabinetNode>(bridgeRun.runId)?.metadata ?? null
    const bridgeRunMetadata = cabinetMetadataRecord(bridgeRunLiveMetadata)
    sceneApi.update(bridgeRun.runId, {
      metadata: {
        ...(selectionRootId === bridgeRun.runId
          ? bridgeRunMetadata
          : withSelectionProxyMetadata(bridgeRunLiveMetadata, selectionRootId)),
        cabinetCornerDerivedRun: {
          role: 'bridge',
          side: endSide,
          turnSide,
          sourceModuleId: sourceModule.id as AnyNodeId,
          sourceRunId: sourceRun.id as AnyNodeId,
        },
      },
    } as Partial<AnyNode>)
    for (const moduleId of bridgeRun.moduleIds) {
      setCabinetSelectionProxy(sceneApi, moduleId, selectionRootId)
    }
    const wallModuleCenters = chainModuleCenters([sourceRun.depth, connectedWidth])
    const cornerWallFillerCenter =
      endSide === 'right' ? (wallModuleCenters[0] ?? 0) : (wallModuleCenters[1] ?? 0)
    const cornerWallFillerWorldPosition = runLocalToPlan(
      { position: wallRunPosition, rotation: legRotation },
      [cornerWallFillerCenter, 0, 0],
    )
    const wallFillerRun = upsertCabinetRunWithModules({
      depth: CABINET_WALL_DEPTH,
      modulePatches: [
        {
          name: 'Corner Wall Filler',
          width: sourceRun.depth,
          moduleKind: 'corner-filler',
          openSide: endSide === 'right' ? 'right' : 'left',
          cornerShelf: true,
          stack: doorStack(connectedShelfCount),
        },
      ],
      name: 'Corner Wall Run',
      parentId: cornerFillerModule.id as AnyNodeId,
      position: worldToCabinetLocalPosition(
        cornerFillerModule,
        sceneApi.nodes(),
        cornerWallFillerWorldPosition,
      ),
      rotation: worldToCabinetLocalRotation(cornerFillerModule, sceneApi.nodes(), legRotation),
      runTier: 'wall',
      sceneApi,
      sourceRun,
    })
    linkedRunIds.push(wallFillerRun.runId)
    const wallFillerRunLiveMetadata =
      sceneApi.get<CabinetNode>(wallFillerRun.runId)?.metadata ?? null
    const wallFillerRunMetadata = cabinetMetadataRecord(wallFillerRunLiveMetadata)
    sceneApi.update(wallFillerRun.runId, {
      metadata: {
        ...(selectionRootId === wallFillerRun.runId
          ? wallFillerRunMetadata
          : withSelectionProxyMetadata(wallFillerRunLiveMetadata, selectionRootId)),
        cabinetCornerDerivedRun: {
          role: 'wall-leg',
          side: endSide,
          turnSide,
          sourceModuleId: sourceModule.id as AnyNodeId,
          sourceRunId: sourceRun.id as AnyNodeId,
        },
      },
    } as Partial<AnyNode>)
    for (const moduleId of wallFillerRun.moduleIds) {
      setCabinetSelectionProxy(sceneApi, moduleId, selectionRootId)
    }
  }

  if (connectedBaseModule) {
    const wallChildId = ensureWallCabinetAbove({
      module: connectedBaseModule,
      run: sceneApi.get<CabinetNode>(baseLeg.runId) ?? baseLegRunNode,
      sceneApi,
      shelfCount: connectedShelfCount,
      openSide: connectedBaseModule.openSide,
    })
    if (wallChildId) {
      setCabinetSelectionProxy(sceneApi, wallChildId, selectionRootId)
    }
  }

  const liveSourceMetadata =
    sceneApi.get<CabinetModuleNode>(sourceModule.id as AnyNodeId)?.metadata ?? null
  const sourceMetadata = cabinetMetadataRecord(liveSourceMetadata)
  const existingSourceLink = cornerSourceLink(liveSourceMetadata)
  sceneApi.update(
    sourceModule.id as AnyNodeId,
    {
      metadata: {
        ...sourceMetadata,
        cabinetCornerSourceLink: {
          side: endSide,
          linkedRunIds: [
            ...new Set([...(existingSourceLink?.linkedRunIds ?? []), ...linkedRunIds]),
          ],
        },
      },
    } as Partial<AnyNode>,
  )

  bumpCabinetRunLayoutRevision(sceneApi, sourceRun)
  return connectedBaseModule?.id ?? null
}

/**
 * Nest a wall cabinet (or chimney hood) above a base module. Returns the new
 * node id, or null when the module already carries one / isn't a base unit.
 */
export function addWallChildAbove({
  kind,
  module,
  run,
  sceneApi,
  openSide,
}: {
  kind: 'cabinet' | 'hood'
  module: CabinetModuleNode
  run: CabinetNode
  sceneApi: SceneApi
  openSide?: CabinetModuleNode['openSide']
}): AnyNodeId | null {
  if (resolveCabinetType(module, run) !== 'base') return null
  if (wallChildOf(module, sceneApi.nodes())) return null

  const isHood = kind === 'hood'
  const carcassHeight = isHood
    ? Math.max(0.4, hoodCompartmentHeight('hood-pyramid'))
    : CABINET_WALL_CARCASS_HEIGHT
  const wall = CabinetModuleNodeSchema.parse({
    name: isHood ? 'Chimney' : 'Wall Cabinet',
    parentId: module.id,
    // Wall cabinet top aligns with the default tall cabinet top.
    position: [
      0,
      wallBottomHeightForTallAlignment() - module.position[1],
      backAlignZ(module.depth, CABINET_WALL_DEPTH),
    ],
    width: module.width,
    depth: CABINET_WALL_DEPTH,
    carcassHeight,
    plinthHeight: 0,
    toeKickDepth: 0,
    countertopThickness: 0,
    countertopOverhang: 0,
    showPlinth: false,
    withCountertop: false,
    stack: isHood ? [newCabinetCompartment('hood-pyramid')] : doorStack(1),
    frontStyle: module.frontStyle,
    frontOverlay: module.frontOverlay,
    handleStyle: module.handleStyle,
    handlePosition: module.handlePosition,
    ...(openSide ? { openSide } : {}),
  })
  sceneApi.upsert(wall as AnyNode, module.id as AnyNodeId)
  sceneApi.markDirty(module.id as AnyNodeId)
  return wall.id
}

function ensureWallCabinetAbove({
  module,
  run,
  sceneApi,
  shelfCount,
  openSide,
}: {
  module: CabinetModuleNode
  run: CabinetNode
  sceneApi: SceneApi
  shelfCount: number
  openSide?: CabinetModuleNode['openSide']
}): AnyNodeId | null {
  const existingWall = wallChildOf(module, sceneApi.nodes())
  if (existingWall) {
    sceneApi.update(
      existingWall.id as AnyNodeId,
      {
        width: module.width,
        depth: CABINET_WALL_DEPTH,
        carcassHeight: CABINET_WALL_CARCASS_HEIGHT,
        position: [
          0,
          wallBottomHeightForTallAlignment() - module.position[1],
          backAlignZ(module.depth, CABINET_WALL_DEPTH),
        ],
        frontStyle: module.frontStyle,
        frontOverlay: module.frontOverlay,
        handleStyle: module.handleStyle,
        handlePosition: module.handlePosition,
        stack: cloneWallCabinetStack(existingWall, shelfCount),
        ...(openSide ? { openSide } : {}),
      } as Partial<AnyNode>,
    )
    return existingWall.id as AnyNodeId
  }

  const wallChildId = addWallChildAbove({
    kind: 'cabinet',
    module,
    run,
    sceneApi,
    openSide,
  })
  if (!wallChildId) return null

  sceneApi.update(wallChildId, {
    stack: doorStack(shelfCount),
  } as Partial<AnyNode>)
  return wallChildId
}

/** Convert a base module to a tall unit (deletes any nested wall cabinet). */
export function switchCabinetToTall({
  module,
  run,
  sceneApi,
}: {
  module: CabinetModuleNode
  run: CabinetNode
  sceneApi: SceneApi
}): boolean {
  if (resolveCabinetType(module, run) !== 'base') return false
  const wallChild = wallChildOf(module, sceneApi.nodes())
  if (wallChild) sceneApi.delete(wallChild.id as AnyNodeId)
  sceneApi.update(
    module.id as AnyNodeId,
    {
      name: 'Tall Cabinet',
      cabinetType: 'tall',
      depth: CABINET_TALL_DEPTH,
      position: [
        module.position[0],
        runModuleBaseY(run),
        backAnchoredModuleZ(module.position[2], module.depth, CABINET_TALL_DEPTH),
      ],
      carcassHeight: CABINET_TALL_CARCASS_HEIGHT,
      plinthHeight: CABINET_TALL_PLINTH_HEIGHT,
      toeKickDepth: 0.075,
      showPlinth: false,
      countertopThickness: 0,
      countertopOverhang: run.countertopOverhang,
      withCountertop: false,
      stack: doorStack(3),
    } as Partial<AnyNode>,
  )
  bumpCabinetRunLayoutRevision(sceneApi, run)
  return true
}

/** Convert a tall module back to a base unit matching the run's dimensions. */
export function switchCabinetToBase({
  module,
  run,
  sceneApi,
}: {
  module: CabinetModuleNode
  run: CabinetNode
  sceneApi: SceneApi
}): boolean {
  if (resolveCabinetType(module, run) !== 'tall') return false
  sceneApi.update(
    module.id as AnyNodeId,
    {
      name: 'Base Cabinet',
      cabinetType: 'base',
      depth: run.depth,
      position: [
        module.position[0],
        runModuleBaseY(run),
        backAnchoredModuleZ(module.position[2], module.depth, run.depth),
      ],
      carcassHeight: run.carcassHeight,
      plinthHeight: run.plinthHeight,
      toeKickDepth: run.toeKickDepth,
      showPlinth: false,
      countertopThickness: 0,
      countertopOverhang: run.countertopOverhang,
      withCountertop: false,
      stack: doorStack(1),
    } as Partial<AnyNode>,
  )
  bumpCabinetRunLayoutRevision(sceneApi, run)
  return true
}
