import { useMemo } from 'react'
import * as THREE from 'three'
import { useEditor } from '@/hooks/use-editor'
import type {
  BaseNode,
  ColumnNode,
  DoorNode,
  GridItem,
  ReferenceImageNode,
  RoofNode,
  ScanNode,
  WallNode,
  WindowNode,
} from '@/lib/nodes/types'
import { TILE_SIZE, WALL_HEIGHT } from '../editor'
import { ColumnRenderer } from './column-renderer'
import { DoorRenderer } from './door-renderer'
import { GroupRenderer } from './group-renderer'
import { ImageRenderer } from './image-renderer'
import { RoofRenderer } from './roof-renderer'
import { ScanRenderer } from './scan-renderer'
import { WallRenderer } from './wall-renderer'
import { WindowRenderer } from './window-renderer'

const OUTLINE_RADIUS = 0.02 // 2cm radius for selection outline cylinders

// Helper function to create a cylinder between two points
function createEdgeCylinder(start: number[], end: number[]) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const dz = end[2] - start[2]
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz)

  const geometry = new THREE.CylinderGeometry(OUTLINE_RADIUS, OUTLINE_RADIUS, length, 8)
  const midpoint = new THREE.Vector3(
    (start[0] + end[0]) / 2,
    (start[1] + end[1]) / 2,
    (start[2] + end[2]) / 2,
  )

  // Calculate rotation to align cylinder with edge
  const direction = new THREE.Vector3(dx, dy, dz).normalize()
  const axis = new THREE.Vector3(0, 1, 0).cross(direction).normalize()
  const angle = Math.acos(new THREE.Vector3(0, 1, 0).dot(direction))

  return { geometry, midpoint, axis, angle }
}

// Selection outline component for grid items
function SelectionOutline({ gridItem }: { gridItem: GridItem }) {
  const edges = useMemo(() => {
    const [width, depth] = gridItem.size
    const worldWidth = width * TILE_SIZE
    const worldDepth = (depth || width) * TILE_SIZE // Use width if depth not specified

    // Create bottom corners (y=0)
    const bottomCorners = [
      [0, 0, 0],
      [worldWidth, 0, 0],
      [worldWidth, 0, worldDepth],
      [0, 0, worldDepth],
    ]

    // Create top corners (y=WALL_HEIGHT)
    const topCorners = [
      [0, WALL_HEIGHT, 0],
      [worldWidth, WALL_HEIGHT, 0],
      [worldWidth, WALL_HEIGHT, worldDepth],
      [0, WALL_HEIGHT, worldDepth],
    ]

    const edgeList = []

    // Bottom rectangle edges
    for (let i = 0; i < bottomCorners.length; i++) {
      edgeList.push([bottomCorners[i], bottomCorners[(i + 1) % bottomCorners.length]])
    }

    // Top rectangle edges
    for (let i = 0; i < topCorners.length; i++) {
      edgeList.push([topCorners[i], topCorners[(i + 1) % topCorners.length]])
    }

    // Vertical edges connecting bottom to top
    for (let i = 0; i < bottomCorners.length; i++) {
      edgeList.push([bottomCorners[i], topCorners[i]])
    }

    return edgeList.map((edge, idx) => {
      const { geometry, midpoint, axis, angle } = createEdgeCylinder(edge[0], edge[1])
      return { geometry, midpoint, axis, angle, key: idx }
    })
  }, [gridItem.size])

  return (
    <>
      {edges.map(({ geometry, midpoint, axis, angle, key }) => (
        <mesh
          geometry={geometry}
          key={key}
          position={midpoint}
          quaternion={new THREE.Quaternion().setFromAxisAngle(axis, angle)}
          renderOrder={999}
        >
          <meshStandardMaterial
            color="#ffffff"
            depthTest={false}
            emissive="#ffffff"
            emissiveIntensity={0.5}
          />
        </mesh>
      ))}
    </>
  )
}

interface NodeRendererProps {
  node: BaseNode
  isViewer?: boolean // Set to true when rendering in viewer mode
}

export function NodeRenderer({ node, isViewer = false }: NodeRendererProps) {
  const gridItemPosition = useMemo(() => {
    const gridItem = node as unknown as GridItem
    if (gridItem.position) {
      const [x, y] = gridItem.position
      return [x * TILE_SIZE, 0, y * TILE_SIZE] as [number, number, number]
    }
    return [0, 0, 0] as [number, number, number]
  }, [node])

  const selectedElements = useEditor((state) => state.selectedElements)
  const viewerDisplayMode = useEditor((state) => state.viewerDisplayMode)

  const isSelected = useMemo(
    () => selectedElements.some((el) => el.id === node.id),
    [selectedElements, node],
  )

  // Filter nodes based on viewer display mode (only in viewer mode)
  const shouldRenderNode = useMemo(() => {
    // Level nodes are always rendered (they're containers)
    if (node.type === 'level') return true

    // Only apply display mode filtering in viewer mode
    if (isViewer) {
      if (viewerDisplayMode === 'scans') {
        // Only render scan nodes
        return node.type === 'scan'
      }
      if (viewerDisplayMode === 'objects') {
        // Render everything except scans
        return node.type !== 'scan'
      }
    }

    // Default: render everything (editor mode or when no filtering is needed)
    return true
  }, [node.type, viewerDisplayMode, isViewer])

  // Don't render if filtered out by display mode
  if (!shouldRenderNode && node.type !== 'level') {
    return null
  }

  // TODO: If node has children and is selected we could calculate a bounding box around all children and render that too

  return (
    <>
      <group
        position={gridItemPosition}
        rotation-y={(node as unknown as GridItem).rotation || 0}
        visible={node.visible}
      >
        {node.type === 'group' && <GroupRenderer node={node} />}
        {node.type === 'wall' && <WallRenderer node={node as WallNode} />}
        {node.type === 'roof' && <RoofRenderer node={node as RoofNode} />}
        {node.type === 'column' && <ColumnRenderer node={node as ColumnNode} />}
        {node.type === 'door' && <DoorRenderer node={node as DoorNode} />}
        {node.type === 'window' && <WindowRenderer node={node as WindowNode} />}
        {node.type === 'reference-image' && <ImageRenderer node={node as ReferenceImageNode} />}
        {node.type === 'scan' && <ScanRenderer node={node as ScanNode} />}

        {/* Selection outline for grid items */}
        {(node as unknown as GridItem).size && isSelected && (
          <SelectionOutline gridItem={node as unknown as GridItem} />
        )}
      </group>
      {/* Recursively render children - pass isViewer prop down */}
      {node.children.map((childNode) => (
        <NodeRenderer isViewer={isViewer} key={childNode.id} node={childNode} />
      ))}
    </>
  )
}
