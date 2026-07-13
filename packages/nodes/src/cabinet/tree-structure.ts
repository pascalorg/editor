import type {
  AnyNode,
  AnyNodeId,
  CabinetModuleNode as CabinetModuleNodeType,
  CabinetNode as CabinetNodeType,
} from '@pascal-app/core'

/**
 * Sidebar-tree shaping for cabinet runs (`def.tree` on both cabinet
 * definitions). L-corner legs are real cabinet runs parented inside the
 * source run (see run-ops' `addCornerRun`), but the sidebar should read as
 * the user's mental model: one run whose base cabinets carry their corner
 * modules inline. So corner-derived runs are hidden and their modules are
 * flattened into the surrounding hierarchy.
 */

type CabinetCornerDerivedRunLink = {
  role: 'base-leg' | 'wall-leg' | 'bridge'
  side: 'left' | 'right'
  sourceModuleId: AnyNodeId
  sourceRunId: AnyNodeId
}

function cornerDerivedRunLink(
  metadata: CabinetNodeType['metadata'] | CabinetModuleNodeType['metadata'],
): CabinetCornerDerivedRunLink | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>).cabinetCornerDerivedRun
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const role = (value as { role?: unknown }).role
  const side = (value as { side?: unknown }).side
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
    sourceModuleId: sourceModuleId as AnyNodeId,
    sourceRunId: sourceRunId as AnyNodeId,
  }
}

function isCabinetRun(node: AnyNode | undefined): node is CabinetNodeType {
  return node?.type === 'cabinet'
}

function isCabinetModule(node: AnyNode | undefined): node is CabinetModuleNodeType {
  return node?.type === 'cabinet-module'
}

function cabinetModuleChildren(
  run: CabinetNodeType,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): CabinetModuleNodeType[] {
  return (run.children ?? [])
    .map((id) => nodes[id as AnyNodeId])
    .filter((child): child is CabinetModuleNodeType => child?.type === 'cabinet-module')
}

function childIdsOf(node: AnyNode | undefined): AnyNodeId[] {
  if (!node || typeof node !== 'object' || !('children' in node) || !Array.isArray(node.children)) {
    return []
  }
  return node.children as AnyNodeId[]
}

function resolveCabinetRunChildIds(
  run: CabinetNodeType,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): AnyNodeId[] {
  const resolved: AnyNodeId[] = []
  for (const childId of run.children ?? []) {
    const child = nodes[childId as AnyNodeId]
    if (isCabinetModule(child)) {
      resolved.push(child.id as AnyNodeId)
      continue
    }
    if (!isCabinetRun(child)) continue
    const link = cornerDerivedRunLink(child.metadata)
    if (link?.role === 'base-leg') {
      resolved.push(...resolveCabinetRunChildIds(child, nodes))
      continue
    }
    if (link) continue
    resolved.push(child.id as AnyNodeId)
  }
  return resolved
}

/** `def.tree.hidden` for cabinet runs: corner-derived legs disappear as rows
 * (their modules resurface through `childIds` flattening). */
export function cabinetTreeHidden(
  node: AnyNode,
  _nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): boolean {
  return isCabinetRun(node) && cornerDerivedRunLink(node.metadata) != null
}

export function cabinetTreeLabel(
  node: AnyNode,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): string {
  if (node.name) return node.name
  if (isCabinetRun(node)) {
    const moduleCount = resolveCabinetRunChildIds(node, nodes).filter((childId) => {
      const child = nodes[childId]
      return child?.type === 'cabinet-module'
    }).length
    return `Modular Cabinet (${moduleCount} module${moduleCount === 1 ? '' : 's'})`
  }
  if (isCabinetModule(node)) return 'Cabinet Module'
  return 'Node'
}

/** `def.tree.childIds` for both cabinet kinds. */
export function cabinetTreeChildIds(
  node: AnyNode,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): AnyNodeId[] {
  if (isCabinetRun(node)) {
    return resolveCabinetRunChildIds(node, nodes)
  }

  if (!isCabinetModule(node)) return []

  const resolved: AnyNodeId[] = []
  for (const childId of childIdsOf(node)) {
    const child = nodes[childId as AnyNodeId]
    if (isCabinetModule(child)) {
      resolved.push(child.id as AnyNodeId)
      continue
    }
    if (!isCabinetRun(child)) continue
    const link = cornerDerivedRunLink(child.metadata)
    if (link) {
      resolved.push(...cabinetModuleChildren(child, nodes).map((module) => module.id as AnyNodeId))
      continue
    }
    resolved.push(child.id as AnyNodeId)
  }
  return resolved
}

export function cabinetFloorplanAffectedIds(args: {
  node: AnyNode
  nodes: Record<AnyNodeId, AnyNode>
  liveOverrides: Map<string, Record<string, unknown>>
}): readonly AnyNodeId[] {
  const { node, nodes, liveOverrides } = args
  const affected = new Set<AnyNodeId>()
  const visited = new Set<AnyNodeId>()
  const queue: AnyNodeId[] = [node.id as AnyNodeId]

  while (queue.length > 0) {
    const id = queue.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    const current = nodes[id]
    if (!isCabinetRun(current) && !isCabinetModule(current)) continue
    affected.add(id)

    const parentIds = [
      current.parentId as AnyNodeId | undefined,
      (liveOverrides.get(id) as { parentId?: AnyNodeId } | undefined)?.parentId,
    ]
    for (const parentId of parentIds) {
      const parent = parentId ? nodes[parentId] : undefined
      if (parentId && (isCabinetRun(parent) || isCabinetModule(parent))) {
        queue.push(parentId)
      }
    }

    for (const childId of childIdsOf(current)) {
      const child = nodes[childId]
      if (isCabinetRun(child) || isCabinetModule(child)) {
        queue.push(childId as AnyNodeId)
      }
    }
  }

  return Array.from(affected)
}
