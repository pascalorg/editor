'use client'

import { sceneRegistry, useScene, type ZoneNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import { resolveOverlayPolicy } from '../lib/interaction/overlay-policy'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'

export const ViewerZoneSystem = () => {
  useFrame(() => {
    const { levelId, zoneId } = useViewer.getState().selection
    const nodes = useScene.getState().nodes
    // Snapshot capture is a clean, camera-only surface — zone geometry and
    // tags stay out of the framed shot (mirrors the editor ZoneSystem's gate).
    const isCaptureMode = useEditor.getState().isCaptureMode
    // During any active interaction zone labels step back entirely (Sims-light).
    const zoneLabelsHidden =
      resolveOverlayPolicy(useInteractionScope.getState().scope).zoneLabels === 'hidden'

    sceneRegistry.byType.zone!.forEach((id) => {
      const obj = sceneRegistry.nodes.get(id)
      if (!obj) return

      const zone = nodes[id as ZoneNode['id']] as ZoneNode | undefined
      if (!zone) return

      const isOnSelectedLevel = zone.parentId === levelId

      // Keep group visible (so <Html> labels stay active), hide/show meshes only:
      // only the selected zone shows its volume.
      const isSelected = id === zoneId
      // A zone the author hid (sidebar eye) takes the group with it — this
      // per-frame write would otherwise undo the renderer's `visible` prop.
      const nodeVisible = zone.visible !== false
      const shouldShowGeometry = nodeVisible && !isCaptureMode && isSelected
      if (obj.visible !== nodeVisible) obj.visible = nodeVisible
      obj.traverse((child) => {
        if ((child as Mesh).isMesh) {
          child.visible = shouldShowGeometry
        }
      })

      // Labels: always visible on the current level (regardless of mode or zone selection)
      const showLabel =
        nodeVisible && !isCaptureMode && !zoneLabelsHidden && !!levelId && isOnSelectedLevel
      const targetOpacity = showLabel ? '1' : '0'
      const labelEl = document.getElementById(`${id}-label`)
      if (labelEl && labelEl.style.opacity !== targetOpacity) {
        labelEl.style.opacity = targetOpacity
      }
    })
  })

  return null
}
