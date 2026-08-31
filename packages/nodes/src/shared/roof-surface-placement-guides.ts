import {
  type AnyNode,
  type AnyNodeId,
  type RoofNode,
  type RoofSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { type OpeningGuide3D, useOpeningGuides } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import * as THREE from 'three'
import { buildBoxVentGeometry } from '../box-vent/geometry'
import { buildChimneyGeometry } from '../chimney/geometry'
import { buildCupolaGeometry } from '../cupola/geometry'
import { buildDormerGhostGeometry } from '../dormer/geometry'
import { buildEyebrowVentGeometry } from '../eyebrow-vent/geometry'
import { buildGutterGeometry } from '../gutter/geometry'
import { buildRidgeVentGeometry } from '../ridge-vent/geometry'
import { buildFrameGeometry } from '../skylight/frame-csg'
import { buildSolarPanelGeometry } from '../solar-panel/geometry'
import { buildTurbineVentGeometry } from '../turbine-vent/geometry'
import type { RelativeRoofDragTarget } from './relative-roof-drag'
import { getRoofSurfaceFaceBoundsAt, getSurfaceY } from './roof-surface'

const MIN_DIMENSION_M = 0.02
const ALIGNMENT_THRESHOLD_M = 0.08
const EQUAL_SPACING_THRESHOLD_M = 0.03

const tmp = new THREE.Vector3()
const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const ROOF_SURFACE_FOOTPRINT_CACHE_MAX = 160
const roofSurfaceFootprintCache = new Map<
  string,
  Pick<RoofSurfaceGuideFootprint, 'width' | 'depth'> | null
>()

export type RoofSurfaceGuideMode = 'side-center' | 'linear-edge'

export type RoofSurfaceGuideFootprint = {
  width: number
  depth: number
  rotation?: number
}

type RoofGuideBounds = {
  centerX: number
  centerZ: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

type RoofGuideSide = 'left' | 'right' | 'bottom' | 'top'

type RoofSiblingSpacingResult<T> = {
  guides: T[]
  blockedSides: Record<RoofGuideSide, boolean>
}

type RoofAlignmentFeature = 'min' | 'center' | 'max'

type RoofAlignmentCandidate = {
  axis: 'x' | 'z'
  coord: number
  gap: number
  from: [number, number]
  to: [number, number]
}

type RoofEqualSpacingItem = {
  bounds: RoofGuideBounds
  moving: boolean
}

type RoofEqualSpacingGap = {
  value: number
  from: [number, number]
  to: [number, number]
}

export function roofSurfaceFootprintFromNode(
  node: unknown,
  options?: { segment?: RoofSegmentNode },
): RoofSurfaceGuideFootprint {
  const n = node as Record<string, unknown>
  const geometryBounds = cachedGeometryFootprintForNode(n, options?.segment)
  if (geometryBounds) {
    return {
      ...geometryBounds,
      rotation: numberField(n.rotation, 0),
    }
  }

  if (n.type === 'solar-panel') {
    const columns = numberField(n.columns, 1)
    const rows = numberField(n.rows, 1)
    const panelWidth = numberField(n.panelWidth, 1)
    const panelHeight = numberField(n.panelHeight, 1)
    const gapX = numberField(n.gapX, 0)
    const gapY = numberField(n.gapY, 0)
    return {
      width: columns * panelWidth + Math.max(0, columns - 1) * gapX,
      depth: rows * panelHeight + Math.max(0, rows - 1) * gapY,
      rotation: numberField(n.rotation, 0),
    }
  }

  if (n.type === 'ridge-vent') {
    return {
      width: numberField(n.length, 1),
      depth: numberField(n.width, 0.3),
      rotation: numberField(n.rotation, 0),
    }
  }

  if (n.type === 'gutter') {
    return {
      width: numberField(n.length, 1),
      depth: numberField(n.size, 0.13),
      rotation: numberField(n.rotation, 0),
    }
  }

  const width = numberField(n.width, numberField(n.diameter, 1))
  const depth = numberField(n.depth, width)
  return {
    width,
    depth,
    rotation: numberField(n.rotation, 0),
  }
}

function cachedGeometryFootprintForNode(
  node: Record<string, unknown>,
  segment: RoofSegmentNode | undefined,
): Pick<RoofSurfaceGuideFootprint, 'width' | 'depth'> | null {
  const key = geometryFootprintCacheKey(node, segment)
  if (roofSurfaceFootprintCache.has(key)) {
    const cached = roofSurfaceFootprintCache.get(key)
    return cached ? { ...cached } : null
  }

  const footprint = geometryFootprintForNode(node, segment)
  roofSurfaceFootprintCache.set(key, footprint ? { ...footprint } : null)
  if (roofSurfaceFootprintCache.size > ROOF_SURFACE_FOOTPRINT_CACHE_MAX) {
    const oldestKey = roofSurfaceFootprintCache.keys().next().value
    if (oldestKey) roofSurfaceFootprintCache.delete(oldestKey)
  }
  return footprint
}

function geometryFootprintCacheKey(
  node: Record<string, unknown>,
  segment: RoofSegmentNode | undefined,
): string {
  const type = typeof node.type === 'string' ? node.type : 'unknown'
  const segmentKey = type === 'chimney' && segment ? `|segment:${stableCacheKey(segment)}` : ''
  return `${type}|node:${stableCacheKey(node)}${segmentKey}`
}

function stableCacheKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableCacheKey(item)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => typeof entryValue !== 'function' && entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableCacheKey(entryValue)}`).join(',')}}`
}

