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
  return side === 'left' ? standardBaseModules[0] ?? null : standardBaseModules.at(-1) ?? null
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
  const leftAvailable =
    sideInsertX({
      anchorModule: context.module,
      modules: runModules,
      side: 'left',
      width: CABINET_BASE_WIDTH,
      epsilon: CABINET_EDGE_EPSILON,
    }) != null
  const rightAvailable =
    sideInsertX({
      anchorModule: context.module,
      modules: runModules,
      side: 'right',
      width: CABINET_BASE_WIDTH,
      epsilon: CABINET_EDGE_EPSILON,
    }) != null
  const canAddCornerLeft =
    leftCornerModule != null &&
    context.run.runTier === 'base' &&
    moduleSideOpen(runModules, leftCornerModule.id, 'left', CABINET_EDGE_EPSILON)
  const canAddCornerRight =
    rightCornerModule != null &&
    context.run.runTier === 'base' &&
    moduleSideOpen(runModules, rightCornerModule.id, 'right', CABINET_EDGE_EPSILON)

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

  if (canAddCornerLeft) {
    actions.push({
      id: 'cabinet:add-corner-left',
      label: 'L Left',
      title: 'Turn an L corner to the left',
      icon: cornerTurnLeftIcon,
      run: ({ sceneApi }) => {
        const id = addCornerRun({
          module: leftCornerModule!,
          run: context.run,
          sceneApi,
          side: 'left',
        })
        return id ? { selectedIds: [id] } : undefined
      },
    })
  }

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

  if (canAddCornerRight) {
    actions.push({
      id: 'cabinet:add-corner-right',
      label: 'L Right',
      title: 'Turn an L corner to the right',
      icon: cornerTurnRightIcon,
      run: ({ sceneApi }) => {
        const id = addCornerRun({
          module: rightCornerModule!,
          run: context.run,
          sceneApi,
          side: 'right',
        })
        return id ? { selectedIds: [id] } : undefined
      },
    })
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
