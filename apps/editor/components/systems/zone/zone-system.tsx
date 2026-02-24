import { sceneRegistry, useScene, type ZoneNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import useEditor from '@/store/use-editor'

export const ZoneSystem = () => {
  const structureLayer = useEditor((state) => state.structureLayer)
  const levelMode = useViewer((state) => state.levelMode)
  const selectedLevelId = useViewer((state) => state.selection.levelId)

  useEffect(() => {
    const visible = structureLayer === 'zones'
    const zones = sceneRegistry.byType.zone || new Set()
    const nodes = useScene.getState().nodes

    zones.forEach((zoneId) => {
      const obj = sceneRegistry.nodes.get(zoneId)
      if (!obj) return

      const zone = nodes[zoneId as ZoneNode['id']] as ZoneNode | undefined

      // In solo mode, hide labels for zones not on the current level
      const isOnSelectedLevel = zone?.parentId === selectedLevelId
      const hideInSoloMode = levelMode === 'solo' && selectedLevelId && !isOnSelectedLevel

      obj.visible = visible
      
      const label = obj.getObjectByName('label')
      if (label) {
        // Hide label if zone layer is off OR if in solo mode on a different level
        const showLabel = visible && !hideInSoloMode;
        const labelPosition = obj.userData.labelPosition as [number, number, number] | undefined
        if (showLabel && labelPosition) {
          label.position.set(...labelPosition)
        } else {
          label.position.set(-9999, -9999, -9999)
        }
      }
    })
  }, [structureLayer, levelMode, selectedLevelId])

  return null
}