function geometryFootprintForNode(
  node: Record<string, unknown>,
  segment: RoofSegmentNode | undefined,
): Pick<RoofSurfaceGuideFootprint, 'width' | 'depth'> | null {
  const bounds = new THREE.Box3()
  const geometries: THREE.BufferGeometry[] = []
  const add = (geometry: THREE.BufferGeometry | null | undefined) => {
    if (geometry) geometries.push(geometry)
  }

  try {
    switch (node.type) {
      case 'box-vent':
        add(buildBoxVentGeometry(node as Parameters<typeof buildBoxVentGeometry>[0]))
        break
      case 'turbine-vent':
        add(buildTurbineVentGeometry(node as Parameters<typeof buildTurbineVentGeometry>[0]))
        break
      case 'eyebrow-vent':
        add(buildEyebrowVentGeometry(node as Parameters<typeof buildEyebrowVentGeometry>[0]))
        break
      case 'solar-panel':
        add(buildSolarPanelGeometry(node as Parameters<typeof buildSolarPanelGeometry>[0]))
        break
      case 'skylight':
        add(
          buildFrameGeometry({
            curb: node.curb as never,
            curbHeight: node.curbHeight as never,
            frameDepth: node.frameDepth as never,
            frameThickness: node.frameThickness as never,
            height: node.height as never,
            width: node.width as never,
          }),
        )
        add(buildSkylightGlassBounds(node))
        break
      case 'cupola':
        add(buildCupolaGeometry(node as Parameters<typeof buildCupolaGeometry>[0]))
        break
      case 'chimney':
        if (segment) {
          const geo = buildChimneyGeometry(
            node as Parameters<typeof buildChimneyGeometry>[0],
            segment,
          )
          add(geo.body)
          add(geo.cap)
          add(geo.flues)
          add(geo.cricket)
          add(geo.bands)
        }
        break
      case 'ridge-vent':
        add(buildRidgeVentGeometry(node as Parameters<typeof buildRidgeVentGeometry>[0]))
        break
      case 'gutter':
        add(buildGutterGeometry(node as Parameters<typeof buildGutterGeometry>[0]))
        break
      case 'dormer':
        add(buildDormerGhostGeometry(node as Parameters<typeof buildDormerGhostGeometry>[0]))
        break
    }

    if (geometries.length === 0) return null
    bounds.makeEmpty()
    for (const geometry of geometries) {
      geometry.computeBoundingBox()
      if (geometry.boundingBox) bounds.union(geometry.boundingBox)
    }
    if (bounds.isEmpty()) return null
    if (
      !Number.isFinite(bounds.min.x) ||
      !Number.isFinite(bounds.max.x) ||
      !Number.isFinite(bounds.min.z) ||
      !Number.isFinite(bounds.max.z)
    ) {
      return null
    }
    return {
      width: Math.max(0, bounds.max.x - bounds.min.x),
      depth: Math.max(0, bounds.max.z - bounds.min.z),
    }
  } catch {
    return null
  } finally {
    for (const geometry of geometries) geometry.dispose()
  }
}

