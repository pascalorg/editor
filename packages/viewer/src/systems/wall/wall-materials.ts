import {
  getEffectiveWallSurfaceMaterial,
  getMaterialPresetByRef,
  getWallSurfaceMaterialSignature,
  resolveMaterial,
  type WallNode,
  type WallSurfaceMaterialSpec,
} from '@pascal-app/core'
import { Color, type Material } from 'three'
import { Fn, float, fract, length, mix, positionLocal, smoothstep, step, vec2 } from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { baseMaterial, createMaterial, createMaterialFromPresetRef } from '../../lib/materials'

const DEFAULT_WALL_COLOR = '#f2f0ed'

const WALL_HIGHLIGHT_PROFILES = {
  delete: {
    color: new Color('#dc2626'),
    blend: 0.76,
    emissiveBlend: 0.92,
    emissiveIntensity: 0.46,
  },
  selection: {
    color: new Color('#818cf8'),
    blend: 0.32,
    emissiveBlend: 0.7,
    emissiveIntensity: 0.42,
  },
} as const

type WallHighlightKind = keyof typeof WALL_HIGHLIGHT_PROFILES

export type WallMaterialArray = [Material, Material, Material]

export interface WallMaterials {
  visible: WallMaterialArray
  invisible: WallMaterialArray
  deleteVisible: WallMaterialArray
  deleteInvisible: WallMaterialArray
  highlightedVisible: WallMaterialArray
  highlightedInvisible: WallMaterialArray
  materialHash: string
}

const wallMaterialCache = new Map<string, WallMaterials>()

const dotPattern = Fn(() => {
  const scale = float(0.1)
  const dotSize = float(0.3)

  const uv = vec2(positionLocal.x, positionLocal.y).div(scale)
  const gridUV = fract(uv)

  const dist = length(gridUV.sub(0.5))

  const dots = step(dist, dotSize.mul(0.5))

  const fadeHeight = float(2.5)
  const yFade = float(1).sub(smoothstep(float(0), fadeHeight, positionLocal.y))

  return dots.mul(yFade)
})

function getSurfaceVisibleMaterial(spec: WallSurfaceMaterialSpec): Material {
  if (spec.materialPreset) {
    return createMaterialFromPresetRef(spec.materialPreset) ?? baseMaterial
  }

  if (spec.material) {
    return createMaterial(spec.material)
  }

  return baseMaterial
}

function getSurfaceColor(spec: WallSurfaceMaterialSpec, fallback = DEFAULT_WALL_COLOR): string {
  const preset = getMaterialPresetByRef(spec.materialPreset)
  if (preset?.mapProperties?.color) {
    return preset.mapProperties.color
  }

  if (spec.material) {
    return resolveMaterial(spec.material).color
  }

  return fallback
}

function getHighlightedColor(color: Color, kind: WallHighlightKind): Color {
  const profile = WALL_HIGHLIGHT_PROFILES[kind]
  return color.clone().lerp(profile.color, profile.blend)
}

function createHighlightedWallMaterial(material: Material, kind: WallHighlightKind): Material {
  const highlightedMaterial = material.clone() as Material & {
    color?: Color
    emissive?: Color
    emissiveIntensity?: number
    needsUpdate?: boolean
  }
  const profile = WALL_HIGHLIGHT_PROFILES[kind]

  if ('color' in highlightedMaterial && highlightedMaterial.color) {
    highlightedMaterial.color = getHighlightedColor(highlightedMaterial.color, kind)
  }
  if ('emissive' in highlightedMaterial && highlightedMaterial.emissive) {
    highlightedMaterial.emissive = highlightedMaterial.emissive
      .clone()
      .lerp(profile.color, profile.emissiveBlend)
  }
  if ('emissiveIntensity' in highlightedMaterial) {
    highlightedMaterial.emissiveIntensity = Math.max(
      highlightedMaterial.emissiveIntensity ?? 0,
      profile.emissiveIntensity,
    )
  }
  highlightedMaterial.needsUpdate = true

  return highlightedMaterial
}

function createInvisibleWallMaterial(color: string): MeshStandardNodeMaterial {
  return new MeshStandardNodeMaterial({
    transparent: true,
    opacityNode: mix(float(0.0), float(0.24), dotPattern()),
    color,
    depthWrite: false,
    emissive: color,
  })
}

function mapWallMaterialArray(
  materials: WallMaterialArray,
  iteratee: (material: Material, index: number) => Material,
): WallMaterialArray {
  return materials.map(iteratee) as WallMaterialArray
}

function disposeOwnedMaterials(materials: WallMaterialArray[]) {
  const owned = new Set<Material>()
  materials.forEach((entry) => {
    entry.forEach((material) => {
      owned.add(material)
    })
  })
  owned.forEach((material) => {
    material.dispose()
  })
}

export function getWallMaterialHash(wallNode: WallNode): string {
  return JSON.stringify({
    interior: getWallSurfaceMaterialSignature(
      getEffectiveWallSurfaceMaterial(wallNode, 'interior'),
    ),
    exterior: getWallSurfaceMaterialSignature(
      getEffectiveWallSurfaceMaterial(wallNode, 'exterior'),
    ),
  })
}

export function getMaterialsForWall(wallNode: WallNode): WallMaterials {
  const cacheKey = wallNode.id
  const materialHash = getWallMaterialHash(wallNode)

  const existing = wallMaterialCache.get(cacheKey)
  if (existing && existing.materialHash === materialHash) {
    return existing
  }

  if (existing) {
    disposeOwnedMaterials([
      existing.invisible,
      existing.deleteVisible,
      existing.deleteInvisible,
      existing.highlightedVisible,
      existing.highlightedInvisible,
    ])
  }

  const interiorSpec = getEffectiveWallSurfaceMaterial(wallNode, 'interior')
  const exteriorSpec = getEffectiveWallSurfaceMaterial(wallNode, 'exterior')

  const visible: WallMaterialArray = [
    baseMaterial,
    getSurfaceVisibleMaterial(interiorSpec),
    getSurfaceVisibleMaterial(exteriorSpec),
  ]

  const invisible: WallMaterialArray = [
    createInvisibleWallMaterial(DEFAULT_WALL_COLOR),
    createInvisibleWallMaterial(getSurfaceColor(interiorSpec, DEFAULT_WALL_COLOR)),
    createInvisibleWallMaterial(getSurfaceColor(exteriorSpec, DEFAULT_WALL_COLOR)),
  ]

  const highlightedVisible = mapWallMaterialArray(visible, (material) =>
    createHighlightedWallMaterial(material, 'selection'),
  )
  const highlightedInvisible = mapWallMaterialArray(invisible, (material) =>
    createHighlightedWallMaterial(material, 'selection'),
  )
  const deleteVisible = mapWallMaterialArray(visible, (material) =>
    createHighlightedWallMaterial(material, 'delete'),
  )
  const deleteInvisible = mapWallMaterialArray(invisible, (material) =>
    createHighlightedWallMaterial(material, 'delete'),
  )

  const result: WallMaterials = {
    visible,
    invisible,
    deleteVisible,
    deleteInvisible,
    highlightedVisible,
    highlightedInvisible,
    materialHash,
  }

  wallMaterialCache.set(cacheKey, result)
  return result
}

export function getVisibleWallMaterials(wallNode: WallNode): WallMaterialArray {
  return getMaterialsForWall(wallNode).visible
}
