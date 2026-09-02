import {
  type AnyNodeId,
  type HandleDescriptor,
  type KeyboardActions,
  type MovableConfig,
  type NodeDefinition,
  type ParametricDescriptor,
  type SceneApi,
  useScene,
} from '@pascal-app/core'
import { CONDENSER_PAD_THICKNESS, CONDENSER_UNIT_DIMS } from '../engines/hvac'
import { serviceParentFrame } from './frame'
import { resolveHeatPumpAssemblyYaw } from './proxy'
import { SERVICE_TYPES, ServiceNode } from './schema'

type ServiceDefinition = NodeDefinition<typeof ServiceNode> & Record<string, unknown>

/**
 * HEAT-PUMP ROTATE PARITY (HP polish item 4 — Julien: "it looks like I
 * can't rotate it like a normal object or with R"). HOST INVESTIGATION
 * (read-only): the standard gestures reach a selected node two ways —
 *  - R / T (use-keyboard.ts): multi-select group rotate → references →
 *    door/window flips → `nodeRegistry.get(type)?.keyboardActions?.r/t`
 *    (definition seam) → the plain `'rotation' in node` fallback that
 *    writes rotation[1] directly;
 *  - ⌘-drag rotate + the 2D floorplan rotate (selection-manager.tsx /
 *    floorplan-registry-layer.tsx → lib/direct-manipulation.ts): a
 *    definition `handles` entry with kind 'arc-resize' + shape 'rotate'
 *    wins (`getDirectRotateHandle(...).apply`), else the same raw
 *    rotation[1] write.
 * The engine composes the heat-pump assembly from the SERVICE node, so a
 * raw rotation[1] write changed nothing visible — R "did nothing". Both
 * definition seams below intercept the gestures for heat-pump nodes ONLY
 * and write the additive `yawOverride` field the hvac engine consumes
 * (absent/null ⇒ wall-square auto). Other service types keep the host
 * default (an inert rotation write — pre-existing behavior).
 */
const isHeatPumpNode = (node: unknown): boolean =>
  (node as { serviceType?: unknown } | null)?.serviceType === 'heat-pump'

/** Host R/T semantics, mirrored from private-editor placement-math.ts
 * `steppedRotation` (not exported by the pinned @pascal-app/editor index —
 * mirrored like parentFrame): round the CURRENT angle to the nearest 45°,
 * then step ONE increment, so any starting yaw lands on a clean multiple. */
const ROTATION_QUANTUM = Math.PI / 4
const steppedYaw = (current: number, direction: 1 | -1): number =>
  (Math.round(current / ROTATION_QUANTUM) + direction) * ROTATION_QUANTUM

/** The rotate keystroke: step `yawOverride` from the assembly's CURRENT
 * yaw (override, else the engine's derived wall-square — stepping from 0
 * would jump the unit to an absolute 45° on the first press). */
const rotateHeatPump = (node: ServiceNode, direction: 1 | -1): void => {
  const nodes = useScene.getState().nodes as unknown as Record<string, Record<string, unknown>>
  const yaw = resolveHeatPumpAssemblyYaw(nodes, node as never)
  useScene
    .getState()
    .updateNode(node.id as AnyNodeId, { yawOverride: steppedYaw(yaw, direction) } as never)
}

const serviceKeyboardActions: KeyboardActions = {
  r: { appliesTo: isHeatPumpNode, run: (node) => rotateHeatPump(node as never, 1) },
  t: { appliesTo: isHeatPumpNode, run: (node) => rotateHeatPump(node as never, -1) },
}

/** ⌘-drag / floorplan rotate arc (and the on-canvas rotate gizmo the host
 * arrow renderer mounts from this descriptor): the host measures the
 * angular delta and calls `apply` — write the same `yawOverride`, with the
 * host sign convention (a positive delta turns clockwise: `base − delta`,
 * matching direct-manipulation's `rotation[1] − delta`). */
const heatPumpRotateHandle: HandleDescriptor<ServiceNode> = {
  kind: 'arc-resize',
  axis: 'angular',
  shape: 'rotate',
  apply: (initial, delta, sceneApi: SceneApi) => {
    const nodes = sceneApi.nodes() as unknown as Record<string, Record<string, unknown>>
    return { yawOverride: resolveHeatPumpAssemblyYaw(nodes, initial as never) - delta } as never
  },
  placement: {
    // Above the cabinet's +X/+Z shoulder — clear of the sign plate and the
    // pick proxy, reading as attached to the unit (column-gizmo convention).
    position: () => [
      CONDENSER_UNIT_DIMS[0] / 2,
      CONDENSER_PAD_THICKNESS + CONDENSER_UNIT_DIMS[1] + 0.12,
      CONDENSER_UNIT_DIMS[2] / 2,
    ],
    rotationY: () => -Math.PI / 4,
  },
  decoration: {
    kind: 'ring',
    radius: () => Math.hypot(CONDENSER_UNIT_DIMS[0] / 2, CONDENSER_UNIT_DIMS[2] / 2) + 0.06,
    y: () => CONDENSER_PAD_THICKNESS + CONDENSER_UNIT_DIMS[1] / 2,
  },
}

