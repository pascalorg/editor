'use client'

import { useScene } from '@pascal-app/core'
import { useSyncExternalStore } from 'react'
import { create } from 'zustand'
import {
  availableViews,
  type EditorViewDescriptor,
  editorHostViewRegistry,
} from '../../../lib/editor-views'
import {
  editorHostPanelRegistry,
  managedPluginIds,
  showsPluginManager,
} from '../../../lib/plugin-panels'
import useEditor from '../../../store/use-editor'
import { activeViewLayout, type ViewLayout } from '../../../store/view-layout'

export const PLUGINS_VIEW_ID = 'plugins'

const pluginsView: EditorViewDescriptor = {
  id: PLUGINS_VIEW_ID,
  label: 'Plugins',
  icon: { kind: 'url', src: '/icons/plugins.webp' },
  component: () => import('./plugins-view').then((module) => ({ default: module.PluginsView })),
  workspaces: ['edit'],
}

/** Every view this project can show in the current workspace, the plugin directory included when it has a place. */
export function useEditorViews(): EditorViewDescriptor[] {
  const registered = useSyncExternalStore(
    editorHostViewRegistry.subscribe,
    editorHostViewRegistry.getSnapshot,
    editorHostViewRegistry.getSnapshot,
  )
  const panels = useSyncExternalStore(
    editorHostPanelRegistry.subscribe,
    editorHostPanelRegistry.getSnapshot,
    editorHostPanelRegistry.getSnapshot,
  )
  const workspaceMode = useEditor((s) => s.workspaceMode)
  const installedPlugins = useScene((s) => s.installedPlugins)
  const readOnly = useScene((s) => s.readOnly)
  const withManager = showsPluginManager({
    managedPluginCount: managedPluginIds(panels).length,
    readOnly,
    workspaceMode,
  })
  return availableViews({
    registered: withManager ? [...registered, pluginsView] : registered,
    workspaceMode,
    installedPlugins,
  })
}

/**
 * How long after a project loads its plugins have to register their views. A plugin registers
 * its views as it loads, some only once the project says it is installed, so a view missing in
 * that window is most likely still on its way.
 */
export const VIEW_SETTLE_MS = 600

/** The hydration whose plugins have had `VIEW_SETTLE_MS` to register their views. */
export const useViewSettle = create<{ settled: object | null }>(() => ({ settled: null }))

let settleTimer: ReturnType<typeof setTimeout> | undefined
useScene.subscribe((state, previous) => {
  if (state.hydrationId === previous.hydrationId) return
  clearTimeout(settleTimer)
  const hydration = state.hydrationId
  if (hydration)
    settleTimer = setTimeout(() => useViewSettle.setState({ settled: hydration }), VIEW_SETTLE_MS)
})

/**
 * Whether the views a layout names can be judged: the project has loaded and its plugins have had
 * `VIEW_SETTLE_MS` to register theirs. Until then a view the layout names but no plugin offers yet
 * is loading, not unavailable.
 */
export function useViewsSettled(): boolean {
  const hydration = useScene((s) => s.hydrationId)
  const settled = useViewSettle((s) => s.settled)
  return hydration !== null && settled === hydration
}

export function useActiveViewLayout(): ViewLayout {
  return useEditor(activeViewLayout)
}
