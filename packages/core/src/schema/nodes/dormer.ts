import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'
import { getRoofSegmentSurfaceY, type RoofSegmentNode, RoofType } from './roof-segment'
import { WindowNode } from './window'

export type DormerSurfaceMaterialRole = 'top' | 'side' | 'wall'
export type DormerSurfaceMaterialSpec = {
  material?: z.infer<typeof MaterialSchema>
  materialPreset?: string
}

export const DormerWallFace = z.enum(['front', 'back', 'right', 'left'])
export type DormerWallFace = z.infer<typeof DormerWallFace>

export type DormerWallFaceFrame = {
  origin: [number, number, number]
  yaw: number
  width: number
}

/**
 * Default dormer dimensions and window controls. Values match the
 * legacy archive so existing scenes don't shift visually.
 */
export const DORMER_DEFAULTS = {
  WIDTH: 1.21,
  DEPTH: 1.55,
  WALL_HEIGHT: 0,
  ROOF_HEIGHT: 0.49,
  WALL_SKIRT_HEIGHT: 2.73,
  WINDOW_WIDTH: 0.76,
  WINDOW_HEIGHT: 0.68,
  WINDOW_OFFSET_X: 0.02,
  WINDOW_OFFSET_Y: 0.99,
  WINDOW_FRAME_THICKNESS: 0.05,
  WINDOW_FRAME_DEPTH: 0.06,
  WINDOW_COLUMNS: 3,
  WINDOW_ROWS: 3,
  WINDOW_DIVIDER_THICKNESS: 0.02,
  WINDOW_ARCH_HEIGHT: 0.35,
  WINDOW_CORNER_RADIUS: 0.15,
  WINDOW_SILL_DEPTH: 0.08,
  WINDOW_SILL_THICKNESS: 0.03,
} as const

const DEFAULT_CORNER_RADII: [number, number, number, number] = [
  DORMER_DEFAULTS.WINDOW_CORNER_RADIUS,
  DORMER_DEFAULTS.WINDOW_CORNER_RADIUS,
  DORMER_DEFAULTS.WINDOW_CORNER_RADIUS,
  DORMER_DEFAULTS.WINDOW_CORNER_RADIUS,
]

