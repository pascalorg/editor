import {
  type AnyNode,
  COLUMN_PRESETS,
  ColumnNode,
  type ColumnNode as ColumnNodeType,
  DownspoutNode,
  type DownspoutNode as DownspoutNodeType,
  GutterNode,
  type GutterNode as GutterNodeType,
  generateId,
  getWallBaseElevationForNodes,
  type LeanToExtensionNode,
  levelBaseElevationAt,
  RoofNode,
  type RoofNode as RoofNodeType,
  RoofSegmentNode,
  type RoofSegmentNode as RoofSegmentNodeType,
  spatialGridManager,
  type WallNode,
} from '@pascal-app/core'
import { resolveEaveSnap } from '../gutter/eave-snap'
import { getRoofTopSurfaceY } from '../shared/roof-surface'
import { resolveLeanToLayout } from './layout'

const MANAGED_BY_KEY = 'managedByLeanTo'
const MANAGED_ROLE_KEY = 'leanToRole'
const SELECTION_PROXY_KEY = 'nodeSelectionProxyId'
const ROOF_INSET_SPAN_KEY = 'leanToSideInfillSpan'
const ROOF_INSET_MIN_X_KEY = 'leanToSideInfillMinX'
const ROOF_INSET_MAX_X_KEY = 'leanToSideInfillMaxX'
const POST_INDEX_KEY = 'leanToPostIndex'
const POST_SIDE_KEY = 'leanToPostSide'
const POST_GUTTER_CLEARANCE = 0.02
const POST_GROUND_EMBED = 0.02
const POST_BEAM_EMBED = 0.02
const WALL_CONNECTION_TRIM = 0.002
const WALL_CONNECTION_OVERLAP = 0.02

type LeanToManagedRole = 'roof' | 'roof-segment' | 'gutter' | 'downspout' | 'post'
export type LeanToPostSide = 'high' | 'low'

export type LeanToRoofMaterialPatch = Pick<
  RoofNodeType,
  | 'material'
  | 'materialPreset'
  | 'topMaterial'
  | 'topMaterialPreset'
  | 'edgeMaterial'
  | 'edgeMaterialPreset'
  | 'wallMaterial'
  | 'wallMaterialPreset'
>

function metadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {}
}

function managedMetadata(
  leanTo: LeanToExtensionNode,
  role: LeanToManagedRole,
  extra: Record<string, unknown> = {},
) {
  return {
    [MANAGED_BY_KEY]: leanTo.id,
    [MANAGED_ROLE_KEY]: role,
    ...(role === 'roof' || role === 'roof-segment' ? { [SELECTION_PROXY_KEY]: leanTo.id } : {}),
    ...extra,
  }
}

export function isManagedLeanToNode(
  node: AnyNode,
  leanToId: LeanToExtensionNode['id'],
  role?: LeanToManagedRole,
): boolean {
  const metadata = metadataRecord(node.metadata)
  return (
    metadata[MANAGED_BY_KEY] === leanToId &&
    (role === undefined || metadata[MANAGED_ROLE_KEY] === role)
  )
}

export function isManagedLeanToPost(
  column: ColumnNodeType,
  leanToId: LeanToExtensionNode['id'],
): boolean {
  return isManagedLeanToNode(column, leanToId, 'post')
}

export function managedLeanToPostIndex(column: ColumnNodeType): number | null {
  const index = metadataRecord(column.metadata)[POST_INDEX_KEY]
  return typeof index === 'number' && Number.isInteger(index) ? index : null
}

export function managedLeanToPostSide(column: ColumnNodeType): LeanToPostSide {
  return metadataRecord(column.metadata)[POST_SIDE_KEY] === 'high' ? 'high' : 'low'
}

export type LeanToPostLayoutPatch = Pick<
  ColumnNodeType,
  | 'position'
  | 'height'
  | 'width'
  | 'depth'
  | 'crossSection'
  | 'baseStyle'
  | 'baseHeight'
  | 'baseWidthScale'
  | 'baseDepthScale'
  | 'slots'
>

