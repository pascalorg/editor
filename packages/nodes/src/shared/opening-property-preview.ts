import type { AnyNode, AnyNodeId, DoorNode, WindowNode } from '@pascal-app/core'
import { constrainCurtainOpening } from './curtain-opening-limits'

export type OpeningPropertyPreviewDependencies = {
  nodes: () => Readonly<Record<AnyNodeId, AnyNode>>
  override: (id: AnyNodeId) => Partial<AnyNode> | undefined
  setOverride: (id: AnyNodeId, patch: Partial<AnyNode>) => void
  clearOverrideFields: (id: AnyNodeId, fields: string[]) => void
  markDirty: (id: AnyNodeId) => void
  updateNode: (id: AnyNodeId, patch: Partial<AnyNode>) => void
  scheduleFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (handle: number) => void
  scheduleDelay: (callback: () => void, delay: number) => number
  cancelDelay: (handle: number) => void
}

const CURTAIN_PARENT_PREVIEW_INTERVAL_MS = 100

export function createOpeningPropertyPreview<T extends DoorNode | WindowNode>(
  id: AnyNodeId,
  dependencies: OpeningPropertyPreviewDependencies,
) {
  let pending: Partial<T> | undefined
  let dirtyFrame: number | undefined
  let parentDelay: number | undefined
  const parent = () => {
    const parentId = dependencies.nodes()[id]?.parentId
    return parentId ? dependencies.nodes()[parentId as AnyNodeId] : undefined
  }
  const dirtyOpening = () => {
    dependencies.markDirty(id)
  }
  const dirtyParent = () => {
    const parentId = dependencies.nodes()[id]?.parentId
    if (parentId) dependencies.markDirty(parentId as AnyNodeId)
  }
  const cancelScheduledDirty = () => {
    if (dirtyFrame === undefined) return
    dependencies.cancelFrame(dirtyFrame)
    dirtyFrame = undefined
  }
  const scheduleDirty = () => {
    if (dirtyFrame !== undefined) return
    let completedSynchronously = false
    const handle = dependencies.scheduleFrame(() => {
      completedSynchronously = true
      dirtyFrame = undefined
      dirtyOpening()
      const parentNode = parent()
      if (parentNode?.type !== 'wall' || parentNode.wallType !== 'curtain') {
        dirtyParent()
        return
      }
      if (parentDelay !== undefined) return
      parentDelay = dependencies.scheduleDelay(() => {
        parentDelay = undefined
        dirtyParent()
      }, CURTAIN_PARENT_PREVIEW_INTERVAL_MS)
    })
    if (!completedSynchronously) dirtyFrame = handle
  }
  const clear = () => {
    if (!pending) return
    cancelScheduledDirty()
    if (parentDelay !== undefined) {
      dependencies.cancelDelay(parentDelay)
      parentDelay = undefined
    }
    dependencies.clearOverrideFields(id, [...Object.keys(pending), 'metadata'])
    pending = undefined
    dirtyOpening()
    dirtyParent()
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
      dependencies.setOverride(id, {
        ...patch,
        metadata: { ...node.metadata, ...effective.metadata, deferParentRebuild: true },
      } as Partial<AnyNode>)
      scheduleDirty()
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