function buildSkylightGlassBounds(node: Record<string, unknown>): THREE.BufferGeometry {
  const width = numberField(node.width, 1)
  const height = numberField(node.height, 1)
  const glassThickness = numberField(node.glassThickness, 0.01)
  const curbHeight = node.curb ? Math.max(0, numberField(node.curbHeight, 0.1)) : 0
  const geometry = new THREE.BoxGeometry(width, glassThickness, height)
  geometry.translate(0, curbHeight + glassThickness / 2, 0)
  return geometry
}

export function publishRoofSurfacePlacementGuides(args: {
  roof: RoofNode
  segment: RoofSegmentNode
  center: readonly [number, number, number]
  footprint: RoofSurfaceGuideFootprint
  mode?: RoofSurfaceGuideMode
  movingId?: string
}): void {
  const { segment, center, footprint, mode = 'side-center', movingId } = args
  const segObj = sceneRegistry.nodes.get(segment.id as AnyNodeId)
  if (!segObj) return

  const bounds = roofGuideBounds(center, footprint)
  const halfW = Math.max(0, footprint.width) / 2
  const cos = Math.cos(footprint.rotation ?? 0)
  const sin = Math.sin(footprint.rotation ?? 0)

  const faceBounds = getRoofSurfaceFaceBoundsAt(segment, center[0], center[2])
  const faceKey = roofFaceKey(faceBounds.polygon)

  const toBuilding = (x: number, z: number): [number, number, number] => {
    const y = faceBounds.surfaceYAt(x, z) + 0.035
    tmp.set(x, y, z)
    segObj.localToWorld(tmp)
    const buildingId = useViewer.getState().selection.buildingId
    const buildingObj = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
    if (buildingObj) buildingObj.worldToLocal(tmp)
    return [tmp.x, tmp.y, tmp.z]
  }

  const dimension = (
    id: string,
    from: [number, number],
    to: [number, number],
  ): OpeningGuide3D | null => {
    const from3 = toBuilding(from[0], from[1])
    const to3 = toBuilding(to[0], to[1])
    const value = tmpA.set(...from3).distanceTo(tmpB.set(...to3))
    if (value <= MIN_DIMENSION_M) return null
    return {
      kind: 'dimension',
      id,
      from: from3,
      to: to3,
      value,
    }
  }
  const alignLine = (
    id: string,
    from: [number, number],
    to: [number, number],
  ): OpeningGuide3D | null => {
    const from3 = toBuilding(from[0], from[1])
    const to3 = toBuilding(to[0], to[1])
    const value = tmpA.set(...from3).distanceTo(tmpB.set(...to3))
    if (value <= MIN_DIMENSION_M) return null
    return {
      kind: 'align-line',
      id,
      from: from3,
      to: to3,
    }
  }
  const measure = (from: [number, number], to: [number, number]): number => {
    const from3 = toBuilding(from[0], from[1])
    const to3 = toBuilding(to[0], to[1])
    return tmpA.set(...from3).distanceTo(tmpB.set(...to3))
  }
  const badge = (id: string, at: [number, number], value: number): OpeningGuide3D | null => {
    if (value <= MIN_DIMENSION_M) return null
    return {
      kind: 'badge',
      id,
      at: toBuilding(at[0], at[1]),
      value,
    }
  }

  const guides: OpeningGuide3D[] = []
  const siblingSpacing =
    mode === 'linear-edge'
      ? null
      : roofSiblingSpacing({
          segment,
          movingId,
          movingBounds: bounds,
          faceKey,
          dimension,
          alignLine,
          badge,
          measure,
        })

  if (mode === 'linear-edge') {
    const useX = Math.abs(cos) >= Math.abs(sin)
    if (useX) {
      const interval = faceBounds.xIntervalAtZ(center[2])
      if (interval) {
        const [faceMinX, faceMaxX] = interval
        const startX = clamp(bounds.centerX - halfW, faceMinX, faceMaxX)
        const endX = clamp(bounds.centerX + halfW, faceMinX, faceMaxX)
        const left = dimension('roof-gap:left', [faceMinX, center[2]], [startX, center[2]])
        const right = dimension('roof-gap:right', [endX, center[2]], [faceMaxX, center[2]])
        if (left) guides.push(left)
        if (right) guides.push(right)
      }
    } else {
      const interval = faceBounds.zIntervalAtX(center[0])
      if (interval) {
        const [faceMinZ, faceMaxZ] = interval
        const startZ = clamp(bounds.centerZ - halfW, faceMinZ, faceMaxZ)
        const endZ = clamp(bounds.centerZ + halfW, faceMinZ, faceMaxZ)
        const bottom = dimension('roof-gap:bottom', [center[0], faceMinZ], [center[0], startZ])
        const top = dimension('roof-gap:top', [center[0], endZ], [center[0], faceMaxZ])
        if (bottom) guides.push(bottom)
        if (top) guides.push(top)
      }
    }
  } else {
    const xInterval = faceBounds.xIntervalAtZ(center[2])
    const zInterval = faceBounds.zIntervalAtX(center[0])
    if (xInterval) {
      const [faceMinX, faceMaxX] = xInterval
      const itemMinX = clamp(bounds.minX, faceMinX, faceMaxX)
      const itemMaxX = clamp(bounds.maxX, faceMinX, faceMaxX)
      if (!siblingSpacing?.blockedSides.left) {
        const left = dimension('roof-gap:left', [faceMinX, center[2]], [itemMinX, center[2]])
        if (left) guides.push(left)
      }
      if (!siblingSpacing?.blockedSides.right) {
        const right = dimension('roof-gap:right', [itemMaxX, center[2]], [faceMaxX, center[2]])
        if (right) guides.push(right)
      }
    }
    if (zInterval) {
      const [faceMinZ, faceMaxZ] = zInterval
      const itemMinZ = clamp(bounds.minZ, faceMinZ, faceMaxZ)
      const itemMaxZ = clamp(bounds.maxZ, faceMinZ, faceMaxZ)
      if (!siblingSpacing?.blockedSides.bottom) {
        const bottom = dimension('roof-gap:bottom', [center[0], faceMinZ], [center[0], itemMinZ])
        if (bottom) guides.push(bottom)
      }
      if (!siblingSpacing?.blockedSides.top) {
        const top = dimension('roof-gap:top', [center[0], itemMaxZ], [center[0], faceMaxZ])
        if (top) guides.push(top)
      }
    }
  }

  if (siblingSpacing) guides.push(...siblingSpacing.guides)

  useOpeningGuides.getState().set(guides)
}

