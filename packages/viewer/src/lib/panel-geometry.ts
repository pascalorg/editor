import {
  type GeometryContext,
  type PanelNode,
  panelDepthOffset,
  type WallNode,
} from '@pascal-app/core'
import { BoxGeometry, FrontSide, Group, Mesh } from 'three'
import { applyWorldScaleBoxUVs } from './box-uv'
import {
  type ColorPreset,
  createSurfaceRoleMaterial,
  type RenderShading,
  resolveMaterialRef,
} from './materials'

export const PANEL_SLOT_ID = 'surface'

/**
 * One box on the host wall's face, in the wall's frame, with UVs in metres so
 * finishes tile at real size. Shared by the panel node and previews of it.
 */
export function buildPanelGeometry(
  node: PanelNode,
  ctx?: { wall?: Pick<WallNode, 'thickness'> | null; materials?: GeometryContext['materials'] },
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
): Group {
  const group = new Group()
  group.name = 'panel-geometry'
  const geometry = new BoxGeometry(node.width, node.height, node.thickness)
  applyWorldScaleBoxUVs(geometry, node.width, node.height, node.thickness)
  const ref = node.slots?.[PANEL_SLOT_ID]
  const material =
    (textures && ref ? resolveMaterialRef(ref, ctx?.materials, shading) : null) ??
    createSurfaceRoleMaterial('wall', colorPreset, FrontSide, sceneTheme)
  const mesh = new Mesh(geometry, material)
  mesh.name = 'panel-body'
  mesh.position.z = panelDepthOffset(node, ctx?.wall ?? null)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.slotId = PANEL_SLOT_ID
  group.add(mesh)
  return group
}
