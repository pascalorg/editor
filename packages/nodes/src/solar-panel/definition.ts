import {
  type HandleDescriptor,
  type NodeDefinition,
  SolarPanelNode as SolarPanelNodeSchema,
  type SolarPanelNode as SolarPanelNodeType,
} from '@pascal-app/core'
import { buildSolarPanelFloorplan } from './floorplan'
import { solarPanelParametrics } from './parametrics'
import { SolarPanelNode } from './schema'

// Handle constants — same scheme as the skylight: edge-to-arrow-center
// offsets that need to clear half the chevron's body (~13 cm at default
// scale) plus the frame thickness before the gap reads. 0.35 m matches
// the skylight's visual cadence; rotate gizmo gets a matching offset +
// a small +X bump so it sits beside (not on) the +X corner.
const SIDE_HANDLE_OFFSET = 0.35
const ROTATE_CORNER_OFFSET = 0.35
const ROTATE_CORNER_X_OFFSET = 0.2
const ROTATE_CORNER_Y_OFFSET = 0.18
const ROTATE_RING_OFFSET = 0.06
const MIN_PANEL_DIM = 0.1
const MIN_FRAME_THICKNESS = 0.005
const MIN_FRAME_DEPTH = 0.005
// Small gap above the current frame top so the chevron stays grabbable
// when frameDepth collapses near zero and floats above the frame for
// thicker frames.
const FRAME_DEPTH_HANDLE_OFFSET = 0.15

// Total array footprint (meters). `panelWidth` / `panelHeight` are
// per-cell dimensions; arrays multiply by columns/rows and add the
// inter-cell gaps. Handles operate on the TOTAL footprint so the
// dimension label and drag distance feel intuitive (drag the right edge
// by 1 m → array grows 1 m on that side, not 1 m per cell).
function totalArrayWidth(n: SolarPanelNodeType): number {
  return n.columns * n.panelWidth + Math.max(0, n.columns - 1) * (n.gapX ?? 0)
}

function totalArrayHeight(n: SolarPanelNodeType): number {
  return n.rows * n.panelHeight + Math.max(0, n.rows - 1) * (n.gapY ?? 0)
}

// Width arrows on ±X (left / right edges of the array). Asymmetric
// resize — same pattern as the skylight: anchored edge stays world-fixed,
// per-cell `panelWidth` is back-solved from the new total width, and
// `position` shifts by half the actual change along the panel's local
// +X axis (projected to segment-local via the panel's yaw). Clears
// `panelTypePreset` since the dimensions no longer match a saved preset.
function solarPanelWidthHandle(side: 'left' | 'right'): HandleDescriptor<SolarPanelNodeType> {
  const sign = side === 'right' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: side === 'right' ? 'min' : 'max',
    min: MIN_PANEL_DIM,
    currentValue: (n) => totalArrayWidth(n),
    apply: (initial, newTotalWidth) => {
      const cols = initial.columns
      const gapTotal = Math.max(0, cols - 1) * (initial.gapX ?? 0)
      const newPanelWidth = Math.max(MIN_PANEL_DIM, (newTotalWidth - gapTotal) / cols)
      const actualNewTotal = cols * newPanelWidth + gapTotal
      const initialTotal = totalArrayWidth(initial)
      const rotY = initial.rotation ?? 0
      const armX = Math.cos(rotY)
      const armZ = -Math.sin(rotY)
      const anchorX = initial.position[0] - sign * (initialTotal / 2) * armX
      const anchorZ = initial.position[2] - sign * (initialTotal / 2) * armZ
      const newCenterX = anchorX + sign * (actualNewTotal / 2) * armX
      const newCenterZ = anchorZ + sign * (actualNewTotal / 2) * armZ
      return {
        panelWidth: newPanelWidth,
        position: [newCenterX, initial.position[1], newCenterZ],
        panelTypePreset: undefined,
      }
    },
    placement: {
      position: (n) => [sign * (totalArrayWidth(n) / 2 + SIDE_HANDLE_OFFSET), 0, 0],
      rotationY: () => (side === 'right' ? 0 : Math.PI),
    },
    portal: 'grandparent',
  }
}

// Height arrows on ±Z. Same shape as width but acts on `panelHeight`
// (back-solved from new total height) and projects onto +Z instead of
// +X. The skylight-axis convention applies: +Z is the dimension along
// the roof's slope direction.
function solarPanelHeightHandle(side: 'top' | 'bottom'): HandleDescriptor<SolarPanelNodeType> {
  const sign = side === 'top' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'z',
    anchor: side === 'top' ? 'min' : 'max',
    min: MIN_PANEL_DIM,
    currentValue: (n) => totalArrayHeight(n),
    apply: (initial, newTotalHeight) => {
      const rws = initial.rows
      const gapTotal = Math.max(0, rws - 1) * (initial.gapY ?? 0)
      const newPanelHeight = Math.max(MIN_PANEL_DIM, (newTotalHeight - gapTotal) / rws)
      const actualNewTotal = rws * newPanelHeight + gapTotal
      const initialTotal = totalArrayHeight(initial)
      const rotY = initial.rotation ?? 0
      // Panel-local +Z projects to segment-local (sin r, cos r) —
      // orthogonal to the panel-local +X basis used for width.
      const armX = Math.sin(rotY)
      const armZ = Math.cos(rotY)
      const anchorX = initial.position[0] - sign * (initialTotal / 2) * armX
      const anchorZ = initial.position[2] - sign * (initialTotal / 2) * armZ
      const newCenterX = anchorX + sign * (actualNewTotal / 2) * armX
      const newCenterZ = anchorZ + sign * (actualNewTotal / 2) * armZ
      return {
        panelHeight: newPanelHeight,
        position: [newCenterX, initial.position[1], newCenterZ],
        panelTypePreset: undefined,
      }
    },
    placement: {
      position: (n) => [0, 0, sign * (totalArrayHeight(n) / 2 + SIDE_HANDLE_OFFSET)],
      rotationY: () => (side === 'top' ? 0 : Math.PI),
    },
    portal: 'grandparent',
  }
}

