import {
  GutterNode as GutterNodeSchema,
  type GutterNode as GutterNodeType,
  type HandleDescriptor,
  type NodeDefinition,
} from '@pascal-app/core'
import { buildGutterFloorplan } from './floorplan'
import { snapLengthToCorner } from './length-snap'
import { gutterParametrics } from './parametrics'
import { GutterNode } from './schema'

// Edge-to-arrow-center offset, matching the box-vent / ridge-vent
// cadence so a roof's worth of accessories all read at the same scale.
const SIDE_HANDLE_OFFSET = 0.2
// Gutter chevrons sit BELOW the gutter (the trough hangs below the
// eave); the Y handle places its arrow under the cross-section apex.
const SIZE_HANDLE_OFFSET = 0.15
// Minimums — well below the inspector defaults (2.0 m length, 0.13 m
// profile) so users can shrink freely without locking.
const MIN_LENGTH = 0.2
const MIN_SIZE = 0.05

// Centre of the gutter cross-section in vertical (Y) terms. The gutter
// hangs from the eave (Y=0 in vent-mesh-local) down to Y=-size; chevrons
// that want to read "beside the body" sit at -size/2.
function getBodyMidY(n: GutterNodeType): number {
  return -Math.max(MIN_SIZE, n.size) / 2
}

// Outward Z midpoint — the gutter's back wall sits at Z=0 and the rim
// hangs out to Z≈+size (k-style) / +size (half-round / box). Side
// handles place at Z=0 so they sit ABOVE the eave's fascia line.
function getRimZ(n: GutterNodeType): number {
  return Math.max(MIN_SIZE, n.size) / 2
}

// Length arrow on ±X (the eave direction). Asymmetric resize: drag one
// end outward while the opposite end stays world-fixed by recentering
// `position` along the gutter's own +X arm in segment frame. Same
// yaw-aware projection as the box-vent / ridge-vent / chimney width
// handles.
//
// Corner snap: when the dragged endpoint nears the geometric corner it
// would form with another gutter (the crossing of their length axes),
// `snapLengthToCorner` overrides the raw newLength so the endpoint lands
// EXACTLY on that corner — the corner-mitre detector then fires reliably
// without pixel-perfect dragging. Only this gutter's length changes.
function gutterLengthHandle(side: 'left' | 'right'): HandleDescriptor<GutterNodeType> {
  const sign = side === 'right' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: side === 'right' ? 'min' : 'max',
    min: MIN_LENGTH,
    currentValue: (n) => n.length,
    apply: (initial, newLength, sceneApi) => {
      const rotY = initial.rotation ?? 0
      const armX = Math.cos(rotY)
      const armZ = -Math.sin(rotY)
      const anchorX = initial.position[0] - sign * (initial.length / 2) * armX
      const anchorZ = initial.position[2] - sign * (initial.length / 2) * armZ
      const snap = snapLengthToCorner(
        initial,
        newLength,
        sign,
        anchorX,
        anchorZ,
        armX,
        armZ,
        MIN_LENGTH,
        sceneApi,
      )
      // Only the dragged gutter's own length is snapped — `snapLengthToCorner`
      // never moves the corner-mate, so dragging one gutter can't reset
      // another the user placed deliberately.
      const newCenterX = anchorX + sign * (snap.length / 2) * armX
      const newCenterZ = anchorZ + sign * (snap.length / 2) * armZ
      return {
        length: snap.length,
        position: [newCenterX, initial.position[1], newCenterZ],
      }
    },
    placement: {
      position: (n) => [sign * (n.length / 2 + SIDE_HANDLE_OFFSET), getBodyMidY(n), getRimZ(n)],
      rotationY: () => (side === 'right' ? 0 : Math.PI),
    },
  }
}

// Profile-size arrow below the rim. axis='y', anchor='max' pins the
// top of the trough (Y=0, the eave line) and grows the bottom edge
// downward as the user drags toward -Y. Plain chevron — at typical
// sizes (5″–6″) a dashed tracker would clutter the eave line.
function gutterSizeHandle(): HandleDescriptor<GutterNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    // 'max' = +Y edge anchored (top of the trough stays at Y=0); drag
    // pulls the bottom edge further down. The base linear-resize
    // factor for `max` is -1, which flips the cursor delta so dragging
    // downward grows the value 1:1.
    anchor: 'max',
    min: MIN_SIZE,
    currentValue: (n) => n.size,
    apply: (_n, newValue) => ({ size: Math.max(MIN_SIZE, newValue) }),
    placement: {
      // Sit at the bottom of the trough, pushed a bit further down so
      // the chevron clears the rim and reads as a downward indicator.
      position: (n) => [0, -Math.max(n.size, MIN_SIZE) - SIZE_HANDLE_OFFSET, getRimZ(n)],
    },
  }
}

const gutterHandles: HandleDescriptor<GutterNodeType>[] = [
  gutterLengthHandle('right'),
  gutterLengthHandle('left'),
  gutterSizeHandle(),
]

/**
 * Gutter — a rain-water channel running along the eave of a roof
 * segment. Parented to a `roof-segment`; position is segment-local.
 *
 * Three-checkbox model — same shape as box-vent / ridge-vent: custom
 * `def.renderer` for the parent-segment transform lookup + live
 * override merge, pure geometry builder in `./geometry` shared with
 * the placement preview, no per-frame system (no animation, no
 * cross-kind cascades).
 *
 * Placement tool snaps to the eave line (segment-local
 * `Z = +depth/2, Y = wallHeight`) wherever the cursor lands on a
 * segment. After commit, the length L/R handles cover trimming and
 * the inspector covers profile + size adjustments.
 */
export const gutterDefinition: NodeDefinition<typeof GutterNode> = {
  kind: 'gutter',
  schemaVersion: 1,
  schema: GutterNode,
  category: 'structure',
  surfaceRole: 'roof',

  defaults: () => {
    const stub = GutterNodeSchema.parse({
      id: 'gutter_default' as never,
      type: 'gutter',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Mounts on a roof segment via `roofSegmentId`. Sits ON TOP of the
    // eave fascia — no `buildCut`, just the dirty cascade so the
    // parent roof's merged shell rebuilds when the gutter moves /
    // resizes.
    roofAccessory: {},
  },

  parametrics: gutterParametrics,
  handles: gutterHandles,
  floorplan: buildGutterFloorplan,
  floorplanDependsOnSiblings: true,

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
    { key: 'Left click', label: 'Place gutter on roof eave' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Gutter',
    description: 'Rain-water channel running along the eave of a roof segment.',
    icon: { kind: 'url', src: '/icons/roof.webp' },
    paletteSection: 'structure',
    paletteOrder: 122,
  },

  mcp: {
    description:
      'A gutter strip running along the eave of a roof segment. Three profiles (k-style ogee fascia, half-round, square box), length / size / thickness parametric.',
  },
}