export function leanToPostLayoutPatch(
  leanTo: LeanToExtensionNode,
  index: number,
  baseY = 0,
  gutterSetback = 0,
  side: LeanToPostSide = 'low',
): LeanToPostLayoutPatch {
  const layout = resolveLeanToLayout(leanTo)
  const baseStyle =
    leanTo.footingStyle === 'concrete-pad'
      ? ('square-plinth' as const)
      : leanTo.footingStyle === 'base-plate'
        ? ('simple-square' as const)
        : ('none' as const)
  return {
    position: [
      layout.postXs[index] ?? 0,
      baseY,
      side === 'high' ? 0 : layout.beamZ - gutterSetback,
    ],
    height: Math.max(
      0.2,
      (side === 'high'
        ? layout.highEdgeHeight -
          leanTo.roofThickness / 2 -
          leanTo.ledgerHeight +
          leanTo.ledgerVerticalOffset
        : layout.postHeight) -
        baseY +
        POST_BEAM_EMBED,
    ),
    width: leanTo.postWidth,
    depth: leanTo.postDepth,
    crossSection: 'rectangular',
    baseStyle,
    baseHeight:
      leanTo.footingStyle === 'concrete-pad'
        ? 0.12
        : leanTo.footingStyle === 'base-plate'
          ? 0.04
          : 0,
    baseWidthScale: leanTo.footingStyle === 'concrete-pad' ? 2 : 1.4,
    baseDepthScale: leanTo.footingStyle === 'concrete-pad' ? 2 : 1.4,
    slots: {
      shaft: leanTo.slots?.posts ?? 'library:concrete-plaster',
      ...(leanTo.footingStyle === 'none'
        ? {}
        : { base: leanTo.slots?.footings ?? 'library:concrete-plaster' }),
    },
  }
}

export function resolveLeanToPostGutterSetback(
  leanTo: LeanToExtensionNode,
  column?: ColumnNodeType,
): number {
  if (!column) return 0
  const shaftHalfDepth = column.depth / 2
  const baseHalfDepth =
    column.baseStyle === 'none' ? 0 : (column.depth * Math.max(1, column.baseDepthScale ?? 1)) / 2
  const isBracketCapital =
    column.capitalStyle === 'south-indian-bracket' || column.capitalStyle === 'wood-bracket'
  const capitalFullDepth = isBracketCapital
    ? column.depth * (Math.max(1, column.capitalWidthScale ?? 1.6) + 0.32) +
      (column.bracketDepth ?? 0.35)
    : column.depth * Math.max(1, column.capitalDepthScale ?? column.capitalWidthScale ?? 1)
  const capitalHalfDepth = column.capitalStyle === 'none' ? 0 : capitalFullDepth / 2
  const frameHalfDepth =
    column.supportStyle === 'vertical'
      ? 0
      : (Math.max(column.braceDepth ?? column.depth, 0.04) * 1.75) / 2
  const outwardHalfDepth = Math.max(shaftHalfDepth, baseHalfDepth, capitalHalfDepth, frameHalfDepth)
  const gutterClearanceSetback = Math.max(
    0,
    outwardHalfDepth + POST_GUTTER_CLEARANCE - Math.max(0, leanTo.lowOverhang),
  )
  return Math.min(gutterClearanceSetback, leanTo.beamWidth / 2)
}

export function resolveLeanToPostBaseY(
  leanTo: LeanToExtensionNode,
  wall: WallNode,
  nodes: Record<string, AnyNode>,
  index: number,
  side: LeanToPostSide = 'low',
): number {
  const levelId = wall.parentId
  if (!levelId || nodes[levelId]?.type !== 'level') return 0

  const layout = resolveLeanToLayout(leanTo)
  const postX = layout.postXs[index] ?? 0
  const leanRotation = leanTo.rotation[1]
  const leanCos = Math.cos(leanRotation)
  const leanSin = Math.sin(leanRotation)
  const postZ = side === 'high' ? 0 : layout.beamZ
  const wallLocalX = leanTo.position[0] + postX * leanCos + postZ * leanSin
  const wallLocalZ = leanTo.position[2] - postX * leanSin + postZ * leanCos
  const wallAngle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
  const wallCos = Math.cos(wallAngle)
  const wallSin = Math.sin(wallAngle)
  const position: [number, number, number] = [
    wall.start[0] + wallLocalX * wallCos - wallLocalZ * wallSin,
    0,
    wall.start[1] + wallLocalX * wallSin + wallLocalZ * wallCos,
  ]
  const support = spatialGridManager.getSlabSupportForItem(
    levelId,
    position,
    [leanTo.postWidth, 1, leanTo.postDepth],
    [0, -wallAngle + leanRotation, 0],
  )
  const groundY =
    support.slabId === null
      ? levelBaseElevationAt(nodes, levelId, position[0], position[2])
      : support.elevation
  return (
    groundY - getWallBaseElevationForNodes(wall, nodes) - leanTo.position[1] - POST_GROUND_EMBED
  )
}

