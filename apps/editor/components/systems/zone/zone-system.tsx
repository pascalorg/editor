import { sceneRegistry } from '@pascal-app/core'
import { useEffect } from 'react'
import useEditor from '@/store/use-editor'

export const ZoneSystem = () => {
  const structureLayer = useEditor((state) => state.structureLayer)

  useEffect(() => {
    const visible = structureLayer === 'zones'
    const zones = sceneRegistry.byType.zone || new Set()
    zones.forEach((zoneId) => {
      const node = sceneRegistry.nodes.get(zoneId)
      if (node) {
        node.visible = visible;
        const label = node.getObjectByName('label');
        if (label) {
          label.position.y = visible ? 1 : -1000;
          // Hacky way to hide the label when not visible
        }
      }
    })
  }, [structureLayer])
  return null;
}
