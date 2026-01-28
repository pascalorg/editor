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
        node.visible = visible
      }
    })
  }, [structureLayer])
  return null;
}
