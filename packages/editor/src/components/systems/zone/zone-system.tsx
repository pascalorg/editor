import { sceneRegistry, useScene, type ZoneNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import useEditor from '../../../store/use-editor'

export const ZoneSystem = () => {
  useFrame(() => {
    const structureLayer = useEditor.getState().structureLayer
    const levelMode = useViewer.getState().levelMode
    const selectedLevelId = useViewer.getState().selection.levelId

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

      if (obj.visible !== visible) {
        obj.visible = visible
      }

      // Hide label if zone layer is off OR if in solo mode on a different level
      const showLabel = visible && !hideInSoloMode
      const targetOpacity = showLabel ? '1' : '0'
      const labelEl = document.getElementById(`${zoneId}-label`)
      if (labelEl && labelEl.style.opacity !== targetOpacity) {
        labelEl.style.opacity = targetOpacity
      }
    })
  })

  return null
}
