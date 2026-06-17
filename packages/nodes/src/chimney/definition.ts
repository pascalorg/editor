import {
  type AnyNodeId,
  ChimneyNode as ChimneyNodeSchema,
  type ChimneyNode as ChimneyNodeType,
  getActiveRoofHeight,
  type HandleDescriptor,
  type NodeDefinition,
  type RoofSegmentNode as RoofSegmentNodeType,
  type SceneApi,
} from '@pascal-app/core'
import { buildChimneyFloorplan } from './floorplan'
import { chimneyPaint } from './paint'
import { chimneyParametrics } from './parametrics'
import { ChimneyNode } from './schema'

// Side handle offsets in metres. Match the roof-segment values so a
// segment + chimney selected back-to-back use the same visual rhythm.
const SIDE_HANDLE_OFFSET = 0.25
const HEIGHT_HANDLE_OFFSET = 0.25
const ROTATE_CORNER_OFFSET = 0.35
const MIN_BODY_DIM = 0.3
const MIN_HEIGHT_ABOVE_RIDGE = 0.05
const MIN_FLUE_HEIGHT = 0.05
const MAX_FLUE_HEIGHT = 1.5
const MIN_CAP_THICKNESS = 0.02
const MAX_CAP_THICKNESS = 0.5
const MIN_CAP_OVERHANG = 0
const MAX_CAP_OVERHANG = 0.3
// Cap-reveal gap between body top and cap base — mirrors the
// `CAP_REVEAL` constant in `geometry.ts`. Local copy because handle
// placements need to know the cap's Y range and the geometry's
// constant isn't exported. If you change it here, change it there.
const CAP_REVEAL = 0.003
// Fallback Y when the host segment can't be resolved (shouldn't happen
// for a placed chimney, but `placement.position` runs synchronously and
// must always return a vector).
const FALLBACK_BODY_MID_Y = 1.5

// Resolve the segment that hosts this chimney. Returns undefined if the
// chimney is unparented or the parent isn't in the scene yet.
function resolveHostSegment(
  node: ChimneyNodeType,
  sceneApi: SceneApi,
): RoofSegmentNodeType | undefined {
  if (!node.roofSegmentId) return undefined
  return sceneApi.get<RoofSegmentNodeType>(node.roofSegmentId as AnyNodeId)
}

// Mid-Y of the visible chimney body in the host segment's local frame.
// Matches the geometry builder: body runs from `baseY = max(0, wallHeight
// - 0.2)` up to `peakY + heightAboveRidge`. The handle Y picks the
// midpoint of the *visible* portion (deck plane → top) so chevrons sit
// next to the body, not buried inside the roof deck or floating over
// the eave.
function getBodyMidY(node: ChimneyNodeType, segment: RoofSegmentNodeType): number {
  const peakY = segment.wallHeight + getActiveRoofHeight(segment)
  const topY = peakY + node.heightAboveRidge
  return (segment.wallHeight + topY) / 2
}

// Top of the chimney body (where the cap reveal gap begins). Tracker
// handle and cap-thickness handle both reference this Y.
function getBodyTopY(node: ChimneyNodeType, segment: RoofSegmentNodeType): number {
  return segment.wallHeight + getActiveRoofHeight(segment) + node.heightAboveRidge
}

// Cap base Y — the bottom of the cap slab. Sits just above the body
// top with a small reveal gap so a shadow line separates them.
function getCapBaseY(node: ChimneyNodeType, segment: RoofSegmentNodeType): number {
  return getBodyTopY(node, segment) + CAP_REVEAL
}

// Cap top Y — the top of the cap slab. Falls back to body top when no
// cap is rendered (flues mount on whichever is the upper surface).
function getCapTopY(node: ChimneyNodeType, segment: RoofSegmentNodeType): number {
  if (!node.cap || node.capShape === 'none') return getBodyTopY(node, segment)
  return getCapBaseY(node, segment) + node.capThickness
}

