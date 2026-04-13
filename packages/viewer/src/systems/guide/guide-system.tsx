import { emitter, sceneRegistry } from '@pascal-app/core'
import { useEffect } from 'react'
import useViewer from '../../store/use-viewer'

export const GuideSystem = () => {
  const showGuides = useViewer((state) => state.showGuides)

  useEffect(() => {
    const guides = sceneRegistry.byType.guide || new Set()
    guides.forEach((guideId) => {
      const node = sceneRegistry.nodes.get(guideId)
      if (node) {
        node.visible = showGuides
      }
    })
  }, [showGuides])

  useEffect(() => {
    const hideForCapture = () => {
      const guides = sceneRegistry.byType.guide || new Set()
      guides.forEach((guideId) => {
        const node = sceneRegistry.nodes.get(guideId)
        if (node) node.visible = false
      })
    }
    const restoreAfterCapture = () => {
      const showGuidesNow = useViewer.getState().showGuides
      const guides = sceneRegistry.byType.guide || new Set()
      guides.forEach((guideId) => {
        const node = sceneRegistry.nodes.get(guideId)
        if (node) node.visible = showGuidesNow
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
