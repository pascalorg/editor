import {
  getMaterialPresetByRef,
  getRailingWallConfig,
  type RailingWallSlotId,
  railingWallSlotDefault,
  type SceneMaterial,
  type SceneMaterialId,
  type WallNode,
} from '@pascal-app/core'
import {
  type RenderShading,
  resolveMaterialRef,
  resolveSlotDefaultMaterial,
  type WallMaterialOverride,
} from '@pascal-app/viewer'

/** A railing's slots in its mesh's palette order (`railing-wall-geometry.ts`). */
export const RAILING_WALL_SLOTS: readonly RailingWallSlotId[] = ['railing-frame', 'railing-infill']

/**
 * A railing wall's palette: its frame and its infill, each its painted finish or its style's
 * default (`railingWallSlotDefault`), then the frame again where a wall's face b would be. The
 * materials are the shared library ones, so the railing owns none.
 */
export function createRailingWallMaterials(
  wall: WallNode,
  shading: RenderShading,
  materials?: Record<SceneMaterialId, SceneMaterial>,
): WallMaterialOverride {
  const { style } = getRailingWallConfig(wall)
  const slots = RAILING_WALL_SLOTS.map((slot) => ({
    painted: wall.slots?.[slot],
    fallback: railingWallSlotDefault(style, slot),
  }))
  return {
    hash: JSON.stringify({
      railing: slots.map(({ painted, fallback }) => [
        painted,
        painted?.startsWith('scene:') ? materials?.[painted.slice(6) as SceneMaterialId] : null,
        painted ? getMaterialPresetByRef(painted) : null,
        fallback,
      ]),
    }),
    create: () => {
      const [frame, infill] = slots.map(
        ({ painted, fallback }) =>
          (painted ? resolveMaterialRef(painted, materials, shading) : null) ??
          resolveSlotDefaultMaterial(fallback, shading),
      )
      return { visible: [frame!, infill!, frame!] }
    },
  }
}
