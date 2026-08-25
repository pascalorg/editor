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
  getLevelElevations,
  getWallBaseElevationForNodes,
  heightAt,
  type LeanToExtensionNode,
  levelBaseElevationAt,
  RoofNode,
  type RoofNode as RoofNodeType,
  RoofSegmentNode,
  type RoofSegmentNode as RoofSegmentNodeType,
  spatialGridManager,
  terrainFieldOf,
  type WallNode,
} from '@pascal-app/core'
import { resolveEaveSnap } from '../gutter/eave-snap'
import { getRoofTopSurfaceY } from '../shared/roof-surface'
import { bendLocalPoint, bendRotationYAtLocalX, isCurvedLeanTo } from './arc'
import { isClosedLoopLeanTo } from './conical-host'
import {
  applyLeanToCornerRoofPieces,
  LEAN_TO_CORNER_JOINTS_KEY,
  type LeanToCornerJoint,
  type LeanToCornerSide,
  leanToCornerJointMetadata,
  resolveLeanToCornerJoints,
} from './corner-joint'
import { resolveLeanToLayout } from './layout'
import { isLeanToPostOmitted } from './post-omissions'

const MANAGED_BY_KEY = 'managedByLeanTo'
const MANAGED_ROLE_KEY = 'leanToRole'
const SELECTION_PROXY_KEY = 'nodeSelectionProxyId'
const GUTTER_MITRES_KEY = 'leanToGutterMitres'
const GUTTER_EAVE_Y_KEY = 'leanToGutterEaveY'
const GUTTER_ARC_STRAIGHT_ENDS_KEY = 'leanToGutterArcStraightEnds'
const POST_INDEX_KEY = 'leanToPostIndex'
const POST_SIDE_KEY = 'leanToPostSide'
const POST_GUTTER_CLEARANCE = 0.02
const POST_GROUND_EMBED = 0.02
const POST_BEAM_EMBED = 0.02
const WALL_CONNECTION_TRIM = 0.002
const WALL_CONNECTION_OVERLAP = 0.02
export const LEFT_CORNER_POST_INDEX = -1001
export const RIGHT_CORNER_POST_INDEX = -1002

