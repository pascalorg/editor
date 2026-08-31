import { type ScanNode, sceneRegistry, useScene } from '@pascal-app/core'
import { useEffect } from 'react'
import useViewer from '../../store/use-viewer'

export const ScanSystem = () => {
  const showScans = useViewer((state) => state.showScans)
  const nodes = useScene((state) => state.nodes)

  useEffect(() => {
    const scans = sceneRegistry.byType.scan || new Set()
    scans.forEach((scanId) => {
      const node = sceneRegistry.nodes.get(scanId)
      const scan = nodes[scanId as ScanNode['id']]
      if (node && scan?.type === 'scan') node.visible = showScans && scan.visible
    })
  }, [nodes, showScans])

  return null
}