export function createManagedLeanToPost(
  leanTo: LeanToExtensionNode,
  index: number,
  side: LeanToPostSide = 'low',
): ColumnNodeType {
  const { label: _label, ...preset } = COLUMN_PRESETS.squarePillar
  return ColumnNode.parse({
    ...preset,
    ...leanToPostLayoutPatch(leanTo, index, 0, 0, side),
    name: `Lean-to ${side === 'high' ? 'High ' : ''}Post ${index + 1}`,
    parentId: leanTo.id,
    style: 'plain',
    edgeSoftness: 0.008,
    capitalHeight: 0,
    capitalStyle: 'none',
    capitalWidthScale: 1,
    capitalDepthScale: 1,
    shaftStartScale: 1,
    shaftEndScale: 1,
    metadata: managedMetadata(leanTo, 'post', {
      [POST_INDEX_KEY]: index,
      [POST_SIDE_KEY]: side,
    }),
  })
}

export type LeanToRoofSegmentLayoutPatch = Pick<
  RoofSegmentNodeType,
  | 'position'
  | 'rotation'
  | 'roofType'
  | 'width'
  | 'depth'
  | 'wallHeight'
  | 'pitch'
  | 'wallThickness'
  | 'deckThickness'
  | 'shingleThickness'
  | 'overhang'
  | 'trim'
  | 'metadata'
>

export function leanToRoofSegmentLayoutPatch(
  leanTo: LeanToExtensionNode,
): LeanToRoofSegmentLayoutPatch {
  const layout = resolveLeanToLayout(leanTo)
  const shingleThickness = leanTo.shingleThickness ?? 0.025
  const overhang = 0
  const width = layout.roofWidth
  const depth = layout.roofRun + WALL_CONNECTION_OVERLAP
  const sideMemberFaceInset = Math.min(
    Math.max(0, leanTo.rafterWidth / 2),
    Math.max(0, layout.span / 2 - 0.01),
  )
  const surfaceProbe = {
    roofType: 'shed',
    width,
    depth,
    wallHeight: 0,
    pitch: layout.effectivePitchDegrees,
    wallThickness: 0.01,
    deckThickness: leanTo.roofThickness,
    overhang,
    shingleThickness,
  } as RoofSegmentNodeType
  const topAtWall = getRoofTopSurfaceY(
    0,
    -depth / 2 + Math.max(0, leanTo.highOverhang) + WALL_CONNECTION_TRIM + WALL_CONNECTION_OVERLAP,
    surfaceProbe,
  )
  return {
    position: [
      layout.roofCenterX,
      layout.highEdgeHeight - topAtWall,
      depth / 2 - Math.max(0, leanTo.highOverhang) - WALL_CONNECTION_TRIM - WALL_CONNECTION_OVERLAP,
    ],
    rotation: 0,
    roofType: 'shed',
    width,
    depth,
    wallHeight: 0,
    pitch: layout.effectivePitchDegrees,
    wallThickness: 0.01,
    deckThickness: leanTo.roofThickness,
    shingleThickness,
    overhang,
    metadata: managedMetadata(leanTo, 'roof-segment', {
      [ROOF_INSET_SPAN_KEY]: layout.span,
      [ROOF_INSET_MIN_X_KEY]: -layout.span / 2 - sideMemberFaceInset - layout.roofCenterX,
      [ROOF_INSET_MAX_X_KEY]: layout.span / 2 + sideMemberFaceInset - layout.roofCenterX,
    }),
    trim: {
      left: 0,
      right: 0,
      front: 0,
      back: leanTo.highOverhang > 0 ? 0 : WALL_CONNECTION_TRIM,
      frontLeft: 0,
      frontRight: 0,
      backLeft: 0,
      backRight: 0,
      frontLeftX: 0,
      frontLeftZ: 0,
      frontRightX: 0,
      frontRightZ: 0,
      backLeftX: 0,
      backLeftZ: 0,
      backRightX: 0,
      backRightZ: 0,
    },
  }
}

export function leanToGutterLayoutPatch(
  segment: RoofSegmentNodeType,
  leanTo: LeanToExtensionNode,
  gutter?: GutterNodeType,
): Pick<
  GutterNodeType,
  'position' | 'rotation' | 'length' | 'roofSegmentId' | 'visible' | 'profile' | 'size' | 'outlets'
> {
  const snap = resolveEaveSnap(segment, 0, segment.depth / 2)
  const length = segment.width + 2 * segment.overhang
  const existingOutlet = gutter?.outlets[0]
  const outletId = existingOutlet?.id ?? generateId('outlet')
  const offset = leanTo.downspoutPosition * Math.max(0, length / 2 - 0.16)
  const outlet =
    existingOutlet && existingOutlet.generatedBy !== 'default-downspout'
      ? existingOutlet
      : {
          id: outletId,
          offset,
          diameter: existingOutlet?.diameter ?? 0.07,
          generatedBy: 'default-downspout' as const,
        }
  return {
    position: [snap.eaveX, snap.eaveY, snap.eaveZ],
    rotation: snap.rotation,
    length,
    roofSegmentId: segment.id,
    visible: leanTo.gutterEnabled,
    profile: leanTo.gutterProfile,
    size: leanTo.gutterSize,
    outlets: leanTo.gutterEnabled && leanTo.downspoutEnabled ? [outlet] : [],
  }
}

