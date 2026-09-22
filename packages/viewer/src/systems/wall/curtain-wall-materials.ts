import {
  getCurtainWallConfig,
  type SceneMaterial,
  type SceneMaterialId,
  type WallNode,
} from '@pascal-app/core'
import type { Material } from 'three'
import { MeshLambertNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import { type RenderShading, resolveMaterialRef } from '../../lib/materials'

const ownedMaterials = new WeakSet<Material>()

export function isOwnedCurtainWallMaterial(material: Material): boolean {
  return ownedMaterials.has(material)
}

export function createCurtainWallMaterials(
  wall: WallNode,
  shading: RenderShading,
  materials?: Record<SceneMaterialId, SceneMaterial>,
): Material[] {
  const config = getCurtainWallConfig(wall)
  return ['frame', 'glass', 'solid'].map((role) => {
    const ref = wall.slots?.[`curtain-${role}`]
    const override = ref ? resolveMaterialRef(ref, materials, shading) : undefined
    // Borrow the shared material so asynchronously loaded texture maps stay live.
    if (override) return override
    const glass = role === 'glass'
    const color = glass
      ? config.glassColor
      : role === 'frame'
        ? config.frameColor
        : config.solidColor
    const properties = {
      color,
      transparent: glass,
      opacity: glass ? config.glassOpacity : 1,
      depthWrite: !glass,
    }
    const material =
      shading === 'solid'
        ? new MeshLambertNodeMaterial(properties)
        : new MeshStandardNodeMaterial({
            ...properties,
            metalness: role === 'frame' ? 0.65 : 0,
            roughness: glass ? config.glassRoughness : 0.4,
          })
    ownedMaterials.add(material)
    return material
  })
}
