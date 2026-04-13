import { emitter, sceneRegistry } from '@pascal-app/core'
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

  useEffect(() => {
    const hideForCapture = () => {
      const scans = sceneRegistry.byType.scan || new Set()
      scans.forEach((scanId) => {
        const node = sceneRegistry.nodes.get(scanId)
        if (node) node.visible = false
      })
    }
    const restoreAfterCapture = () => {
      const showScansNow = useViewer.getState().showScans
      const scans = sceneRegistry.byType.scan || new Set()
      scans.forEach((scanId) => {
        const node = sceneRegistry.nodes.get(scanId)
        if (node) node.visible = showScansNow
      })
    }
    emitter.on('thumbnail:before-capture', hideForCapture)
    emitter.on('thumbnail:after-capture', restoreAfterCapture)
    return () => {
      emitter.off('thumbnail:before-capture', hideForCapture)
      emitter.off('thumbnail:after-capture', restoreAfterCapture)
    }
  }, [])

  return null
}
