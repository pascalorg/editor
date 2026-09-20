import type { Plugin } from '@pascal-app/core'
import type { EditorHostPanel } from '@pascal-app/editor'
import { CONSTRUCTION_PANEL_ID, CONSTRUCTION_PLUGIN_ID } from './catalog'

export const constructionPlugin = {
  id: CONSTRUCTION_PLUGIN_ID,
  apiVersion: 1,
  nodes: [],
} satisfies Plugin

export const constructionHostPanel = {
  id: CONSTRUCTION_PANEL_ID,
  pluginId: CONSTRUCTION_PLUGIN_ID,
  label: 'Construction',
  description:
    'Understand a house model, explore its building elements and plan the right handoff. Early preview: model inventory is available; generation outputs are coming later.',
  creator: { name: 'Pascal', url: 'https://pascal.app' },
  pluginUrl: '/construction',
  icon: { kind: 'iconify', name: 'lucide:house' },
  defaultInstalled: false,
  component: () => import('./panel'),
  overview: () => import('./guide'),
} satisfies EditorHostPanel
