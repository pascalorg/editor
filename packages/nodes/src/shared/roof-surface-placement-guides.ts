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
import { getRoofSurfaceFaceBoundsAt } from './roof-surface'

const MIN_DIMENSION_M = 0.02
const ALIGNMENT_THRESHOLD_M = 0.08

const tmp = new THREE.Vector3()
const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()

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

export function roofSurfaceFootprintFromNode(
  node: unknown,
  options?: { segment?: RoofSegmentNode },
): RoofSurfaceGuideFootprint {
  const n = node as Record<string, unknown>
  const geometryBounds = geometryFootprintForNode(n, options?.segment)
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
}): RoofSiblingSpacingResult<T> {
  const out: T[] = []
  const nodes = useScene.getState().nodes
  let left: { bounds: RoofGuideBounds; gap: number } | null = null
  let right: { bounds: RoofGuideBounds; gap: number } | null = null
  let bottom: { bounds: RoofGuideBounds; gap: number } | null = null
  let top: { bounds: RoofGuideBounds; gap: number } | null = null

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

    if (sameGuideLane(args.movingBounds, bounds, 'x')) {
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

function sameGuideLane(a: RoofGuideBounds, b: RoofGuideBounds, axis: 'x' | 'z'): boolean {
  if (axis === 'x') {
    return Math.abs(a.centerZ - b.centerZ) <= ALIGNMENT_THRESHOLD_M
  }
  return Math.abs(a.centerX - b.centerX) <= ALIGNMENT_THRESHOLD_M
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
