import type { TerrainBreakNode } from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import type { NodeEditContribution } from '../definition-contributions'

export const terrainBreakEditContribution: NodeEditContribution<typeof TerrainBreakNode> = {
  tool: () => import('./tool'),
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
    } satisfies FloorplanNodeExtension<TerrainBreakNode>,
  },
  parametrics: { groups: [], customPanel: () => import('./panel') },
  toolHints: [
    { key: 'Left click', label: 'Start terrain boundary' },
    { key: 'Left click', label: 'Finish boundary across the lot' },
    { key: 'Esc', label: 'Cancel' },
  ],
}