export function publishRoofSurfaceNodePlacementGuides(args: {
  roof: RoofNode
  segment: RoofSegmentNode
  center: readonly [number, number, number]
  node: unknown
  mode?: RoofSurfaceGuideMode
  movingId?: string
}): void {
  const movingId =
    args.movingId ??
    ((args.node as { id?: unknown }).id && typeof (args.node as { id?: unknown }).id === 'string'
      ? (args.node as { id: string }).id
      : undefined)

  publishRoofSurfacePlacementGuides({
    roof: args.roof,
    segment: args.segment,
    center: args.center,
    footprint: roofSurfaceFootprintFromNode(args.node, { segment: args.segment }),
    mode: args.mode,
    movingId,
  })
}

export function snapRoofSurfaceNodeTarget(args: {
  target: RelativeRoofDragTarget
  node: unknown
  movingId?: string
  bypass?: boolean
}): RelativeRoofDragTarget {
  if (args.bypass) return args.target

  const movingId =
    args.movingId ??
    ((args.node as { id?: unknown }).id && typeof (args.node as { id?: unknown }).id === 'string'
      ? (args.node as { id: string }).id
      : undefined)
  const movingBounds = roofGuideBounds(
    [args.target.localX, args.target.localY, args.target.localZ],
    roofSurfaceFootprintFromNode(args.node, { segment: args.target.segment }),
  )
  const faceKey = roofFaceKey(
    getRoofSurfaceFaceBoundsAt(args.target.segment, args.target.localX, args.target.localZ).polygon,
  )
  const snap = roofAlignmentSnap({
    segment: args.target.segment,
    movingId,
    movingBounds,
    faceKey,
  })
  if (!snap) return args.target

  const localX = args.target.localX + (snap.dx ?? 0)
  const localZ = args.target.localZ + (snap.dz ?? 0)
  const surfaceOffsetY =
    args.target.localY - getSurfaceY(args.target.localX, args.target.localZ, args.target.segment)
  const localY = getSurfaceY(localX, localZ, args.target.segment) + surfaceOffsetY
  return {
    ...args.target,
    localX,
    localY,
    localZ,
  }
}

