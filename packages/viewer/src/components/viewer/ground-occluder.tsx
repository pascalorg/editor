import { useScene } from '@pascal-app/core'
import { useMemo } from 'react'
import * as THREE from 'three'
import useViewer from '../../store/use-viewer'
import polygonClipping from 'polygon-clipping'

export const GroundOccluder = () => {
  const theme = useViewer((state) => state.theme)
  const bgColor = theme === 'dark' ? '#12151e' : '#fafafa'
  
  const nodes = useScene((state) => state.nodes)

  const shape = useMemo(() => {
    const s = new THREE.Shape()
    const size = 100000
    // Create outer infinite plane
    s.moveTo(-size, -size)
    s.lineTo(size, -size)
    s.lineTo(size, size)
    s.lineTo(-size, size)
    s.closePath()

    // Collect all polygons for slabs and zones
    const polygons: [number, number][][] = []
    
    Object.values(nodes).forEach((node) => {
      if ((node.type === 'slab' || node.type === 'zone') && node.polygon && node.polygon.length >= 3) {
        polygons.push(node.polygon as [number, number][])
      }
    })

    if (polygons.length > 0) {
      // Format for polygon-clipping: [[[x, y], [x, y], ...]]
      const multiPolygons = polygons.map(pts => {
        const ring = pts.map(p => [p[0], -p[1]] as [number, number]) // Negate Y (which was Z)
        return [ring]
      })

      // Union all polygons together to prevent artifacts from overlapping
      const unionedPolygons = polygonClipping.union(multiPolygons[0]!, ...multiPolygons.slice(1))

      // Add each resulting unioned polygon as a hole
      for (const geom of unionedPolygons) {
        // First ring in each geometry is the exterior ring
        if (geom.length > 0) {
          const ring = geom[0]!
          const hole = new THREE.Path()
          
          if (ring.length > 0) {
            hole.moveTo(ring[0]![0], ring[0]![1])
            for (let i = 1; i < ring.length; i++) {
              hole.lineTo(ring[i]![0], ring[i]![1])
            }
            hole.closePath()
            s.holes.push(hole)
          }
        }
      }
    }

    return s
  }, [nodes])

  return (
    <mesh rotation-x={-Math.PI / 2} position-y={-0.05}>
      <shapeGeometry args={[shape]} />
      <meshBasicMaterial color={bgColor} depthWrite={true} />
    </mesh>
  )
}
