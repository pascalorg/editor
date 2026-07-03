'use client'

import { sceneRegistry, useScene, type ZoneNode } from '@pascal-app/core'
import useViewer from '@pascal-app/viewer/store'
import { useFrame } from '@react-three/fiber'
import type { Mesh, Object3D } from 'three'
import useEditor from '../store/use-editor'

export const ViewerZoneSystem = () => {
  useFrame(() => {
    const { levelId, zoneId } = useViewer.getState().selection
    const showZoneLabels = useViewer.getState().showZoneLabels
    const structureLayer = useEditor.getState().structureLayer
    const nodes = useScene.getState().nodes

    sceneRegistry.byType.zone!.forEach((id) => {
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
      obj.traverse((child: Object3D) => {
        if ((child as Mesh).isMesh) {
          child.visible = shouldShowGeometry
        }
      })

      // Labels follow the explicit display-menu toggle on the current level.
      const showLabel = showZoneLabels && !!levelId && isOnSelectedLevel
      const targetOpacity = showLabel ? '1' : '0'
      const labelEl = document.getElementById(`${id}-label`)
      if (labelEl && labelEl.style.opacity !== targetOpacity) {
        labelEl.style.opacity = targetOpacity
      }
    })
  })

  return null
}
