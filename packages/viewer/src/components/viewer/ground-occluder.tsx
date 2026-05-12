import { type LevelNode, useScene } from '@pascal-app/core'
import { useMemo } from 'react'
import * as THREE from 'three'
import { unionPolygons } from '../../lib/polygon-union'
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
      if (
        !(
          node.type === 'slab' &&
          node.visible &&
          node.polygon.length >= 3 &&
          // Only recessed slabs should punch through the ground plane.
          (node.elevation ?? 0.05) < 0
        )
      ) {
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
      for (const ring of unionPolygons(polygons.map((pts) => pts.map((p) => [p[0], -p[1]])))) {
        if (ring.length < 3) continue
        const hole = new THREE.Path()

        hole.moveTo(ring[0]![0], ring[0]![1])
        for (let i = 1; i < ring.length; i++) {
          hole.lineTo(ring[i]![0], ring[i]![1])
        }
        hole.closePath()
        s.holes.push(hole)
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
