import { type BaseNode, type GridItem, useEditor } from '@/hooks/use-editor'
import { useMemo } from 'react'
import { TILE_SIZE } from '../editor'
import { WALL_HEIGHT } from '../viewer'

export function GroupRenderer({ node }: { node: BaseNode }) {
  const children = node.children
  const selectedElements = useEditor((state) => state.selectedElements)
  const isSelected = useMemo(
    () => selectedElements.some((el) => el.id === node.id),
    [selectedElements, node],
  )

  const { width, depth, startPoint } = useMemo(() => {
    if (!isSelected || children.length === 0)
      return { width: 0, depth: 0, startPoint: { x: 0, z: 0 } }

    let minX = Number.POSITIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY

    children.forEach((child: BaseNode) => {
      const gridItem = child as unknown as GridItem
      if (!gridItem.position) return

      const [cx, cz] = gridItem.position
      const sizeX = gridItem.size?.[0] || 1
      const sizeZ = gridItem.size?.[1] || 1
      const rotation = gridItem.rotation || 0

      // Walls have position at START point, not center
      // Other elements have position at center
      if (child.type === 'wall') {
        // For walls: position is start point, calculate end point
        const cos = Math.cos(rotation)
        const sin = Math.sin(rotation)

        const length = sizeX // Wall length
        const thickness = sizeZ // Wall thickness (0.2)

        // Start and end points along the wall centerline
        const startX = cx
        const startZ = cz
        const endX = cx + cos * length
        const endZ = cz - sin * length

        // Perpendicular offset for thickness
        const perpX = (-sin * thickness) / 2
        const perpZ = (-cos * thickness) / 2

        // 4 corners of the wall
        const corners = [
          [startX + perpX, startZ + perpZ],
          [startX - perpX, startZ - perpZ],
          [endX + perpX, endZ + perpZ],
          [endX - perpX, endZ - perpZ],
        ]

        corners.forEach(([wx, wz]) => {
          minX = Math.min(minX, wx)
          minZ = Math.min(minZ, wz)
          maxX = Math.max(maxX, wx)
          maxZ = Math.max(maxZ, wz)
        })
      } else {
        // For non-walls: position is center
        const halfX = sizeX / 2
        const halfZ = sizeZ / 2
        const corners = [
          [-halfX, -halfZ],
          [halfX, -halfZ],
          [halfX, halfZ],
          [-halfX, halfZ],
        ]

        const cos = Math.cos(rotation)
        const sin = Math.sin(rotation)

        corners.forEach(([lx, lz]) => {
          // Apply rotation
          const rotatedX = lx * cos - lz * sin
          const rotatedZ = lx * sin + lz * cos

          // Transform to world space
          const worldX = cx + rotatedX
          const worldZ = cz + rotatedZ

          // Update bounds
          minX = Math.min(minX, worldX)
          minZ = Math.min(minZ, worldZ)
          maxX = Math.max(maxX, worldX)
          maxZ = Math.max(maxZ, worldZ)
        })
      }
    })

    const width = maxX - minX
    const depth = maxZ - minZ
    const startPoint = { x: minX, z: minZ }

    return { width, depth, startPoint }
  }, [children, isSelected, node.id])
  // Calculate center point for mesh positioning
  const centerX = startPoint.x + width / 2
  const centerZ = startPoint.z + depth / 2

  if (!isSelected) return null

  return (
    <group>
      <mesh position={[centerX * TILE_SIZE, WALL_HEIGHT / 2, centerZ * TILE_SIZE]}>
        <boxGeometry args={[width * TILE_SIZE + 0.5, WALL_HEIGHT, depth * TILE_SIZE + 0.5]} />
        <meshStandardMaterial color="blue" depthWrite={false} opacity={0.2} transparent />
      </mesh>
    </group>
  )
}
