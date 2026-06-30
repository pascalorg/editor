import {
  type HandleDescriptor,
  type NodeDefinition,
  RidgeVentNode as RidgeVentNodeSchema,
  type RidgeVentNode as RidgeVentNodeType,
} from '@pascal-app/core'
import { surfacePaintCapability } from '../shared/surface-paint'
import { buildRidgeVentFloorplan } from './floorplan'
import { ridgeVentParametrics } from './parametrics'
import { RidgeVentNode } from './schema'

// Edge-to-arrow-center offset, matching the box-vent / chimney cadence.
const SIDE_HANDLE_OFFSET = 0.25
const HEIGHT_HANDLE_OFFSET = 0.15
// Snug to the vent corner — keeps the rotate icon close to the item.
const ROTATE_CORNER_OFFSET = 0.1
// Ridge vents are long but thin — minimums let users shrink without
// collapsing the geometry past the point where the cross-section
// degenerates. Default length is 2.0, default width 0.3, default
// height 0.08, so these are well below the defaults.
const MIN_LENGTH = 0.2
const MIN_WIDTH = 0.1
const MIN_HEIGHT = 0.02

// Mid-Y of the vent body in vent-mesh-local frame. The base sits at the
// ridge line (Y=0) and the cap peaks at Y=height — so side / rotate
// chevrons place at half-height to read as "beside the body".
function getBodyMidY(n: RidgeVentNodeType): number {
  return Math.max(MIN_HEIGHT, n.height) / 2
}

// Length arrow on ±X (the ridge direction). Asymmetric: drag one end
// outward and the opposite end stays world-fixed by recentering
// `position` along the vent's own +X arm in segment frame (yaw-aware
// math, matches box-vent / chimney). The ridge vent typically straddles
// a portion of the ridge, so dragging one end is the natural extend /
// shorten gesture.
function ridgeVentLengthHandle(side: 'left' | 'right'): HandleDescriptor<RidgeVentNodeType> {
  const sign = side === 'right' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: side === 'right' ? 'min' : 'max',
    min: MIN_LENGTH,
    currentValue: (n) => n.length,
    apply: (initial, newLength) => {
      const rotY = initial.rotation ?? 0
      const armX = Math.cos(rotY)
      const armZ = -Math.sin(rotY)
      const anchorX = initial.position[0] - sign * (initial.length / 2) * armX
      const anchorZ = initial.position[2] - sign * (initial.length / 2) * armZ
      const newCenterX = anchorX + sign * (newLength / 2) * armX
      const newCenterZ = anchorZ + sign * (newLength / 2) * armZ
      return {
        length: newLength,
        position: [newCenterX, initial.position[1], newCenterZ],
      }
    },
    placement: {
      position: (n) => [sign * (n.length / 2 + SIDE_HANDLE_OFFSET), getBodyMidY(n), 0],
      rotationY: () => (side === 'right' ? 0 : Math.PI),
    },
  }
}

// Width arrow on +Z (across the ridge). Symmetric — the vent geometry
// straddles the ridge line (Z=0) so growing the width pushes both edges
// outward by the same amount. A single chevron on +Z reads as "this is
// the width dimension"; keeping it symmetric also stays inside the same
// handle-count budget the chimney / dormer / box-vent already document.
function ridgeVentWidthHandle(): HandleDescriptor<RidgeVentNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'z',
    anchor: 'center',
    min: MIN_WIDTH,
    currentValue: (n) => n.width,
    apply: (_n, newValue) => ({ width: newValue }),
    placement: {
      position: (n) => [0, getBodyMidY(n), n.width / 2 + SIDE_HANDLE_OFFSET],
    },
  }
}

// Height arrow above the cap peak. anchor='min' so the base stays
// pinned to the ridge line (Y=0) and the peak follows the cursor. Plain
// chevron — at default 0.08 m a dashed tracker leader would be visual
// noise rather than a dimension cue.
function ridgeVentHeightHandle(): HandleDescriptor<RidgeVentNodeType> {
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

// Whole-vent rotation gizmo at the +X+Z corner of the body footprint.
// Negate the cursor delta to match three.js Y-rotation handedness. The
// registered group already centres on the vent and applies its yaw,
// so the default rotation pivot is correct.
function ridgeVentRotateHandle(): HandleDescriptor<RidgeVentNodeType> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    apply: (initial, delta) => ({ rotation: (initial.rotation ?? 0) - delta }),
    placement: {
      position: (n) => [
        n.length / 2 + ROTATE_CORNER_OFFSET,
        getBodyMidY(n),
        n.width / 2 + ROTATE_CORNER_OFFSET,
      ],
      // Two-headed icon's natural bias is along +X; aim along the
      // +X+Z corner bisector so it sits visually flush with the
      // rotate gesture's swing direction.
      rotationY: () => -Math.PI / 4,
    },
    // Guide ring centred on the vent, sized to pass through the corner icon
    // so the icon rides the ring — matches solar-panel / skylight.
    decoration: {
      kind: 'ring',
      radius: (n) =>
        Math.hypot(n.length / 2 + ROTATE_CORNER_OFFSET, n.width / 2 + ROTATE_CORNER_OFFSET),
      y: (n) => getBodyMidY(n),
    },
  }
}

// `portal: 'grandparent'` on every handle — see box-vent's note. The vent
// rides the roof→segment→node frame chain, so the handle rig must too, or
// the handles (and rotate arc) render offset from the vent.
const ridgeVentHandles: HandleDescriptor<RidgeVentNodeType>[] = [
  ridgeVentLengthHandle('right'),
  ridgeVentLengthHandle('left'),
  ridgeVentWidthHandle(),
  ridgeVentHeightHandle(),
  ridgeVentRotateHandle(),
].map((h): HandleDescriptor<RidgeVentNodeType> => ({ ...h, portal: 'grandparent' }))

/**
 * Ridge vent — a ventilation strip running along the ridge of a roof
 * segment. Parented to a `roof-segment`; position is segment-local.
 *
 * Three-checkbox model — same shape as box-vent: custom `def.renderer`
 * (parent segment transform lookup + live-transform follow), pure
 * geometry builder shared with the placement preview + future tests,
 * no animation or per-frame system.
 *
 * The placement tool snaps to the nearest ridge/break line wherever the
 * cursor lands on a segment.
 */
export const ridgeVentDefinition: NodeDefinition<typeof RidgeVentNode> = {
  kind: 'ridge-vent',
  schemaVersion: 1,
  schema: RidgeVentNode,
  category: 'structure',
  surfaceRole: 'roof',

  defaults: () => {
    const stub = RidgeVentNodeSchema.parse({
      id: 'rvent_default' as never,
      type: 'ridge-vent',
    })
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
    // ridge — no `buildCut`, just the dirty cascade so the parent
    // roof's merged shell rebuilds when the vent moves / resizes.
    roofAccessory: {},
  },

  parametrics: ridgeVentParametrics,
  handles: ridgeVentHandles,
  floorplan: buildRidgeVentFloorplan,

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
    { key: 'Left click', label: 'Place ridge vent on roof' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Ridge Vent',
    description: 'Ventilation strip running along the ridge of a roof segment.',
    icon: { kind: 'url', src: '/icons/roof.webp' },
    paletteSection: 'structure',
    paletteOrder: 121,
  },

  mcp: {
    description:
      'A ridge vent — three styles (standard curved cap / shingled / metal), optional end caps, length / width / height parametric.',
  },
}
