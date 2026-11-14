import type { FloorplanNodeExtension } from '@pascal-app/editor'
import type { NodeEditContribution } from '../definition-contributions'
import type { StructuralGridNode } from './schema'

export const structuralGridEditContribution: NodeEditContribution<typeof StructuralGridNode> = {
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
      availableModes: ['expert'],
      preferredView: '2d',
    } satisfies FloorplanNodeExtension<StructuralGridNode>,
  },
  snapProfile: 'structural',
  toolHints: [
    { key: 'Left click', label: 'Start grid axis' },
    { key: 'Left click', label: 'Finish grid axis' },
    { key: 'Alt', label: 'Bypass snapping' },
    { key: 'Esc', label: 'Cancel' },
  ],
}
