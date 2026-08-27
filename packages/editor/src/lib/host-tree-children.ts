import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import type { ComponentType } from 'react'

export type EditorHostTreeChildrenProps = {
  nodeId: AnyNodeId
  depth: number
  parentVisible: boolean
}

export type EditorHostTreeChildren = {
  kind: string
  component: ComponentType<EditorHostTreeChildrenProps>
  hasChildren: (node: AnyNode) => boolean
}

function isDevMode(): boolean {
  try {
    const meta = import.meta as { env?: { DEV?: boolean } }
    if (typeof meta?.env?.DEV === 'boolean') return meta.env.DEV
  } catch {
    // import.meta unavailable in some CJS contexts — fall through.
  }
  if (typeof process !== 'undefined' && process.env?.NODE_ENV) {
    return process.env.NODE_ENV !== 'production'
  }
  return false
}

class EditorHostTreeChildrenRegistryImpl {
  private readonly entries = new Map<string, EditorHostTreeChildren>()
  private readonly listeners = new Set<() => void>()
  private revision = 0

  subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange)
    return () => {
      this.listeners.delete(onChange)
    }
  }

  getSnapshot = (): number => this.revision

  childrenForKind = (kind: string): EditorHostTreeChildren | undefined => this.entries.get(kind)

  reset(): void {
    this.entries.clear()
    this.emit()
  }

  register(entry: EditorHostTreeChildren): void {
    if (typeof entry.kind !== 'string' || entry.kind.length === 0) {
      throw new Error('[editor:host-tree-children] kind must be a non-empty string')
    }
    if (this.entries.has(entry.kind)) {
      if (isDevMode()) {
        console.warn(
          `[editor:host-tree-children] re-registering children for "${entry.kind}" (HMR)`,
        )
      } else {
        throw new Error(
          `[editor:host-tree-children] duplicate kind: "${entry.kind}" already registered`,
        )
      }
    }
    this.entries.set(entry.kind, entry)
    this.emit()
  }

  private emit(): void {
    this.revision += 1
    for (const listener of this.listeners) listener()
  }
}

export const editorHostTreeChildrenRegistry = new EditorHostTreeChildrenRegistryImpl()

export function registerEditorHostTreeChildren(entry: EditorHostTreeChildren): void {
  editorHostTreeChildrenRegistry.register(entry)
}
