import {
  getCurtainWallConfig,
  type SceneMaterial,
  type SceneMaterialId,
  type WallNode,
} from '@pascal-app/core'
import {
  getMaterialsForWall,
  type RenderShading,
  resolveMaterialRef,
  type WallMaterialOverride,
  type WallMaterials,
} from '@pascal-app/viewer'
import type { Material } from 'three'
import { MeshLambertNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'

export function createCurtainWallMaterials(
  wall: WallNode,
  shading: RenderShading,
  materials?: Record<SceneMaterialId, SceneMaterial>,
): WallMaterialOverride {
  const config = getCurtainWallConfig(wall)
  return {
    hash: JSON.stringify({
      config,
      slots: ['curtain-frame', 'curtain-glass', 'curtain-solid'].map((slot) => {
        const ref = wall.slots?.[slot]
        return [
          ref,
          ref?.startsWith('scene:') ? materials?.[ref.slice(6) as SceneMaterialId] : null,
        ]
      }),
    }),
    create: () => {
      const owned: Material[] = []
      const visible = ['frame', 'glass', 'solid'].map((role) => {
        const ref = wall.slots?.[`curtain-${role}`]
        const override = ref ? resolveMaterialRef(ref, materials, shading) : undefined
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
        owned.push(material)
        return material
      })
      return { visible, owned }
    },
  }
}

export function getCurtainAwareWallMaterials(
  wall: WallNode,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: Parameters<typeof getMaterialsForWall>[3] = 'clay',
  sceneTheme?: string,
  materials?: Record<SceneMaterialId, SceneMaterial>,
): WallMaterials {
  const override =
    textures && wall.wallType === 'curtain'
      ? createCurtainWallMaterials(wall, shading, materials)
      : undefined
  return getMaterialsForWall(wall, shading, textures, colorPreset, sceneTheme, materials, override)
}
