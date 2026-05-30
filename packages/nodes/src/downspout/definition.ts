import {
  DownspoutNode as DownspoutNodeSchema,
  type DownspoutNode as DownspoutNodeType,
  type HandleDescriptor,
  type NodeDefinition,
} from '@pascal-app/core'
import { downspoutParametrics } from './parametrics'
import { DownspoutNode } from './schema'

// Mirrors the parametric `min`s so handle drags can't shrink the pipe
// past what the inspector would accept.
const MIN_LENGTH = 0.1
const MIN_DIAMETER = 0.02
// Diameter chevron Y — fixed 20 cm below the outlet (so it sits in
// the same camera frame as the gutter the user is editing) rather
// than tracking the pipe length and floating off-screen.
const DIAMETER_HANDLE_Y = -0.2
// Cleared past the worst-case k-style gutter rim (~ 1.5 × gutter size,
// ≤ 0.2 m at the inspector max). Beyond this the chevron is guaranteed
// to sit outside the gutter footprint and read cleanly from the side.
const DIAMETER_HANDLE_CLEARANCE = 0.25

/**
 * Length tracker — dashed vertical leader from the outlet (Y = 0,
 * the gutter floor) down to a small cube at the bottom of the pipe,
 * `anchor: 'max'` + `axis: 'y'` so dragging the cube down extends
 * the pipe 1:1.
 *
 * Tracker shape (instead of a plain chevron) because the downspout's
 * default 2.5 m drop pushes the bottom well below the eave — often
 * past the ground plane. The dashed leader keeps the dimension
 * readable even when the cube is off-screen, and matches the
 * existing tracker handles on the wall / chimney height fields.
 */
function downspoutLengthHandle(): HandleDescriptor<DownspoutNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'max',
    shape: 'tracker',
    min: MIN_LENGTH,
    currentValue: (n) => n.length,
    apply: (_n, newValue) => ({ length: Math.max(MIN_LENGTH, newValue) }),
    placement: {
      // Cube sits at the bottom of the pipe (the dimension terminus).
      position: (n) => [0, -Math.max(n.length, MIN_LENGTH), 0],
    },
    // Leader starts at Y = 0 (outlet / gutter floor) and runs DOWN to
    // the cube — same logic the existing tracker handles use for
    // "the dimension's other end is up here, against the host."
    trackerBaseY: () => 0,
  }
}

/**
 * Diameter chevron — symmetric radial growth, dragged outward (away
 * from the building) along the gutter-local +Z axis. `anchor:
 * 'center'` grows the value by 2× the cursor delta so the visible
 * +Z edge tracks the pointer.
 *
 * Sits at a FIXED Y near the top of the pipe (DIAMETER_HANDLE_Y) so
 * it stays in the gutter's camera frame regardless of pipe length,
 * and at a Z far enough outward that the gutter's rim — which
 * extends up to ~ 1.5 × `size` past the outlet axis on k-style
 * profiles — doesn't occlude the chevron.
 */
function downspoutDiameterHandle(): HandleDescriptor<DownspoutNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'z',
    anchor: 'center',
    min: MIN_DIAMETER,
    currentValue: (n) => n.diameter,
    apply: (_n, newValue) => ({ diameter: Math.max(MIN_DIAMETER, newValue) }),
    placement: {
      position: (n) => [
        0,
        DIAMETER_HANDLE_Y,
        Math.max(n.diameter, MIN_DIAMETER) / 2 + DIAMETER_HANDLE_CLEARANCE,
      ],
    },
  }
}

const downspoutHandles: HandleDescriptor<DownspoutNodeType>[] = [
  downspoutLengthHandle(),
  downspoutDiameterHandle(),
]

/**
 * Downspout — vertical drop pipe taking water from a gutter outlet to
 * the ground. Scene-graph parent is the same roof-segment the host
 * gutter sits on (so it renders under `roof-elements` like every
 * other accessory); the logical link to the gutter is via the
 * `gutterId` field, which the renderer uses to look up the outlet
 * position.
 *
 * No `handles` yet — the downspout's geometry is anchored to the
 * gutter's outlet, so length / diameter live in the inspector rather
 * than as draggable arrows for v1. Future passes can add a length
 * tracker handle similar to the gutter's size chevron.
 */
export const downspoutDefinition: NodeDefinition<typeof DownspoutNode> = {
  kind: 'downspout',
  schemaVersion: 1,
  schema: DownspoutNode,
  category: 'structure',
  surfaceRole: 'roof',

  defaults: () => {
    const stub = DownspoutNodeSchema.parse({
      id: 'downspout_default' as never,
      type: 'downspout',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Logically a roof accessory — registers under the segment, has
    // no buildCut, just the standard dirty cascade.
    roofAccessory: {},
  },

  parametrics: downspoutParametrics,
  handles: downspoutHandles,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  preview: () => import('./preview'),
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Hover gutter', label: 'Highlight outlet' },
    { key: 'Left click', label: 'Drop downspout from outlet' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Downspout',
    description: 'Vertical drop pipe from a gutter outlet to the ground.',
    icon: { kind: 'url', src: '/icons/roof.png' },
    paletteSection: 'structure',
    paletteOrder: 123,
  },

  mcp: {
    description:
      'A downspout — vertical drop pipe attached to a gutter outlet. length / diameter parametric; future passes will add elbows and a kickout.',
  },
}

