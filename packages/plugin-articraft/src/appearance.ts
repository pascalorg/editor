import {
  type ColorPreset,
  createDefaultMaterial,
  createSurfaceRoleMaterial,
  type RenderShading,
} from '@pascal-app/viewer'
import { Color, type Material, type Mesh, type Object3D } from 'three'

export type ArticraftAppearance = {
  colorPreset: ColorPreset
  ghost: boolean
  sceneTheme: string
  shading: RenderShading
  textures: boolean
}

type MaterialWithSurfaceProperties = Material & {
  alphaMap?: unknown
  aoMap?: unknown
  color?: Color
  emissive?: Color
  emissiveIntensity?: number
  emissiveMap?: unknown
  lightMap?: unknown
  lightMapIntensity?: number
  map?: unknown
  roughness?: number
  vertexColors?: boolean
  wireframe?: boolean
}

type CapturedMesh = {
  authored: Material | Material[]
  mesh: Mesh
}

const GHOST_TINT = new Color('#8b5cf6')

function copyMaterialPresentation(source: Material, target: Material) {
  const from = source as MaterialWithSurfaceProperties
  const to = target as MaterialWithSurfaceProperties

  target.alphaTest = source.alphaTest
  target.blending = source.blending
  target.colorWrite = source.colorWrite
  target.depthTest = source.depthTest
  target.depthWrite = source.depthWrite
  target.opacity = source.opacity
  target.polygonOffset = source.polygonOffset
  target.polygonOffsetFactor = source.polygonOffsetFactor
  target.polygonOffsetUnits = source.polygonOffsetUnits
  target.premultipliedAlpha = source.premultipliedAlpha
  target.transparent = source.transparent
  target.toneMapped = source.toneMapped
  target.visible = source.visible

  to.alphaMap = from.alphaMap
  to.aoMap = from.aoMap
  to.emissiveMap = from.emissiveMap
  to.lightMap = from.lightMap
  to.map = from.map
  to.vertexColors = from.vertexColors
  if (from.emissive && to.emissive) to.emissive.copy(from.emissive)
  if (from.emissiveIntensity !== undefined) to.emissiveIntensity = from.emissiveIntensity
  if (from.lightMapIntensity !== undefined) to.lightMapIntensity = from.lightMapIntensity
  target.needsUpdate = true
}

function createSolidVariant(source: Material): Material {
  const surface = source as MaterialWithSurfaceProperties
  const color = surface.color instanceof Color ? `#${surface.color.getHexString()}` : '#ffffff'
  const material = createDefaultMaterial(color, surface.roughness ?? 0.9, 'solid', source.side)
  material.name = source.name
  copyMaterialPresentation(source, material)
  return material
}

function createGhostVariant(source: Material): Material {
  const material = source.clone() as MaterialWithSurfaceProperties
  material.transparent = true
  material.opacity = Math.min(source.opacity, 0.58)
  material.depthWrite = false
  if (material.color instanceof Color) material.color.lerp(GHOST_TINT, 0.35)
  material.needsUpdate = true
  return material
}

/**
 * Keeps an imported articulated hierarchy aligned with Pascal's viewer appearance.
 * Authored materials are retained for Colored + Rendered, while Solid swaps in
 * lightweight Lambert variants and Monochrome uses the active furnishing palette.
 */
export function createArticraftAppearanceController(root: Object3D) {
  const captured: CapturedMesh[] = []
  const solidVariants = new Map<Material, Material>()
  const ghostVariants = new Map<Material, Material>()

  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    captured.push({
      authored: Array.isArray(mesh.material) ? mesh.material.slice() : mesh.material,
      mesh,
    })
  })

  const solidVariant = (material: Material) => {
    const cached = solidVariants.get(material)
    if (cached) return cached
    const next = createSolidVariant(material)
    solidVariants.set(material, next)
    return next
  }

  const ghostVariant = (material: Material) => {
    const cached = ghostVariants.get(material)
    if (cached) return cached
    const next = createGhostVariant(material)
    ghostVariants.set(material, next)
    return next
  }

  const apply = ({ colorPreset, ghost, sceneTheme, shading, textures }: ArticraftAppearance) => {
    for (const { authored, mesh } of captured) {
      const source = Array.isArray(authored) ? authored : [authored]
      const materials = source.map((material) => {
        const visible = textures
          ? shading === 'solid'
            ? solidVariant(material)
            : material
          : createSurfaceRoleMaterial('furnishing', colorPreset, material.side, sceneTheme)
        return ghost ? ghostVariant(visible) : visible
      })

      mesh.material = Array.isArray(authored) ? materials : materials[0]!
      const translucent = materials.some((material) => material.transparent)
      mesh.castShadow = !ghost && !translucent
      mesh.receiveShadow = !ghost && !translucent
    }
  }

  const dispose = () => {
    for (const { authored, mesh } of captured) mesh.material = authored
    for (const material of solidVariants.values()) material.dispose()
    for (const material of ghostVariants.values()) material.dispose()
    solidVariants.clear()
    ghostVariants.clear()
  }

  return { apply, dispose }
}
