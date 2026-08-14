import {
  BoxVentNode as BoxVentNodeSchema,
  type BoxVentNode as BoxVentNodeType,
  type HandleDescriptor,
  type NodeDefinition,
} from '@pascal-app/core'
import { surfacePaintCapability } from '../shared/surface-paint'
import { buildBoxVentFloorplan } from './floorplan'
import { boxVentParametrics } from './parametrics'
import { BoxVentNode } from './schema'

// Edge-to-arrow-center offset, matching the chimney / dormer cadence.
const SIDE_HANDLE_OFFSET = 0.25
const HEIGHT_HANDLE_OFFSET = 0.2
// Snug to the vent corner — vents are small (default 0.4 m), so the big
// chimney/dormer offset floated the rotate icon far off the item.
const ROTATE_CORNER_OFFSET = 0.1
// Min sizes — vents are small (default 0.4 × 0.4 × 0.15), so the floor
// is well below the default values to allow shrinking without locking.
const MIN_DIM = 0.1
const MIN_HEIGHT = 0.05

// Mid-Y of the vent body in vent-mesh-local. The vent sits with its base
// at y=0 on the slope, so mid is half the height. Side / depth / rotate
// chevrons all place their handle at this Y to read as "this dimension
// is the vent body".
function getBodyMidY(n: BoxVentNodeType): number {
  return Math.max(0.001, n.height) / 2
}

// Width arrow on the +X (right) or -X (left) side of the vent body.
// Asymmetric resize — anchored edge stays world-fixed by recentering
// `position` along the vent's own +X arm in segment frame (matches the
// chimney / dormer width handle math). The slope tilt rotates around
// the vent's base point, so segment-local XZ of the anchored edge stays
// the same regardless of tilt; only the yaw matters for the projection.
function boxVentWidthHandle(side: 'left' | 'right'): HandleDescriptor<BoxVentNodeType> {
  const sign = side === 'right' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: side === 'right' ? 'min' : 'max',
    min: MIN_DIM,
    currentValue: (n) => n.width,
    apply: (initial, newWidth) => {
      const rotY = initial.rotation ?? 0
      const armX = Math.cos(rotY)
      const armZ = -Math.sin(rotY)
      const anchorX = initial.position[0] - sign * (initial.width / 2) * armX
      const anchorZ = initial.position[2] - sign * (initial.width / 2) * armZ
      const newCenterX = anchorX + sign * (newWidth / 2) * armX
      const newCenterZ = anchorZ + sign * (newWidth / 2) * armZ
      return {
        width: newWidth,
        position: [newCenterX, initial.position[1], newCenterZ],
      }
    },
    placement: {
      position: (n) => [sign * (n.width / 2 + SIDE_HANDLE_OFFSET), getBodyMidY(n), 0],
      // Flip the left chevron so it points outward toward -X. The
      // generic LinearArrow auto-orients for axis 'z'; +X / -X facing
      // is up to the descriptor.
      rotationY: () => (side === 'right' ? 0 : Math.PI),
    },
  }
}

// Depth arrow on the +Z side. Symmetric (anchor 'center') matches the
// chimney / dormer handle count budget — splitting into asymmetric front /
// back chevrons here would push the vent over the same TSL/MRT pipeline
// threshold those nodes already document. Single symmetric chevron grows
// the depth from the centre.
function boxVentDepthHandle(): HandleDescriptor<BoxVentNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'z',
    anchor: 'center',
    min: MIN_DIM,
    currentValue: (n) => n.depth,
    apply: (_n, newValue) => ({ depth: newValue }),
    placement: {
      position: (n) => [0, getBodyMidY(n), n.depth / 2 + SIDE_HANDLE_OFFSET],
    },
  }
}

// Height arrow above the top of the vent. anchor='min' so the base stays
// pinned to the slope at vent-local y=0 and the top edge follows the
// pointer. Plain chevron (not tracker) — at default sizes (~0.15 m) a
// dashed leader from base to top reads as visual noise rather than a
// dimension cue.
function boxVentHeightHandle(): HandleDescriptor<BoxVentNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: MIN_HEIGHT,
    currentValue: (n) => n.height,
    apply: (_n, newValue) => ({ height: Math.max(MIN_HEIGHT, newValue) }),
    placement: {
      position: (n) => [0, Math.max(n.height, MIN_HEIGHT) + HEIGHT_HANDLE_OFFSET, 0],
    },
  }
}

