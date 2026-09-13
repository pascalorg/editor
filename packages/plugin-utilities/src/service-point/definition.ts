import type { NodeDefinition } from '@pascal-app/core'
import { siteParentFrame } from '../host-frame'
import { SERVICE_POINT_KINDS, ServicePointNode } from '../schema'
import { buildServicePointFloorplan } from './floorplan'
import { servicePointFloorplanMove, servicePointMoveCommit } from './floorplan-move'

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
    /**
     * Movable with the host's standard affordance, wall-aware at both ends of
     * the gesture:
     *  - `parentFrame` converts the plan cursor into the SITE metres this
     *    kind stores, and makes the tool preview via `useLiveNodeOverrides`
     *    (`host-frame.ts`); the live `position` outranks the wall anchor, so
     *    the meter actually follows the cursor instead of sticking to its
     *    wall (`anchor.ts`);
     *  - `parentFrame.onCommit` turns the dropped position back into a
     *    `wallId` + `wallT` anchor — sliding along the same wall, or
     *    re-hosting onto a nearer one within 1.5 m — using the same pure
     *    `resolveServicePointDrop` the 2D path uses, so the two gestures
     *    cannot disagree.
     */
    movable: {
      axes: ['x', 'z'],
      gridSnap: true,
      cursorAttached: true,
      parentFrame: { ...siteParentFrame(), onCommit: servicePointMoveCommit },
    },
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
  // 2D move: slides along the host wall, re-hosts onto another wall within
  // 1.5 m, and drops free-standing beyond that (Alt forces free-standing).
  floorplanMoveTarget: servicePointFloorplanMove as never,
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  toolHints: [
    { key: 'Left click', label: 'Place the service point' },
    { key: 'Hover a wall', label: 'Snaps to the exterior wall face' },
    { key: 'Drag', label: 'Slides along the wall, or re-hosts onto a nearer one' },
    { key: 'Alt', label: 'Drop free-standing instead' },
    { key: 'Esc', label: 'Cancel' },
  ],
  presentation: {
    label: 'Service point',
    description: 'A meter, panel, cleanout or entry point where a utility run meets the building.',
    icon: { kind: 'iconify', name: 'lucide:gauge' },
    hidden: true,
    actionMenu: false,
  },
  mcp: {
    description:
      "A building/utility interface point drawn on the site plan and in 3D. serviceKind: electric-meter | panel | water-meter | sewer-cleanout | gas-meter | water-entry | sewer-exit | power-entry | telecom-nid. Wall-mounted via wallId + wallT (0..1 along the wall) + height; otherwise position is [x, y, z] in SITE metres. Independent of the Bones plugin's bones:service kind — the two are not linked.",
  },
}
