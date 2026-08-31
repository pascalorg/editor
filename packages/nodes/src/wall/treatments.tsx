'use client'

import {
  getWallCurveFrameAt,
  getWallMiterBoundaryPoints,
  getWallThickness,
  isCurvedWall,
  type SceneMaterial,
  type SceneMaterialId,
  useScene,
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
import { resolveWallOpeningCeiling } from '../shared/wall-opening-ceiling'
import { treatmentMiterDataForProud, type WallTreatmentLevelData } from './treatment-level-data'

const CURVE_SEGMENTS = 24
const MIN_SLICE_PROUD = 0.0005
const EPS = 1e-6

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
type TrimProfileDefinition = {
  samples: number
  proudAt: (t: number) => number
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function eased(value: number) {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

const TRIM_PROFILES: Record<TrimKind, Partial<Record<WallTrimProfile, TrimProfileDefinition>>> = {
  skirting: {
    flat: {
      samples: 8,
      proudAt: (t) => (t < 0.72 ? 0.62 : 0.9),
    },
    bevel: {
      samples: 10,
      proudAt: (t) => 0.48 + 0.42 * eased(t),
    },
    triangle: {
      samples: 10,
      proudAt: (t) => 0.32 + 0.68 * (1 - t),
    },
    cove: {
      samples: 12,
      proudAt: (t) => 0.45 + 0.42 * Math.sin(t * Math.PI * 0.5),
    },
    bullnose: {
      samples: 12,
      proudAt: (t) => 0.35 + 0.65 * Math.sin(Math.PI * t),
    },
    'base-modern': {
      samples: 10,
      proudAt: (t) => {
        if (t < 0.16) return 0.85
        if (t < 0.72) return 0.58
        if (t < 0.9) return 1
        return 0.62
      },
    },
    'base-colonial': {
      samples: 14,
      proudAt: (t) => {
        if (t < 0.16) return 0.82
        if (t < 0.55) return 0.52
        const capT = (t - 0.55) / 0.45
        return 0.58 + 0.4 * Math.sin(capT * Math.PI)
      },
    },
    'base-shoe': {
      samples: 14,
      proudAt: (t) => {
        const quarterRound = Math.sqrt(Math.max(0, 1 - t * t))
        return 0.28 + 0.72 * quarterRound
      },
    },
    'base-ogee': {
      samples: 16,
      proudAt: (t) => {
        const ogee = 0.5 - 0.5 * Math.cos(Math.PI * t)
        const bead = 0.16 * Math.sin(2 * Math.PI * t)
        return clamp01(0.42 + 0.5 * ogee + bead)
      },
    },
  },
  crown: {
    flat: {
      samples: 8,
      proudAt: (t) => (t < 0.2 ? 0.52 : t < 0.82 ? 0.78 : 1),
    },
    bevel: {
      samples: 10,
      proudAt: (t) => 0.45 + 0.55 * eased(t),
    },
    triangle: {
      samples: 10,
      proudAt: (t) => 0.35 + 0.65 * t,
    },
    cove: {
      samples: 14,
      proudAt: (t) => 0.46 + 0.45 * Math.sin(t * Math.PI * 0.5),
    },
    bullnose: {
      samples: 14,
      proudAt: (t) => 0.38 + 0.62 * Math.sin(Math.PI * t * 0.5),
    },
    'crown-cove': {
      samples: 16,
      proudAt: (t) => {
        if (t < 0.12) return 0.48
        if (t > 0.9) return 1
        return 0.46 + 0.48 * Math.sin(((t - 0.12) / 0.78) * Math.PI * 0.5)
      },
    },
    'crown-ogee': {
      samples: 18,
      proudAt: (t) => {
        const sCurve = 0.5 - 0.5 * Math.cos(Math.PI * t)
        const reverse = 0.18 * Math.sin(2 * Math.PI * (t - 0.12))
        return clamp01(0.42 + 0.55 * sCurve + reverse)
      },
    },
    'crown-craftsman': {
      samples: 10,
      proudAt: (t) => {
        if (t < 0.16) return 0.48
        if (t < 0.4) return 0.88
        if (t < 0.78) return 0.64
        return 1
      },
    },
    'crown-layered': {
      samples: 14,
      proudAt: (t) => {
        if (t < 0.12) return 0.46
        if (t < 0.28) return 0.82
        if (t < 0.48) return 0.56
        if (t < 0.72) return 0.9
        return 1
      },
    },
  },
  chairRail: {
    flat: {
      samples: 8,
      proudAt: (t) => (t < 0.18 || t > 0.82 ? 0.58 : 0.95),
    },
    bevel: {
      samples: 10,
      proudAt: (t) => 0.45 + 0.45 * Math.sin(Math.PI * t),
    },
    triangle: {
      samples: 10,
      proudAt: (t) => 0.35 + 0.65 * (1 - Math.abs(2 * t - 1)),
    },
    cove: {
      samples: 12,
      proudAt: (t) => 0.42 + 0.42 * Math.sin(Math.PI * t),
    },
    bullnose: {
      samples: 14,
      proudAt: (t) => 0.34 + 0.66 * Math.sin(Math.PI * t),
    },
    'rail-rounded': {
      samples: 14,
      proudAt: (t) => 0.34 + 0.66 * Math.sin(Math.PI * t),
    },
    'rail-ogee': {
      samples: 16,
      proudAt: (t) => {
        const center = Math.sin(Math.PI * t)
        const twist = 0.14 * Math.sin(2 * Math.PI * t)
        return clamp01(0.36 + 0.58 * center + twist)
      },
    },
    'rail-picture': {
      samples: 12,
      proudAt: (t) => {
        if (t < 0.18) return 0.48
        if (t < 0.4) return 0.92
        if (t < 0.74) return 0.58
        return 1
      },
    },
    'rail-stepped': {
      samples: 10,
      proudAt: (t) => {
        if (t < 0.22) return 0.55
        if (t < 0.78) return 1
        return 0.62
      },
    },
  },
}

const TRIM_KIND_CONFIG: Record<
  TrimKind,
  {
    defaultConfig: WallTrimConfig
    slots: Record<WallSide, WallTreatmentSlotId>
  }
> = {
  skirting: {
    defaultConfig: WALL_SKIRTING_DEFAULT,
    slots: { interior: 'skirtingInterior', exterior: 'skirtingExterior' },
  },
  crown: {
    defaultConfig: WALL_CROWN_DEFAULT,
    slots: { interior: 'crownInterior', exterior: 'crownExterior' },
  },
  chairRail: {
    defaultConfig: WALL_CHAIR_RAIL_DEFAULT,
    slots: { interior: 'chairRailInterior', exterior: 'chairRailExterior' },
  },
}

function resolveTrimProfile(kind: TrimKind, trim: WallTrimConfig) {
  const defaultProfile = TRIM_KIND_CONFIG[kind].defaultConfig.profile
  return (
    TRIM_PROFILES[kind][trim.profile] ??
    TRIM_PROFILES[kind][defaultProfile] ??
    TRIM_PROFILES[kind].flat
  )
}

export function wallTreatmentProudOffsets(node: WallNode): number[] {
  const offsets = new Set<number>()
  const configs: Array<[TrimKind, WallTrimConfig | undefined]> = [
    ['skirting', node.skirting],
    ['crown', node.crown],
    ['chairRail', node.chairRail],
  ]

  for (const [kind, rawConfig] of configs) {
    const trim = { ...TRIM_KIND_CONFIG[kind].defaultConfig, ...(rawConfig ?? {}) }
    if (!trim.enabled) continue
    const profile = resolveTrimProfile(kind, trim)
    if (!profile) continue
    for (let index = 0; index < profile.samples; index += 1) {
      const t = (index + 0.5) / profile.samples
      offsets.add(Math.max(MIN_SLICE_PROUD, trim.proud * profile.proudAt(t)))
    }
  }

  return [...offsets]
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

function buildMiteredSidePolyline(
  node: WallNode,
  levelData: WallTreatmentLevelData,
  side: WallSide,
  offset: number,
): Point2[] {
  if (isCurvedWall(node)) return buildSidePolyline(node, side, offset)

  const sideSign = resolveTreatmentSideSign(node, side)
  const toLocal = wallToLocalTransform(node)
  const proud = offset - getWallThickness(node) / 2
  const boundarySource = treatmentMiterDataForProud(levelData, proud)
  if (!boundarySource) return buildSidePolyline(node, side, offset)
  const boundary = getWallMiterBoundaryPoints({ ...node, thickness: offset * 2 }, boundarySource)

  if (!boundary) return buildSidePolyline(node, side, offset)

  const start = sideSign > 0 ? boundary.startLeft : boundary.startRight
  const end = sideSign > 0 ? boundary.endLeft : boundary.endRight
  return [toLocal(start.x, start.y), toLocal(end.x, end.y)]
}

function clipPolyline(points: Point2[], x0?: number, x1?: number): Point2[] {
  if (points.length < 2 || (x0 !== undefined && x1 !== undefined && x1 - x0 <= EPS)) return []
  const out: Point2[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]
    const b = points[index + 1]
    if (!(a && b)) continue
    const minX = Math.min(a.x, b.x)
    const maxX = Math.max(a.x, b.x)
    if ((x0 !== undefined && maxX < x0 - EPS) || (x1 !== undefined && minX > x1 + EPS)) {
      continue
    }

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

    const start = x0 !== undefined && minX < x0 ? pushPointAt(x0) : a
    const end = x1 !== undefined && maxX > x1 ? pushPointAt(x1) : b
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

function applyWorldScaleUvs(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) return
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
  const uv = new Float32Array(position.count * 2)

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index)
    const y = position.getY(index)
    const z = position.getZ(index)
    const nx = Math.abs(normal?.getX(index) ?? 0)
    const ny = Math.abs(normal?.getY(index) ?? 0)
    const nz = Math.abs(normal?.getZ(index) ?? 0)
    const offset = index * 2

    if (ny >= nx && ny >= nz) {
      uv[offset] = x
      uv[offset + 1] = z
    } else if (nz >= nx) {
      uv[offset] = x
      uv[offset + 1] = y
    } else {
      uv[offset] = z
      uv[offset + 1] = y
    }
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
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
  applyWorldScaleUvs(geometry)
  return geometry
}

function mergeGeometries(geometries: THREE.BufferGeometry[]) {
  if (geometries.length === 0) return null
  const merged = mergeBufferGeometries(geometries, false)
  if (merged) return merged
  return null
}

export function buildTrimGeometry(
  node: WallNode,
  side: WallSide,
  trim: WallTrimConfig,
  kind: TrimKind,
  childrenNodes: OpeningLike[],
  levelData: WallTreatmentLevelData,
) {
  const wallHeight = resolveWallOpeningCeiling(node, useScene.getState().nodes)
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
  const inner = buildMiteredSidePolyline(node, levelData, side, thickness / 2)
  if (inner.length < 2) return null

  const wallLength = Math.hypot(node.end[0] - node.start[0], node.end[1] - node.start[1])
  const openingRanges = trimOpeningRanges(node, childrenNodes, yBottom, height)
  const fullRanges: Array<[number, number]> = [[0, wallLength]]
  const runs = subtractOpeningRanges(fullRanges, openingRanges)
  if (runs.length === 0) return null

  const slices: THREE.BufferGeometry[] = []
  const profile = resolveTrimProfile(kind, trim)
  if (!profile) return null
  const sliceHeight = height / profile.samples

  for (const [runStart, runEnd] of runs) {
    const clipStart = runStart > EPS ? runStart : undefined
    const clipEnd = runEnd < wallLength - EPS ? runEnd : undefined
    const innerRun = clipPolyline(inner, clipStart, clipEnd)
    if (innerRun.length < 2) continue
    for (let index = 0; index < profile.samples; index += 1) {
      const t = (index + 0.5) / profile.samples
      const proud = Math.max(MIN_SLICE_PROUD, trim.proud * profile.proudAt(t))
      const outerRun = buildMiteredSidePolyline(node, levelData, side, thickness / 2 + proud)
      const outerClipped = clipPolyline(outerRun, clipStart, clipEnd)
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
  sceneMaterials: SceneMaterials,
) {
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
  levelData,
  materials,
}: {
  node: WallNode
  childrenNodes: OpeningLike[]
  levelData: WallTreatmentLevelData
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
        const geometry = buildTrimGeometry(node, side, trim, kind, childrenNodes, levelData)
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
  }, [childrenNodes, fallbackMaterial, levelData, materials, node])

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
