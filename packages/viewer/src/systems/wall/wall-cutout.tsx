import { type AnyNodeId, emitter, sceneRegistry, useScene, type WallNode } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Material } from 'three'
import { type Mesh, Vector3 } from 'three/webgpu'
import useViewer from '../../store/use-viewer'
import { getMaterialsForWall, getWallMaterialHash } from './wall-materials'

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

export const WallCutout = () => {
  const lastCameraPosition = useRef(new Vector3())
  const lastCameraTarget = useRef(new Vector3())
  const lastUpdateTime = useRef(0)
  const lastWallMode = useRef<string>(useViewer.getState().wallMode)
  const lastNumberOfWalls = useRef(0)
  const lastHighlightKey = useRef('')
  const lastRenderSettingsKey = useRef('')
  const lastWallMaterialsKey = useRef('')
  const lastLoggedRenderSettingsKey = useRef('')

  useFrame(({ camera, clock }) => {
    const viewerState = useViewer.getState()
    const wallMode = viewerState.wallMode
    const selectedIds = viewerState.selection.selectedIds
    const previewSelectedIds = viewerState.previewSelectedIds
    const hoveredId = viewerState.hoveredId
    const hoverHighlightMode = viewerState.hoverHighlightMode
    const renderSettings = {
      shading: viewerState.shading,
      textures: viewerState.textures,
      colorPreset: viewerState.colorPreset,
      sceneTheme: viewerState.sceneTheme,
    }
    const renderSettingsKey = `${renderSettings.shading}|${renderSettings.textures}|${renderSettings.colorPreset}|${renderSettings.sceneTheme}`
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
    const walls = sceneRegistry.byType.wall!
    const wallMaterialEntries: string[] = []
    walls.forEach((wallId) => {
      const wallNode = useScene.getState().nodes[wallId as WallNode['id']]
      if (!wallNode || wallNode.type !== 'wall') return
      wallMaterialEntries.push(`${wallId}:${getWallMaterialHash(wallNode, renderSettings)}`)
    })
    const wallMaterialsKey = wallMaterialEntries.sort().join('|')

    if (
      ((distanceMoved > 0.5 || directionChanged > 0.3) && timeSinceUpdate > 0.1) ||
      lastWallMode.current !== wallMode ||
      walls.size !== lastNumberOfWalls.current ||
      lastHighlightKey.current !== highlightKey ||
      lastRenderSettingsKey.current !== renderSettingsKey ||
      lastWallMaterialsKey.current !== wallMaterialsKey
    ) {
      lastCameraPosition.current.copy(currentCameraPosition)
      lastCameraTarget.current.copy(tmpVec)
      lastUpdateTime.current = currentTime
      camera.getWorldDirection(u)

      if (lastLoggedRenderSettingsKey.current !== renderSettingsKey) {
        lastLoggedRenderSettingsKey.current = renderSettingsKey
        console.log('[viewer/wall-cutout] Applying wall materials.', {
          wallCount: walls.size,
          wallMode,
          ...renderSettings,
        })
      }
      walls.forEach((wallId) => {
        const wallMesh = sceneRegistry.nodes.get(wallId)
        if (!wallMesh) return
        const wallNode = useScene.getState().nodes[wallId as WallNode['id']]
        if (!wallNode || wallNode.type !== 'wall') return

        const hideWall = getWallHideState(wallNode, wallMesh as Mesh, wallMode, u)
        const isDeleteHighlighted = deleteHoveredWallId === wallId
        const isSelectionHighlighted = !isDeleteHighlighted && highlightedWallIds.has(wallId)
        const materials = getMaterialsForWall(wallNode, renderSettings)

        if (hideWall) {
          ;(wallMesh as Mesh).material = isDeleteHighlighted
            ? materials.deleteInvisible
            : isSelectionHighlighted
              ? materials.highlightedInvisible
              : materials.invisible
        } else {
          ;(wallMesh as Mesh).material = isDeleteHighlighted
            ? materials.deleteVisible
            : isSelectionHighlighted
              ? materials.highlightedVisible
              : materials.visible
        }
      })
      lastWallMode.current = wallMode
      lastNumberOfWalls.current = sceneRegistry.byType.wall!.size
      lastHighlightKey.current = highlightKey
      lastRenderSettingsKey.current = renderSettingsKey
      lastWallMaterialsKey.current = wallMaterialsKey
    }
  })

  useEffect(() => {
    const snapshot = new Map<Mesh, Material | Material[]>()

    const restoreForCapture = () => {
      const viewerState = useViewer.getState()
      const renderSettings = {
        shading: viewerState.shading,
        textures: viewerState.textures,
        colorPreset: viewerState.colorPreset,
        sceneTheme: viewerState.sceneTheme,
      }
      sceneRegistry.byType.wall!.forEach((wallId) => {
        const wallMesh = sceneRegistry.nodes.get(wallId) as Mesh | undefined
        if (!wallMesh) return
        const wallNode = useScene.getState().nodes[wallId as AnyNodeId] as WallNode | undefined
        if (!wallNode || wallNode.type !== 'wall') return
        const mats = getMaterialsForWall(wallNode, renderSettings)
        const current = wallMesh.material as Material | Material[]
        snapshot.set(wallMesh, current)
        if (current === mats.highlightedVisible || current === mats.deleteVisible) {
          wallMesh.material = mats.visible
        } else if (current === mats.highlightedInvisible || current === mats.deleteInvisible) {
          wallMesh.material = mats.invisible
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