export const DormerNode = BaseNode.extend({
  id: objectId('dormer'),
  type: nodeType('dormer'),

  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  topMaterial: MaterialSchema.optional(),
  topMaterialPreset: z.string().optional(),
  sideMaterial: MaterialSchema.optional(),
  sideMaterialPreset: z.string().optional(),
  wallMaterial: MaterialSchema.optional(),
  wallMaterialPreset: z.string().optional(),

  roofSegmentId: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),

  width: z.number().default(DORMER_DEFAULTS.WIDTH),
  depth: z.number().default(DORMER_DEFAULTS.DEPTH),
  height: z.number().default(DORMER_DEFAULTS.WALL_HEIGHT),

  roofType: RoofType.default('gable'),
  roofHeight: z.number().default(DORMER_DEFAULTS.ROOF_HEIGHT),
  shedHighSide: z.enum(['back', 'front']).default('back'),

  // Height of the hung wall (the "skirt") that extends below the eave
  // into the host roof — this is the wall area the window opening is
  // cut through. Larger values let the dormer host taller windows.
  wallSkirtHeight: z.number().default(DORMER_DEFAULTS.WALL_SKIRT_HEIGHT),

  // Legacy inline-window controls. Existing scenes are promoted to a hosted
  // WindowNode during scene migration; these fields remain for archive data.
  windowWidth: z.number().default(DORMER_DEFAULTS.WINDOW_WIDTH),
  windowHeight: z.number().default(DORMER_DEFAULTS.WINDOW_HEIGHT),
  windowOffsetX: z.number().default(DORMER_DEFAULTS.WINDOW_OFFSET_X),
  windowOffsetY: z.number().default(DORMER_DEFAULTS.WINDOW_OFFSET_Y),
  windowFrameThickness: z.number().default(DORMER_DEFAULTS.WINDOW_FRAME_THICKNESS),
  windowFrameDepth: z.number().default(DORMER_DEFAULTS.WINDOW_FRAME_DEPTH),
  windowColumns: z.number().int().min(1).max(8).default(DORMER_DEFAULTS.WINDOW_COLUMNS),
  windowRows: z.number().int().min(1).max(8).default(DORMER_DEFAULTS.WINDOW_ROWS),
  windowDividerThickness: z.number().default(DORMER_DEFAULTS.WINDOW_DIVIDER_THICKNESS),
  windowShape: z.enum(['rectangle', 'rounded', 'arch']).default('rectangle'),
  windowArchHeight: z.number().default(DORMER_DEFAULTS.WINDOW_ARCH_HEIGHT),
  // Single source of truth for the rounded-shape corner radii. Tuple is
  // [topLeft, topRight, bottomRight, bottomLeft]. "All vs Individual"
  // is a UI-only view mode derived from whether the tuple is uniform.
  windowCornerRadii: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .default(DEFAULT_CORNER_RADII),
  windowSill: z.boolean().default(false),
  windowSillDepth: z.number().default(DORMER_DEFAULTS.WINDOW_SILL_DEPTH),
  windowSillThickness: z.number().default(DORMER_DEFAULTS.WINDOW_SILL_THICKNESS),

  // Hosted windows use the same recursive scene-graph contract as walls and
  // roof segments. Legacy window* fields above are retained for migration.
  children: z.array(WindowNode.shape.id).default([]),
}).describe(
  dedent`
  Dormer — a small house-shaped protrusion sitting on top of a roof
  segment. width × depth × height defines the box base; roofType and
  roofHeight define the dormer's own roof shape. shedHighSide controls
  the pitch direction for shed roofs. WindowNode children are hosted on
  its wall faces and use the regular window item model.
  `,
)

export type DormerNode = z.infer<typeof DormerNode>

export function getDormerWallFaceFrame(
  dormer: Pick<DormerNode, 'width' | 'depth'>,
  face: DormerWallFace,
): DormerWallFaceFrame {
  switch (face) {
    case 'back':
      return { origin: [0, 0, -dormer.depth / 2], yaw: Math.PI, width: dormer.width }
    case 'right':
      return { origin: [dormer.width / 2, 0, 0], yaw: Math.PI / 2, width: dormer.depth }
    case 'left':
      return { origin: [-dormer.width / 2, 0, 0], yaw: -Math.PI / 2, width: dormer.depth }
    default:
      return { origin: [0, 0, dormer.depth / 2], yaw: 0, width: dormer.width }
  }
}

export function dormerWallFacePointToDormer(
  dormer: Pick<DormerNode, 'width' | 'depth'>,
  face: DormerWallFace,
  point: [number, number, number],
): [number, number, number] {
  const frame = getDormerWallFaceFrame(dormer, face)
  const cos = Math.cos(frame.yaw)
  const sin = Math.sin(frame.yaw)
  const [x, y, z] = point
  return [
    frame.origin[0] + x * cos + z * sin,
    frame.origin[1] + y,
    frame.origin[2] - x * sin + z * cos,
  ]
}

export function dormerPointToWallFace(
  dormer: Pick<DormerNode, 'width' | 'depth'>,
  face: DormerWallFace,
  point: [number, number, number],
): [number, number, number] {
  const frame = getDormerWallFaceFrame(dormer, face)
  const cos = Math.cos(frame.yaw)
  const sin = Math.sin(frame.yaw)
  const dx = point[0] - frame.origin[0]
  const dz = point[2] - frame.origin[2]
  return [cos * dx - sin * dz, point[1] - frame.origin[1], sin * dx + cos * dz]
}

