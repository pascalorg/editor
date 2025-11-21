import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import type * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import { shallow } from 'zustand/shallow'
import { useEditor } from '@/hooks/use-editor'
import { getRenderer } from '@/lib/nodes/registry'
import type { AnyNode, AnyNodeId, BaseNode } from '@/lib/scenegraph/schema/index'
import { TILE_SIZE } from '../editor'
import { SelectionBox } from './selection-box'

interface NodeRendererProps {
  nodeId: BaseNode['id']
  isViewer?: boolean // Set to true when rendering in viewer mode
}

export function NodeRenderer({ nodeId, isViewer = false }: NodeRendererProps) {
  const { nodeType, nodeVisible, nodePosition, nodeRotation, nodeElevation, nodeChildrenIdsStr } =
    useEditor(
      useShallow((state) => {
        const handle = state.graph.getNodeById(nodeId)
        const node = handle?.data()
        return {
          nodeType: node?.type,
          nodeVisible: (node as any)?.visible, // TODO: Type correctly
          nodeChildrenIdsStr: JSON.stringify(
            (node as any)?.children?.map((child: AnyNode) => child.id) || [],
          ), // Storing into string to avoid deep equality issues
          nodePosition: (node as any)?.position, // TODO: Type correctly
          nodeElevation: (node as any)?.elevation, // TODO: Type correctly
          nodeRotation: (node as any)?.rotation, // TODO: Type correctly
        }
      }),
    )

  const nodeChildrenIds = useMemo(
    () => JSON.parse(nodeChildrenIdsStr || '[]'),
    [nodeChildrenIdsStr],
  )

  const gridItemPosition = useMemo(() => {
    if (nodePosition) {
      const [x, y] = nodePosition
      return [x * TILE_SIZE, nodeElevation || 0, y * TILE_SIZE] as [number, number, number]
    }
    return [0, nodeElevation || 0, 0] as [number, number, number]
  }, [nodePosition, nodeElevation])

  const selectedElements = useEditor((state) => state.selectedElements)
  const viewerDisplayMode = useEditor((state) => state.viewerDisplayMode)
  const controlMode = useEditor((state) => state.controlMode)

  const isSelected = useMemo(
    () => selectedElements.includes(nodeId as AnyNodeId),
    [selectedElements, nodeId],
  )

  // Filter nodes based on viewer display mode (only in viewer mode)
  const shouldRenderNode = useMemo(() => {
    // Level nodes are always rendered (they're containers)
    if (nodeType === 'level') return true

    // Only apply display mode filtering in viewer mode
    if (isViewer) {
      if (viewerDisplayMode === 'scans') {
        // Only render scan nodes
        return nodeType === 'scan'
      }
      if (viewerDisplayMode === 'objects') {
        // Render everything except scans
        return nodeType !== 'scan'
      }
    }

    // Default: render everything (editor mode or when no filtering is needed)
    return true
  }, [nodeType, viewerDisplayMode, isViewer])

  const groupRef = useRef<THREE.Group>(null)

  // Try to get renderer from registry first
  const RegistryRenderer = getRenderer(nodeType || 'unknown')

  // Don't render if filtered out by display mode
  if (!shouldRenderNode && nodeType !== 'level') {
    return null
  }

  return (
    <>
      <group
        name={nodeId}
        position={gridItemPosition}
        rotation-y={nodeRotation}
        userData={{
          nodeId,
        }}
        visible={nodeVisible}
      >
        <group ref={groupRef}>
          {/* Use registry renderer if available, otherwise fallback to direct imports */}
          {RegistryRenderer && <RegistryRenderer nodeId={nodeId} />}

          {/* Recursively render children INSIDE parent group - children use relative positions */}
          {nodeChildrenIds.length > 0 &&
            nodeChildrenIds.map((childNodeId: AnyNode['id']) => (
              <NodeRenderer isViewer={isViewer} key={childNodeId} nodeId={childNodeId} />
            ))}
        </group>
        {isSelected && controlMode === 'select' && <SelectionBox group={groupRef} />}
      </group>
    </>
  )
}