export function leanToCornerPostIndex(side: LeanToCornerSide): number {
  return side === 'left' ? LEFT_CORNER_POST_INDEX : RIGHT_CORNER_POST_INDEX
}

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
  | 'rotation'
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
  const postX = layout.postXs[index] ?? 0
  const postZ = side === 'high' ? 0 : layout.beamZ - gutterSetback
  const bent = bendLocalPoint(leanTo, postX, postZ)
  return {
    position: [bent.x, baseY, bent.y],
    rotation: bendRotationYAtLocalX(leanTo, postX),
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

export function leanToCornerPostLayoutPatch(
  leanTo: LeanToExtensionNode,
  joint: LeanToCornerJoint,
  baseY = 0,
  gutterSetback = 0,
): LeanToPostLayoutPatch {
  const cornerX = joint.sharedPostPosition[0]
  const bent = bendLocalPoint(leanTo, cornerX, joint.sharedPostPosition[2] - gutterSetback)
  return {
    ...leanToPostLayoutPatch(leanTo, 0, baseY, gutterSetback, 'low'),
    position: [bent.x, baseY, bent.y],
    rotation: bendRotationYAtLocalX(leanTo, cornerX),
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

function siteGroundYInLevelFrame(
  nodes: Record<string, AnyNode>,
  levelId: string,
  x: number,
  z: number,
): number {
  const elevation = getLevelElevations(nodes).get(levelId)
  if (!elevation) return levelBaseElevationAt(nodes, levelId, x, z)

  const building = elevation.buildingId ? nodes[elevation.buildingId] : undefined
  const buildingPosition: [number, number, number] =
    building?.type === 'building' ? building.position : [0, 0, 0]
  const buildingRotation = building?.type === 'building' ? building.rotation[1] : 0
  const cos = Math.cos(buildingRotation)
  const sin = Math.sin(buildingRotation)
  const worldX = buildingPosition[0] + x * cos + z * sin
  const worldZ = buildingPosition[2] - x * sin + z * cos
  const site = Object.values(nodes).find((node) => node.type === 'site')
  const terrain = terrainFieldOf(site)
  const groundWorldY = terrain ? heightAt(terrain, worldX, worldZ) : 0
  const levelWorldY = buildingPosition[1] + elevation.baseY
  return groundWorldY - levelWorldY
}

export function resolveLeanToPostBaseY(
  leanTo: LeanToExtensionNode,
  wall: WallNode | undefined,
  nodes: Record<string, AnyNode>,
  index: number,
  side: LeanToPostSide = 'low',
): number {
  const layout = resolveLeanToLayout(leanTo)
  const postX = layout.postXs[index] ?? 0
  const postZ = side === 'high' ? 0 : layout.beamZ
  const bent = bendLocalPoint(leanTo, postX, postZ)
  return resolveLeanToPostBaseYAtLocalPosition(leanTo, wall, nodes, [bent.x, 0, bent.y])
}

export function resolveLeanToPostBaseYAtLocalPosition(
  leanTo: LeanToExtensionNode,
  wall: WallNode | undefined,
  nodes: Record<string, AnyNode>,
  localPosition: readonly [number, number, number],
): number {
  const levelId = wall?.parentId ?? leanTo.parentId
  if (!levelId || nodes[levelId]?.type !== 'level') return 0

  const postX = localPosition[0]
  const leanRotation = leanTo.rotation[1]
  const leanCos = Math.cos(leanRotation)
  const leanSin = Math.sin(leanRotation)
  const postZ = localPosition[2]
  const position: [number, number, number] = wall
    ? (() => {
        const wallLocalX = leanTo.position[0] + postX * leanCos + postZ * leanSin
        const wallLocalZ = leanTo.position[2] - postX * leanSin + postZ * leanCos
        const wallAngle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
        const wallCos = Math.cos(wallAngle)
        const wallSin = Math.sin(wallAngle)
        return [
          wall.start[0] + wallLocalX * wallCos - wallLocalZ * wallSin,
          0,
          wall.start[1] + wallLocalX * wallSin + wallLocalZ * wallCos,
        ]
      })()
    : [
        leanTo.position[0] + postX * leanCos + postZ * leanSin,
        0,
        leanTo.position[2] - postX * leanSin + postZ * leanCos,
      ]
  const wallAngle = wall ? Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]) : 0
  const support = spatialGridManager.getSlabSupportForItem(
    levelId,
    position,
    [leanTo.postWidth, 1, leanTo.postDepth],
    [0, -wallAngle + leanRotation, 0],
  )
  const groundY =
    support.slabId === null
      ? siteGroundYInLevelFrame(nodes, levelId, position[0], position[2])
      : support.elevation
  return (
    groundY -
    (wall ? getWallBaseElevationForNodes(wall, nodes) : 0) -
    leanTo.position[1] -
    POST_GROUND_EMBED
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

export function createManagedLeanToCornerPost(
  leanTo: LeanToExtensionNode,
  joint: LeanToCornerJoint,
): ColumnNodeType {
  const { label: _label, ...preset } = COLUMN_PRESETS.squarePillar
  return ColumnNode.parse({
    ...preset,
    ...leanToCornerPostLayoutPatch(leanTo, joint),
    name: `Lean-to ${joint.side === 'left' ? 'Left' : 'Right'} Corner Post`,
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
      [POST_INDEX_KEY]: leanToCornerPostIndex(joint.side),
      [POST_SIDE_KEY]: 'low',
    }),
  })
}

export function resolveLeanToPostIndexes(
  leanTo: LeanToExtensionNode,
  cornerJoints: Partial<Record<LeanToCornerSide, LeanToCornerJoint>>,
  side: LeanToPostSide,
): number[] {
  const layout = resolveLeanToLayout(leanTo)
  return Array.from({ length: layout.postXs.length }, (_, index) => index).filter((index) => {
    if (isLeanToPostOmitted(leanTo, side, index)) return false
    if (side === 'high') return true
    const x = layout.postXs[index] ?? 0
    const left = cornerJoints.left
    if (left?.kind === 'linear' && index === 0) return false
    if (left?.kind === 'concave' && x <= left.sharedPostPosition[0] + 1e-6) return false
    const right = cornerJoints.right
    if (right?.kind === 'linear' && index === layout.postXs.length - 1) return false
    if (right?.kind === 'concave' && x >= right.sharedPostPosition[0] - 1e-6) return false
    return true
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
  | 'arc'
  | 'shedSideInfillSpan'
  | 'shedSideInfillMinX'
  | 'shedSideInfillMaxX'
  | 'shedFootprintPieces'
  | 'shedOpenEndSides'
  | 'managedByParent'
  | 'wallShell'
  | 'shedInsetEndPanels'
  | 'trim'
  | 'metadata'
>

export function leanToRoofSegmentLayoutPatch(
  leanTo: LeanToExtensionNode,
  nodes?: Record<string, AnyNode>,
): LeanToRoofSegmentLayoutPatch {
  const layout = resolveLeanToLayout(leanTo)
  const wall =
    leanTo.parentId && nodes?.[leanTo.parentId]?.type === 'wall'
      ? (nodes[leanTo.parentId] as WallNode)
      : undefined
  const shingleThickness = leanTo.shingleThickness ?? 0.025
  const overhang = 0
  const depth = layout.roofRun + WALL_CONNECTION_OVERLAP
  const cornerJoints = resolveLeanToCornerJoints(leanTo, wall, nodes)
  const leftCornerExtension = cornerJoints.left?.roofExtension ?? 0
  const rightCornerExtension = cornerJoints.right?.roofExtension ?? 0
  const width = Math.max(0.05, layout.roofWidth + leftCornerExtension + rightCornerExtension)
  const roofCenterX = layout.roofCenterX + (rightCornerExtension - leftCornerExtension) / 2
  const roofCenterZ =
    depth / 2 - Math.max(0, leanTo.highOverhang) - WALL_CONNECTION_TRIM - WALL_CONNECTION_OVERLAP
  // Concentric-band descriptor in segment-local coords. The whole lean-to bends
  // about the wall's true arc center at lean-to-local (0, spanArcCenterZ); the
  // segment is offset by (roofCenterX, roofCenterZ), so the center lands here.
  // `radius` is the signed bend reference |spanArcCenterZ| (its sign follows
  // centerZ), which reproduces the members' bend transform exactly.
  const arc = isCurvedLeanTo(leanTo)
    ? {
        centerX: -roofCenterX,
        centerZ: (leanTo.spanArcCenterZ ?? 0) - roofCenterZ,
        radius: leanTo.spanArcRadius ?? 0,
      }
    : undefined
  const roofBack = roofCenterZ - depth / 2 + (leanTo.highOverhang > 0 ? 0 : WALL_CONNECTION_TRIM)
  const roofFront = roofCenterZ + depth / 2
  const roofPieces: [number, number][][] = applyLeanToCornerRoofPieces(
    [
      [layout.roofCenterX - layout.roofWidth / 2, roofBack],
      [layout.roofCenterX + layout.roofWidth / 2, roofBack],
      [layout.roofCenterX + layout.roofWidth / 2, roofFront],
      [layout.roofCenterX - layout.roofWidth / 2, roofFront],
    ],
    cornerJoints,
  ).map((polygon) =>
    polygon.map(([x = 0, z = 0]) => [x - roofCenterX, z - roofCenterZ] as [number, number]),
  )
  const jointSides = Object.values(cornerJoints).flatMap((joint) => (joint ? [joint.side] : []))
  const hasShapedCorner = Object.values(cornerJoints).some(
    (joint) => joint && joint.kind !== 'linear',
  )
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
    position: [roofCenterX, layout.highEdgeHeight - topAtWall, roofCenterZ],
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
    arc,
    shedSideInfillSpan: layout.span,
    shedSideInfillMinX: -layout.span / 2 - sideMemberFaceInset - roofCenterX,
    shedSideInfillMaxX: layout.span / 2 + sideMemberFaceInset - roofCenterX,
    shedFootprintPieces: hasShapedCorner ? roofPieces : undefined,
    shedOpenEndSides: jointSides.length > 0 ? jointSides : undefined,
    managedByParent: true,
    wallShell: 'omit',
    shedInsetEndPanels: true,
    metadata: managedMetadata(leanTo, 'roof-segment'),
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
  nodes?: Record<string, AnyNode>,
): Pick<
  GutterNodeType,
  | 'position'
  | 'rotation'
  | 'length'
  | 'arc'
  | 'roofSegmentId'
  | 'visible'
  | 'profile'
  | 'size'
  | 'endCapLeft'
  | 'endCapRight'
  | 'outlets'
  | 'metadata'
> {
  const snap = resolveEaveSnap(segment, 0, segment.depth / 2)
  const existingOutlet = gutter?.outlets[0]
  const outletId = existingOutlet?.id ?? generateId('outlet')
  const wall =
    leanTo.parentId && nodes?.[leanTo.parentId]?.type === 'wall'
      ? (nodes[leanTo.parentId] as WallNode)
      : undefined
  const cornerJoints = resolveLeanToCornerJoints(leanTo, wall, nodes)
  const ownWorldEaveY =
    (wall && nodes ? getWallBaseElevationForNodes(wall, nodes) : 0) +
    leanTo.position[1] +
    segment.position[1] +
    snap.eaveY
  let sharedWorldEaveY = ownWorldEaveY
  if (leanTo.gutterEnabled && nodes) {
    for (const joint of Object.values(cornerJoints)) {
      const neighbor = joint ? nodes[joint.neighborId] : undefined
      if (neighbor?.type !== 'lean-to-extension' || !neighbor.gutterEnabled) continue
      const neighborWall = neighbor.parentId ? nodes[neighbor.parentId] : undefined
      if (neighborWall?.type !== 'wall') continue
      const neighborSegment = leanToRoofSegmentLayoutPatch(neighbor, nodes)
      const neighborSnap = resolveEaveSnap(
        neighborSegment as RoofSegmentNodeType,
        0,
        neighborSegment.depth / 2,
      )
      sharedWorldEaveY = Math.max(
        sharedWorldEaveY,
        getWallBaseElevationForNodes(neighborWall, nodes) +
          neighbor.position[1] +
          neighborSegment.position[1] +
          neighborSnap.eaveY,
      )
    }
  }
  const sharedLocalEaveY = sharedWorldEaveY - ownWorldEaveY + snap.eaveY
  const gutterMitreForJoint = (joint: LeanToCornerJoint | undefined): number => {
    if (!(leanTo.gutterEnabled && joint && nodes)) return 0
    const neighbor = nodes[joint.neighborId]
    return neighbor?.type === 'lean-to-extension' && neighbor.gutterEnabled ? joint.gutterMitre : 0
  }
  const gutterOpenAtJoint = (joint: LeanToCornerJoint | undefined): boolean => {
    if (!(leanTo.gutterEnabled && joint && nodes)) return false
    const neighbor = nodes[joint.neighborId]
    return neighbor?.type === 'lean-to-extension' && neighbor.gutterEnabled
  }
  const length = Math.max(0.05, segment.width + 2 * segment.overhang)
  const jointAwareDownspoutPosition =
    cornerJoints.left && leanTo.downspoutPosition < -0.75
      ? cornerJoints.right
        ? 0
        : 1
      : cornerJoints.right && leanTo.downspoutPosition > 0.75
        ? cornerJoints.left
          ? 0
          : -1
        : leanTo.downspoutPosition
  const offset = jointAwareDownspoutPosition * Math.max(0, length / 2 - 0.16)
  // The eave follows the same concentric arc as the deck. The eave snap is a pure
  // translation of segment-local (rotation 0 for shed's +Z eave), so the segment
  // arc center maps to gutter-mesh-local by subtracting the snap seat; radius (the
  // signed bend reference) is unchanged.
  const gutterArc = segment.arc
    ? {
        centerX: segment.arc.centerX - snap.eaveX,
        centerZ: segment.arc.centerZ - snap.eaveZ,
        radius: segment.arc.radius,
      }
    : undefined
  const layout = resolveLeanToLayout(leanTo)
  const arcStraightEnds = gutterArc
    ? Object.fromEntries(
        (['left', 'right'] as const).flatMap((side) => {
          if (!cornerJoints[side]) return []
          const sign = side === 'left' ? -1 : 1
          const startX =
            layout.roofCenterX + sign * (layout.roofWidth / 2) - segment.position[0] - snap.eaveX
          return [[side, { startX, endX: sign * (length / 2) }]]
        }),
      )
    : undefined
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
    arc: gutterArc,
    roofSegmentId: segment.id,
    visible: leanTo.gutterEnabled,
    profile: leanTo.gutterProfile,
    size: leanTo.gutterSize,
    endCapLeft: !isClosedLoopLeanTo(leanTo) && !gutterOpenAtJoint(cornerJoints.left),
    endCapRight: !isClosedLoopLeanTo(leanTo) && !gutterOpenAtJoint(cornerJoints.right),
    outlets: leanTo.gutterEnabled && leanTo.downspoutEnabled ? [outlet] : [],
    metadata: {
      ...metadataRecord(gutter?.metadata),
      ...managedMetadata(leanTo, 'gutter', {
        [GUTTER_MITRES_KEY]: {
          left: gutterMitreForJoint(cornerJoints.left),
          right: gutterMitreForJoint(cornerJoints.right),
        },
        [GUTTER_EAVE_Y_KEY]: sharedLocalEaveY,
        ...(arcStraightEnds && Object.keys(arcStraightEnds).length > 0
          ? { [GUTTER_ARC_STRAIGHT_ENDS_KEY]: arcStraightEnds }
          : {}),
      }),
    },
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
  nodes?: Record<string, AnyNode>,
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
    ...leanToRoofSegmentLayoutPatch(leanTo, nodes),
    name: 'Lean-to Shed Roof',
    parentId: roof.id,
  })
  const gutter = GutterNode.parse({
    ...leanToGutterLayoutPatch(segment, leanTo, undefined, nodes),
    name: 'Lean-to Gutter',
    parentId: segment.id,
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
  nodes?: Record<string, AnyNode>,
): {
  extension: LeanToExtensionNode
  roof: RoofNodeType
  segment: RoofSegmentNodeType
  gutter: GutterNodeType
  downspout: DownspoutNodeType
  posts: ColumnNodeType[]
  children: AnyNode[]
} {
  const roofAssembly = createManagedLeanToRoofAssembly(leanTo, hostRoof, nodes)
  const wall =
    leanTo.parentId && nodes?.[leanTo.parentId]?.type === 'wall'
      ? (nodes[leanTo.parentId] as WallNode)
      : undefined
  const cornerJoints = resolveLeanToCornerJoints(leanTo, wall, nodes)
  const posts = resolveLeanToPostIndexes(leanTo, cornerJoints, 'low').map((index) =>
    createManagedLeanToPost(leanTo, index, 'low'),
  )
  for (const joint of Object.values(cornerJoints)) {
    if (
      joint?.sharedPostOwner &&
      !isLeanToPostOmitted(leanTo, 'low', leanToCornerPostIndex(joint.side))
    ) {
      posts.push(createManagedLeanToCornerPost(leanTo, joint))
    }
  }
  if (leanTo.highSideMode === 'independent-high-beam') {
    posts.push(
      ...resolveLeanToPostIndexes(leanTo, cornerJoints, 'high').map((index) =>
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
      metadata: {
        ...metadataRecord(leanTo.metadata),
        [LEAN_TO_CORNER_JOINTS_KEY]: leanToCornerJointMetadata(cornerJoints),
      },
      children: [roofAssembly.roof.id, ...posts.map((post) => post.id)],
    },
    ...roofAssembly,
    posts,
    children,
  }
}
