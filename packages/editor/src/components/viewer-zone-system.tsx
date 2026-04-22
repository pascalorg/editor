'use client'

import { sceneRegistry, useScene, type ZoneNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import useEditor from '../store/use-editor'

export const ViewerZoneSystem = () => {
  useFrame(() => {
    const { levelId, zoneId } = useViewer.getState().selection
    const structureLayer = useEditor.getState().structureLayer
    const nodes = useScene.getState().nodes

    sceneRegistry.byType.zone.forEach((id) => {
      const obj = sceneRegistry.nodes.get(id)
      if (!obj) return

      const zone = nodes[id as ZoneNode['id']] as ZoneNode | undefined
      if (!zone) return

      const isOnSelectedLevel = zone.parentId === levelId

      // Keep group visible (so <Html> labels stay active), hide/show meshes only.
      // Zone geometry: visible in zone mode on the right level, OR when this zone is selected.
      // The editor ZoneSystem handles the selected zone's opacity animation.
      const isSelected = id === zoneId
      const shouldShowGeometry =
        (structureLayer === 'zones' && !!levelId && isOnSelectedLevel) || isSelected
      if (!obj.visible) obj.visible = true
      obj.traverse((child) => {
        if ((child as Mesh).isMesh) {
          child.visible = shouldShowGeometry
        }
      })

      // Keep the built-in zone labels hidden while the room-button HUD owns room naming.
      const targetOpacity = '0'
      const labelEl = document.getElementById(`${id}-label`)
      if (labelEl && labelEl.style.opacity !== targetOpacity) {
        labelEl.style.opacity = targetOpacity
      }
    })
  })

  return null
}