const serviceHandles = (node: ServiceNode): HandleDescriptor<ServiceNode>[] =>
  isHeatPumpNode(node) ? [heatPumpRotateHandle] : []

const serviceParametrics: ParametricDescriptor<ServiceNode> = {
  groups: [
    {
      label: 'Service point',
      fields: [
        { key: 'serviceType', kind: 'enum', options: [...SERVICE_TYPES] },
        { key: 'heightAff', kind: 'number', unit: 'm', min: 0, max: 3, step: 0.05 },
        { key: 'wallT', kind: 'number', min: 0, max: 1, step: 0.01 },
      ],
    },
    {
      label: 'Position',
      fields: [{ key: 'position', kind: 'vec3' }],
    },
  ],
}

/**
 * The `bones:service` definition — service points the Bones panel creates
 * (never palette-placed). Selectable and movable with the host's standard
 * tools. Wall-mounted types drag DOOR-STYLE via `movable.parentFrame`
 * (frame.ts): the cursor projects onto the wall axis, the box slides along
 * the wall live, and the commit writes `wallId`+`wallT` while resetting
 * `position` to [0,0,0] — the wall anchor stays authoritative after every
 * drag (the old "wallT slider inert after a gizmo drag" quirk is gone).
 * Floor types keep plain plan moves (drag writes `position`). A manually
 * written non-default `position` (inspector vec3 / MCP) still OUTRANKS the
 * wall anchor — wall types snap to the nearest wall — as the escape hatch.
 * Engines re-route to the node on every change.
 */
export const serviceDefinition: ServiceDefinition = {
  kind: 'bones:service',
  schemaVersion: 1,
  schema: ServiceNode,
  category: 'furnish',
  snapProfile: 'item',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    serviceType: 'panel',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  }),

  capabilities: {
    // `cursorAttached` + `parentFrame` are newer host contract fields than
    // the pinned @pascal-app/core 0.9.1 types — mirrored in frame.ts and
    // cast here (the host reads them structurally at runtime).
    // cursorAttached: service boxes are small connector-like nodes; pinning
    // to the cursor also makes the drag origin independent of the stored
    // position (which is the [0,0,0] sentinel while wall-anchored).
    movable: {
      axes: ['x', 'z'],
      gridSnap: true,
      cursorAttached: true,
      parentFrame: serviceParentFrame,
    } as unknown as MovableConfig,
    rotatable: {
      axes: ['y'],
      snapAngles: Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4),
    },
    selectable: { hitVolume: 'bbox' },
    deletable: true,
    duplicable: false,
  },

  parametrics: serviceParametrics,

  // Heat-pump rotate parity (see the module note above): the R/T registry
  // seam + the arc-rotate handle both write `yawOverride`; every other
  // service type returns appliesTo=false / no handles and keeps the host
  // default path untouched.
  keyboardActions: serviceKeyboardActions,
  handles: serviceHandles,

  renderer: { kind: 'parametric', module: () => import('./renderer') },

  // Window-parity move (wall-mount move tool, shared with bones:device):
  // wall-mounted types slide along the wall surface (#689 hidden-wall hold,
  // #694 own-wall gate, live overrides → engines re-route live) and commit
  // ONE tracked anchor write; floor types (heat pump pad, sewer exit) get
  // the equivalent grid-snapped planar ground drag from the same component.
  // `capabilities.movable` stays for the Move-cross / Ctrl-drag gates and
  // the 2D fallback; `affordanceTools` rides Record<string, unknown> (newer
  // host contract than the pinned core types, like parentFrame).
  affordanceTools: { move: () => import('../wall-mount/move-tool') },

  presentation: {
    label: 'Service point',
    description:
      'A Bones utility interface point (panel, water heater, water/sewer/power entry) — move it and the systems re-route to it.',
    icon: { kind: 'iconify', name: 'lucide:plug-zap' },
    paletteSection: 'furnish',
    hidden: true,
  },

  mcp: {
    description:
      'Bones service point node. serviceType: panel | water-heater | water-entry | sewer-exit | power-entry | thermostat | heat-pump | electric-meter. Wall-mounted via wallId + wallT (0..1 along the wall) + heightAff, or floor-placed via position; editor drags slide wall types along their wall and commit wallT (position resets to [0,0,0]); a position written off the default [0,0,0] outranks the wall anchor. heat-pump only: yawOverride (radians, world Y) turns the whole outdoor assembly (cabinet + pad); null/absent = the engine’s wall-square auto orientation. The engines treat an existing node as the authoritative location and re-route wiring/piping to it; deleting it restores auto-placement.',
  },
}
