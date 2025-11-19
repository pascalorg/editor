import { useMemo, useRef } from 'react'
import type * as THREE from 'three'
import { useEditor } from '@/hooks/use-editor'
import { getRenderer } from '@/lib/nodes/registry'
import type { AnyNode, GridItem } from '@/lib/scenegraph/schema/index'
import { TILE_SIZE } from '../editor'
import { SelectionBox } from './selection-box'

interface NodeRendererProps {
  node: AnyNode
  isViewer?: boolean // Set to true when rendering in viewer mode
}

export function NodeRenderer({ node, isViewer = false }: NodeRendererProps) {
  const gridItemPosition = useMemo(() => {
    const gridItem = node as unknown as GridItem
    if (gridItem.position) {
      const [x, y] = gridItem.position
      return [x * TILE_SIZE, gridItem.elevation || 0, y * TILE_SIZE] as [number, number, number]
    }
    return [0, gridItem.elevation || 0, 0] as [number, number, number]
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

  // Try to get renderer from registry first
  const RegistryRenderer = getRenderer(node.type)

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
        visible={'visible' in node ? node.visible : true}
      >
        <group ref={groupRef}>
          {/* Use registry renderer if available, otherwise fallback to direct imports */}
          {RegistryRenderer && <RegistryRenderer node={node} />}

          {/* Recursively render children INSIDE parent group - children use relative positions */}
          {'children' in node &&
            Array.isArray(node.children) &&
            node.children.map((childNode: AnyNode) => (
              <NodeRenderer isViewer={isViewer} key={childNode.id} node={childNode} />
            ))}
        </group>
        {isSelected && controlMode === 'select' && <SelectionBox group={groupRef} />}
      </group>
    </>
  )
}
