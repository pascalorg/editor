'use client'

import {
  getWallCurveFrameAt,
  getWallThickness,
  isCurvedWall,
  type SceneMaterial,
  type SceneMaterialId,
  WALL_CHAIR_RAIL_DEFAULT,
  WALL_CROWN_DEFAULT,
  WALL_SKIRTING_DEFAULT,
  WALL_SURFACE_SLOT_DEFAULTS,
  type WallNode,
  type WallSurfaceSlotId,
  type WallTrimConfig,
  type WallTrimProfile,
} from '@pascal-app/core'
import {
  baseMaterial,
  createMaterialFromPresetRef,
  type RenderShading,
  resolveMaterialRef,
} from '@pascal-app/viewer'
import { memo, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries as mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const CURVE_SEGMENTS = 24
const MIN_SLICE_PROUD = 0.0005
const EPS = 1e-6

const TRIM_PROFILE_SAMPLES: Record<
  WallTrimProfile,
  { samples: number; fn: (t: number) => number }
> = {
  flat: { samples: 1, fn: () => 1 },
  bevel: {
    samples: 6,
    fn: (t) => (t < 0.65 ? 1 : 1 - ((t - 0.65) / 0.35) * 0.6),
  },
  triangle: {
    samples: 8,
    fn: (t) => Math.max(0, 1 - t),
  },
  cove: {
    samples: 10,
    fn: (t) => Math.sqrt(Math.max(0, 1 - t * t)),
  },
  bullnose: {
    samples: 12,
    fn: (t) => Math.sqrt(Math.max(0, 1 - (2 * t - 1) * (2 * t - 1))),
  },
}

type OpeningLike = {
  type: string
  width?: number
  height?: number
  position?: [number, number, number]
}

type TrimKind = 'skirting' | 'crown' | 'chairRail'
type WallSide = 'interior' | 'exterior'
type SceneMaterials = Record<SceneMaterialId, SceneMaterial>
type Point2 = { x: number; z: number }
type WallTreatmentSlotId =
  | 'skirtingInterior'
  | 'skirtingExterior'
  | 'crownInterior'
  | 'crownExterior'
  | 'chairRailInterior'
  | 'chairRailExterior'

const TRIM_KIND_CONFIG: Record<
  TrimKind,
  {
    defaultConfig: WallTrimConfig
    slots: Record<WallSide, WallTreatmentSlotId>
    flipProfile: boolean
  }
> = {
  skirting: {
    defaultConfig: WALL_SKIRTING_DEFAULT,
    slots: { interior: 'skirtingInterior', exterior: 'skirtingExterior' },
    flipProfile: false,
  },
  crown: {
    defaultConfig: WALL_CROWN_DEFAULT,
    slots: { interior: 'crownInterior', exterior: 'crownExterior' },
    flipProfile: true,
  },
  chairRail: {
    defaultConfig: WALL_CHAIR_RAIL_DEFAULT,
    slots: { interior: 'chairRailInterior', exterior: 'chairRailExterior' },
    flipProfile: false,
  },
}

function resolveTreatmentSideSign(node: WallNode, side: WallSide) {
  if (side === 'interior') {
    if (node.frontSide === 'interior') return 1
    if (node.backSide === 'interior') return -1
    return 1
  }
  if (node.frontSide === 'exterior') return 1
  if (node.backSide === 'exterior') return -1
  return -1
}

function wallToLocalTransform(node: WallNode) {
  const dx = node.end[0] - node.start[0]
  const dz = node.end[1] - node.start[1]
  const angle = Math.atan2(dz, dx)
  const cosA = Math.cos(-angle)
  const sinA = Math.sin(-angle)
  return (worldX: number, worldZ: number): Point2 => {
    const px = worldX - node.start[0]
    const pz = worldZ - node.start[1]
    return {
      x: px * cosA - pz * sinA,
      z: px * sinA + pz * cosA,
    }
  }
}

function buildSidePolyline(node: WallNode, side: WallSide, offset: number): Point2[] {
  const sideSign = resolveTreatmentSideSign(node, side)
  const toLocal = wallToLocalTransform(node)
  const sampleCount = isCurvedWall(node) ? CURVE_SEGMENTS : 1
  const points: Point2[] = []

  for (let index = 0; index <= sampleCount; index += 1) {
    const frame = getWallCurveFrameAt(node, index / sampleCount)
    const worldX = frame.point.x + frame.normal.x * offset * sideSign
    const worldZ = frame.point.y + frame.normal.y * offset * sideSign
    points.push(toLocal(worldX, worldZ))
  }

  return points
}

function clipPolyline(points: Point2[], x0: number, x1: number): Point2[] {
  if (points.length < 2 || x1 - x0 <= EPS) return []
  const out: Point2[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]
    const b = points[index + 1]
    if (!(a && b)) continue
    const minX = Math.min(a.x, b.x)
    const maxX = Math.max(a.x, b.x)
    if (maxX < x0 - EPS || minX > x1 + EPS) continue

    const pushPointAt = (x: number) => {
      if (Math.abs(b.x - a.x) <= EPS) {
        return { x, z: a.z }
      }
      const t = (x - a.x) / (b.x - a.x)
      return {
        x,
        z: a.z + (b.z - a.z) * t,
      }
    }

    const start = minX < x0 ? pushPointAt(x0) : a
    const end = maxX > x1 ? pushPointAt(x1) : b
    if (
      out.length === 0 ||
      Math.hypot(out[out.length - 1]!.x - start.x, out[out.length - 1]!.z - start.z) > EPS
    ) {
      out.push(start)
    }
    out.push(end)
  }
  return out
}

