import type {
  AnyNode,
  AnyNodeId,
  CabinetModuleNode,
  CabinetNode,
  NodeQuickAction,
  SceneApi,
} from '@pascal-app/core'
import { CabinetModuleNode as CabinetModuleNodeSchema } from './schema'

type CabinetEditableNode = CabinetNode | CabinetModuleNode
type CabinetContext = {
  run: CabinetNode
  module: CabinetModuleNode | null
}

const CABINET_BASE_WIDTH = 0.6
const CABINET_WALL_DEPTH = 0.32
const CABINET_WALL_CARCASS_HEIGHT = 0.72
const CABINET_TALL_DEPTH = 0.58
const CABINET_TALL_PLINTH_HEIGHT = 0.1
const CABINET_TALL_CARCASS_HEIGHT = 2.07
const CABINET_EDGE_EPSILON = 1e-4

function cabinetCompartmentId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `cc_${crypto.randomUUID().slice(0, 8)}`
  }
  return `cc_${Date.now().toString(36)}`
}

function defaultDoorStack(shelfCount: number) {
  return [{ id: cabinetCompartmentId(), type: 'door' as const, shelfCount }]
}

function cabinetMetadataRecord(metadata: CabinetEditableNode['metadata']): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {}
}

function bumpCabinetRunsLayoutRevisionOnLevel(sceneApi: SceneApi, levelId: AnyNodeId) {
  for (const candidate of Object.values(sceneApi.nodes())) {
    if (candidate.type !== 'cabinet' || candidate.parentId !== levelId) continue
    const metadata = cabinetMetadataRecord(candidate.metadata)
    const currentRevision =
      typeof metadata.cabinetLayoutRevision === 'number' ? metadata.cabinetLayoutRevision : 0
    sceneApi.update(candidate.id as AnyNodeId, {
      metadata: {
        ...metadata,
        cabinetLayoutRevision: currentRevision + 1,
      },
    })
  }
}

function bumpCabinetRunLayoutRevision(sceneApi: SceneApi, run: CabinetNode) {
  const metadata = cabinetMetadataRecord(run.metadata)
  const currentRevision =
    typeof metadata.cabinetLayoutRevision === 'number' ? metadata.cabinetLayoutRevision : 0
  sceneApi.update(run.id as AnyNodeId, {
    metadata: {
      ...metadata,
      cabinetLayoutRevision: currentRevision + 1,
    },
  })
  sceneApi.markDirty(run.id as AnyNodeId)
  if (run.parentId) bumpCabinetRunsLayoutRevisionOnLevel(sceneApi, run.parentId as AnyNodeId)
}

function runModuleBaseY(run: Pick<CabinetNode, 'showPlinth' | 'plinthHeight'>) {
  return run.showPlinth ? run.plinthHeight : 0
}