// Width arrow on the +X (right) or -X (left) side. Asymmetric resize:
// dragging one arrow grows the chimney outward from its own edge while
// the opposite edge stays world-fixed. Handles live in the chimney's
// registered ref frame (the nested inner group in the renderer that
// applies `node.position` / `node.rotation`), so placements are in
// chimney-local coordinates — no per-arrow rotation/translation
// compensation. `apply` keeps the world-fixed edge anchored even when
// the chimney is rotated by recentering `position` along the chimney's
// own +X arm in segment frame.
function chimneyWidthHandle(side: 'left' | 'right'): HandleDescriptor<ChimneyNodeType> {
  const sign = side === 'right' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: side === 'right' ? 'min' : 'max',
    // Portal into the roof (grandparent), not the segment (parent). Unpainted
    // roof segments live inside a `visible={false}` wrapper, which would
    // hide the handles. The roof itself is always visible. Skylight does
    // the same.
    portal: 'grandparent',
    min: MIN_BODY_DIM,
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
      position: (n, sceneApi) => {
        const segment = resolveHostSegment(n, sceneApi)
        const y = segment ? getBodyMidY(n, segment) : FALLBACK_BODY_MID_Y
        return [sign * (n.width / 2 + SIDE_HANDLE_OFFSET), y, 0]
      },
      // Chevron faces along the chimney's own ±X; the left arrow flips
      // 180°. No node.rotation here — the registered inner group is
      // already rotated by `node.rotation`, so chimney-local +X is the
      // chevron's natural direction.
      rotationY: () => (side === 'right' ? 0 : Math.PI),
    },
  }
}

// Depth arrow — symmetric on the +Z side. Only meaningful for square
// bodies; round chimneys are circular (depth field is ignored by the
// geometry builder, so a depth handle would just resize an invisible
// field). The chimneys factory below omits this descriptor for round
// bodies.
function chimneyDepthHandle(): HandleDescriptor<ChimneyNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'z',
    anchor: 'center',
    min: MIN_BODY_DIM,
    currentValue: (n) => n.depth,
    apply: (_n, newValue) => ({ depth: newValue }),
    placement: {
      position: (n, sceneApi) => {
        const segment = resolveHostSegment(n, sceneApi)
        const y = segment ? getBodyMidY(n, segment) : FALLBACK_BODY_MID_Y
        return [0, y, n.depth / 2 + SIDE_HANDLE_OFFSET]
      },
    },
  }
}

// Height-above-ridge tracker. Dashed leader spans the chimney body's
// visible extent — from the roof deck plane up to the body top — and
// terminates in a draggable cube at the body top. Cap, flues, cricket
// and bands sit ABOVE the body and are explicitly excluded from the
// leader so the height affordance reads as "this is the body height",
// not "this is the whole stack height". Dragging the cube vertically
// adjusts `heightAboveRidge` 1:1.
function chimneyHeightAboveRidgeHandle(): HandleDescriptor<ChimneyNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    shape: 'tracker',
    min: MIN_HEIGHT_ABOVE_RIDGE,
    currentValue: (n) => n.heightAboveRidge,
    apply: (initial, newValue) => ({
      heightAboveRidge: Math.max(MIN_HEIGHT_ABOVE_RIDGE, newValue),
    }),
    placement: {
      // Cube sits AT the body top (no offset) so the leader terminates
      // exactly at the body's top edge — visually the "ceiling" of the
      // body, before the cap reveal gap.
      position: (n, sceneApi) => {
        const segment = resolveHostSegment(n, sceneApi)
        const y = segment ? getBodyTopY(n, segment) : FALLBACK_BODY_MID_Y
        return [0, y, 0]
      },
    },
    // Leader bottom = deck plane (segment.wallHeight). The chimney body
    // geometry actually extends a touch below the deck so the bottom
    // doesn't show above the eave on low-slope roofs (`baseY = max(0,
    // wallHeight - 0.2)`), but the visible portion starts at the deck —
    // and starting the leader there is what reads as "body height" to
    // the user.
    trackerBaseY: (n, sceneApi) => {
      const segment = resolveHostSegment(n, sceneApi)
      return segment?.wallHeight ?? 0
    },
  }
}