export function getDormerWallVerticalBounds(
  dormer: Pick<DormerNode, 'height' | 'wallSkirtHeight'>,
) {
  return {
    min: -(dormer.wallSkirtHeight ?? DORMER_DEFAULTS.WALL_SKIRT_HEIGHT),
    max: Math.max(0, dormer.height),
  }
}

type DormerWallProfile = Pick<
  DormerNode,
  'width' | 'depth' | 'height' | 'wallSkirtHeight' | 'roofType' | 'roofHeight' | 'shedHighSide'
>

function getDormerWallCeilingAt(
  dormer: DormerWallProfile,
  face: DormerWallFace,
  faceX: number,
): number {
  const eaveHeight = Math.max(0, dormer.height)
  if (dormer.roofType !== 'shed') return eaveHeight

  const depth = Math.max(dormer.depth, Number.EPSILON)
  const [, , dormerZ] = dormerWallFacePointToDormer(dormer, face, [faceX, 0, 0])
  const frontWeight = Math.max(0, Math.min(1, dormerZ / depth + 0.5))
  const highSideWeight = dormer.shedHighSide === 'front' ? frontWeight : 1 - frontWeight
  return eaveHeight + Math.max(0, dormer.roofHeight) * highSideWeight
}

export function getDormerWallOpeningVerticalBounds(
  dormer: DormerWallProfile,
  face: DormerWallFace,
  centerX: number,
  width: number,
) {
  const halfWidth = width / 2
  return {
    min: -(dormer.wallSkirtHeight ?? DORMER_DEFAULTS.WALL_SKIRT_HEIGHT),
    max: Math.min(
      getDormerWallCeilingAt(dormer, face, centerX - halfWidth),
      getDormerWallCeilingAt(dormer, face, centerX + halfWidth),
    ),
  }
}

export function getDormerWallHorizontalBoundsAtHeight(
  dormer: DormerWallProfile,
  face: DormerWallFace,
  height: number,
) {
  const halfWidth = getDormerWallFaceFrame(dormer, face).width / 2
  const leftCeiling = getDormerWallCeilingAt(dormer, face, -halfWidth)
  const rightCeiling = getDormerWallCeilingAt(dormer, face, halfWidth)

  if (height <= Math.min(leftCeiling, rightCeiling)) {
    return { min: -halfWidth, max: halfWidth }
  }
  if (leftCeiling === rightCeiling) {
    return { min: -halfWidth, max: halfWidth }
  }

  const crossing =
    -halfWidth + ((height - leftCeiling) / (rightCeiling - leftCeiling)) * (halfWidth * 2)

  if (rightCeiling > leftCeiling) {
    const min = Math.min(halfWidth, crossing)
    return { min, max: halfWidth }
  }

  const max = Math.max(-halfWidth, crossing)
  return { min: -halfWidth, max }
}

const DORMER_WINDOW_CENTER_MIN_CLEARANCE = 0.01

export function getDormerExposedFaces(
  dormer: Pick<DormerNode, 'depth' | 'position' | 'rotation' | 'wallSkirtHeight' | 'windowOffsetY'>,
  hostSegment: RoofSegmentNode,
): { front: boolean; back: boolean } {
  const halfDepth = dormer.depth / 2
  const [dormerX, dormerY, dormerZ] = dormer.position
  const faceDX = halfDepth * Math.sin(dormer.rotation)
  const faceDZ = halfDepth * Math.cos(dormer.rotation)
  const windowCenterY = dormerY - dormer.wallSkirtHeight / 2 + dormer.windowOffsetY
  const clears = (faceX: number, faceZ: number) =>
    windowCenterY - getRoofSegmentSurfaceY(hostSegment, faceX, faceZ) >
    DORMER_WINDOW_CENTER_MIN_CLEARANCE

  return {
    front: clears(dormerX + faceDX, dormerZ + faceDZ),
    back: clears(dormerX - faceDX, dormerZ - faceDZ),
  }
}

