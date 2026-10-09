import type { IconRef, LazyComponent } from '@pascal-app/core'
import useEditor from '../store/use-editor'
import { VIEW_2D, VIEW_3D } from '../store/view-layout'

/**
 * A view fills a pane of the stage, beside or instead of the 3D scene and the
 * 2D plan. Hosts and plugins register views the way they register rail panels;
 * a plugin registers as many as it needs, each tagged with its `pluginId`.
 */
export type EditorHostView = {
  id: string
  label: string
  icon: IconRef
  component: LazyComponent
  /** The view exists in a project only while this plugin is installed there. */
  pluginId?: string
  /** Workspaces the view is offered in. Default `['edit']`, like panels. */
  workspaces?: readonly string[]
  description?: string
  /** Shown in the view bar until the user unpins it. Default false: the "More views" menu only. */
  defaultPinned?: boolean
}

/** A view as the stage needs it. The scene views have no component: the stage owns their canvases. */
export type EditorViewDescriptor = Omit<EditorHostView, 'component'> & {
  component?: LazyComponent
  /** 3D and 2D: the views the level selector, tool dock and scene overlays belong to. */
  scene?: boolean
}

export const SCENE_VIEWS: readonly EditorViewDescriptor[] = [
  {
    id: VIEW_3D,
    label: '3D',
    icon: { kind: 'url', src: '/icons/building.webp' },
    scene: true,
    defaultPinned: true,
  },
  {
    id: VIEW_2D,
    label: '2D',
    icon: { kind: 'url', src: '/icons/blueprint.webp' },
    scene: true,
    defaultPinned: true,
  },
]

export function isSceneView(viewId: string): boolean {
  return viewId === VIEW_3D || viewId === VIEW_2D
}

function isDevMode(): boolean {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV) {
    return process.env.NODE_ENV !== 'production'
  }
  return false
}

class EditorHostViewRegistryImpl {
  private readonly views = new Map<string, EditorHostView>()
  private readonly listeners = new Set<() => void>()
  private cached: EditorHostView[] = []

  subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange)
    return () => {
      this.listeners.delete(onChange)
    }
  }

  getSnapshot = (): EditorHostView[] => this.cached

  reset(): void {
    this.views.clear()
    this.emit()
  }

  registerView(view: EditorHostView): void {
    if (typeof view.id !== 'string' || view.id.length === 0) {
      throw new Error('[editor:host-views] view id must be a non-empty string')
    }
    if (isSceneView(view.id)) {
      throw new Error(`[editor:host-views] "${view.id}" is a built-in view`)
    }
    if (this.views.has(view.id)) {
      if (isDevMode()) {
        console.warn(`[editor:host-views] re-registering view "${view.id}" (HMR)`)
      } else {
        throw new Error(`[editor:host-views] duplicate view id: "${view.id}" already registered`)
      }
    }
    this.views.set(view.id, view)
    this.emit()
  }

  private emit(): void {
    this.cached = Array.from(this.views.values())
    for (const listener of this.listeners) listener()
  }
}

export const editorHostViewRegistry = new EditorHostViewRegistryImpl()

export function registerEditorHostView(view: EditorHostView): void {
  editorHostViewRegistry.registerView(view)
}

/**
 * Show a view: focus it if it is on screen, else put it in the focused pane —
 * or, with `beside`, split and open it next to what is there.
 */
export function openEditorView(viewId: string, options?: { beside?: boolean }): void {
  useEditor.getState().showView(viewId, options)
}

/**
 * The views a project can show in a workspace: the scene views, then every
 * registered view offered there whose plugin (if any) is installed.
 */
export function availableViews({
  registered,
  workspaceMode,
  installedPlugins,
}: {
  registered: readonly EditorViewDescriptor[]
  workspaceMode: string
  installedPlugins: readonly string[]
}): EditorViewDescriptor[] {
  return [
    ...SCENE_VIEWS,
    ...registered.filter(
      (view) =>
        (view.workspaces ?? ['edit']).includes(workspaceMode) &&
        (!view.pluginId || installedPlugins.includes(view.pluginId)),
    ),
  ]
}

export function isViewPinned(
  view: EditorViewDescriptor,
  pinnedViews: Readonly<Record<string, boolean>>,
): boolean {
  return pinnedViews[view.id] ?? view.defaultPinned ?? false
}
