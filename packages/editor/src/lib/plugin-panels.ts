import type { IconRef, LazyComponent, Plugin } from '@pascal-app/core'

export type PluginPanelWorkspace = string & {}

export type EditorPluginPanel = {
  id: string
  label: string
  icon: IconRef
  component: LazyComponent
  workspaces?: readonly PluginPanelWorkspace[]
}

export type EditorPlugin = Plugin & {
  panels?: EditorPluginPanel[]
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

class PluginPanelRegistryImpl {
  private readonly panels = new Map<string, EditorPluginPanel>()
  private readonly listeners = new Set<() => void>()
  private readonly kindPanels = new Map<string, string>()
  private cached: EditorPluginPanel[] = []

  subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange)
    return () => {
      this.listeners.delete(onChange)
    }
  }

  getSnapshot = (): EditorPluginPanel[] => this.cached

  panelForKind = (kind: string): string | undefined => this.kindPanels.get(kind)

  registerPlugin(plugin: Pick<EditorPlugin, 'id' | 'nodes' | 'panels'>): void {
    for (const panel of plugin.panels ?? []) {
      const namespacedId = `${plugin.id}:${panel.id}`
      this.registerPanel({ ...panel, id: namespacedId })
      for (const def of plugin.nodes ?? []) {
        if (!this.kindPanels.has(def.kind)) {
          this.kindPanels.set(def.kind, namespacedId)
        }
      }
    }
  }

  reset(): void {
    this.panels.clear()
    this.kindPanels.clear()
    this.emit()
  }

  private registerPanel(panel: EditorPluginPanel): void {
    if (typeof panel.id !== 'string' || panel.id.length === 0) {
      throw new Error('[editor:plugin-panels] panel id must be a non-empty string')
    }
    if (this.panels.has(panel.id)) {
      if (isDevMode()) {
        console.warn(`[editor:plugin-panels] re-registering panel "${panel.id}" (HMR)`)
      } else {
        throw new Error(
          `[editor:plugin-panels] duplicate panel id: "${panel.id}" already registered`,
        )
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

export const pluginPanelRegistry = new PluginPanelRegistryImpl()

export function registerEditorPluginPanels(
  plugin: Pick<EditorPlugin, 'id' | 'nodes' | 'panels'>,
): void {
  pluginPanelRegistry.registerPlugin(plugin)
}
