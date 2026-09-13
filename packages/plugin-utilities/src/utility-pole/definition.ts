import {
  type AnyNodeId,
  type HandleDescriptor,
  type KeyboardActions,
  type NodeDefinition,
  useScene,
} from '@pascal-app/core'
import { siteParentFrame } from '../host-frame'
import { DEFAULT_POLE_HEIGHT, GUY_DIRECTIONS, UtilityPoleNode } from '../schema'
import { buildUtilityPoleFloorplan } from './floorplan'
import { utilityPoleFloorplanMove } from './floorplan-move'
import { POLE_CROSSARM_DROP, POLE_CROSSARM_LENGTH } from './geometry'

/**
 * R / T semantics, mirrored from the host's `steppedRotation`: round the
 * CURRENT angle to the nearest 45°, then step ONE increment, so any starting
 * yaw lands on a clean multiple. (The same mirror plugin-bones makes — the
 * helper is not exported from the pinned `@pascal-app/editor` index.)
 */
const ROTATION_QUANTUM = Math.PI / 4
const steppedYaw = (current: number, direction: 1 | -1): number =>
  (Math.round(current / ROTATION_QUANTUM) + direction) * ROTATION_QUANTUM

const rotatePole = (node: UtilityPoleNode, direction: 1 | -1): void => {
  useScene
    .getState()
    .updateNode(node.id as AnyNodeId, { yaw: steppedYaw((node.yaw ?? 0), direction) } as never)
}

/**
 * R / T turn the CROSSARM (`yaw`), not a `rotation` the renderer would
 * ignore. Without this seam the host falls back to writing `rotation[1]`
 * (`use-keyboard.ts` → the plain `'rotation' in node` branch), a field this
 * kind deliberately does not carry — the user would press R and nothing would
 * happen, which is exactly the failure plugin-bones hit with its heat pump.
 */
const isPole = (node: unknown): boolean =>
  (node as { type?: unknown } | null)?.type === 'utility-pole'

const poleKeyboardActions: KeyboardActions = {
  r: { appliesTo: isPole, run: (node) => rotatePole(node as never, 1) },
  t: { appliesTo: isPole, run: (node) => rotatePole(node as never, -1) },
}

/**
 * ⌘-drag rotate and the 2D floor-plan rotate both look for a definition
 * handle of kind 'arc-resize' + shape 'rotate' before falling back to a raw
 * `rotation[1]` write (`lib/direct-manipulation.ts`). Write `yaw`, with the
 * host's sign convention — a positive delta turns clockwise, i.e.
 * `base − delta`, matching direct-manipulation's own `rotation[1] − delta`.
 */
const poleRotateHandle: HandleDescriptor<UtilityPoleNode> = {
  kind: 'arc-resize',
  axis: 'angular',
  shape: 'rotate',
  apply: (initial, delta) => ({ yaw: initial.yaw - delta }) as never,
  placement: {
    position: (node) => [
      POLE_CROSSARM_LENGTH / 2 + 0.25,
      Math.max(0, node.height - POLE_CROSSARM_DROP),
      0,
    ],
  },
  decoration: {
    kind: 'ring',
    radius: () => POLE_CROSSARM_LENGTH / 2 + 0.15,
    y: (node) => Math.max(0, node.height - POLE_CROSSARM_DROP),
  },
}

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
    position: [0, 0, 0],
    yaw: 0,
    height: DEFAULT_POLE_HEIGHT,
    classLabel: '',
    hasTransformer: false,
    guy: 'none',
    label: '',
  }),
  capabilities: {
    // Movable with the host's standard affordance. `parentFrame` is what
    // converts the plan cursor to the SITE metres this kind stores; without
    // it the generic path would write plan coordinates into `position` and
    // the pole would jump by the building's own offset. `host-frame.ts`
    // explains the rest, including why `parentRotationY` is 0.
    movable: {
      axes: ['x', 'z'],
      gridSnap: true,
      parentFrame: siteParentFrame(),
    },
    rotatable: {
      axes: ['y'],
      snapAngles: Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4),
    },
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
  // 2D move: the plan frame is building-local and `position` is site metres,
  // so the generic free-translate fallback is wrong for this kind.
  floorplanMoveTarget: utilityPoleFloorplanMove as never,
  keyboardActions: poleKeyboardActions,
  handles: () => [poleRotateHandle],
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  toolHints: [
    { key: 'Left click', label: 'Place the pole' },
    { key: 'Alt', label: 'Ignore grid snap' },
    { key: 'R / T', label: 'Turn the crossarm' },
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
      'A utility pole. position is [x, y, z] in SITE metres — the butt, y = 0 at grade (a legacy [x, z] pair is widened on parse). yaw is the crossarm direction in radians about +Y; R / T step it by 45°, and an overhead run linked to this pole leaves the insulator pin on whichever end of the arm faces the run. height is metres above grade (default 10.668 m / 35 ft, a common ANSI O5.1 stock length rather than a code minimum); classLabel is free text (ANSI O5.1 classes); hasTransformer adds a pole-mounted transformer can; guy is none | north | east | south | west.',
  },
}
