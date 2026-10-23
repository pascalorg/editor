import type { GeometryContext } from '@pascal-app/core'
import {
  applyWorldScaleBoxUVs,
  type ColorPreset,
  createMaterial,
  type RenderShading,
  resolveMaterialRef,
} from '@pascal-app/viewer'
import {
  BoxGeometry,
  CylinderGeometry,
  type Group,
  Mesh,
  type MeshStandardMaterial,
  SphereGeometry,
} from 'three'
import { accessoryFinish } from './accessory-finish'
import {
  applyCylinderWorldUvs,
  applySphereWorldUvs,
  copyUvToSecondaryChannel,
} from './primitive-uv'

/** Resolve finish/paint on existing meshes; their topology and transforms remain untouched. */
export function finishMechanicalGeometry(
  group: Group,
  slots: Record<string, string> | undefined,
  slotFor: (name: string) => string,
  ctx?: GeometryContext,
  shading: RenderShading = 'rendered',
  textures = true,
  preset: ColorPreset = 'clay',
  theme?: string,
): Group {
  const retired = new Set<MeshStandardMaterial>()
  group.traverse((object) => {
    if (!(object instanceof Mesh) || Array.isArray(object.material)) return
    const slot = slotFor(object.name)
    object.userData.slotId = slot
    const original = object.material as MeshStandardMaterial
    const coated = slot === 'cabinet'
    const insulation = slot === 'insulation'
    object.material = !textures
      ? accessoryFinish('furnishing', preset, undefined, theme, shading)
      : (resolveMaterialRef(slots?.[slot], ctx?.materials, shading) ??
        createMaterial(
          {
            preset: 'custom',
            properties: {
              color: `#${original.color.getHexString()}`,
              roughness: insulation ? 0.94 : coated ? 0.38 : Math.min(original.roughness, 0.45),
              metalness: insulation ? 0 : coated ? 0.08 : original.metalness,
              opacity: 1,
              transparent: false,
              side: 'front',
            },
          },
          shading,
        ))
    retired.add(original)
    const geometry = object.geometry
    if (geometry instanceof BoxGeometry)
      applyWorldScaleBoxUVs(
        geometry,
        geometry.parameters.width,
        geometry.parameters.height,
        geometry.parameters.depth,
      )
    else if (geometry instanceof CylinderGeometry) {
      const { radiusTop, radiusBottom, height } = geometry.parameters
      applyCylinderWorldUvs(geometry, Math.max(radiusTop, radiusBottom), height)
    } else if (geometry instanceof SphereGeometry)
      applySphereWorldUvs(geometry, geometry.parameters.radius)
    copyUvToSecondaryChannel(geometry)
  })
  for (const material of retired) material.dispose()
  return group
}
