import type {
  AnyNode,
  AnyNodeId,
  CabinetModuleNode,
  CabinetNode,
  NodeQuickAction,
} from '@pascal-app/core'
import { sideInsertX } from './run-layout'
import {
  addCabinetModuleSide,
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
  const hasWallCabinet =
    context.module && selectedCabinetType === 'base'
      ? Boolean(wallChildOf(context.module, nodes))
      : false
  const runModules = cabinetModulesForRun(context.run, nodes)
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
