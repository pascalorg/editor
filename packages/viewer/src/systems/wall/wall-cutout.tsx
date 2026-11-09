import { type AnyNodeId, emitter, sceneRegistry, useScene, type WallNode } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { Camera, Material } from 'three'
import { type Mesh, Vector3 } from 'three/webgpu'
import useViewer, { type WallMode } from '../../store/use-viewer'
import {
  sameMaterialArray,
  WallCutoutCache,
  type WallCutoutViewerStore,
  wallHiddenFromFacing,
} from './wall-cutout-cache'
import { getWallFinishRefs } from './wall-finish-data'
import {
  getMaterialsForWall,
  getSelectionHighlightMaterials,
  type WallMaterialsResolver,
} from './wall-materials'
import { subscribeWallRebuilds } from './wall-rebuild-notifications'

const v = new Vector3()

export const WALL_CUTOUT_FRAME_PRIORITY = 0

export function runWallCutoutFrame(
  cache: WallCutoutCache,
  { camera, clock }: { camera: Camera; clock: { elapsedTime: number } },
) {
  cache.update(camera, clock.elapsedTime)
}

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

/**
 * The walls as a capture draws them, until the returned function puts them back: a delete or a
 * selection highlight taken off and, with `wholeWalls`, every wall whole whatever the wall mode.
 * The palettes come from the renderer's own resolver, so a curtain wall keeps its glass.
 */
export function wallsForCapture(
  materialResolver: WallMaterialsResolver,
  viewerStore: WallCutoutViewerStore,
  wholeWalls: boolean,
): () => void {
  const snapshot = new Map<Mesh, Material | Material[]>()
  const viewer = viewerStore.getState()
  sceneRegistry.byType.wall!.forEach((wallId) => {
    const wallMesh = sceneRegistry.nodes.get(wallId) as Mesh | undefined
    if (!wallMesh) return
    const wallNode = useScene.getState().nodes[wallId as AnyNodeId] as WallNode | undefined
    if (wallNode?.type !== 'wall') return
    const mats = materialResolver(
      wallNode,
      viewer.shading,
      viewer.textures,
      viewer.colorPreset,
      viewer.sceneTheme,
      useScene.getState().materials,
      getWallFinishRefs(wallMesh.geometry),
    )
    const current = wallMesh.material as Material | Material[]
    snapshot.set(wallMesh, current)
    if (wholeWalls || current === mats.deleteVisible) {
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
  return () => {
    snapshot.forEach((material, mesh) => {
      mesh.material = material
    })
  }
}

export const WallCutout = ({
  viewerStore = useViewer,
  materialResolver = getMaterialsForWall,
}: {
  viewerStore?: WallCutoutViewerStore
  materialResolver?: WallMaterialsResolver
}) => {
  const cache = useMemo(
    () => new WallCutoutCache(viewerStore, materialResolver),
    [viewerStore, materialResolver],
  )

  useEffect(() => subscribeWallRebuilds((id) => cache.handleRebuilt(id)), [cache])

  useEffect(() => cache.subscribeLiveTransforms(), [cache])

  // Camera changes reach PostProcessing (1) in this frame. WallSystem (4)
  // notifies the next frame; WallBatchSystem (5) reads this frame's stamps.
  useFrame((state) => runWallCutoutFrame(cache, state), WALL_CUTOUT_FRAME_PRIORITY)

  useEffect(() => {
    let restore: (() => void) | null = null
    const restoreForCapture = (event?: { wholeWalls?: boolean }) => {
      restore = wallsForCapture(materialResolver, viewerStore, event?.wholeWalls === true)
    }
    const reapplyAfterCapture = () => {
      restore?.()
      restore = null
    }

    emitter.on('thumbnail:before-capture', restoreForCapture)
    emitter.on('thumbnail:after-capture', reapplyAfterCapture)
    return () => {
      emitter.off('thumbnail:before-capture', restoreForCapture)
      emitter.off('thumbnail:after-capture', reapplyAfterCapture)
    }
  }, [viewerStore, materialResolver])

  return null
}
