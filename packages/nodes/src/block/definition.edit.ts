import type { BlockNode as BlockNodeType } from '@pascal-app/core'

import type { FloorplanNodeExtension } from '@pascal-app/editor'
import type { NodeEditContribution } from '../definition-contributions'
import { blockContextualHelp } from './contextual-help'
import { buildBlockFloorplan } from './floorplan'
import { blockPaint } from './paint'
import { blockParametrics } from './parametrics'
import type { BlockNode } from './schema'

export const blockEditContribution: NodeEditContribution<typeof BlockNode> = {
  snapProfile: 'structural',
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./tool'),
      preferredView: '3d',
    } satisfies FloorplanNodeExtension<BlockNodeType>,
    'pascal:editor/contextual-help': blockContextualHelp,
  },
  capabilities: {
    paint: blockPaint,
  },
  floorplan: buildBlockFloorplan,
  parametrics: blockParametrics,
  affordanceTools: {
    selection: () => import('./selection'),
  },
  preview: () => import('./preview'),
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place block' },
    { key: 'Esc', label: 'Cancel' },
  ],
}
