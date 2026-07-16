import type { IconRef, LazyComponent } from '@pascal-app/core'

export type EditorHostPanelWorkspace = string & {}

export type EditorHostPanel = {
  id: string
  label: string
  icon: IconRef
  component: LazyComponent
  workspaces?: readonly EditorHostPanelWorkspace[]
  pluginId?: string
  description?: string
  creator?: {
    name: string
    url?: string
  }
  pluginUrl?: string
  defaultInstalled?: boolean
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

class EditorHostPanelRegistryImpl {
  private readonly panels = new Map<string, EditorHostPanel>()
  private readonly listeners = new Set<() => void>()
  private cached: EditorHostPanel[] = []

  subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange)
    return () => {
      this.listeners.delete(onChange)
    }
  }

  getSnapshot = (): EditorHostPanel[] => this.cached

  getDefaultInstalledPluginIds = (): string[] =>
    Array.from(
      new Set(
        this.cached
          .filter((panel) => panel.pluginId && panel.defaultInstalled)
          .map((panel) => panel.pluginId as string),
      ),
    )

  reset(): void {
    this.panels.clear()
    this.emit()
  }

  registerPanel(panel: EditorHostPanel): void {
    if (typeof panel.id !== 'string' || panel.id.length === 0) {
      throw new Error('[editor:host-panels] panel id must be a non-empty string')
    }
    if (this.panels.has(panel.id)) {
      if (isDevMode()) {
        console.warn(`[editor:host-panels] re-registering panel "${panel.id}" (HMR)`)
      } else {
        throw new Error(`[editor:host-panels] duplicate panel id: "${panel.id}" already registered`)
      }
    }
    this.panels.set(panel.id, panel)
    this.emit()
  }

  private emit(): void {
    this.cached = Array.from(this.panels.values())
    for (const listener of this.listeners) listener()
  }
}

export const editorHostPanelRegistry = new EditorHostPanelRegistryImpl()

export function registerEditorHostPanel(panel: EditorHostPanel): void {
  editorHostPanelRegistry.registerPanel(panel)
}
