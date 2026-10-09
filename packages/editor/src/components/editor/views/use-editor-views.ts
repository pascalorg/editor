'use client'

import { useScene } from '@pascal-app/core'
import { useSyncExternalStore } from 'react'
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

export function useActiveViewLayout(): ViewLayout {
  return useEditor(activeViewLayout)
}
