import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import type { EditorHostPanel } from '@pascal-app/editor'
import { ARTICRAFT_ICON } from './brand'
import { articraftAssetDefinition } from './definition'

export const articraftPlugin: Plugin = {
  id: 'pascal:articraft',
  apiVersion: 1,
  nodes: [articraftAssetDefinition as unknown as AnyNodeDefinition],
}

export const articraftHostPanel: EditorHostPanel = {
  id: 'pascal:articraft:catalog',
  label: 'Articraft',
  icon: ARTICRAFT_ICON,
  component: () => import('./panel'),
  kinds: ['articraft:asset'],
  pluginId: articraftPlugin.id,
  description:
    'Browse Articraft-10K or generate a poseable articulated asset from a prompt or reference image.',
  creator: {
    name: 'Pascal',
    url: 'https://github.com/pascalorg',
  },
  pluginUrl: 'https://github.com/pascalorg/plugin-articraft',
  defaultInstalled: true,
}

export { ARTICRAFT_API_BASE, fetchCatalog } from './api'
export { articraftAssetDefinition } from './definition'
export { ArticraftAssetNode } from './schema'
export type {
  ArticraftArtifact,
  ArticraftAttribution,
  ArticraftCatalogItem,
  ArticraftCatalogResponse,
  ArticraftCategory,
  ArticraftGeneration,
  ArticraftGenerationConfiguration,
  ArticraftGenerationDraft,
  ArticraftGenerationModel,
  ArticraftGenerationQueueItem,
  ArticraftJoint,
  ArticraftPart,
  ArticraftProjectImage,
  ArticraftReferenceRender,
} from './types'
