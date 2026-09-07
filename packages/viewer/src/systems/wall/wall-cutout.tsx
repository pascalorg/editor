import { type AnyNodeId, emitter, sceneRegistry, useScene, type WallNode } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Material } from 'three'
import { type Mesh, Vector3 } from 'three/webgpu'
import useViewer, { type WallMode } from '../../store/use-viewer'
import { sameMaterialArray, WallCutoutCache, wallHiddenFromFacing } from './wall-cutout-cache'
import { getMaterialsForWall, getSelectionHighlightMaterials } from './wall-materials'
import { subscribeWallRebuilds } from './wall-rebuild-notifications'

const v = new Vector3()

/**
 * Whether a wall should be hidden or see-through for the current camera and
 * wall mode. Pure: reads only its arguments and the mesh's world direction.
 *
 * Exported so hosts rendering their own layers inside `<Viewer>` can match
 * these semantics instead of re-deriving the facing test or inferring state
 * from the assigned material variant.
 */
export function getWallHideState(
  wallNode: WallNode,
  wallMesh: Mesh,
  wallMode: WallMode,
  cameraDir: Vector3,
): boolean {
  if (wallMode === 'up') return false
  if (wallMode === 'down') return true
  wallMesh.getWorldDirection(v)
  return wallHiddenFromFacing(wallNode, wallMode, v.dot(cameraDir) < 0)
}

export const WallCutout = () => {
  const cacheRef = useRef<WallCutoutCache | null>(null)
  if (!cacheRef.current) cacheRef.current = new WallCutoutCache()
  const cache = cacheRef.current

  useEffect(() => subscribeWallRebuilds((id) => cache.rebuilt.add(id)), [cache])

  // Read completed transforms after WallSystem (4), before WallBatchSystem (5)
  // consumes the hidden stamps and its independent rebuild queue.
  useFrame(({ camera, clock }) => cache.update(camera, clock.elapsedTime), 4.5)

  useEffect(() => {
    const snapshot = new Map<Mesh, Material | Material[]>()

    const restoreForCapture = () => {
      sceneRegistry.byType.wall!.forEach((wallId) => {
        const wallMesh = sceneRegistry.nodes.get(wallId) as Mesh | undefined
        if (!wallMesh) return
        const wallNode = useScene.getState().nodes[wallId as AnyNodeId] as WallNode | undefined
        if (wallNode?.type !== 'wall') return
        const mats = getMaterialsForWall(
          wallNode,
          useViewer.getState().shading,
          useViewer.getState().textures,
          useViewer.getState().colorPreset,
          useViewer.getState().sceneTheme,
          useScene.getState().materials,
        )
        const current = wallMesh.material as Material | Material[]
        snapshot.set(wallMesh, current)
        if (current === mats.deleteVisible) {
          wallMesh.material = mats.visible
        } else if (current === mats.deleteInvisible) {
          wallMesh.material = mats.invisible
        } else if (
          current === mats.deleteTranslucent ||
          sameMaterialArray(current, getSelectionHighlightMaterials(mats.translucent))
        ) {
          wallMesh.material = mats.translucent
        }
      })
    }

    const reapplyAfterCapture = () => {
      snapshot.forEach((mat, mesh) => {
        mesh.material = mat
      })
      snapshot.clear()
    }

    emitter.on('thumbnail:before-capture', restoreForCapture)
    emitter.on('thumbnail:after-capture', reapplyAfterCapture)
    return () => {
      emitter.off('thumbnail:before-capture', restoreForCapture)
      emitter.off('thumbnail:after-capture', reapplyAfterCapture)
    }
  }, [])

  return null
}
