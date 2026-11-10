import type { NodeRenderDefinition } from '../definition-contributions'
import { StructuralGridNode } from './schema'

export const structuralGridRenderDefinition: NodeRenderDefinition<typeof StructuralGridNode> & {
  kind: 'structural-grid'
} = {
  kind: 'structural-grid',
  bake: 'strip',
  schemaVersion: 1,
  schema: StructuralGridNode,
  category: 'structure',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    start: [0, 0],
    end: [0, 5],
    label: '1',
    showStartBubble: true,
    showEndBubble: true,
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    deletable: true,
    presettable: false,
  },
  dirtyTracking: false,
  presentation: {
    label: 'Structural Grid',
    description: 'Persistent construction grid axis with identification bubbles.',
    icon: { kind: 'url', src: '/icons/structural-grid.webp' },
    paletteSection: 'structure',
    paletteOrder: 72,
  },
  mcp: {
    description:
      'A floor-plan structural datum axis defined by two level-local points and a grid identifier.',
  },
}
