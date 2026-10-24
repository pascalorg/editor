import {
  GLAZED_ROOF_SLOTS,
  getRoofGlazing,
  type RoofSegmentNode,
  type SceneMaterial,
  type SceneMaterialId,
} from '@pascal-app/core'
import {
  type ColorPreset,
  createSurfaceRoleMaterial,
  type RenderShading,
  resolveMaterialRef,
} from '@pascal-app/viewer'
import { FrontSide, type Material } from 'three'
import { MeshLambertNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import { getRoofDebugMaterials } from './roof-materials'

export { GLAZED_ROOF_SLOTS } from '@pascal-app/core'

export function createGlazedRoofMaterials(
  node: Pick<RoofSegmentNode, 'glazing' | 'slots'>,
  shading: RenderShading,
  materials: Record<SceneMaterialId, SceneMaterial> = {},
  {
    textures = true,
    colorPreset = 'clay',
    sceneTheme,
    debugColors = false,
  }: {
    textures?: boolean
    colorPreset?: ColorPreset
    sceneTheme?: string
    debugColors?: boolean
  } = {},
) {
  const config = getRoofGlazing(node)
  const owned: Material[] = []
  const visible = GLAZED_ROOF_SLOTS.map((slot, index) => {
    if (debugColors || !textures) {
      const source = debugColors
        ? getRoofDebugMaterials(shading)[index]!
        : createSurfaceRoleMaterial(
            index === 1 ? 'glazing' : 'roof',
            colorPreset,
            FrontSide,
            sceneTheme,
          )
      const material = source.clone()
      if (!debugColors && index === 1) material.opacity = config.glassOpacity
      owned.push(material)
      return material
    }
    const override = resolveMaterialRef(node.slots?.[slot], materials, shading)
    if (override) return override
    const glass = index === 1
    const properties = {
      color: glass ? config.glassColor : config.frameColor,
      transparent: glass,
      opacity: glass ? config.glassOpacity : 1,
      depthWrite: !glass,
    }
    const material =
      shading === 'solid'
        ? new MeshLambertNodeMaterial(properties)
        : new MeshStandardNodeMaterial({
            ...properties,
            roughness: glass ? config.glassRoughness : 0.4,
            metalness: index === 0 ? 0.65 : 0,
          })
    owned.push(material)
    return material
  })
  return { visible: [...visible, visible[0]!], owned }
}
