import type { ItemNode } from '@pascal-app/core'
import type { Vector3 } from 'three'
import type { DraftNodeHandle } from './components/tools/item/use-draft-node'
import type { PlacementCoordinatorConfig } from './components/tools/item/use-placement-coordinator'

export type ItemActionHandlers = { decorateDuplicate?: (source: ItemNode, duplicateInfo: Record<string, unknown>) => void; onDelete?: (node: ItemNode) => boolean; onDuplicateDraft?: (source: ItemNode, draft: ItemNode) => void; onRepair?: (node: ItemNode) => boolean }
export type ItemMoveExtensionContext = { draftNode: DraftNodeHandle; isNew: boolean; meta: Record<string, unknown>; movingNode: ItemNode }
export type ItemMoveExtension = Partial<Pick<PlacementCoordinatorConfig, 'ignoreItemIds' | 'isDisabled' | 'onCommitRequested' | 'preserveDraftOnUnmount' | 'surfaceMode'>> & { initDraft?: (gridPosition: Vector3) => boolean; onCancel?: () => void; onCommitted?: () => void }
type ItemMoveExtensionHook = (context: ItemMoveExtensionContext) => ItemMoveExtension | null
const globalRobotAdapter = globalThis as typeof globalThis & {
  __pascalItemActionHandlers?: Set<ItemActionHandlers>
  __pascalItemMoveExtensionHook?: ItemMoveExtensionHook | null
}
globalRobotAdapter.__pascalItemActionHandlers ??= new Set<ItemActionHandlers>()
globalRobotAdapter.__pascalItemMoveExtensionHook ??= null

export function registerItemActionHandlers(handlers: ItemActionHandlers) {
  globalRobotAdapter.__pascalItemActionHandlers?.add(handlers)
  return () => globalRobotAdapter.__pascalItemActionHandlers?.delete(handlers)
}

export function decorateItemDuplicate(source: ItemNode, duplicateInfo: Record<string, unknown>) {
  for (const handlers of globalRobotAdapter.__pascalItemActionHandlers ?? []) {
    handlers.decorateDuplicate?.(source, duplicateInfo)
  }
}
export function notifyItemDuplicateDraft(source: ItemNode, draft: ItemNode) {
  for (const handlers of globalRobotAdapter.__pascalItemActionHandlers ?? []) {
    handlers.onDuplicateDraft?.(source, draft)
  }
}
export function requestExternalItemDelete(node: ItemNode) {
  for (const handlers of globalRobotAdapter.__pascalItemActionHandlers ?? []) {
    if (handlers.onDelete?.(node)) return true
  }
  return false
}
export function requestExternalItemRepair(node: ItemNode) {
  for (const handlers of globalRobotAdapter.__pascalItemActionHandlers ?? []) {
    if (handlers.onRepair?.(node)) return true
  }
  return false
}
export function registerItemMoveExtension(hook: ItemMoveExtensionHook | null) {
  globalRobotAdapter.__pascalItemMoveExtensionHook = hook
}
export function useItemMoveExtension(context: ItemMoveExtensionContext) {
  return globalRobotAdapter.__pascalItemMoveExtensionHook?.(context) ?? null
}

export { triggerSFX } from './lib/sfx-bus'
export { default as useEditor } from './store/use-editor'
export { Viewer } from '@pascal-app/viewer'
