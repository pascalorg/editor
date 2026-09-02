import type { NodeDefinition } from '@pascal-app/core'
import { SERVICE_POINT_KINDS, ServicePointNode } from '../schema'
import { buildServicePointFloorplan } from './floorplan'

/**
 * `service-point` — the interface between a utility run and the building.
 *
 * Distinct from `bones:service` (node_modules/@pascal-app/plugin-bones):
 * that kind is an ENGINE INPUT — the bones framing/plumbing/electrical
 * engines re-route to it, and it only exists while the Bones plugin is
 * installed. This one is a DRAWING node: it appears on the site plan and in
 * 3D whether or not Bones is present, and carries the meter / cleanout / NID
 * kinds a site plan needs that Bones does not model. Where both exist for
 * the same thing (electric meter, water entry, sewer exit, power entry, panel)
 * they are NOT linked — a scene with both will draw two. That duplication is
 * real and unresolved; reconciling them means one kind referencing the other,
 * which crosses a package this workstream does not own.
 */
export const servicePointDefinition: NodeDefinition<typeof ServicePointNode> = {
  kind: 'service-point',
  schemaVersion: 1,
  schema: ServicePointNode,
  category: 'site',
  distributionRole: 'terminal',
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
    serviceKind: 'electric-meter',
    position: [0, 0, 0],
    wallId: null,
    wallT: null,
    height: 1.5,
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
        label: 'Service point',
        fields: [
          { key: 'serviceKind', kind: 'enum', options: [...SERVICE_POINT_KINDS] },
          { key: 'height', label: 'Height', kind: 'number', unit: 'm', min: 0, max: 3, step: 0.05 },
          { key: 'wallT', label: 'Along wall', kind: 'number', min: 0, max: 1, step: 0.01 },
          // `label` is free text; the host has no 'text' parametric field kind.
        ],
      },
    ],
  },
  floorplan: buildServicePointFloorplan,
  floorplanScope: 'building',
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  toolHints: [
    { key: 'Left click', label: 'Place the service point' },
    { key: 'Hover a wall', label: 'Snaps to the exterior wall face' },
    { key: 'Esc', label: 'Cancel' },
  ],
  presentation: {
    label: 'Service point',
    description:
      'A meter, panel, cleanout or entry point where a utility run meets the building.',
    icon: { kind: 'iconify', name: 'lucide:gauge' },
    hidden: true,
    actionMenu: false,
  },
  mcp: {
    description:
      'A building/utility interface point drawn on the site plan and in 3D. serviceKind: electric-meter | panel | water-meter | sewer-cleanout | gas-meter | water-entry | sewer-exit | power-entry | telecom-nid. Wall-mounted via wallId + wallT (0..1 along the wall) + height; otherwise position is [x, y, z] in SITE metres. Independent of the Bones plugin\'s bones:service kind — the two are not linked.',
  },
}
