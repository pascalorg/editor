import type { AnyNode, AnyNodeId, CabinetModuleNode, CabinetNode } from '@pascal-app/core'
import { cornerStyleSourceForRun } from './run-ops'

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
      const source = cornerStyleSourceForRun(current, nodes)
      const derivedSource = source && source.run.id !== current.id ? source : null
      return {
        parentRun: derivedSource?.run ?? current,
        reflowModule: current.id === directParentId ? (derivedSource?.module ?? module) : null,
      }
    }
    current = current.parentId ? nodes[current.parentId as AnyNodeId] : undefined
  }
  return null
}