export function clearRoofSurfacePlacementGuides(): void {
  useOpeningGuides.getState().clear()
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function roofGuideBounds(
  center: readonly [number, number, number],
  footprint: RoofSurfaceGuideFootprint,
): RoofGuideBounds {
  const halfW = Math.max(0, footprint.width) / 2
  const halfD = Math.max(0, footprint.depth) / 2
  const rot = footprint.rotation ?? 0
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const halfX = Math.abs(cos) * halfW + Math.abs(sin) * halfD
  const halfZ = Math.abs(sin) * halfW + Math.abs(cos) * halfD
  return {
    centerX: center[0],
    centerZ: center[2],
    minX: center[0] - halfX,
    maxX: center[0] + halfX,
    minZ: center[2] - halfZ,
    maxZ: center[2] + halfZ,
  }
}

export function roofSiblingSpacingGuides<T>(args: {
  segment: RoofSegmentNode
  movingId?: string
  movingBounds: RoofGuideBounds
  faceKey: string
  dimension: (id: string, from: [number, number], to: [number, number]) => T | null
}): T[] {
  return roofSiblingSpacing(args).guides
}

export function roofSiblingSpacing<T>(args: {
  segment: RoofSegmentNode
  movingId?: string
  movingBounds: RoofGuideBounds
  faceKey: string
  dimension: (id: string, from: [number, number], to: [number, number]) => T | null
  alignLine?: (id: string, from: [number, number], to: [number, number]) => T | null
  badge?: (id: string, at: [number, number], value: number) => T | null
  measure?: (from: [number, number], to: [number, number]) => number
}): RoofSiblingSpacingResult<T> {
  const out: T[] = []
  const nodes = useScene.getState().nodes
  let left: { bounds: RoofGuideBounds; gap: number } | null = null
  let right: { bounds: RoofGuideBounds; gap: number } | null = null
  let bottom: { bounds: RoofGuideBounds; gap: number } | null = null
  let top: { bounds: RoofGuideBounds; gap: number } | null = null
  let xAlign: RoofAlignmentCandidate | null = null
  let zAlign: RoofAlignmentCandidate | null = null
  const xLane: RoofGuideBounds[] = []
  const zLane: RoofGuideBounds[] = []

  for (const childId of args.segment.children ?? []) {
    if (childId === args.movingId) continue
    const sibling = nodes[childId as AnyNodeId]
    if (!isRoofGuideSibling(sibling)) continue
    const position = sibling.position
    if (!Array.isArray(position)) continue
    const siblingFace = getRoofSurfaceFaceBoundsAt(args.segment, position[0] ?? 0, position[2] ?? 0)
    if (roofFaceKey(siblingFace.polygon) !== args.faceKey) continue

    const footprint = roofSurfaceFootprintFromNode(sibling, { segment: args.segment })
    const bounds = roofGuideBounds(position as [number, number, number], footprint)
    xAlign = nearerAlignment(xAlign, detectRoofAlignment(args.movingBounds, bounds, 'x'))
    zAlign = nearerAlignment(zAlign, detectRoofAlignment(args.movingBounds, bounds, 'z'))

    if (sameGuideLane(args.movingBounds, bounds, 'x')) {
      xLane.push(bounds)
      const gapToLeft = args.movingBounds.minX - bounds.maxX
      if (gapToLeft > MIN_DIMENSION_M && (!left || gapToLeft < left.gap)) {
        left = { bounds, gap: gapToLeft }
      }
      const gapToRight = bounds.minX - args.movingBounds.maxX
      if (gapToRight > MIN_DIMENSION_M && (!right || gapToRight < right.gap)) {
        right = { bounds, gap: gapToRight }
      }
    }

    if (sameGuideLane(args.movingBounds, bounds, 'z')) {
      zLane.push(bounds)
      const gapToBottom = args.movingBounds.minZ - bounds.maxZ
      if (gapToBottom > MIN_DIMENSION_M && (!bottom || gapToBottom < bottom.gap)) {
        bottom = { bounds, gap: gapToBottom }
      }
      const gapToTop = bounds.minZ - args.movingBounds.maxZ
      if (gapToTop > MIN_DIMENSION_M && (!top || gapToTop < top.gap)) {
        top = { bounds, gap: gapToTop }
      }
    }
  }

  if (left) {
    const guide = args.dimension(
      'roof-sibling:left',
      [left.bounds.maxX, args.movingBounds.centerZ],
      [args.movingBounds.minX, args.movingBounds.centerZ],
    )
    if (guide) out.push(guide)
  }
  if (right) {
    const guide = args.dimension(
      'roof-sibling:right',
      [args.movingBounds.maxX, args.movingBounds.centerZ],
      [right.bounds.minX, args.movingBounds.centerZ],
    )
    if (guide) out.push(guide)
  }
  if (bottom) {
    const guide = args.dimension(
      'roof-sibling:bottom',
      [args.movingBounds.centerX, bottom.bounds.maxZ],
      [args.movingBounds.centerX, args.movingBounds.minZ],
    )
    if (guide) out.push(guide)
  }
  if (top) {
    const guide = args.dimension(
      'roof-sibling:top',
      [args.movingBounds.centerX, args.movingBounds.maxZ],
      [args.movingBounds.centerX, top.bounds.minZ],
    )
    if (guide) out.push(guide)
  }
  if (args.alignLine) {
    if (xAlign) {
      const guide = args.alignLine('roof-align:x', xAlign.from, xAlign.to)
      if (guide) out.push(guide)
    }
    if (zAlign) {
      const guide = args.alignLine('roof-align:z', zAlign.from, zAlign.to)
      if (guide) out.push(guide)
    }
  }
  if (args.badge) {
    pushRoofEqualSpacingBadges({
      axis: 'x',
      movingBounds: args.movingBounds,
      siblings: xLane,
      badge: args.badge,
      measure: args.measure,
      out,
    })
    pushRoofEqualSpacingBadges({
      axis: 'z',
      movingBounds: args.movingBounds,
      siblings: zLane,
      badge: args.badge,
      measure: args.measure,
      out,
    })
  }

  return {
    guides: out,
    blockedSides: {
      left: !!left,
      right: !!right,
      bottom: !!bottom,
      top: !!top,
    },
  }
}

function pushRoofEqualSpacingBadges<T>(args: {
  axis: 'x' | 'z'
  movingBounds: RoofGuideBounds
  siblings: RoofGuideBounds[]
  badge: (id: string, at: [number, number], value: number) => T | null
  measure?: (from: [number, number], to: [number, number]) => number
  out: T[]
}): void {
  if (args.siblings.length < 2) return
  const items: RoofEqualSpacingItem[] = [
    { bounds: args.movingBounds, moving: true },
    ...args.siblings.map((bounds) => ({ bounds, moving: false })),
  ].sort((a, b) =>
    args.axis === 'x' ? a.bounds.centerX - b.bounds.centerX : a.bounds.centerZ - b.bounds.centerZ,
  )
  const movingIndex = items.findIndex((item) => item.moving)
  if (movingIndex < 0) return

  const gaps: RoofEqualSpacingGap[] = []
  for (let i = 0; i < items.length - 1; i++) {
    const a = items[i]
    const b = items[i + 1]
    if (!a || !b) continue
    const from: [number, number] =
      args.axis === 'x'
        ? [a.bounds.maxX, args.movingBounds.centerZ]
        : [args.movingBounds.centerX, a.bounds.maxZ]
    const to: [number, number] =
      args.axis === 'x'
        ? [b.bounds.minX, args.movingBounds.centerZ]
        : [args.movingBounds.centerX, b.bounds.minZ]
    const value = args.measure?.(from, to) ?? Math.hypot(to[0] - from[0], to[1] - from[1])
    gaps.push({ value, from, to })
  }

  let best: { value: number; gaps: RoofEqualSpacingGap[] } | null = null
  for (let lo = 0; lo < gaps.length; lo++) {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (let hi = lo; hi < gaps.length; hi++) {
      const gap = gaps[hi]
      if (!gap || gap.value < MIN_DIMENSION_M) break
      min = Math.min(min, gap.value)
      max = Math.max(max, gap.value)
      if (max - min > EQUAL_SPACING_THRESHOLD_M) break

      const gapCount = hi - lo + 1
      if (gapCount < 2) continue
      const firstItem = lo
      const lastItem = hi + 1
      if (movingIndex < firstItem || movingIndex > lastItem) continue
      if (best !== null && gapCount <= best.gaps.length) continue

      const run = gaps.slice(lo, hi + 1)
      best = {
        value: run.reduce((sum, g) => sum + g.value, 0) / run.length,
        gaps: run,
      }
    }
  }

  best?.gaps.forEach((gap, index) => {
    const guide = args.badge(
      `roof-spacing:${args.axis}:${index}`,
      mid2(gap.from, gap.to),
      best.value,
    )
    if (guide) args.out.push(guide)
  })
}

function mid2(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

function sameGuideLane(a: RoofGuideBounds, b: RoofGuideBounds, axis: 'x' | 'z'): boolean {
  if (axis === 'x') {
    return valueWithinRange(a.centerZ, b.minZ, b.maxZ)
  }
  return valueWithinRange(a.centerX, b.minX, b.maxX)
}

function valueWithinRange(value: number, min: number, max: number): boolean {
  return value >= min - ALIGNMENT_THRESHOLD_M && value <= max + ALIGNMENT_THRESHOLD_M
}

function roofAlignmentSnap(args: {
  segment: RoofSegmentNode
  movingId?: string
  movingBounds: RoofGuideBounds
  faceKey: string
}): { dx?: number; dz?: number } | null {
  const nodes = useScene.getState().nodes
  let bestX: { delta: number; gap: number } | null = null
  let bestZ: { delta: number; gap: number } | null = null

  for (const childId of args.segment.children ?? []) {
    if (childId === args.movingId) continue
    const sibling = nodes[childId as AnyNodeId]
    if (!isRoofGuideSibling(sibling)) continue
    const position = sibling.position
    if (!Array.isArray(position)) continue
    const siblingFace = getRoofSurfaceFaceBoundsAt(args.segment, position[0] ?? 0, position[2] ?? 0)
    if (roofFaceKey(siblingFace.polygon) !== args.faceKey) continue

    const footprint = roofSurfaceFootprintFromNode(sibling, { segment: args.segment })
    const siblingBounds = roofGuideBounds(position as [number, number, number], footprint)
    bestX = nearerSnap(bestX, detectRoofAlignmentSnap(args.movingBounds, siblingBounds, 'x'))
    bestZ = nearerSnap(bestZ, detectRoofAlignmentSnap(args.movingBounds, siblingBounds, 'z'))
  }

  if (!bestX && !bestZ) return null
  return {
    dx: bestX?.delta,
    dz: bestZ?.delta,
  }
}

function detectRoofAlignmentSnap(
  moving: RoofGuideBounds,
  sibling: RoofGuideBounds,
  axis: 'x' | 'z',
): { delta: number; gap: number } | null {
  let best: { delta: number; gap: number } | null = null
  for (const movingFeature of ROOF_ALIGNMENT_FEATURES) {
    const movingCoord = roofFeatureCoord(moving, axis, movingFeature)
    for (const siblingFeature of ROOF_ALIGNMENT_FEATURES) {
      const siblingCoord = roofFeatureCoord(sibling, axis, siblingFeature)
      const delta = siblingCoord - movingCoord
      const gap = Math.abs(delta)
      if (gap <= ALIGNMENT_THRESHOLD_M && (!best || gap < best.gap)) {
        best = { delta, gap }
      }
    }
  }
  return best
}

function nearerSnap(
  current: { delta: number; gap: number } | null,
  candidate: { delta: number; gap: number } | null,
): { delta: number; gap: number } | null {
  if (!candidate) return current
  if (!current || candidate.gap < current.gap) return candidate
  return current
}

function detectRoofAlignment(
  moving: RoofGuideBounds,
  sibling: RoofGuideBounds,
  axis: 'x' | 'z',
): RoofAlignmentCandidate | null {
  let best: RoofAlignmentCandidate | null = null
  for (const movingFeature of ROOF_ALIGNMENT_FEATURES) {
    const movingCoord = roofFeatureCoord(moving, axis, movingFeature)
    for (const siblingFeature of ROOF_ALIGNMENT_FEATURES) {
      const siblingCoord = roofFeatureCoord(sibling, axis, siblingFeature)
      const gap = Math.abs(siblingCoord - movingCoord)
      if (gap > ALIGNMENT_THRESHOLD_M || (best && gap >= best.gap)) continue
      const coord = siblingCoord
      if (axis === 'x') {
        best = {
          axis,
          coord,
          gap,
          from: [coord, Math.min(moving.minZ, sibling.minZ)],
          to: [coord, Math.max(moving.maxZ, sibling.maxZ)],
        }
      } else {
        best = {
          axis,
          coord,
          gap,
          from: [Math.min(moving.minX, sibling.minX), coord],
          to: [Math.max(moving.maxX, sibling.maxX), coord],
        }
      }
    }
  }
  return best
}

const ROOF_ALIGNMENT_FEATURES: RoofAlignmentFeature[] = ['center', 'min', 'max']

function roofFeatureCoord(
  bounds: RoofGuideBounds,
  axis: 'x' | 'z',
  feature: RoofAlignmentFeature,
): number {
  if (axis === 'x') {
    if (feature === 'min') return bounds.minX
    if (feature === 'max') return bounds.maxX
    return bounds.centerX
  }
  if (feature === 'min') return bounds.minZ
  if (feature === 'max') return bounds.maxZ
  return bounds.centerZ
}

function nearerAlignment(
  current: RoofAlignmentCandidate | null,
  candidate: RoofAlignmentCandidate | null,
): RoofAlignmentCandidate | null {
  if (!candidate) return current
  if (!current || candidate.gap < current.gap) return candidate
  return current
}

function isRoofGuideSibling(node: AnyNode | undefined): node is AnyNode & {
  position: readonly [number, number, number]
} {
  if (!node || !Array.isArray((node as { position?: unknown }).position)) return false
  switch (node.type) {
    case 'box-vent':
    case 'turbine-vent':
    case 'eyebrow-vent':
    case 'solar-panel':
    case 'skylight':
    case 'cupola':
    case 'chimney':
    case 'ridge-vent':
    case 'gutter':
    case 'dormer':
      return true
    default:
      return false
  }
}

export function roofFaceKey(polygon: readonly (readonly [number, number])[]): string {
  return polygon.map(([x, z]) => `${roundKey(x)}:${roundKey(z)}`).join('|')
}

function roundKey(value: number): string {
  return value.toFixed(4)
}

function numberField(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