export function getDormerDefaultWindowFace(
  dormer: Pick<DormerNode, 'depth' | 'position' | 'rotation' | 'wallSkirtHeight' | 'windowOffsetY'>,
  hostSegment?: RoofSegmentNode,
): Extract<DormerWallFace, 'front' | 'back'> {
  if (!hostSegment) return 'front'
  const exposed = getDormerExposedFaces(dormer, hostSegment)
  return !exposed.front && exposed.back ? 'back' : 'front'
}

export function createDormerDefaultWindow(
  dormer: Pick<
    DormerNode,
    | 'id'
    | 'width'
    | 'wallSkirtHeight'
    | 'windowWidth'
    | 'windowHeight'
    | 'windowOffsetX'
    | 'windowOffsetY'
    | 'windowFrameThickness'
    | 'windowFrameDepth'
    | 'windowColumns'
    | 'windowRows'
    | 'windowDividerThickness'
    | 'windowShape'
    | 'windowArchHeight'
    | 'windowCornerRadii'
    | 'windowSill'
    | 'windowSillDepth'
    | 'windowSillThickness'
  >,
  id: string,
  face: Extract<DormerWallFace, 'front' | 'back'> = 'front',
): WindowNode {
  const skirt = dormer.wallSkirtHeight ?? DORMER_DEFAULTS.WALL_SKIRT_HEIGHT
  const equalRatios = (count: number) => Array.from({ length: Math.max(1, count) }, () => 1)
  return WindowNode.parse({
    id,
    parentId: dormer.id,
    dormerId: dormer.id,
    dormerFace: face,
    position: [dormer.windowOffsetX, -skirt / 2 + dormer.windowOffsetY, 0],
    rotation: [0, 0, 0],
    side: 'front',
    width: dormer.windowWidth,
    height: dormer.windowHeight,
    openingShape: dormer.windowShape,
    archHeight: dormer.windowArchHeight,
    openingCornerRadii: dormer.windowCornerRadii,
    frameThickness: dormer.windowFrameThickness,
    frameDepth: dormer.windowFrameDepth,
    columnRatios: equalRatios(dormer.windowColumns),
    rowRatios: equalRatios(dormer.windowRows),
    columnDividerThickness: dormer.windowDividerThickness,
    rowDividerThickness: dormer.windowDividerThickness,
    sill: dormer.windowSill,
    sillDepth: dormer.windowSillDepth,
    sillThickness: dormer.windowSillThickness,
  })
}

/**
 * Per-surface material resolution. Fall-through order:
 *   top  → topMaterial[Preset]                              → legacy
 *   side → sideMaterial[Preset] → wallMaterial[Preset]      → legacy
 *   wall → wallMaterial[Preset] → sideMaterial[Preset]      → legacy
 * where legacy is `node.material` / `node.materialPreset`.
 */
export function getEffectiveDormerSurfaceMaterial(
  node: DormerNode,
  role: DormerSurfaceMaterialRole,
): DormerSurfaceMaterialSpec {
  const top: DormerSurfaceMaterialSpec = {
    material: node.topMaterial,
    materialPreset: node.topMaterialPreset,
  }
  const side: DormerSurfaceMaterialSpec = {
    material: node.sideMaterial,
    materialPreset: node.sideMaterialPreset,
  }
  const wall: DormerSurfaceMaterialSpec = {
    material: node.wallMaterial,
    materialPreset: node.wallMaterialPreset,
  }
  const legacy: DormerSurfaceMaterialSpec = {
    material: node.material,
    materialPreset: node.materialPreset,
  }
  const has = (spec: DormerSurfaceMaterialSpec) =>
    spec.material !== undefined || typeof spec.materialPreset === 'string'

  if (role === 'top') return has(top) ? top : legacy
  if (role === 'side') return has(side) ? side : has(wall) ? wall : legacy
  return has(wall) ? wall : has(side) ? side : legacy
}