function subtractOpeningRanges(ranges: Array<[number, number]>, openings: Array<[number, number]>) {
  let next = ranges.slice()
  for (const [gap0, gap1] of openings) {
    const updated: Array<[number, number]> = []
    for (const [a, b] of next) {
      const start = Math.max(a, gap0)
      const end = Math.min(b, gap1)
      if (end - start <= EPS) {
        updated.push([a, b])
        continue
      }
      if (start - a > EPS) updated.push([a, start])
      if (b - end > EPS) updated.push([end, b])
    }
    next = updated
  }
  return next
}

function trimOpeningRanges(
  node: WallNode,
  childrenNodes: OpeningLike[],
  yBottom: number,
  height: number,
) {
  const yTop = yBottom + height
  return childrenNodes
    .filter((child) => child.type === 'door' || child.type === 'window')
    .flatMap((child) => {
      const width = child.width ?? 0
      const childHeight = child.height ?? 0
      const position = child.position ?? [0, 0, 0]
      const childBottom = position[1] - childHeight / 2
      const childTop = childBottom + childHeight
      if (childTop <= yBottom + EPS || childBottom >= yTop - EPS) return []
      return [[position[0] - width / 2, position[0] + width / 2] as [number, number]]
    })
}

function buildPlanPolygon(outer: Point2[], inner: Point2[]) {
  if (outer.length < 2 || inner.length < 2) return null
  const shape = new THREE.Shape()
  shape.moveTo(outer[0]!.x, -outer[0]!.z)
  for (let index = 1; index < outer.length; index += 1) {
    shape.lineTo(outer[index]!.x, -outer[index]!.z)
  }
  for (let index = inner.length - 1; index >= 0; index -= 1) {
    shape.lineTo(inner[index]!.x, -inner[index]!.z)
  }
  shape.closePath()
  return shape
}

function buildTrimSliceGeometry(
  outer: Point2[],
  inner: Point2[],
  extrudeHeight: number,
  translateY: number,
) {
  const shape = buildPlanPolygon(outer, inner)
  if (!shape) return null
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: extrudeHeight,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 1,
  })
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, translateY, 0)
  geometry.computeVertexNormals()
  return geometry
}

function mergeGeometries(geometries: THREE.BufferGeometry[]) {
  if (geometries.length === 0) return null
  const merged = mergeBufferGeometries(geometries, false)
  if (merged) return merged
  return null
}

function buildTrimGeometry(
  node: WallNode,
  side: WallSide,
  trim: WallTrimConfig,
  kind: TrimKind,
  childrenNodes: OpeningLike[],
) {
  const wallHeight = node.height ?? 2.5
  const height = trim.height
  const yBottom =
    kind === 'crown'
      ? Math.max(0, wallHeight - height)
      : kind === 'chairRail'
        ? Math.max(
            0,
            Math.min(wallHeight - height, trim.offsetY ?? WALL_CHAIR_RAIL_DEFAULT.offsetY ?? 0.9),
          )
        : 0

  const thickness = getWallThickness(node)
  const inner = buildSidePolyline(node, side, thickness / 2)
  const fullOuter = buildSidePolyline(node, side, thickness / 2 + trim.proud)
  if (inner.length < 2 || fullOuter.length < 2) return null

  const openingRanges = trimOpeningRanges(node, childrenNodes, yBottom, height)
  const fullRanges: Array<[number, number]> = [[inner[0]!.x, inner[inner.length - 1]!.x]]
  const runs = subtractOpeningRanges(fullRanges, openingRanges)
  if (runs.length === 0) return null

  const profile = TRIM_PROFILE_SAMPLES[trim.profile]
  if (!profile) return null
  const slices: THREE.BufferGeometry[] = []
  const sliceHeight = height / profile.samples

  for (const [runStart, runEnd] of runs) {
    const innerRun = clipPolyline(inner, runStart, runEnd)
    if (innerRun.length < 2) continue
    for (let index = 0; index < profile.samples; index += 1) {
      const tRaw = (index + 0.5) / profile.samples
      const t = TRIM_KIND_CONFIG[kind].flipProfile ? 1 - tRaw : tRaw
      const proud = Math.max(MIN_SLICE_PROUD, trim.proud * profile.fn(t))
      const outerRun = buildSidePolyline(node, side, thickness / 2 + proud)
      const outerClipped = clipPolyline(outerRun, runStart, runEnd)
      if (outerClipped.length < 2) continue
      const slice = buildTrimSliceGeometry(
        outerClipped,
        innerRun,
        sliceHeight,
        yBottom + index * sliceHeight,
      )
      if (slice) slices.push(slice)
    }
  }

  if (slices.length === 0) return null
  const merged = mergeGeometries(slices)
  for (const slice of slices) slice.dispose()
  return merged
}