// Whole-vent rotation gizmo at the +X/+Z corner of the body footprint.
// The registered group already centres on the vent and applies its
// composed slope+yaw quaternion, so the default rotation pivot is
// correct — no `rotationCenter` override needed.
function boxVentRotateHandle(): HandleDescriptor<BoxVentNodeType> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    apply: (initial, delta) => ({ rotation: (initial.rotation ?? 0) - delta }),
    placement: {
      position: (n) => [
        n.width / 2 + ROTATE_CORNER_OFFSET,
        getBodyMidY(n),
        n.depth / 2 + ROTATE_CORNER_OFFSET,
      ],
      // Aim the two-headed icon along the +X+Z corner bisector.
      rotationY: () => -Math.PI / 4,
    },
    // Guide ring centred on the vent (drawn at the handle-frame origin),
    // sized to pass through the corner icon so the icon rides the ring and
    // the whole control reads as encircling the item — matches solar-panel.
    decoration: {
      kind: 'ring',
      radius: (n) =>
        Math.hypot(n.width / 2 + ROTATE_CORNER_OFFSET, n.depth / 2 + ROTATE_CORNER_OFFSET),
      y: (n) => getBodyMidY(n),
    },
  }
}

// `portal: 'grandparent'` on every handle: the vent mesh is mounted under
// the roof's `roof-elements` group (reproducing the segment transform), so
// the handle rig must ride the roof→segment→node frame chain — same as
// solar-panel / skylight. Without it the handles (and the rotate arc) mount
// in the bare segment-mesh frame and render offset from the vent.
const boxVentHandles: HandleDescriptor<BoxVentNodeType>[] = [
  boxVentWidthHandle('right'),
  boxVentWidthHandle('left'),
  boxVentDepthHandle(),
  boxVentHeightHandle(),
  boxVentRotateHandle(),
].map((h): HandleDescriptor<BoxVentNodeType> => ({ ...h, portal: 'grandparent' }))

/**
 * Box vent — a small louvered ventilation box that sits on a roof
 * slope. Parented to a `roof-segment`; position is segment-local;
 * rotation rotates the vent around the segment's vertical axis after
 * the slope tilt is applied.
 *
 * Composition (three-checkbox model):
 *  - **`renderer` (custom)** — the box-vent needs the parent segment's
 *    position + rotation + slope geometry to position itself, and the
 *    registry-era roof-segment renderer doesn't auto-nest children
 *    (its mesh is filled by `RoofSystem`). The custom renderer reads
 *    the segment from `useScene`, applies the transform stack, and
 *    follows the segment's `useLiveTransforms` override during a
 *    parent drag.
 *  - **no `geometry`** — geometry is created inside the renderer via
 *    the shared pure builder in `./geometry`. We could lift it to
 *    `def.geometry` once roof-segment migrates to the parametric path
 *    (Phase 5 Stage B); for now keeping it inside the renderer
 *    matches the legacy mount semantics one-for-one.
 *  - **no `system`** — no animations, no cross-kind cascades.
 *
 * The bespoke move flow (segment-hopping with hit-tests against every
 * sibling roof-segment) ports later as `affordanceTools.move`. The
 * placement `def.tool` listens to `roof:*` events and creates a new
 * vent on click.
 */
export const boxVentDefinition: NodeDefinition<typeof BoxVentNode> = {
  kind: 'box-vent',
  schemaVersion: 1,
  schema: BoxVentNode,
  category: 'structure',
  surfaceRole: 'roof',

  defaults: () => {
    const stub = BoxVentNodeSchema.parse({ id: 'bvent_default' as never, type: 'box-vent' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Single painted surface — registry-driven paint dispatch (see chimney).
    paint: surfacePaintCapability,
    // Mounts on a roof segment via `roofSegmentId`. Sits ON TOP of the
    // slope — no `buildCut`, just the dirty cascade so the parent
    // roof's merged shell rebuilds when the vent moves / resizes.
    roofAccessory: {},
  },

  parametrics: boxVentParametrics,
  handles: boxVentHandles,
  floorplan: buildBoxVentFloorplan,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  preview: () => import('./preview'),
  tool: () => import('./tool'),
  affordanceTools: {
    move: () => import('./move-tool'),
  },
  toolHints: [
    { key: 'Left click', label: 'Place box vent on roof' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Box Vent',
    description: 'Small louvered exhaust vent that sits on a roof slope.',
    icon: { kind: 'url', src: '/icons/roof.webp' },
    paletteSection: 'structure',
    paletteOrder: 120,
  },

  mcp: {
    description:
      'A louvered box vent sitting on a roof segment. Style: standard / low-profile / dome. Width/depth/height/hoodOverhang parametric.',
  },
}
