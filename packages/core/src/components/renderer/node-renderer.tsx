'use client'

import { useSpring } from '@react-spring/three'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import { useEditor } from '../../hooks'
import { getRenderer } from '../../registry'
import type { AnyNode, AnyNodeId, BaseNode } from '../../scenegraph/schema'
import { FLOOR_SPACING, TILE_SIZE } from '../../constants'

interface NodeRendererProps {
  nodeId: BaseNode['id']
  isViewer?: boolean // Set to true when rendering in viewer mode
}

interface AnimatedLevelGroupProps {
  children: React.ReactNode
  basePosition: [number, number, number]
  rotation: [number, number, number]
  visible?: boolean
  name: string
  userData: any
  levelIndex: number
}

/**
 * Animated group specifically for level nodes.
 * Subscribes to levelMode changes imperatively and animates Y position with spring.
 */
const AnimatedLevelGroup = ({
  children,
  basePosition,
  rotation,
  visible,
  name,
  userData,
  levelIndex,
}: AnimatedLevelGroupProps) => {
  const groupRef = useRef<THREE.Group>(null)

  // Calculate initial Y based on current levelMode
  const getTargetY = (levelMode: 'stacked' | 'exploded') =>
    basePosition[1] + (levelMode === 'exploded' ? levelIndex * FLOOR_SPACING : 0)

  // Spring for smooth Y position transitions
  const { y } = useSpring({
    y: getTargetY(useEditor.getState().levelMode),
    config: {
      mass: 1,
      tension: 170,
      friction: 26,
    },
  })

  // Subscribe to levelMode changes and trigger spring animation
  useEffect(() => {
    let prevLevelMode = useEditor.getState().levelMode
    const unsubscribe = useEditor.subscribe((state) => {
      if (state.levelMode !== prevLevelMode) {
        prevLevelMode = state.levelMode
        y.start(getTargetY(state.levelMode))
      }
    })
    return unsubscribe
  }, [levelIndex, basePosition, y])

  // Update spring target when basePosition changes
  useEffect(() => {
    y.start(getTargetY(useEditor.getState().levelMode))
  }, [basePosition, y])

  // Apply animated Y position to group each frame
  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.position.y = y.get()
    }
  })

  return (
    <group
      name={name}
      position={[basePosition[0], basePosition[1], basePosition[2]]}
      ref={groupRef}
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
    nodeType,
    nodeVisible,
    nodePosition,
    nodeRotation,
    nodeElevation,
    nodeLevel,
    nodeChildrenIdsStr,
  } = useEditor(
    useShallow((state) => {
      const handle = state.graph.getNodeById(nodeId as AnyNodeId)
      const node = handle?.data()
      return {
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

  // Base position without level offset (level offset is handled by AnimatedLevelGroup)
  const basePosition = useMemo(() => {
    if (nodePosition) {
      const [x, y] = nodePosition
      return [x * TILE_SIZE, nodeElevation || 0, y * TILE_SIZE] as [number, number, number]
    }
    return [0, nodeElevation || 0, 0] as [number, number, number]
  }, [nodePosition, nodeElevation])

  const viewerDisplayMode = useEditor((state) => state.viewerDisplayMode)

  // Ref for the outer group to control visibility imperatively
  const groupRef = useRef<THREE.Group>(null)

  // For level nodes in viewer mode, subscribe to selectedFloorId changes
  // and update visibility imperatively without causing re-renders
  const isViewerLevelNode = isViewer && nodeType === 'level'
  useEffect(() => {
    if (!isViewerLevelNode) return

    // Update visibility based on selectedFloorId
    const updateVisibility = (selectedFloorId: string | null) => {
      if (groupRef.current) {
        const shouldBeVisible = !selectedFloorId || selectedFloorId === nodeId
        groupRef.current.visible = shouldBeVisible
      }
    }

    // Set initial state
    updateVisibility(useEditor.getState().selectedFloorId)

    // Subscribe to store changes and check if selectedFloorId changed
    let prevSelectedFloorId = useEditor.getState().selectedFloorId
    const unsubscribe = useEditor.subscribe((state) => {
      if (state.selectedFloorId !== prevSelectedFloorId) {
        prevSelectedFloorId = state.selectedFloorId
        updateVisibility(state.selectedFloorId)
      }
    })

    return unsubscribe
  }, [isViewerLevelNode, nodeId])

  // Filter nodes based on viewer display mode (only in viewer mode)
  // Note: Level visibility is now handled imperatively via subscription above
  const shouldRenderNode = useMemo(() => {
    // Viewer-specific visibility logic
    if (isViewer) {
      // Level nodes are always rendered (visibility controlled imperatively)
      if (nodeType === 'level') {
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
  }, [nodeType, viewerDisplayMode, isViewer])

  // Try to get renderer from registry first
  const RegistryRenderer = getRenderer(nodeType || 'unknown')

  // Don't render if filtered out by display mode
  if (!shouldRenderNode) {
    return null
  }

  const rotation: [number, number, number] = Array.isArray(nodeRotation)
    ? (nodeRotation as [number, number, number])
    : [0, nodeRotation ?? 0, 0]

  const children = (
    <>
      {/* Use registry renderer if available, otherwise fallback to direct imports */}
      {RegistryRenderer && <RegistryRenderer nodeId={nodeId} />}

      {/* Recursively render children INSIDE parent group - children use relative positions */}
      {nodeChildrenIds.length > 0 &&
        nodeChildrenIds.map((childNodeId: AnyNode['id']) => (
          <NodeRenderer isViewer={isViewer} key={childNodeId} nodeId={childNodeId} />
        ))}
    </>
  )

  // Level nodes use AnimatedLevelGroup for smooth levelMode transitions
  if (nodeType === 'level') {
    return (
      <group ref={groupRef}>
        <AnimatedLevelGroup
          basePosition={basePosition}
          levelIndex={nodeLevel || 0}
          name={nodeId}
          rotation={rotation}
          userData={{ nodeId }}
          visible={nodeVisible}
        >
          {children}
        </AnimatedLevelGroup>
      </group>
    )
  }

  // Non-level nodes use a plain group
  return (
    <group ref={groupRef}>
      <group
        name={nodeId}
        position={basePosition}
        rotation={rotation}
        userData={{ nodeId }}
        visible={nodeVisible}
      >
        {children}
      </group>
    </group>
  )
}