function totalCabinetHeight(
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

function wallBottomHeightForTallAlignment() {
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

function backAlignZ(baseDepth: number, wallDepth: number) {
  return -(baseDepth - wallDepth) / 2
}

function backAnchoredModuleZ(currentZ: number, currentDepth: number, nextDepth: number) {
  return currentZ + (nextDepth - currentDepth) / 2
}

function cabinetModulesForRun(
  run: CabinetNode,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): CabinetModuleNode[] {
  return (run.children ?? [])
    .map((id) => nodes[id as AnyNodeId])
    .filter((child): child is CabinetModuleNode => child?.type === 'cabinet-module')
}

function resolveCabinetContext(
  node: AnyNode,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): CabinetContext | null {
  if (node.type === 'cabinet') return { run: node, module: null }
  if (node.type !== 'cabinet-module' || !node.parentId) return null
  const parent = nodes[node.parentId as AnyNodeId]
  if (parent?.type === 'cabinet') return { run: parent, module: node }
  return null
}

function resolveCabinetType(module: CabinetModuleNode, run: CabinetNode): 'base' | 'tall' {
  return module.cabinetType ?? (run.runTier === 'tall' ? 'tall' : 'base')
}

function wallChildOf(
  module: CabinetModuleNode,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): CabinetModuleNode | null {
  for (const childId of module.children ?? []) {
    const child = nodes[childId as AnyNodeId]
    if (child?.type === 'cabinet-module') return child
  }
  return null
}

function resolveCabinetSideInsertX({
  anchorModule,
  nodes,
  run,
  side,
}: {
  anchorModule: CabinetModuleNode | null
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>
  run: CabinetNode
  side: 'left' | 'right'
}): number | null {
  const modules = cabinetModulesForRun(run, nodes)
  if (modules.length === 0) {
    return side === 'left' ? -CABINET_BASE_WIDTH / 2 : CABINET_BASE_WIDTH / 2
  }

  if (!anchorModule) {
    const edge =
      side === 'left'
        ? Math.min(...modules.map((module) => module.position[0] - module.width / 2))
        : Math.max(...modules.map((module) => module.position[0] + module.width / 2))
    return side === 'left' ? edge - CABINET_BASE_WIDTH / 2 : edge + CABINET_BASE_WIDTH / 2
  }

  const selectedLeft = anchorModule.position[0] - anchorModule.width / 2
  const selectedRight = anchorModule.position[0] + anchorModule.width / 2
  const siblings = modules.filter((module) => module.id !== anchorModule.id)

  if (side === 'left') {
    const nearestLeft = siblings
      .map((module) => module.position[0] + module.width / 2)
      .filter((edge) => edge <= selectedLeft + CABINET_EDGE_EPSILON)
      .reduce<number | null>((best, edge) => (best == null || edge > best ? edge : best), null)
    if (
      nearestLeft != null &&
      selectedLeft - nearestLeft < CABINET_BASE_WIDTH - CABINET_EDGE_EPSILON
    ) {
      return null
    }
    return selectedLeft - CABINET_BASE_WIDTH / 2
  }

  const nearestRight = siblings
    .map((module) => module.position[0] - module.width / 2)
    .filter((edge) => edge >= selectedRight - CABINET_EDGE_EPSILON)
    .reduce<number | null>((best, edge) => (best == null || edge < best ? edge : best), null)
  if (
    nearestRight != null &&
    nearestRight - selectedRight < CABINET_BASE_WIDTH - CABINET_EDGE_EPSILON
  ) {
    return null
  }
  return selectedRight + CABINET_BASE_WIDTH / 2
}

function addCabinetModuleSide({
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
  const x = resolveCabinetSideInsertX({
    anchorModule,
    nodes: sceneApi.nodes(),
    run,
    side,
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

function addWallCabinetAbove({
  module,
  run,
  sceneApi,
}: {
  module: CabinetModuleNode
  run: CabinetNode
  sceneApi: SceneApi
}): AnyNodeId | null {
  if (resolveCabinetType(module, run) !== 'base') return null
  if (wallChildOf(module, sceneApi.nodes())) return null

  const wall = CabinetModuleNodeSchema.parse({
    name: 'Wall Cabinet',
    parentId: module.id,
    position: [
      0,
      wallBottomHeightForTallAlignment() - module.position[1],
      backAlignZ(module.depth, CABINET_WALL_DEPTH),
    ],
    width: module.width,
    depth: CABINET_WALL_DEPTH,
    carcassHeight: CABINET_WALL_CARCASS_HEIGHT,
    plinthHeight: 0,
    toeKickDepth: 0,
    countertopThickness: 0,
    countertopOverhang: 0,
    showPlinth: false,
    withCountertop: false,
    stack: defaultDoorStack(1),
  })
  sceneApi.upsert(wall as AnyNode, module.id as AnyNodeId)
  sceneApi.markDirty(module.id as AnyNodeId)
  return wall.id
}

function switchCabinetToTall({
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
      stack: defaultDoorStack(3),
    } as Partial<AnyNode>,
  )
  bumpCabinetRunLayoutRevision(sceneApi, run)
  return true
}

function switchCabinetToBase({
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
      stack: defaultDoorStack(1),
    } as Partial<AnyNode>,
  )
  bumpCabinetRunLayoutRevision(sceneApi, run)
  return true
}

export function cabinetQuickActions({
  node,
  nodes,
}: {
  node: CabinetNode | CabinetModuleNode
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>
}): NodeQuickAction[] {
  const context = resolveCabinetContext(node, nodes)
  if (!context) return []

  const selectedCabinetType =
    context.module && context.run ? resolveCabinetType(context.module, context.run) : null
  const hasWallCabinet =
    context.module && selectedCabinetType === 'base'
      ? Boolean(wallChildOf(context.module, nodes))
      : false
  const leftAvailable =
    resolveCabinetSideInsertX({
      anchorModule: context.module,
      nodes,
      run: context.run,
      side: 'left',
    }) != null
  const rightAvailable =
    resolveCabinetSideInsertX({
      anchorModule: context.module,
      nodes,
      run: context.run,
      side: 'right',
    }) != null

  const actions: NodeQuickAction[] = []

  if (leftAvailable) {
    actions.push({
      id: 'cabinet:add-left',
      label: 'Left',
      title: 'Add cabinet to the left',
      icon: 'add-left',
      run: ({ sceneApi }) => {
        const id = addCabinetModuleSide({
          anchorModule: context.module,
          run: context.run,
          sceneApi,
          side: 'left',
        })
        return id ? { selectedIds: [id] } : undefined
      },
    })
  }

  if (context.module) {
    if (selectedCabinetType === 'base') {
      actions.push({
        id: 'cabinet:add-wall',
        label: 'Wall',
        title: hasWallCabinet
          ? 'A wall cabinet already exists above this cabinet'
          : 'Add wall cabinet above',
        disabled: hasWallCabinet,
        run: ({ sceneApi }) => {
          const id = addWallCabinetAbove({
            module: context.module!,
            run: context.run,
            sceneApi,
          })
          return id ? { selectedIds: [id] } : undefined
        },
      })
      actions.push({
        id: 'cabinet:to-tall',
        label: 'Tall',
        title: 'Switch to tall cabinet',
        icon: 'convert',
        run: ({ sceneApi }) =>
          switchCabinetToTall({
            module: context.module!,
            run: context.run,
            sceneApi,
          })
            ? { selectedIds: [context.module!.id] }
            : undefined,
      })
    } else {
      actions.push({
        id: 'cabinet:to-base',
        label: 'Base',
        title: 'Switch to base cabinet',
        icon: 'convert',
        run: ({ sceneApi }) =>
          switchCabinetToBase({
            module: context.module!,
            run: context.run,
            sceneApi,
          })
            ? { selectedIds: [context.module!.id] }
            : undefined,
      })
    }
  }

  if (rightAvailable) {
    actions.push({
      id: 'cabinet:add-right',
      label: 'Right',
      title: 'Add cabinet to the right',
      icon: 'add-right',
      run: ({ sceneApi }) => {
        const id = addCabinetModuleSide({
          anchorModule: context.module,
          run: context.run,
          sceneApi,
          side: 'right',
        })
        return id ? { selectedIds: [id] } : undefined
      },
    })
  }

  return actions
}
