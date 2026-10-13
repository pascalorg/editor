import {
  getRoofGlazing,
  type RoofSegmentNode,
  type SceneMaterial,
  type SceneMaterialId,
} from '@pascal-app/core'
import { type RenderShading, resolveMaterialRef } from '@pascal-app/viewer'
import type { Material } from 'three'
import { MeshLambertNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'

export const GLAZED_ROOF_SLOTS = ['glazing-frame', 'glazing-glass', 'glazing-solid'] as const

export function createGlazedRoofMaterials(
  node: Pick<RoofSegmentNode, 'glazing' | 'slots'>,
  shading: RenderShading,
  materials: Record<SceneMaterialId, SceneMaterial> = {},
) {
  const config = getRoofGlazing(node)
  const owned: Material[] = []
  const visible = GLAZED_ROOF_SLOTS.map((slot, index) => {
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
