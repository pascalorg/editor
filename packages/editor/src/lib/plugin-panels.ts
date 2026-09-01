import type { IconRef, LazyComponent } from '@pascal-app/core'

export type EditorHostPanelWorkspace = string & {}

export type EditorHostPanel = {
  id: string
  label: string
  icon: IconRef
  component: LazyComponent
  kinds?: readonly string[]
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

  panelForKind = (kind: string): string | undefined =>
    this.cached.find((panel) => panel.kinds?.includes(kind))?.id

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

/**
 * The distinct plugins the manager can act on — every registered panel that
 * declares a `pluginId`, deduplicated, because one plugin may contribute
 * several panels and the manager lists plugins, not panels.
 *
 * Registration is what makes a plugin *manageable*, not installation: an
 * uninstalled plugin still has to appear so it can be installed.
 */
export function managedPluginIds(panels: readonly EditorHostPanel[]): string[] {
  return Array.from(
    new Set(panels.filter((panel) => panel.pluginId).map((panel) => panel.pluginId as string)),
  )
}

/**
 * Does the plugin *manager* tab belong in the rail?
 *
 * It is a management surface — it installs and uninstalls plugins into the
 * scene — so it earns a slot when there is something to manage, or when the
 * scene is writable and the "create a plugin" path is still worth offering to
 * whoever owns it.
 *
 * That leaves exactly one case out, and it is a real screen rather than a
 * hypothetical: the open lobby (`/play/<id>`) mounts the editor under a
 * read-only lease and registers NO host panels, so the manager was the only
 * tab in the rail. The rail therefore opened by default onto a "Plugins"
 * heading with nothing under it, covering roughly 40% of a visitor's window
 * over the world they had come to play in (owner report 2026-08-31). With no
 * tabs at all the v2 layout drops the whole left column, which is the lobby as
 * intended: the canvas, and nothing else.
 *
 * A read-only *editor* keeps the tab as long as plugins are registered — a
 * viewer can still read what a project uses; only the install button is
 * disabled. So this hides an empty panel, never a populated one.
 */
export function showsPluginManager({
  managedPluginCount,
  readOnly,
  workspaceMode,
}: {
  managedPluginCount: number
  readOnly: boolean
  workspaceMode: string
}): boolean {
  if (workspaceMode !== 'edit') return false
  return managedPluginCount > 0 || !readOnly
}
