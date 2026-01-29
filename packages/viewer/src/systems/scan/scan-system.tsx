import { sceneRegistry } from '@pascal-app/core'
import { useEffect } from 'react'
import useViewer from '../../store/use-viewer'

export const ScanSystem = () => {
  const showScans = useViewer((state) => state.showScans)

  useEffect(() => {
    const scans = sceneRegistry.byType.scan || new Set()
    scans.forEach((scanId) => {
      const node = sceneRegistry.nodes.get(scanId)
      if (node) {
        node.visible = showScans
      }
    })
  }, [showScans])
  return null;
}
