import type { AnyNode, AnyNodeId, CabinetModuleNode, CabinetNode } from '@pascal-app/core'

export type CabinetModulePanelContext = {
  parentRun: CabinetNode
  reflowModule: CabinetModuleNode | null
}

export function cabinetModulePanelContext(
  module: CabinetModuleNode,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): CabinetModulePanelContext | null {
  const directParentId = module.parentId as AnyNodeId | undefined
  let current = directParentId ? nodes[directParentId] : undefined
  const visited = new Set<AnyNodeId>()

  while (current && !visited.has(current.id as AnyNodeId)) {
    visited.add(current.id as AnyNodeId)
    if (current.type === 'cabinet') {
      return {
        parentRun: current,
        reflowModule: current.id === directParentId ? module : null,
      }
    }
    current = current.parentId ? nodes[current.parentId as AnyNodeId] : undefined
  }
  return null
}
