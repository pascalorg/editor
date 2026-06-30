import { type AnyNodeId, emitter, sceneRegistry, useScene, type WallNode } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Material } from 'three'
import { type Mesh, Vector3 } from 'three/webgpu'
import useViewer from '../../store/use-viewer'
import { getMaterialsForWall, getSelectionHighlightMaterials } from './wall-materials'

const tmpVec = new Vector3()
const u = new Vector3()
const v = new Vector3()

function getWallHideState(
  wallNode: WallNode,
  wallMesh: Mesh,
  wallMode: string,
  cameraDir: Vector3,
): boolean {
  let hideWall = wallNode.frontSide === 'interior' && wallNode.backSide === 'interior'

  if (wallMode === 'up') {
    hideWall = false
  } else if (wallMode === 'down') {
    hideWall = true
  } else {
    wallMesh.getWorldDirection(v)
    if (v.dot(cameraDir) < 0) {
      if (wallNode.frontSide === 'exterior' && wallNode.backSide !== 'exterior') {
        hideWall = true
      }
    } else if (wallNode.backSide === 'exterior' && wallNode.frontSide !== 'exterior') {
      hideWall = true
    }
  }

  return hideWall
}

function sameMaterialArray(a: Material | Material[], b: Material[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((material, i) => material === b[i])
}

export const WallCutout = () => {
  const lastCameraPosition = useRef(new Vector3())
  const lastCameraTarget = useRef(new Vector3())
  const lastUpdateTime = useRef(0)
  const lastWallMode = useRef<string>(useViewer.getState().wallMode)
  const lastShading = useRef(useViewer.getState().shading)
  const lastNumberOfWalls = useRef(0)
  const lastHighlightKey = useRef('')
  const lastTextures = useRef(useViewer.getState().textures)
  const lastColorPreset = useRef(useViewer.getState().colorPreset)
  const lastSceneTheme = useRef(useViewer.getState().sceneTheme)

  useFrame(({ camera, clock }) => {
    const wallMode = useViewer.getState().wallMode
    const shading = useViewer.getState().shading
    const textures = useViewer.getState().textures
    const colorPreset = useViewer.getState().colorPreset
    const sceneTheme = useViewer.getState().sceneTheme
    const selectedIds = useViewer.getState().selection.selectedIds
    const previewSelectedIds = useViewer.getState().previewSelectedIds
    const hoveredId = useViewer.getState().hoveredId
    const hoverHighlightMode = useViewer.getState().hoverHighlightMode
    const currentTime = clock.elapsedTime
    const currentCameraPosition = camera.position
    camera.getWorldDirection(tmpVec)
    tmpVec.add(currentCameraPosition)
    const highlightedWallIds = new Set(
      [...selectedIds, ...previewSelectedIds].filter(
        (id) => useScene.getState().nodes[id as AnyNodeId]?.type === 'wall',
      ),
    )
    const deleteHoveredWallId =
      hoverHighlightMode === 'delete' &&
      hoveredId &&
      useScene.getState().nodes[hoveredId as AnyNodeId]?.type === 'wall'
        ? hoveredId
        : null
    const highlightKey = `${Array.from(highlightedWallIds).sort().join('|')}::${deleteHoveredWallId ?? ''}`

    const distanceMoved = currentCameraPosition.distanceTo(lastCameraPosition.current)
    const directionChanged = tmpVec.distanceTo(lastCameraTarget.current)
    const timeSinceUpdate = currentTime - lastUpdateTime.current

    if (
      ((distanceMoved > 0.5 || directionChanged > 0.3) && timeSinceUpdate > 0.1) ||
      lastWallMode.current !== wallMode ||
      lastShading.current !== shading ||
      lastTextures.current !== textures ||
      lastColorPreset.current !== colorPreset ||
      lastSceneTheme.current !== sceneTheme ||
      sceneRegistry.byType.wall!.size !== lastNumberOfWalls.current ||
      lastHighlightKey.current !== highlightKey
    ) {
      lastCameraPosition.current.copy(currentCameraPosition)
      lastCameraTarget.current.copy(tmpVec)
      lastUpdateTime.current = currentTime
      camera.getWorldDirection(u)

      const walls = sceneRegistry.byType.wall!
      walls.forEach((wallId) => {
        const wallMesh = sceneRegistry.nodes.get(wallId)
        if (!wallMesh) return
        const wallNode = useScene.getState().nodes[wallId as WallNode['id']]
        if (wallNode?.type !== 'wall') return

        const hideWall = getWallHideState(wallNode, wallMesh as Mesh, wallMode, u)
        const isDeleteHighlighted = deleteHoveredWallId === wallId
        const isSelectionHighlighted = !isDeleteHighlighted && highlightedWallIds.has(wallId)
        const materials = getMaterialsForWall(
          wallNode,
          shading,
          textures,
          colorPreset,
          sceneTheme,
          useScene.getState().materials,
        )

        if (wallMode === 'translucent') {
          ;(wallMesh as Mesh).material = isDeleteHighlighted
            ? materials.deleteTranslucent
            : isSelectionHighlighted
              ? getSelectionHighlightMaterials(materials.translucent)
              : materials.translucent
        } else if (hideWall) {
          ;(wallMesh as Mesh).material = isDeleteHighlighted
            ? materials.deleteInvisible
            : isSelectionHighlighted
              ? getSelectionHighlightMaterials(materials.invisible)
              : materials.invisible
        } else {
          ;(wallMesh as Mesh).material = isDeleteHighlighted
            ? materials.deleteVisible
            : isSelectionHighlighted
              ? getSelectionHighlightMaterials(materials.visible)
              : materials.visible
        }
      })
      lastWallMode.current = wallMode
      lastShading.current = shading
      lastTextures.current = textures
      lastColorPreset.current = colorPreset
      lastSceneTheme.current = sceneTheme
      lastNumberOfWalls.current = sceneRegistry.byType.wall!.size
      lastHighlightKey.current = highlightKey
    }
  })

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
