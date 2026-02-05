import { useScene, type SiteNode } from '@pascal-app/core'
import { useCallback } from 'react'
import { PolygonEditor } from '../shared/polygon-editor'

/**
 * Site boundary editor - allows editing site polygon when in site phase
 * Uses the generic PolygonEditor component
 */
export const SiteBoundaryEditor: React.FC = () => {
  const nodes = useScene((state) => state.nodes)
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const updateNode = useScene((state) => state.updateNode)

  // Get the site node (first root node)
  const siteNode = rootNodeIds[0] ? nodes[rootNodeIds[0]] : null
  const site = siteNode?.type === 'site' ? (siteNode as SiteNode) : null

  const handlePolygonChange = useCallback(
    (newPolygon: Array<[number, number]>) => {
      if (site) {
        updateNode(site.id, {
          polygon: {
            type: 'polygon',
            points: newPolygon,
          },
        })
      }
    },
    [site, updateNode],
  )

  if (!site || !site.polygon?.points || site.polygon.points.length < 3) return null

  return (
    <PolygonEditor
      polygon={site.polygon.points}
      color="#f59e0b"
      onPolygonChange={handlePolygonChange}
      minVertices={3}
    />
  )
}
