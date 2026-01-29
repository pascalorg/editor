import { sceneRegistry } from '@pascal-app/core'
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
  return null;
}
