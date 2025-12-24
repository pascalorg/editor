import { animated, useSpring } from '@react-spring/three'
import { useMemo, useRef } from 'react'
import type * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import { useEditor } from '@/hooks/use-editor'
import { getRenderer } from '@/lib/nodes/registry'
import type { AnyNode, AnyNodeId, BaseNode } from '@/lib/scenegraph/schema/index'
import { FLOOR_SPACING, TILE_SIZE } from '../editor'

interface NodeRendererProps {
  nodeId: BaseNode['id']
  isViewer?: boolean // Set to true when rendering in viewer mode
}

interface AnimatedGroupProps {
  children: React.ReactNode
  position: [number, number, number]
  rotation: [number, number, number]
  visible?: boolean
  name: string
  userData: any
  // activeTool: any
  // movingCamera: boolean
}

interface GroupProps {
  children: React.ReactNode
  position: [number, number, number]
  rotation: [number, number, number]
  visible?: boolean
  name: string
  userData: any
  shouldAnimate: boolean
  // activeTool: any
  // movingCamera: boolean
}

const AnimatedGroup = ({
  children,
  position,
  rotation,
  visible,
  name,
  userData,
  // activeTool,
  // movingCamera,
}: AnimatedGroupProps) => {
  const { springPosition } = useSpring({
    springPosition: position,
    config: {
      mass: 1,
      tension: 170,
      friction: 26,
    },
    // immediate: !!activeTool || movingCamera,
  })

  return (
    <animated.group
      name={name}
      position={springPosition as any}
      rotation={rotation}
      userData={userData}
      visible={visible}
    >
      {children}
    </animated.group>
  )
}

const Group = ({
  children,
  position,
  rotation,
  visible,
  name,
  userData,
  shouldAnimate,
}: GroupProps) => {
  if (shouldAnimate) {
    return (
      <AnimatedGroup
        name={name}
        position={position}
        rotation={rotation}
        userData={userData}
        visible={visible}
      >
        {children}
      </AnimatedGroup>
    )
  }

  return (
    <group
      name={name}
      position={position}
      rotation={rotation}
      userData={userData}
      visible={visible}
    >
      {children}
    </group>
  )
}

export function NodeRenderer({ nodeId, isViewer = false }: NodeRendererProps) {
  const {
    levelMode,
    nodeType,
    nodeVisible,
    nodePosition,
    nodeRotation,
    nodeElevation,
    nodeLevel,
    nodeChildrenIdsStr,
    selectedFloorId,
  } = useEditor(
    useShallow((state) => {
      const handle = state.graph.getNodeById(nodeId as AnyNodeId)
      const node = handle?.data()
      return {
        selectedFloorId: state.selectedFloorId,
        levelMode: state.levelMode,
        nodeType: node?.type,
        nodeVisible: (node as any)?.visible, // TODO: Type correctly
        nodeChildrenIdsStr: JSON.stringify(
          (node as any)?.children?.map((child: AnyNode) => child.id) || [],
        ), // Storing into string to avoid deep equality issues
        nodePosition: (node as any)?.position, // TODO: Type correctly
        nodeElevation: (node as any)?.elevation, // TODO: Type correctly
        nodeRotation: (node as any)?.rotation, // TODO: Type correctly - can be number or [x,y,z] tuple
        nodeLevel: (node as any)?.level, // TODO: Type correctly
      }
    }),
  )

  const nodeChildrenIds = useMemo(
    () => JSON.parse(nodeChildrenIdsStr || '[]'),
    [nodeChildrenIdsStr],
  )

  const gridItemPosition = useMemo(() => {
    let levelOffset = 0
    if (nodeType === 'level' && levelMode === 'exploded') {
      levelOffset = nodeLevel * FLOOR_SPACING
    }
    if (nodePosition) {
      const [x, y] = nodePosition
      return [x * TILE_SIZE, (nodeElevation || 0) + levelOffset, y * TILE_SIZE] as [
        number,
        number,
        number,
      ]
    }
    return [0, (nodeElevation || 0) + levelOffset, 0] as [number, number, number]
  }, [nodePosition, nodeElevation, nodeLevel, levelMode, nodeType])

  const viewerDisplayMode = useEditor((state) => state.viewerDisplayMode)

  // Filter nodes based on viewer display mode (only in viewer mode)
  const shouldRenderNode = useMemo(() => {
    // Viewer-specific visibility logic
    if (isViewer) {
      // Level visibility: if a floor is selected, hide other floors
      if (nodeType === 'level') {
        if (selectedFloorId && selectedFloorId !== nodeId) {
          return false
        }
        return true
      }

      if (viewerDisplayMode === 'scans') {
        // Only render scan nodes
        return nodeType === 'scan'
      }
      if (viewerDisplayMode === 'objects') {
        // Render everything except scans and reference images
        return nodeType !== 'scan' && nodeType !== 'reference-image'
      }
    }

    // Level nodes are always rendered in editor mode
    if (nodeType === 'level') return true

    // Default: render everything (editor mode or when no filtering is needed)
    return true
  }, [nodeType, viewerDisplayMode, isViewer, selectedFloorId, nodeId])

  const groupRef = useRef<THREE.Group>(null)

  // Try to get renderer from registry first
  const RegistryRenderer = getRenderer(nodeType || 'unknown')

  // Don't render if filtered out by display mode
  if (!shouldRenderNode) {
    return null
  }

  return (
    <>
      <Group
        name={nodeId}
        position={gridItemPosition}
        rotation={
          Array.isArray(nodeRotation)
            ? (nodeRotation as [number, number, number])
            : [0, nodeRotation ?? 0, 0]
        }
        shouldAnimate={nodeType === 'level'}
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
      </Group>
    </>
  )
}
