'use client'

import { type ZoneNode, sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'

export const ViewerZoneSystem = () => {
  useFrame(() => {
    const { levelId, zoneId } = useViewer.getState().selection
    const nodes = useScene.getState().nodes

    sceneRegistry.byType.zone.forEach((id) => {
      const obj = sceneRegistry.nodes.get(id)
      if (!obj) return

      const zone = nodes[id as ZoneNode['id']] as ZoneNode | undefined
      if (!zone) return

      // Hide zones if:
      // 1. No level is selected
      // 2. Zone is not on the selected level
      // 3. A zone is already selected (hide all zones to show zone contents)
      const isOnSelectedLevel = zone.parentId === levelId
      const shouldShow = !!levelId && isOnSelectedLevel && !zoneId

      obj.visible = shouldShow

      // Also hide the label
      const label = obj.getObjectByName('label')
      if (label) {
        label.position.y = shouldShow ? 1 : -1000
      }
    })
  })

  return null
}
