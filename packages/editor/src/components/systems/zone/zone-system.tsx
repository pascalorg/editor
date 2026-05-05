import { sceneRegistry, useScene, type ZoneNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { type Group, MathUtils, type Mesh } from 'three'
import type { MeshBasicNodeMaterial } from 'three/webgpu'
import useEditor from '../../../store/use-editor'

// Disable raycasting on zone geometry so clicks pass through to items underneath.
// Zone selection in the editor is handled exclusively via the HTML label overlay.
const noopRaycast = () => {}

export const ZoneSystem = () => {
  useFrame((_, delta) => {
    const structureLayer = useEditor.getState().structureLayer
    const editorMode = useEditor.getState().mode
    const selectedLevelId = useViewer.getState().selection.levelId
    const selectedZoneId = useViewer.getState().selection.zoneId
    const hoveredId = useViewer.getState().hoveredId

    const zoneGeometryVisible = structureLayer === 'zones'
    const zones = sceneRegistry.byType.zone || new Set()
    const nodes = useScene.getState().nodes
    const lerpSpeed = 10 * delta

    zones.forEach((zoneId) => {
      const obj = sceneRegistry.nodes.get(zoneId)
      if (!obj) return

      const zone = nodes[zoneId as ZoneNode['id']] as ZoneNode | undefined

      const isOnSelectedLevel = zone?.parentId === selectedLevelId
      const isSelected = zoneId === selectedZoneId
      const isDeleteHovered = editorMode === 'delete' && hoveredId === zoneId

      // Keep group visible (so <Html> labels stay active), hide/show meshes only.
      // Show meshes when: in zone mode, selected, or delete-hovered.
      if (!obj.visible) obj.visible = true
      const meshVisible = zoneGeometryVisible || isSelected || isDeleteHovered
      const targetOpacity = isSelected || isDeleteHovered ? 1 : zoneGeometryVisible ? 1 : 0

      const walls = (obj as Group).getObjectByName('walls') as Mesh | undefined
      if (walls) {
        walls.visible = meshVisible
        const material = walls.material as MeshBasicNodeMaterial
        if (material?.userData?.uOpacity) {
          material.userData.uOpacity.value = MathUtils.lerp(
            material.userData.uOpacity.value,
            targetOpacity,
            lerpSpeed,
          )
        }
      }

      const floor = (obj as Group).getObjectByName('floor') as Mesh | undefined
      if (floor) {
        floor.visible = meshVisible
        const material = floor.material as MeshBasicNodeMaterial
        if (material?.userData?.uOpacity) {
          material.userData.uOpacity.value = MathUtils.lerp(
            material.userData.uOpacity.value,
            targetOpacity,
            lerpSpeed,
          )
        }
      }

      // Disable raycasting once per zone object so geometry never intercepts clicks
      if (!obj.userData.__raycastDisabled) {
        obj.raycast = noopRaycast
        obj.traverse((child) => {
          child.raycast = noopRaycast
        })
        obj.userData.__raycastDisabled = true
      }

      // Labels: always visible on the current level (regardless of mode)
      const showLabel = !!selectedLevelId && isOnSelectedLevel
      const labelOpacity = showLabel ? '1' : '0'
      const labelEl = document.getElementById(`${zoneId}-label`)
      if (labelEl && labelEl.style.opacity !== labelOpacity) {
        labelEl.style.opacity = labelOpacity
      }
    })
  })

  return null
}
