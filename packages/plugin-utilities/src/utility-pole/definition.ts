import type { NodeDefinition } from '@pascal-app/core'
import { DEFAULT_POLE_HEIGHT, GUY_DIRECTIONS, UtilityPoleNode } from '../schema'
import { buildUtilityPoleFloorplan } from './floorplan'

/**
 * `utility-pole` — a distribution pole on the lot or in the right of way.
 * Building-scoped for the same reasons as `utility-line`; see that
 * definition's note.
 */
export const utilityPoleDefinition: NodeDefinition<typeof UtilityPoleNode> = {
  kind: 'utility-pole',
  schemaVersion: 1,
  schema: UtilityPoleNode,
  category: 'site',
  distributionRole: 'equipment',
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
    position: [0, 0],
    height: DEFAULT_POLE_HEIGHT,
    classLabel: '',
    hasTransformer: false,
    guy: 'none',
    label: '',
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    deletable: true,
    duplicable: true,
  },
  parametrics: {
    groups: [
      {
        label: 'Pole',
        fields: [
          { key: 'height', label: 'Height', kind: 'number', unit: 'm', min: 3, max: 30, step: 0.1 },
          { key: 'hasTransformer', label: 'Transformer', kind: 'boolean' },
          { key: 'guy', label: 'Guy', kind: 'enum', options: [...GUY_DIRECTIONS] },
          // `classLabel` / `label` are free text; the host has no 'text'
          // parametric field kind, so they are edited elsewhere.
        ],
      },
    ],
  },
  floorplan: buildUtilityPoleFloorplan,
  floorplanScope: 'building',
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  toolHints: [
    { key: 'Left click', label: 'Place the pole' },
    { key: 'Alt', label: 'Ignore grid snap' },
    { key: 'Esc', label: 'Cancel' },
  ],
  presentation: {
    label: 'Utility pole',
    description: 'A distribution pole with a crossarm, optional transformer and optional down-guy.',
    icon: { kind: 'iconify', name: 'lucide:utility-pole' },
    hidden: true,
    actionMenu: false,
  },
  mcp: {
    description:
      'A utility pole. position is [x, z] in SITE metres with the butt at grade; height is metres above grade (default 10.668 m / 35 ft, a common ANSI O5.1 stock length rather than a code minimum); classLabel is free text (ANSI O5.1 classes); hasTransformer adds a pole-mounted transformer can; guy is none | north | east | south | west.',
  },
}
