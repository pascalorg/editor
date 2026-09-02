import type { MovableConfig, NodeDefinition, ParametricDescriptor } from '@pascal-app/core'
import { deviceParentFrame } from './frame'
import { DEVICE_KINDS, DeviceNode } from './schema'

type DeviceDefinition = NodeDefinition<typeof DeviceNode> & Record<string, unknown>

const deviceParametrics: ParametricDescriptor<DeviceNode> = {
  groups: [
    {
      label: 'Device',
      fields: [
        { key: 'deviceKind', kind: 'enum', options: [...DEVICE_KINDS] },
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
 * The `bones:device` definition — movable receptacles/switches (Q7). Never
 * palette-placed: the X-ray's reconciler mirrors every derived wall device
 * into one of these nodes (device/place.ts), so any outlet is hoverable and
 * draggable with the host's standard tools. Wall drags ride
 * `movable.parentFrame` (frame.ts) door-style and commit `wallId`+`wallT`
 * (position resets to [0,0,0]); height edits ride the inspector's heightAff
 * slider — the host move tool is planar. Any anchor differing from the seed
 * makes the node an engine override: the box snaps code-legal (RO-clear,
 * against a stud face or booked blocking, height clamped) and the wiring
 * re-routes. Deleting the node returns the device to auto-placement (the
 * reconciler re-creates it at the derived spot).
 */
export const deviceDefinition: DeviceDefinition = {
  kind: 'bones:device',
  schemaVersion: 1,
  schema: DeviceNode,
  category: 'furnish',
  snapProfile: 'item',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    deviceId: '',
    deviceKind: 'receptacle',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  }),

  capabilities: {
    // `cursorAttached` + `parentFrame` are newer host contract fields than
    // the pinned @pascal-app/core types — mirrored in frame.ts and cast here
    // (the host reads them structurally at runtime), exactly like
    // service/definition.ts.
    movable: {
      axes: ['x', 'z'],
      gridSnap: true,
      cursorAttached: true,
      parentFrame: deviceParentFrame,
    } as unknown as MovableConfig,
    selectable: { hitVolume: 'bbox' },
    deletable: true,
    duplicable: false,
  },

  parametrics: deviceParametrics,

  renderer: { kind: 'parametric', module: () => import('./renderer') },

  // Window-parity move (wall-mount move tool): the host's MoveTool dispatcher
  // mounts this INSTEAD of the generic planar mover whenever the Move cross /
  // press-drag arms a device — the box slides along the wall surface with the
  // #689 hidden-wall hold + #694 own-wall gate, previews through
  // useLiveNodeOverrides (the framing live recompute routes it through
  // applyDeviceOverrides — stud snap + height bands stay the truth), and
  // commits ONE tracked anchor write (wallId + wallT + heightAff).
  // `capabilities.movable` above stays: it keeps the context-toolbar Move
  // cross + Ctrl-drag gates (isRegistryMovable / hasRegistry3DMoveTool) and
  // the 2D fallback exactly as before. `affordanceTools` is a newer host
  // contract field than the pinned @pascal-app/core types — it rides the
  // definition's Record<string, unknown> like the parentFrame cast.
  affordanceTools: { move: () => import('../wall-mount/move-tool') },

  presentation: {
    label: 'Electrical device',
    description:
      'A Bones movable electrical device (receptacle/switch) — drag it along its wall and the wiring re-routes; placement snaps to code-legal spots.',
    icon: { kind: 'iconify', name: 'lucide:plug' },
    paletteSection: 'furnish',
    hidden: true,
  },

  mcp: {
    description:
      'Bones movable electrical device node (receptacle | receptacle-gfci | receptacle-wr-gfci | switch), reconciled 1:1 against the derived electrical layout by deviceId. wallId + wallT (0..1 along the wall) + heightAff anchor the box; editor drags slide it along the wall and commit wallT (position resets to [0,0,0]); a position written off the default outranks the wall anchor. Moving it away from its seed* fields makes it an engine override: the box snaps out of rough openings, mounts beside a stud (or books a blocking member), heights clamp to the legal band (receptacle 0.15-1.7 m, switch 0.9-2.0 m per NEC 404.8(A)), and the wiring re-routes. Delete the node to restore auto-placement.',
  },
}