function resolveWallSlotMaterial(
  node: WallNode,
  slotId: WallSurfaceSlotId,
  shading: RenderShading,
  sceneMaterials: SceneMaterials,
) {
  const ref = node.slots?.[slotId]
  if (ref) {
    return resolveMaterialRef(ref, sceneMaterials, shading) ?? baseMaterial(shading)
  }
  return (
    createMaterialFromPresetRef(WALL_SURFACE_SLOT_DEFAULTS[slotId], shading) ??
    baseMaterial(shading)
  )
}

export function createWallExtraSlotMaterials(
  node: WallNode,
  shading: RenderShading,
  textures: boolean,
  sceneMaterials: SceneMaterials,
  interiorFallback: THREE.Material,
  exteriorFallback: THREE.Material,
) {
  if (!textures) {
    return {
      skirtingInterior: interiorFallback,
      skirtingExterior: exteriorFallback,
      crownInterior: interiorFallback,
      crownExterior: exteriorFallback,
      chairRailInterior: interiorFallback,
      chairRailExterior: exteriorFallback,
    } satisfies Record<WallTreatmentSlotId, THREE.Material>
  }

  return {
    skirtingInterior: resolveWallSlotMaterial(node, 'skirtingInterior', shading, sceneMaterials),
    skirtingExterior: resolveWallSlotMaterial(node, 'skirtingExterior', shading, sceneMaterials),
    crownInterior: resolveWallSlotMaterial(node, 'crownInterior', shading, sceneMaterials),
    crownExterior: resolveWallSlotMaterial(node, 'crownExterior', shading, sceneMaterials),
    chairRailInterior: resolveWallSlotMaterial(node, 'chairRailInterior', shading, sceneMaterials),
    chairRailExterior: resolveWallSlotMaterial(node, 'chairRailExterior', shading, sceneMaterials),
  } satisfies Record<WallTreatmentSlotId, THREE.Material>
}

export const WallTreatments = memo(function WallTreatments({
  node,
  childrenNodes,
  materials,
}: {
  node: WallNode
  childrenNodes: OpeningLike[]
  materials: Record<WallTreatmentSlotId, THREE.Material>
}) {
  const fallbackMaterial =
    materials.skirtingInterior ??
    materials.skirtingExterior ??
    materials.crownInterior ??
    materials.crownExterior ??
    materials.chairRailInterior ??
    materials.chairRailExterior

  const trimEntries = useMemo(() => {
    const out: Array<{
      key: string
      slotId: WallTreatmentSlotId
      geometry: THREE.BufferGeometry
      material: THREE.Material
    }> = []

    const configs: Array<[TrimKind, WallTrimConfig | undefined]> = [
      ['skirting', node.skirting],
      ['crown', node.crown],
      ['chairRail', node.chairRail],
    ]

    for (const [kind, rawConfig] of configs) {
      const trim = { ...TRIM_KIND_CONFIG[kind].defaultConfig, ...(rawConfig ?? {}) }
      if (!trim.enabled) continue
      const sides =
        trim.sides === 'both'
          ? (['interior', 'exterior'] as WallSide[])
          : ([trim.sides] as WallSide[])
      for (const side of sides) {
        const geometry = buildTrimGeometry(node, side, trim, kind, childrenNodes)
        if (!geometry) continue
        const slotId = TRIM_KIND_CONFIG[kind].slots[side]
        out.push({
          key: `${kind}-${side}`,
          slotId,
          geometry,
          material: materials[slotId] ?? fallbackMaterial,
        })
      }
    }

    return out
  }, [childrenNodes, fallbackMaterial, materials, node])

  useEffect(
    () => () => {
      for (const entry of trimEntries) entry.geometry.dispose()
    },
    [trimEntries],
  )

  return (
    <>
      {trimEntries.map((entry) => (
        <mesh
          castShadow
          geometry={entry.geometry}
          key={entry.key}
          material={entry.material}
          receiveShadow
          userData={{ slotId: entry.slotId }}
        />
      ))}
    </>
  )
})