// Whole-chimney rotation gizmo at the +X/+Z corner of the body
// footprint. The registered inner group already centers on the chimney
// and applies its yaw, so the default rotation pivot (rideObject origin)
// is correct — no `rotationCenter` override needed.
function chimneyRotateHandle(): HandleDescriptor<ChimneyNodeType> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    apply: (initial, delta) => ({ rotation: (initial.rotation ?? 0) - delta }),
    placement: {
      position: (n, sceneApi) => {
        const segment = resolveHostSegment(n, sceneApi)
        const y = segment ? getBodyMidY(n, segment) : FALLBACK_BODY_MID_Y
        const isRound = n.bodyShape === 'round'
        const halfX = n.width / 2 + ROTATE_CORNER_OFFSET
        const halfZ = (isRound ? n.width : n.depth) / 2 + ROTATE_CORNER_OFFSET
        return [halfX, y, halfZ]
      },
      // The two-headed icon's natural bias points along +X; aim it
      // toward the corner (45° outward from the chimney's local frame).
      rotationY: () => -Math.PI / 4,
    },
  }
}

// Flue-height chevron at the center of the cap top, pointing upward.
// Drag adjusts `flueHeight` for ALL flues uniformly — the schema only
// carries a single scalar. Placed at chimney center (X=Z=0) so the
// handle stays valid regardless of `flueCount` / `flueSpacing`. Anchor
// is 'min' so the flue base stays pinned to the cap and the top edge
// follows the pointer.
function chimneyFlueHeightHandle(): HandleDescriptor<ChimneyNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    portal: 'grandparent',
    min: MIN_FLUE_HEIGHT,
    max: MAX_FLUE_HEIGHT,
    currentValue: (n) => n.flueHeight,
    apply: (_n, newValue) => ({ flueHeight: newValue }),
    placement: {
      position: (n, sceneApi) => {
        const segment = resolveHostSegment(n, sceneApi)
        // Sit the chevron at the flue top so it visually attaches to
        // the thing being dragged. Fallback Y mirrors the body-top
        // fallback above.
        const baseY = segment ? getCapTopY(n, segment) : FALLBACK_BODY_MID_Y
        return [0, baseY + n.flueHeight, 0]
      },
    },
  }
}

// Cap-thickness chevron above the cap top, pointing upward. Anchor is
// 'min' so the cap base stays at body-top + reveal and the top edge
// follows the pointer.
function chimneyCapThicknessHandle(): HandleDescriptor<ChimneyNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    portal: 'grandparent',
    min: MIN_CAP_THICKNESS,
    max: MAX_CAP_THICKNESS,
    currentValue: (n) => n.capThickness,
    apply: (_n, newValue) => ({ capThickness: newValue }),
    placement: {
      position: (n, sceneApi) => {
        const segment = resolveHostSegment(n, sceneApi)
        // Offset toward +Z (away from chimney center on the depth axis)
        // so the cap-thickness chevron doesn't overlap the flue-height
        // chevron at X=0,Z=0. Pick the cap edge minus a small margin so
        // it sits on top of the cap, not floating off to the side.
        const isRound = n.bodyShape === 'round'
        const halfZ = (isRound ? n.width : n.depth) / 2
        const z = halfZ * 0.35
        const y = segment ? getCapTopY(n, segment) : FALLBACK_BODY_MID_Y
        return [0, y, z]
      },
    },
  }
}

// Cap-overhang radial chevron on the +X edge of the cap. Outward 1:1
// drag grows the overhang; the cap's half-extent is `width/2 + overhang`.
function chimneyCapOverhangHandle(): HandleDescriptor<ChimneyNodeType> {
  return {
    kind: 'radial-resize',
    axis: 'x',
    portal: 'grandparent',
    min: MIN_CAP_OVERHANG,
    max: MAX_CAP_OVERHANG,
    currentValue: (n) => n.capOverhang,
    apply: (_n, newValue) => ({ capOverhang: newValue }),
    placement: {
      position: (n, sceneApi) => {
        const segment = resolveHostSegment(n, sceneApi)
        // Cap mid-height in the chimney-local frame so the chevron sits
        // on the cap edge, not above or below it.
        const capBaseY = segment ? getCapBaseY(n, segment) : FALLBACK_BODY_MID_Y
        const y = capBaseY + n.capThickness / 2
        return [n.width / 2 + n.capOverhang + SIDE_HANDLE_OFFSET, y, 0]
      },
    },
  }
}