export function leanToDownspoutLayoutPatch(
  _segment: RoofSegmentNodeType,
  gutter: GutterNodeType,
  leanTo: LeanToExtensionNode,
  downspout?: DownspoutNodeType,
): Pick<DownspoutNodeType, 'diameter' | 'gutterId' | 'lengthMode' | 'visible' | 'outletId'> {
  const outlet = gutter.outlets[0]
  return {
    diameter: outlet?.diameter ?? 0.07,
    gutterId: gutter.id,
    lengthMode: downspout?.lengthMode === 'manual' ? 'manual' : 'to-ground',
    visible: leanTo.gutterEnabled && leanTo.downspoutEnabled,
    outletId: outlet?.id,
  }
}

export function leanToRoofMaterialPatch(hostRoof: RoofNodeType): LeanToRoofMaterialPatch {
  return {
    material: hostRoof.material,
    materialPreset: hostRoof.materialPreset,
    topMaterial: hostRoof.topMaterial,
    topMaterialPreset: hostRoof.topMaterialPreset,
    edgeMaterial: hostRoof.edgeMaterial,
    edgeMaterialPreset: hostRoof.edgeMaterialPreset,
    wallMaterial: hostRoof.wallMaterial,
    wallMaterialPreset: hostRoof.wallMaterialPreset,
  }
}

export type LeanToRoofAssembly = {
  roof: RoofNodeType
  segment: RoofSegmentNodeType
  gutter: GutterNodeType
  downspout: DownspoutNodeType
}

export function createManagedLeanToRoofAssembly(
  leanTo: LeanToExtensionNode,
  hostRoof?: RoofNodeType,
): LeanToRoofAssembly {
  const roof = RoofNode.parse({
    ...(hostRoof && leanTo.matchHostRoofMaterial !== false
      ? leanToRoofMaterialPatch(hostRoof)
      : {}),
    name: 'Lean-to Roof',
    parentId: leanTo.id,
    position: [0, 0, 0],
    rotation: 0,
    metadata: managedMetadata(leanTo, 'roof'),
  })
  const segment = RoofSegmentNode.parse({
    ...leanToRoofSegmentLayoutPatch(leanTo),
    name: 'Lean-to Shed Roof',
    parentId: roof.id,
  })
  const gutter = GutterNode.parse({
    ...leanToGutterLayoutPatch(segment, leanTo),
    name: 'Lean-to Gutter',
    parentId: segment.id,
    metadata: managedMetadata(leanTo, 'gutter'),
  })
  const downspout = DownspoutNode.parse({
    ...leanToDownspoutLayoutPatch(segment, gutter, leanTo),
    name: 'Lean-to Downspout',
    parentId: segment.id,
    lengthMode: 'to-ground',
    strapStyle: 'none',
    terminal: 'straight',
    metadata: managedMetadata(leanTo, 'downspout'),
  })

  return {
    roof: { ...roof, children: [segment.id] },
    segment: { ...segment, children: [gutter.id, downspout.id] },
    gutter,
    downspout,
  }
}

export function createLeanToAssembly(
  leanTo: LeanToExtensionNode,
  hostRoof?: RoofNodeType,
): {
  extension: LeanToExtensionNode
  roof: RoofNodeType
  segment: RoofSegmentNodeType
  gutter: GutterNodeType
  downspout: DownspoutNodeType
  posts: ColumnNodeType[]
  children: AnyNode[]
} {
  const roofAssembly = createManagedLeanToRoofAssembly(leanTo, hostRoof)
  const postCount = resolveLeanToLayout(leanTo).postXs.length
  const posts = Array.from({ length: postCount }, (_, index) =>
    createManagedLeanToPost(leanTo, index, 'low'),
  )
  if (leanTo.highSideMode === 'independent-high-beam') {
    posts.push(
      ...Array.from({ length: postCount }, (_, index) =>
        createManagedLeanToPost(leanTo, index, 'high'),
      ),
    )
  }
  const children: AnyNode[] = [
    roofAssembly.roof,
    roofAssembly.segment,
    roofAssembly.gutter,
    roofAssembly.downspout,
    ...posts,
  ]
  return {
    extension: {
      ...leanTo,
      children: [roofAssembly.roof.id, ...posts.map((post) => post.id)],
    },
    ...roofAssembly,
    posts,
    children,
  }
}
