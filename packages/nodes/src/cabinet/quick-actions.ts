import type {
  AnyNode,
  AnyNodeId,
  CabinetModuleNode,
  CabinetNode,
  IconRef,
  NodeQuickAction,
} from '@pascal-app/core'
import { moduleSideOpen, sideInsertX } from './run-layout'
import {
  addCabinetModuleSide,
  addCornerRun,
  addWallChildAbove,
  CABINET_BASE_WIDTH,
  CABINET_EDGE_EPSILON,
  cabinetModulesForRun,
  planCabinetModuleSideAddition,
  previewCornerAdditionLayout,
  resolveCabinetType,
  switchCabinetToBase,
  switchCabinetToTall,
  wallChildOf,
} from './run-ops'

type CabinetContext = {
  run: CabinetNode
  module: CabinetModuleNode | null
}

function resolveRunEndModule(
  runModules: CabinetModuleNode[],
  run: CabinetNode,
  side: 'left' | 'right',
): CabinetModuleNode | null {
  const standardBaseModules = runModules.filter(
    (module) => module.moduleKind === 'standard' && resolveCabinetType(module, run) === 'base',
  )
  if (standardBaseModules.length === 0) return null
  return side === 'left' ? (standardBaseModules[0] ?? null) : (standardBaseModules.at(-1) ?? null)
}

// Lazy component IconRefs — the menus mount these behind Suspense, so the
// glyph module loads only when a cabinet quick action is actually shown.
const cabinetWallIcon: IconRef = {
  kind: 'component',
  module: () => import('./quick-action-icons').then((m) => ({ default: m.CabinetWallGlyph })),
}
const cabinetTallIcon: IconRef = {
  kind: 'component',
  module: () => import('./quick-action-icons').then((m) => ({ default: m.CabinetTallGlyph })),
}
const cabinetBaseIcon: IconRef = {
  kind: 'component',
  module: () => import('./quick-action-icons').then((m) => ({ default: m.CabinetBaseGlyph })),
}
const cornerTurnLeftIcon: IconRef = {
  kind: 'component',
  module: () => import('./quick-action-icons').then((m) => ({ default: m.CornerTurnLeftGlyph })),
}
const cornerTurnRightIcon: IconRef = {
  kind: 'component',
  module: () => import('./quick-action-icons').then((m) => ({ default: m.CornerTurnRightGlyph })),
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

export function cabinetQuickActions({
  node,
  nodes,
}: {
  node: CabinetNode | CabinetModuleNode
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>
}): NodeQuickAction[] {
  const context = resolveCabinetContext(node, nodes)
  if (!context) return []

  const selectedCabinetType = context.module
    ? resolveCabinetType(context.module, context.run)
    : null
  const standardModule = context.module == null || context.module.moduleKind === 'standard'
  const hasWallCabinet =
    context.module && standardModule && selectedCabinetType === 'base'
      ? Boolean(wallChildOf(context.module, nodes))
      : false
  const runModules = cabinetModulesForRun(context.run, nodes)
  const leftCornerModule =
    context.module && standardModule && selectedCabinetType === 'base'
      ? context.module
      : resolveRunEndModule(runModules, context.run, 'left')
  const rightCornerModule =
    context.module && standardModule && selectedCabinetType === 'base'
      ? context.module
      : resolveRunEndModule(runModules, context.run, 'right')
  const leftHasInsertSlot =
    sideInsertX({
      anchorModule: context.module,
      modules: runModules,
      side: 'left',
      width: CABINET_BASE_WIDTH,
      epsilon: CABINET_EDGE_EPSILON,
    }) != null
  const rightHasInsertSlot =
    sideInsertX({
      anchorModule: context.module,
      modules: runModules,
      side: 'right',
      width: CABINET_BASE_WIDTH,
      epsilon: CABINET_EDGE_EPSILON,
    }) != null
  const leftAvailable =
    leftHasInsertSlot &&
    planCabinetModuleSideAddition({
      anchorModule: context.module,
      nodes,
      run: context.run,
      side: 'left',
    }) != null
  const rightAvailable =
    rightHasInsertSlot &&
    planCabinetModuleSideAddition({
      anchorModule: context.module,
      nodes,
      run: context.run,
      side: 'right',
    }) != null
  const canAddCornerLeft =
    leftCornerModule != null &&
    context.run.runTier === 'base' &&
    moduleSideOpen(runModules, leftCornerModule.id, 'left', CABINET_EDGE_EPSILON) &&
    previewCornerAdditionLayout({
      module: leftCornerModule,
      run: context.run,
      nodes,
      side: 'left',
    }) != null
  const canAddCornerRight =
    rightCornerModule != null &&
    context.run.runTier === 'base' &&
    moduleSideOpen(runModules, rightCornerModule.id, 'right', CABINET_EDGE_EPSILON) &&
    previewCornerAdditionLayout({
      module: rightCornerModule,
      run: context.run,
      nodes,
      side: 'right',
    }) != null

  const actions: NodeQuickAction[] = []
  const pushSideAction = (side: 'left' | 'right', disabled: boolean) => {
    actions.push({
      id: `cabinet:add-${side}`,
      label: side === 'left' ? 'Left' : 'Right',
      title: side === 'left' ? 'Add cabinet to the left' : 'Add cabinet to the right',
      icon: side === 'left' ? 'add-left' : 'add-right',
      disabled,
      history: 'single',
      run: ({ sceneApi }) => {
        if (disabled) return undefined
        const id = addCabinetModuleSide({
          anchorModule: context.module,
          run: context.run,
          sceneApi,
          side,
        })
        return id ? { selectedIds: [id] } : undefined
      },
    })
  }
  const pushCornerAction = (
    module: CabinetModuleNode | null,
    endSide: 'left' | 'right',
    disabled: boolean,
  ) => {
    actions.push({
      id: `cabinet:add-corner-${endSide}`,
      label: endSide === 'left' ? 'L Left' : 'L Right',
      title: endSide === 'left' ? 'Turn an L corner to the left' : 'Turn an L corner to the right',
      icon: endSide === 'left' ? cornerTurnLeftIcon : cornerTurnRightIcon,
      disabled,
      history: 'single',
      run: ({ sceneApi }) => {
        if (disabled || !module) return undefined
        const id = addCornerRun({
          module,
          run: context.run,
          sceneApi,
          side: endSide,
        })
        return id ? { selectedIds: [id] } : undefined
      },
    })
  }

  pushSideAction('left', !leftAvailable)

  pushCornerAction(leftCornerModule, 'left', !canAddCornerLeft)

  if (context.module) {
    if (standardModule && selectedCabinetType === 'base') {
      actions.push({
        id: 'cabinet:add-wall',
        label: 'Wall',
        title: hasWallCabinet
          ? 'A wall cabinet already exists above this cabinet'
          : 'Add wall cabinet above',
        icon: cabinetWallIcon,
        disabled: hasWallCabinet,
        run: ({ sceneApi }) => {
          const id = addWallChildAbove({
            kind: 'cabinet',
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
        icon: cabinetTallIcon,
        run: ({ sceneApi }) =>
          switchCabinetToTall({
            module: context.module!,
            run: context.run,
            sceneApi,
          })
            ? { selectedIds: [context.module!.id] }
            : undefined,
      })
    } else if (standardModule) {
      actions.push({
        id: 'cabinet:to-base',
        label: 'Base',
        title: 'Switch to base cabinet',
        icon: cabinetBaseIcon,
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

  pushCornerAction(rightCornerModule, 'right', !canAddCornerRight)

  pushSideAction('right', !rightAvailable)

  return actions
}
