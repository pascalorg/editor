import {
  getEffectiveWallSurfaceMaterial,
  getMaterialPresetByRef,
  getMaterialSolidColorByRef,
  getWallSurfaceMaterialSignature,
  resolveMaterial,
  type WallNode,
  type WallSurfaceMaterialSpec,
} from '@pascal-app/core'
import { Color, type Material } from 'three'
import { Fn, float, fract, length, mix, positionLocal, smoothstep, step, vec2 } from 'three/tsl'
import { MeshLambertNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import {
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

export type WallMaterialRenderOptions = {
  shading: RenderShading
  textures: boolean
  colorPreset: ColorPreset
  sceneTheme?: string
}

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
  options: WallMaterialRenderOptions,
): Material {
  if (!options.textures) {
    return createSurfaceRoleMaterial(
      'wall',
      options.colorPreset,
      undefined,
      options.sceneTheme,
      options.shading,
    )
  }

  if (spec.materialPreset) {
    return (
      createMaterialFromPresetRef(spec.materialPreset, options.shading) ??
      createSurfaceRoleMaterial(
        'wall',
        options.colorPreset,
        undefined,
        options.sceneTheme,
        options.shading,
      )
    )
  }

  if (spec.material) {
    return createMaterial(spec.material, options.shading)
  }

  return createSurfaceRoleMaterial(
    'wall',
    options.colorPreset,
    undefined,
    options.sceneTheme,
    options.shading,
  )
}

function hasExplicitMaterial(spec: WallSurfaceMaterialSpec): boolean {
  return Boolean(spec.materialPreset || spec.material)
}

function getSurfaceColor(spec: WallSurfaceMaterialSpec, fallback = DEFAULT_WALL_COLOR): string {
  if (spec.material) {
    return resolveMaterial(spec.material).color
  }

  const preset = getMaterialPresetByRef(spec.materialPreset)
  const solidColor = getMaterialSolidColorByRef(spec.materialPreset)
  if (solidColor) {
    return solidColor
  }

  if (preset?.mapProperties?.color) {
    return preset.mapProperties.color
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

export function getWallMaterialHash(
  wallNode: WallNode,
  options?: Partial<WallMaterialRenderOptions>,
): string {
  return JSON.stringify({
    render: options,
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
  options: WallMaterialRenderOptions = {
    shading: 'rendered',
    textures: true,
    colorPreset: 'clay',
  },
): WallMaterials {
  const cacheKey = wallNode.id
  const materialHash = getWallMaterialHash(wallNode, options)

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
  const defaultWallColor = resolveSurfaceColor('wall', options.colorPreset, options.sceneTheme)
  const wallRoleMaterial = createSurfaceRoleMaterial(
    'wall',
    options.colorPreset,
    undefined,
    options.sceneTheme,
    options.shading,
  )

  const visible: WallMaterialArray = [
    wallRoleMaterial,
    hasExplicitMaterial(interiorSpec)
      ? getSurfaceVisibleMaterial(interiorSpec, options)
      : wallRoleMaterial,
    hasExplicitMaterial(exteriorSpec)
      ? getSurfaceVisibleMaterial(exteriorSpec, options)
      : wallRoleMaterial,
  ]

  const invisible: WallMaterialArray = [
    createInvisibleWallMaterial(defaultWallColor, options.textures ? options.shading : 'solid'),
    createInvisibleWallMaterial(
      options.textures ? getSurfaceColor(interiorSpec, defaultWallColor) : defaultWallColor,
      options.textures ? options.shading : 'solid',
    ),
    createInvisibleWallMaterial(
      options.textures ? getSurfaceColor(exteriorSpec, defaultWallColor) : defaultWallColor,
      options.textures ? options.shading : 'solid',
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
  options?: WallMaterialRenderOptions,
): WallMaterialArray {
  return getMaterialsForWall(wallNode, options).visible
}

export function getWallMaterialCacheSize(): number {
  return wallMaterialCache.size
}

export function clearWallMaterialCache(): void {
  for (const materials of wallMaterialCache.values()) {
    disposeOwnedMaterials([
      materials.invisible,
      materials.deleteVisible,
      materials.deleteInvisible,
      materials.highlightedVisible,
      materials.highlightedInvisible,
    ])
  }
  wallMaterialCache.clear()
}
