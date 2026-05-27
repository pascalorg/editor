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
import { MeshLambertNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import {
  baseMaterial,
  type ColorPreset,
  createMaterial,
  createMaterialFromPresetRef,
  createSurfaceRoleMaterial,
  type RenderShading,
  resolveSurfaceColor,
} from '../../lib/materials'

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

function getSurfaceVisibleMaterial(
  spec: WallSurfaceMaterialSpec,
  shading: RenderShading,
): Material {
  if (spec.materialPreset) {
    return createMaterialFromPresetRef(spec.materialPreset, shading) ?? baseMaterial(shading)
  }

  if (spec.material) {
    return createMaterial(spec.material, shading)
  }

  return baseMaterial(shading)
}

function hasExplicitMaterial(spec: WallSurfaceMaterialSpec): boolean {
  return Boolean(spec.materialPreset || spec.material)
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

function createInvisibleWallMaterial(color: string, shading: RenderShading): Material {
  const material =
    shading === 'solid'
      ? new MeshLambertNodeMaterial({
          transparent: true,
          color,
          depthWrite: false,
          emissive: color,
        })
      : new MeshStandardNodeMaterial({
          transparent: true,
          color,
          depthWrite: false,
          emissive: color,
        })

  material.opacityNode = mix(float(0.0), float(0.24), dotPattern())
  return material
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

export function getWallMaterialHash(wallNode: WallNode, shading: RenderShading): string {
  return JSON.stringify({
    shading,
    interior: getWallSurfaceMaterialSignature(
      getEffectiveWallSurfaceMaterial(wallNode, 'interior'),
    ),
    exterior: getWallSurfaceMaterialSignature(
      getEffectiveWallSurfaceMaterial(wallNode, 'exterior'),
    ),
  })
}

export function getMaterialsForWall(
  wallNode: WallNode,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
): WallMaterials {
  const cacheKey = `${wallNode.id}-${shading}-${textures}-${colorPreset}-${sceneTheme ?? 'base'}`
  const materialHash = textures
    ? getWallMaterialHash(wallNode, shading)
    : JSON.stringify({ textures, colorPreset, sceneTheme })

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
  const wallRoleMaterial = createSurfaceRoleMaterial('wall', colorPreset, undefined, sceneTheme)

  // Untextured surfaces take the themed wall role colour even with textures on;
  // only surfaces with an explicit preset/material keep their texture.
  const visible: WallMaterialArray = textures
    ? [
        wallRoleMaterial,
        hasExplicitMaterial(interiorSpec)
          ? getSurfaceVisibleMaterial(interiorSpec, shading)
          : wallRoleMaterial,
        hasExplicitMaterial(exteriorSpec)
          ? getSurfaceVisibleMaterial(exteriorSpec, shading)
          : wallRoleMaterial,
      ]
    : [wallRoleMaterial, wallRoleMaterial, wallRoleMaterial]

  const wallRoleColor = resolveSurfaceColor('wall', colorPreset, sceneTheme)
  const invisible: WallMaterialArray = [
    createInvisibleWallMaterial(wallRoleColor, textures ? shading : 'solid'),
    createInvisibleWallMaterial(
      textures ? getSurfaceColor(interiorSpec, wallRoleColor) : wallRoleColor,
      textures ? shading : 'solid',
    ),
    createInvisibleWallMaterial(
      textures ? getSurfaceColor(exteriorSpec, wallRoleColor) : wallRoleColor,
      textures ? shading : 'solid',
    ),
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

export function getVisibleWallMaterials(
  wallNode: WallNode,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
): WallMaterialArray {
  return getMaterialsForWall(wallNode, shading, textures, colorPreset, sceneTheme).visible
}
