import type { AnyNode, AnyNodeId, DoorNode, WindowNode } from '@pascal-app/core'
import { constrainCurtainOpening } from './curtain-opening-limits'

export type OpeningPropertyPreviewDependencies = {
  nodes: () => Readonly<Record<AnyNodeId, AnyNode>>
  override: (id: AnyNodeId) => Partial<AnyNode> | undefined
  setOverride: (id: AnyNodeId, patch: Partial<AnyNode>) => void
  clearOverrideFields: (id: AnyNodeId, fields: string[]) => void
  markDirty: (id: AnyNodeId) => void
  updateNode: (id: AnyNodeId, patch: Partial<AnyNode>) => void
}

export function createOpeningPropertyPreview<T extends DoorNode | WindowNode>(
  id: AnyNodeId,
  dependencies: OpeningPropertyPreviewDependencies,
) {
  let pending: Partial<T> | undefined
  const dirty = () => {
    dependencies.markDirty(id)
    const parent = dependencies.nodes()[id]?.parentId
    if (parent) dependencies.markDirty(parent as AnyNodeId)
  }
  const clear = () => {
    if (!pending) return
    dependencies.clearOverrideFields(id, Object.keys(pending))
    pending = undefined
    dirty()
  }
  return {
    preview(patch: Partial<T>) {
      const nodes = dependencies.nodes()
      const node = nodes[id]
      if (node?.type !== 'door' && node?.type !== 'window') return
      const live = dependencies.override(id)
      const effective = live ? ({ ...node, ...live } as T) : (node as T)
      patch = constrainCurtainOpening(effective, patch, nodes)
      pending = { ...pending, ...patch }
      dependencies.setOverride(id, patch as Partial<AnyNode>)
      dirty()
    },
    commit(patch?: Partial<T>) {
      const live = dependencies.override(id)
      if (pending && !Object.keys(pending).some((key) => live && key in live)) {
        clear()
        return
      }
      const current =
        pending && live
          ? Object.fromEntries(
              Object.keys(pending)
                .filter((key) => key in live)
                .map((key) => [key, live[key as keyof typeof live]]),
            )
          : undefined
      const nodes = dependencies.nodes()
      const node = nodes[id]
      const updates =
        node?.type === 'door' || node?.type === 'window'
          ? constrainCurtainOpening(node as T, { ...current, ...patch } as Partial<T>, nodes)
          : {}
      if (Object.keys(updates).length) dependencies.updateNode(id, updates as Partial<AnyNode>)
      clear()
    },
    cancel: clear,
  }
}