// Rotate gizmo at the +X+Z corner of the total array footprint, lifted
// slightly off the surface so it doesn't sink into the frame. Negate
// the cursor delta to match three.js Y-rotation handedness.
function solarPanelRotateHandle(): HandleDescriptor<SolarPanelNodeType> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    apply: (initial, delta) => ({ rotation: (initial.rotation ?? 0) - delta }),
    placement: {
      position: (n) => {
        const halfX = totalArrayWidth(n) / 2
        const halfZ = totalArrayHeight(n) / 2
        return [
          halfX + ROTATE_CORNER_X_OFFSET,
          ROTATE_CORNER_Y_OFFSET,
          halfZ + ROTATE_CORNER_OFFSET,
        ]
      },
      rotationY: () => -Math.PI / 4,
    },
    decoration: {
      kind: 'ring',
      radius: (n) =>
        Math.hypot(totalArrayWidth(n) / 2, totalArrayHeight(n) / 2) + ROTATE_RING_OFFSET,
      y: () => 0,
    },
    portal: 'grandparent',
  }
}

// Frame-depth arrow — vertical chevron above the array, centred on the
// panel surface. Drag up to grow `frameDepth` (how far the frame sticks
// out from the surface). axis='y' / anchor='min' so the bottom of the
// frame stays pinned at the surface (Y=0 in panel-local) and the top
// follows the cursor. Clears `panelTypePreset` since dimensions no
// longer match a saved preset.
function solarPanelFrameDepthHandle(): HandleDescriptor<SolarPanelNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: MIN_FRAME_DEPTH,
    currentValue: (n) => n.frameDepth ?? 0.04,
    apply: (_n, newValue) => ({
      frameDepth: newValue,
      panelTypePreset: undefined,
    }),
    placement: {
      position: (n) => [0, (n.frameDepth ?? 0.04) + FRAME_DEPTH_HANDLE_OFFSET, 0],
    },
    portal: 'grandparent',
  }
}

// Frame-thickness arrow — diagonal chevron at the -X+Z (top-left) corner,
// mirroring the skylight handle. axis='z' so dragging outward toward +Z
// grows the value; rotationY = -π/4 swings the auto-rotated +Z chevron
// to point along the -X+Z corner bisector. Clears `panelTypePreset`
// since the frame dimensions no longer match a saved preset.
function solarPanelFrameThicknessHandle(): HandleDescriptor<SolarPanelNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'z',
    anchor: 'min',
    min: MIN_FRAME_THICKNESS,
    currentValue: (n) => n.frameThickness ?? 0.04,
    apply: (_n, newValue) => ({
      frameThickness: newValue,
      panelTypePreset: undefined,
    }),
    placement: {
      position: (n) => [
        -(totalArrayWidth(n) / 2) - SIDE_HANDLE_OFFSET,
        0,
        totalArrayHeight(n) / 2 + SIDE_HANDLE_OFFSET,
      ],
      rotationY: () => -Math.PI / 4,
    },
    portal: 'grandparent',
  }
}

const solarPanelHandles: HandleDescriptor<SolarPanelNodeType>[] = [
  solarPanelWidthHandle('right'),
  solarPanelWidthHandle('left'),
  solarPanelHeightHandle('top'),
  solarPanelHeightHandle('bottom'),
  solarPanelFrameDepthHandle(),
  solarPanelRotateHandle(),
  solarPanelFrameThicknessHandle(),
]

/**
 * Solar panel array — a grid of photovoltaic panels mounted on a roof
 * segment. Position is segment-local; the surface normal stored on
 * the node orients the array flat to the slope.
 *
 * Three-checkbox model: custom `def.renderer` for the parent-segment
 * lookup + analytical surface normal fallback. No `geometry` (the
 * builder lives in `./geometry` and is shared with the preview), no
 * `system` (the orientation quaternion is computed once per render,
 * not per frame — see renderer notes).
 */
export const solarPanelDefinition: NodeDefinition<typeof SolarPanelNode> = {
  kind: 'solar-panel',
  schemaVersion: 1,
  schema: SolarPanelNode,
  category: 'structure',
  surfaceRole: 'roof',

  defaults: () => {
    const stub = SolarPanelNodeSchema.parse({
      id: 'solarpanel_default' as never,
      type: 'solar-panel',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Mounts on a roof segment via `roofSegmentId`. Sits ON TOP of the
    // shell — no `buildCut`, just the dirty cascade so the parent
    // roof's merged shell rebuilds when the array moves / resizes.
    roofAccessory: {},
  },

  parametrics: solarPanelParametrics,
  handles: solarPanelHandles,
  floorplan: buildSolarPanelFloorplan,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  tool: () => import('./tool'),
  affordanceTools: {
    move: () => import('./move-tool'),
  },
  toolHints: [
    { key: 'Left click', label: 'Place solar panel array on roof' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Solar Panel',
    description: 'Grid of photovoltaic panels mounted on a roof segment.',
    icon: { kind: 'url', src: '/icons/roof.webp' },
    paletteSection: 'structure',
    paletteOrder: 123,
  },

  mcp: {
    description:
      'A solar panel array on a roof segment. rows × columns grid of individual panels with configurable size, gap, mounting (flush / tilted), and frame.',
  },
}
