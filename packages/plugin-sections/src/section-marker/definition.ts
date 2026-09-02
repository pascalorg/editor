import type { NodeDefinition } from '@pascal-app/core'
import { SectionMarkerNode } from '../schema'
import { buildSectionMarkerFloorplan } from './floorplan'
import { moveSectionMarkerEndpointAffordance } from './floorplan-affordances'

/**
 * `section-marker` — a vertical cut plane through the building, drawn in the
 * 2D plan as the standard broken cut line with bubbles and look-direction
 * arrows. `buildSectionDrawing` turns it into a true vector section.
 */
export const sectionMarkerDefinition: NodeDefinition<typeof SectionMarkerNode> = {
  kind: 'section-marker',
  schemaVersion: 1,
  schema: SectionMarkerNode,
  category: 'analysis',
  bake: 'strip',
  dirtyTracking: false,
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
      preferredView: '2d',
    },
  },
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    label: 'A',
    levelId: null,
    start: [0, 0],
    end: [1, 0],
    lookDirection: 'left',
    depth: 12,
    sheetRef: null,
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    deletable: true,
    duplicable: true,
  },
  parametrics: {
    groups: [
      {
        label: 'Section',
        fields: [
          { key: 'lookDirection', kind: 'enum', options: ['left', 'right'], display: 'segmented' },
          {
            key: 'depth',
            label: 'View depth',
            kind: 'number',
            unit: 'm',
            min: 0.5,
            max: 100,
            step: 0.5,
          },
        ],
      },
    ],
  },
  floorplan: buildSectionMarkerFloorplan,
  floorplanAffordances: {
    'move-section-marker-endpoint': moveSectionMarkerEndpointAffordance,
  },
  toolHints: [
    { key: 'Left click', label: 'Place the cut line start' },
    { key: 'Left click', label: 'Place the cut line end' },
    { key: 'Shift', label: 'Flip which side the section looks toward' },
    { key: 'Alt', label: 'Ignore grid snap' },
    { key: 'Esc', label: 'Step back or cancel' },
  ],
  presentation: {
    label: 'Section marker',
    description:
      'A vertical cut plane through the building. Drives a true vector building section drawn from the scene geometry.',
    icon: { kind: 'iconify', name: 'lucide:scissors-line-dashed' },
    hidden: true,
    actionMenu: false,
  },
  mcp: {
    description:
      'A building section marker. start/end are the cut line in building plan coords [x, z] metres; lookDirection ("left" | "right") picks which side of start->end the section views; depth is how far past the cut plane background geometry is projected; label is the bubble letter; sheetRef optionally names the sheet the section lands on.',
  },
}
