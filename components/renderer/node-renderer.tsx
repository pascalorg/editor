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
import { useMemo, useRef } from 'react'
import type * as THREE from 'three'
import { TILE_SIZE } from '../editor'
import { ColumnRenderer } from './column-renderer'
import { DoorRenderer } from './door-renderer'
import { ImageRenderer } from './image-renderer'
import { RoofRenderer } from './roof-renderer'
import { ScanRenderer } from './scan-renderer'
import { SelectionBox } from './selection-box'
import { WallRenderer } from './wall-renderer'
import { WindowRenderer } from './window-renderer'

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
  const controlMode = useEditor((state) => state.controlMode)

  const isSelected = useMemo(() => selectedElements.includes(node.id), [selectedElements, node])

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

  const groupRef = useRef<THREE.Group>(null)

  // Don't render if filtered out by display mode
  if (!shouldRenderNode && node.type !== 'level') {
    return null
  }

  return (
    <>
      <group
        name={node.id}
        position={gridItemPosition}
        rotation-y={(node as unknown as GridItem).rotation || 0}
        userData={{
          nodeId: node.id,
        }}
        visible={node.visible}
      >
        <group ref={groupRef}>
          {/* {node.type === 'group' && <GroupRenderer node={node} />} */}
          {node.type === 'wall' && <WallRenderer node={node as WallNode} />}
          {node.type === 'roof' && <RoofRenderer node={node as RoofNode} />}
          {node.type === 'column' && <ColumnRenderer node={node as ColumnNode} />}
          {node.type === 'door' && <DoorRenderer node={node as DoorNode} />}
          {node.type === 'window' && <WindowRenderer node={node as WindowNode} />}
          {node.type === 'reference-image' && <ImageRenderer node={node as ReferenceImageNode} />}
          {node.type === 'scan' && <ScanRenderer node={node as ScanNode} />}

          {/* Selection outline for grid items */}
          {/* {(node as unknown as GridItem).size && isSelected && (
        <SelectionOutline gridItem={node as unknown as GridItem} />
      )} */}

          {/* Recursively render children INSIDE parent group - children use relative positions */}
          {node.children.map((childNode) => (
            <NodeRenderer isViewer={isViewer} key={childNode.id} node={childNode} />
          ))}
        </group>
        {isSelected && controlMode === 'select' && <SelectionBox group={groupRef} />}
      </group>
    </>
  )
}
