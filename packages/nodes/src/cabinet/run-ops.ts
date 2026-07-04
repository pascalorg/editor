import type { AnyNode, AnyNodeId, CabinetModuleNode, CabinetNode, SceneApi } from '@pascal-app/core'
import { sideInsertX } from './run-layout'
import { CabinetModuleNode as CabinetModuleNodeSchema } from './schema'
import { backAnchoredModuleZ, hoodCompartmentHeight, newCabinetCompartment } from './stack'

/**
 * Kind-owned cabinet run mutations, shared by the properties panel, the
 * quick-action menu, and the placement tool. Everything routes through
 * `SceneApi` so each caller (panel with `useScene`, actions with the
 * registry's api) gets identical behavior — these used to be copy-pasted
 * per surface and had already drifted (gap checks, hood support, revision
 * scope).
 */

export const CABINET_BASE_WIDTH = 0.6
export const CABINET_WALL_DEPTH = 0.32
export const CABINET_WALL_CARCASS_HEIGHT = 0.72
export const CABINET_TALL_DEPTH = 0.58
export const CABINET_TALL_PLINTH_HEIGHT = 0.1
export const CABINET_TALL_CARCASS_HEIGHT = 2.07
export const CABINET_EDGE_EPSILON = 1e-4

export type CabinetEditableNode = CabinetNode | CabinetModuleNode

export function cabinetMetadataRecord(
  metadata: CabinetEditableNode['metadata'],
): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {}
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

function doorStack(shelfCount: number) {
  return [{ ...newCabinetCompartment('door'), shelfCount }]
}

/**
 * Insert a new base module flush against the anchor's side (or the run's
 * outer edge with no anchor). Gap-checked — returns null when a flush
 * neighbor leaves no room for a standard-width unit.
 */
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
  const modules = cabinetModulesForRun(run, sceneApi.nodes())
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
  const module = CabinetModuleNodeSchema.parse({
    name: `Base Cabinet ${modules.length + 1}`,
    parentId: run.id,
    position: [x, runModuleBaseY(run), z],
    width: CABINET_BASE_WIDTH,
    depth,
    carcassHeight: run.carcassHeight,
    plinthHeight: run.plinthHeight,
    toeKickDepth: run.toeKickDepth,
    countertopThickness: 0,
    countertopOverhang: run.countertopOverhang,
    showPlinth: false,
    withCountertop: false,
  })
  sceneApi.upsert(module as AnyNode, run.id as AnyNodeId)
  bumpCabinetRunLayoutRevision(sceneApi, run)
  return module.id
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
}: {
  kind: 'cabinet' | 'hood'
  module: CabinetModuleNode
  run: CabinetNode
  sceneApi: SceneApi
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
  })
  sceneApi.upsert(wall as AnyNode, module.id as AnyNodeId)
  sceneApi.markDirty(module.id as AnyNodeId)
  return wall.id
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
