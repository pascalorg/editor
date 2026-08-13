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
  type LeanToExtensionNode,
  RoofNode,
  type RoofNode as RoofNodeType,
  RoofSegmentNode,
  type RoofSegmentNode as RoofSegmentNodeType,
} from '@pascal-app/core'
import { resolveEaveSnap } from '../gutter/eave-snap'
import { resolveLeanToLayout } from './layout'

const MANAGED_BY_KEY = 'managedByLeanTo'
const MANAGED_ROLE_KEY = 'leanToRole'
const POST_INDEX_KEY = 'leanToPostIndex'
const DEFAULT_GROUND_CLEARANCE = 0.08
const WALL_EDGE_TRIM = 0.002

type LeanToManagedRole = 'roof' | 'roof-segment' | 'gutter' | 'downspout' | 'post'

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

export type LeanToPostLayoutPatch = Pick<
  ColumnNodeType,
  'position' | 'rotation' | 'height' | 'width' | 'depth' | 'crossSection'
>

export function leanToPostLayoutPatch(
  leanTo: LeanToExtensionNode,
  index: number,
): LeanToPostLayoutPatch {
  const layout = resolveLeanToLayout(leanTo)
  return {
    position: [layout.postXs[index] ?? 0, 0, layout.projection],
    rotation: 0,
    height: layout.postHeight,
    width: leanTo.postWidth,
    depth: leanTo.postDepth,
    crossSection: 'rectangular',
  }
}

export function createManagedLeanToPost(
  leanTo: LeanToExtensionNode,
  index: number,
): ColumnNodeType {
  const { label: _label, ...preset } = COLUMN_PRESETS.squarePillar
  return ColumnNode.parse({
    ...preset,
    ...leanToPostLayoutPatch(leanTo, index),
    name: `Lean-to Post ${index + 1}`,
    parentId: leanTo.id,
    style: 'plain',
    edgeSoftness: 0.008,
    baseHeight: 0,
    capitalHeight: 0,
    baseStyle: 'none',
    capitalStyle: 'none',
    baseWidthScale: 1,
    baseDepthScale: 1,
    capitalWidthScale: 1,
    capitalDepthScale: 1,
    shaftStartScale: 1,
    shaftEndScale: 1,
    metadata: managedMetadata(leanTo, 'post', { [POST_INDEX_KEY]: index }),
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
  | 'overhang'
  | 'trim'
>

export function leanToRoofSegmentLayoutPatch(
  leanTo: LeanToExtensionNode,
): LeanToRoofSegmentLayoutPatch {
  const layout = resolveLeanToLayout(leanTo)
  const overhang = Math.max(0, leanTo.eaveOverhang)
  const width = Math.max(0.5, layout.span + 2 * leanTo.sideOverhang - 2 * overhang)
  return {
    position: [0, layout.lowEdgeHeight, layout.projection / 2],
    rotation: 0,
    roofType: 'shed',
    width,
    depth: layout.projection,
    wallHeight: 0,
    pitch: layout.effectivePitchDegrees,
    wallThickness: 0.01,
    deckThickness: leanTo.roofThickness,
    overhang,
    trim: {
      left: 0,
      right: 0,
      front: 0,
      back: WALL_EDGE_TRIM,
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
): Pick<GutterNodeType, 'position' | 'rotation' | 'length' | 'roofSegmentId'> {
  const snap = resolveEaveSnap(segment, 0, segment.depth / 2)
  return {
    position: [snap.eaveX, snap.eaveY, snap.eaveZ],
    rotation: snap.rotation,
    length: segment.width + 2 * segment.overhang,
    roofSegmentId: segment.id,
  }
}

export function leanToDownspoutLayoutPatch(
  segment: RoofSegmentNodeType,
  gutter: GutterNodeType,
): Pick<DownspoutNodeType, 'length' | 'diameter' | 'gutterId'> {
  const snap = resolveEaveSnap(segment, 0, segment.depth / 2)
  const outlet = gutter.outlets[0]
  return {
    length: Math.max(0.2, segment.position[1] + snap.eaveY - DEFAULT_GROUND_CLEARANCE),
    diameter: outlet?.diameter ?? 0.07,
    gutterId: gutter.id,
  }
}

export type LeanToRoofAssembly = {
  roof: RoofNodeType
  segment: RoofSegmentNodeType
  gutter: GutterNodeType
  downspout: DownspoutNodeType
}

export function createManagedLeanToRoofAssembly(leanTo: LeanToExtensionNode): LeanToRoofAssembly {
  const roof = RoofNode.parse({
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
    shingleThickness: 0.025,
    metadata: managedMetadata(leanTo, 'roof-segment'),
  })
  const outletId = generateId('outlet')
  const gutterLength = segment.width + 2 * segment.overhang
  const gutter = GutterNode.parse({
    ...leanToGutterLayoutPatch(segment),
    name: 'Lean-to Gutter',
    parentId: segment.id,
    outlets: [
      {
        id: outletId,
        offset: Math.max(0, gutterLength / 2 - 0.16),
        diameter: 0.07,
      },
    ],
    metadata: managedMetadata(leanTo, 'gutter'),
  })
  const downspout = DownspoutNode.parse({
    ...leanToDownspoutLayoutPatch(segment, gutter),
    name: 'Lean-to Downspout',
    parentId: segment.id,
    outletId,
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

export function createLeanToAssembly(leanTo: LeanToExtensionNode): {
  extension: LeanToExtensionNode
  roof: RoofNodeType
  segment: RoofSegmentNodeType
  gutter: GutterNodeType
  downspout: DownspoutNodeType
  posts: ColumnNodeType[]
  children: AnyNode[]
} {
  const roofAssembly = createManagedLeanToRoofAssembly(leanTo)
  const posts = Array.from({ length: leanTo.postCount }, (_, index) =>
    createManagedLeanToPost(leanTo, index),
  )
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
