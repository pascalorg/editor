import { type LevelNode, useScene } from '@pascal-app/core'
import polygonClipping from 'polygon-clipping'
import { useMemo } from 'react'
import * as THREE from 'three'
import useViewer from '../../store/use-viewer'

export const GroundOccluder = () => {
  const theme = useViewer((state) => state.theme)
  const bgColor = theme === 'dark' ? '#1f2433' : '#fafafa'

  const nodes = useScene((state) => state.nodes)

  const shape = useMemo(() => {
    const s = new THREE.Shape()
    const size = 1000
    // Create outer infinite plane
    s.moveTo(-size, -size)
    s.lineTo(size, -size)
    s.lineTo(size, size)
    s.lineTo(-size, size)
    s.closePath()

    const levelIndexById = new Map<LevelNode['id'], number>()
    let lowestLevelIndex = Number.POSITIVE_INFINITY

    Object.values(nodes).forEach((node) => {
      if (node.type !== 'level') {
        return
      }

      levelIndexById.set(node.id, node.level)
      lowestLevelIndex = Math.min(lowestLevelIndex, node.level)
    })

    // Only the lowest level should punch through the ground plane.
    // Upper-level slabs should still cast shadows, but they should not
    // reveal their footprint on the level-zero ground material.
    const polygons: [number, number][][] = []

    Object.values(nodes).forEach((node) => {
      if (!(node.type === 'slab' && node.visible && node.polygon.length >= 3)) {
        return
      }

      if (Number.isFinite(lowestLevelIndex)) {
        const parentLevelIndex = node.parentId
          ? levelIndexById.get(node.parentId as LevelNode['id'])
          : undefined

        if (parentLevelIndex !== lowestLevelIndex) {
          return
        }
      }

      polygons.push(node.polygon as [number, number][])
    })

    if (polygons.length > 0) {
      // Format for polygon-clipping: [[[x, y], [x, y], ...]]
      const multiPolygons = polygons.map((pts) => {
        const ring = pts.map((p) => [p[0], -p[1]] as [number, number]) // Negate Y (which was Z)
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
    <mesh position-y={-0.05} rotation-x={-Math.PI / 2}>
      <shapeGeometry args={[shape]} />
      <meshBasicMaterial
        color={bgColor}
        depthWrite={true}
        polygonOffset={true}
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
      />
    </mesh>
  )
}
