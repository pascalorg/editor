import { type AnyNode, useScene, type WallNode } from '@pascal-app/core'
import type { Mesh, Object3D } from 'three'
import useViewer from '../../store/use-viewer'
import { getWallFinishRefs } from '../wall/wall-finish-data'
import { getMaterialsForWall } from '../wall/wall-materials'

/**
 * The picture a deleted node plays out is a copy of what stood there, and a copy wears the
 * material its source had in that frame. A wall the cutaway was hiding wears its stipple, so its
 * deletion would play as faint dots: it wears the wall's own visible variant instead, the one a
 * capture draws (`wallsForCapture`), for as long as it plays. A wall the cutaway showed, and any
 * other wall mode, keep what they wear.
 */
export function dressDeletionGhost(source: Object3D, clone: Object3D, node: AnyNode | undefined) {
  const viewer = useViewer.getState()
  const mesh = clone as Mesh
  if (
    node?.type === 'wall' &&
    viewer.wallMode === 'cutaway' &&
    source.userData.wallHidden === true &&
    mesh.isMesh &&
    mesh.geometry
  ) {
    mesh.material = getMaterialsForWall(
      node as WallNode,
      viewer.shading,
      viewer.textures,
      viewer.colorPreset,
      viewer.sceneTheme,
      useScene.getState().materials,
      getWallFinishRefs(mesh.geometry),
    ).visible
  }
}
