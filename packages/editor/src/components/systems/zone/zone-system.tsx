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
 * Zone volumes are working views, not the everyday look: they mount only while
 * a unit is focused (painting its membership needs every zone in view) or a
 * free-drawn zone is selected. Rooms show as light label pills instead
 * (`RoomLabels3D`). Mounting is the viewer's `showZones` flag: unmounting skips
 * the meshes and drei labels entirely, and the cleanup restores the default so
 * preview / first-person surfaces keep their labels.
 */
export const ZoneSystem = () => {
  const focusedUnitId = useViewer((s) => s.focusedUnitId)
  const zoneId = useViewer((s) => s.selection.zoneId)
  const selectedId = useViewer((s) =>
    s.selection.selectedIds.length === 1 ? s.selection.selectedIds[0] : undefined,
  )
  const selectedZoneId = useScene(
    (s) =>
      zoneId ??
      (selectedId && s.nodes[selectedId as ZoneNode['id']]?.type === 'zone' ? selectedId : null),
  )
  const isCaptureMode = useEditor((s) => s.isCaptureMode)
  const active = (!!focusedUnitId || !!selectedZoneId) && !isCaptureMode
  useEffect(() => {
    useViewer.getState().setShowZones(active)
    return () => useViewer.getState().setShowZones(true)
  }, [active])

  useFrame((_, delta) => {
    if (!useViewer.getState().showZones) return

    const { levelId: selectedLevelId } = useViewer.getState().selection
    const unitFocused = !!useViewer.getState().focusedUnitId
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
      const shown = nodeVisible && (zoneId === selectedZoneId || (unitFocused && isOnSelectedLevel))

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
