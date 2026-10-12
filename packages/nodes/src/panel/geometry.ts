import type { GeometryContext, PanelNode } from '@pascal-app/core'
import {
  buildPanelGeometry as buildPanelMesh,
  type ColorPreset,
  type RenderShading,
} from '@pascal-app/viewer'

/** `def.geometry` for the panel: the shared builder, reading its host wall from the context. */
export function buildPanelGeometry(
  node: PanelNode,
  ctx?: Pick<GeometryContext, 'parent' | 'materials'>,
  shading?: RenderShading,
  textures?: boolean,
  colorPreset?: ColorPreset,
  sceneTheme?: string,
) {
  const wall = ctx?.parent?.type === 'wall' ? ctx.parent : null
  return buildPanelMesh(
    node,
    { wall, materials: ctx?.materials },
    shading,
    textures,
    colorPreset,
    sceneTheme,
  )
}
