import { sceneRegistry, useScene, type ZoneNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect } from 'react'
import { type Group, MathUtils, type Mesh } from 'three'
import type { MeshBasicNodeMaterial } from 'three/webgpu'
import { resolveOverlayPolicy } from '../../../lib/interaction/overlay-policy'
import useEditor from '../../../store/use-editor'
import useInteractionScope from '../../../store/use-interaction-scope'

// Disable raycasting on zone geometry so clicks pass through to items underneath.
const noopRaycast = () => {}

/**
 * Zone volumes are a working view for one job only: painting a unit's
 * membership, where every zone on the level has to be in view. Otherwise every
 * zone, drawn or detected, shows as a room: a light label pill (`RoomLabels3D`)
 * and the room outline when selected. Mounting is the viewer's `showZones`
 * flag: unmounting skips the meshes and drei labels entirely, and the cleanup
 * restores the default so preview / first-person surfaces keep their labels.
 */
export const ZoneSystem = () => {
  const focusedUnitId = useViewer((s) => s.focusedUnitId)
  const isCaptureMode = useEditor((s) => s.isCaptureMode)
  const active = !!focusedUnitId && !isCaptureMode
  useEffect(() => {
    useViewer.getState().setShowZones(active)
    return () => useViewer.getState().setShowZones(true)
  }, [active])

  useFrame((_, delta) => {
    if (!useViewer.getState().showZones) return

    const { levelId: selectedLevelId } = useViewer.getState().selection
    // During any active interaction zone labels step back entirely.
    const zoneLabelsHidden =
      resolveOverlayPolicy(useInteractionScope.getState().scope).zoneLabels === 'hidden'
    const zones = sceneRegistry.byType.zone || new Set()
    const nodes = useScene.getState().nodes
    const lerpSpeed = 10 * delta

    zones.forEach((zoneId) => {
      const obj = sceneRegistry.nodes.get(zoneId)
      if (!obj) return

      const zone = nodes[zoneId as ZoneNode['id']] as ZoneNode | undefined
      const isOnSelectedLevel = zone?.parentId === selectedLevelId
      // A zone the author hid (sidebar eye) takes its group with it; otherwise
      // this per-frame write would undo the renderer's `visible` prop.
      const nodeVisible = zone?.visible !== false
      if (obj.visible !== nodeVisible) obj.visible = nodeVisible
      const shown = nodeVisible && isOnSelectedLevel

      // Raycast is re-disabled per frame: the meshes remount whenever zones
      // mount again, so a one-shot flag on the persistent group would leave
      // fresh meshes clickable.
      for (const name of ['walls', 'floor']) {
        const mesh = (obj as Group).getObjectByName(name) as Mesh | undefined
        if (!mesh) continue
        mesh.visible = shown
        mesh.raycast = noopRaycast
        const material = mesh.material as MeshBasicNodeMaterial
        if (material?.userData?.uOpacity) {
          material.userData.uOpacity.value = MathUtils.lerp(
            material.userData.uOpacity.value,
            shown ? 1 : 0,
            lerpSpeed,
          )
        }
      }

      const labelOpacity = shown && !zoneLabelsHidden ? '1' : '0'
      const labelEl = document.getElementById(`${zoneId}-label`)
      if (labelEl && labelEl.style.opacity !== labelOpacity) {
        labelEl.style.opacity = labelOpacity
      }
    })
  })

  return null
}