const chimneyHandles = (node: ChimneyNodeType): HandleDescriptor<ChimneyNodeType>[] => {
  const descriptors: HandleDescriptor<ChimneyNodeType>[] = [
    chimneyWidthHandle('right'),
    chimneyWidthHandle('left'),
  ]
  if (node.bodyShape !== 'round') descriptors.push(chimneyDepthHandle())
  descriptors.push(chimneyHeightAboveRidgeHandle(), chimneyRotateHandle())
  // Conditional flue/cap handles are temporarily disabled — they fired
  // a "Color target has no corresponding fragment stage output" WebGPU
  // validation error that the original four handles don't trigger. The
  // descriptor shapes (linear-resize y / radial-resize x) match other
  // working handles in the codebase, so the cause is likely a TSL/MRT
  // pipeline interaction we haven't pinned down. Re-enable one at a
  // time after isolating the trigger; the factory + helpers are kept so
  // we can flip them back on without re-deriving the placement math.
  // if (node.cap && node.capShape !== 'none') {
  //   descriptors.push(chimneyCapThicknessHandle(), chimneyCapOverhangHandle())
  // }
  // if (node.flueCount > 0) descriptors.push(chimneyFlueHeightHandle())
  return descriptors
}

// Every fresh chimney starts as plain white (body + top). The paint
// flow / material picker writes preset refs or full `MaterialSchema`
// objects on top of this; until then both roles render `#ffffff`.
const WHITE_MATERIAL = {
  properties: {
    color: '#ffffff',
    roughness: 0.85,
    metalness: 0,
    opacity: 1,
    transparent: false,
    side: 'front' as const,
  },
}

/**
 * Chimney — a vertical masonry stack hosted on a roof segment.
 *
 * Three-checkbox model: `def.renderer` (custom — segment-aware
 * geometry from `useScene`, body height derived from
 * `segment.wallHeight + roofHeight + heightAboveRidge`), no `geometry`,
 * no `system`.
 *
 * **Option C scope**: chimney ships in the registry shape with solid
 * geometry. CSG-driven decoration (cap flue holes, body cavity,
 * panels, bands) is preserved in the schema but not rendered yet —
 * those re-light when roof-segment migrates to Stage B and introduces
 * a `roofCutout` capability the parent segment can read.
 */
export const chimneyDefinition: NodeDefinition<typeof ChimneyNode> = {
  kind: 'chimney',
  schemaVersion: 1,
  schema: ChimneyNode,
  category: 'structure',
  surfaceRole: 'wall',

  defaults: () => {
    const stub = ChimneyNodeSchema.parse({
      id: 'chimney_default' as never,
      type: 'chimney',
      material: WHITE_MATERIAL,
      topMaterial: WHITE_MATERIAL,
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Mounts on a roof segment via `roofSegmentId`. Dirty marks
    // cascade to the host segment's parent roof so its merged shell
    // re-renders. No `buildCut` — the chimney does its own self-trim
    // via `trimChimneyBodyAgainstRoof`; the host roof shell stays solid
    // underneath.
    roofAccessory: {},
    // Paint dispatch for the body / top surface split. The editor's
    // selection-manager routes paint hover / click / preview through
    // this entry rather than carrying a kind-name arm.
    paint: chimneyPaint,
  },

  affordanceTools: {
    // Drag-to-place tool for duplicate + move. Reuses the placement
    // ghost preview but seeds it from the moving (cloned) node so the
    // duplicate keeps the source's body shape, materials, panels, etc.
    move: () => import('./move-tool'),
  },

  parametrics: chimneyParametrics,
  handles: chimneyHandles,
  floorplan: buildChimneyFloorplan,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place chimney on roof' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Chimney',
    description: 'Vertical masonry stack on a roof segment.',
    icon: { kind: 'url', src: '/icons/roof.webp' },
    paletteSection: 'structure',
    paletteOrder: 122,
  },

  mcp: {
    description:
      'A chimney on a roof segment. Square or round body; optional shoulder taper; sloped/flat/stepped cap; up to 4 protruding flues; optional cricket on the up-slope face.',
  },
}
