'use client'

import { Line } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { memo, useCallback, useMemo, useState } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/shallow'
import { TILE_SIZE, WALL_HEIGHT } from '@/components/editor'
import { useEditor } from '@/hooks/use-editor'
import type { RoofNode } from '@/lib/scenegraph/schema/index'

const ROOF_WIDTH = 6 // 6m total width (3m on each side of ridge)
const OUTLINE_RADIUS = 0.02 // 2cm radius for selection outline cylinders

// Handle geometry dimensions
const DEBUG = false
const ORIGIN_MARKER_SIZE = 0.16
const ARROW_SHAFT_RADIUS = 0.06
const ARROW_SHAFT_LENGTH = 0.5
const ARROW_HEAD_RADIUS = 0.12
const ARROW_HEAD_LENGTH = 0.3
const ROTATION_HANDLE_RADIUS = 0.4
const ROTATION_HANDLE_THICKNESS = 0.06

// Hit target scale factors
const ORIGIN_HIT_SCALE = 2.5
const ARROW_HIT_RADIUS_SCALE = 2.5
const ARROW_HIT_LENGTH_SCALE = 1.7
const ROTATION_HIT_SCALE = 2

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

// Material components for handles
const HitMaterial = () => {
  const hitAreaOpacity = DEBUG ? (0.5 as const) : 0
  return <meshStandardMaterial depthTest={false} opacity={hitAreaOpacity} transparent />
}

const HandleMaterial = ({
  color,
  opacity,
  emissiveIntensity,
}: {
  color: string
  opacity: number
  emissiveIntensity: number
}) => (
  <meshStandardMaterial
    color={color}
    depthTest={false}
    emissive={color}
    emissiveIntensity={emissiveIntensity}
    metalness={0.3}
    opacity={opacity}
    roughness={0.4}
    side={THREE.DoubleSide}
    transparent
  />
)

interface RoofRendererProps {
  nodeId: RoofNode['id']
}

export function RoofRenderer({ nodeId }: RoofRendererProps) {
  const getLevelId = useEditor((state) => state.getLevelId)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const tileSize = TILE_SIZE
  const baseHeight = WALL_HEIGHT

  // Track hover and active states for handles
  const [hoveredHandle, setHoveredHandle] = useState<string | null>(null)
  const [activeHandle, setActiveHandle] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Three.js scene utilities
  const { camera, gl } = useThree()

  const {
    isPreview,
    levelId,
    nodePosition,
    nodeVisible,
    nodeOpacity,
    nodeHeight,
    nodeLeftWidth,
    nodeRightWidth,
    nodeSize,
    nodeRotation,
    isSelected,
    movingCamera,
    controlMode,
  } = useEditor(
    useShallow((state) => {
      const node = state.nodeIndex.get(nodeId) as RoofNode | undefined
      return {
        isPreview: node?.editor?.preview === true,
        levelId: state.getLevelId(node!),
        nodePosition: node?.position,
        nodeVisible: node?.visible,
        nodeOpacity: node?.opacity,
        nodeHeight: (node as any).height ?? 2.5,
        nodeLeftWidth: (node as any).leftWidth ?? ROOF_WIDTH / 2,
        nodeRightWidth: (node as any).rightWidth ?? ROOF_WIDTH / 2,
        nodeSize: node?.size || [0, 0],
        nodeRotation: node?.rotation || 0,
        isSelected: state.selectedElements.includes(nodeId),
        movingCamera: state.movingCamera,
        controlMode: state.controlMode,
      }
    }),
  )

  // Roof segment with ABSOLUTE grid coordinates (for manipulation handles)
  const roofSegment = useMemo(() => {
    const [x1, y1] = nodePosition || [0, 0]
    const length = nodeSize[0]
    const x2 = x1 + Math.cos(nodeRotation) * length
    const y2 = y1 - Math.sin(nodeRotation) * length

    return {
      start: [x1, y1] as [number, number],
      end: [x2, y2] as [number, number],
      id: nodeId,
      height: nodeHeight,
      leftWidth: nodeLeftWidth,
      rightWidth: nodeRightWidth,
      visible: nodeVisible ?? true,
      opacity: nodeOpacity ?? 100,
    }
  }, [
    nodeHeight,
    nodeLeftWidth,
    nodeRightWidth,
    nodeVisible,
    nodeOpacity,
    nodePosition,
    nodeSize,
    nodeRotation,
    nodeId,
  ])
  // Local segment for rendering (parent group handles position & rotation)
  const localSegment = useMemo(() => {
    const length = nodeSize[0]
    return {
      start: [0, 0] as [number, number], // Start at origin in local space
      end: [length, 0] as [number, number], // End along local X axis
      height: nodeHeight,
      leftWidth: nodeLeftWidth,
      rightWidth: nodeRightWidth,
    }
  }, [nodeHeight, nodeLeftWidth, nodeRightWidth, nodeSize])

  // Update roof segment in the store
  const updateRoofSegment = useCallback(
    (updatedSegment: typeof roofSegment) => {
      const state = useEditor.getState()
      const [x1, y1] = updatedSegment.start
      const [x2, y2] = updatedSegment.end
      const dx = x2 - x1
      const dy = y2 - y1
      const length = Math.sqrt(dx * dx + dy * dy)
      const rotation = Math.atan2(-dy, dx) // Negate dy to match 3D z-axis direction

      const updates: Record<string, unknown> = {
        position: [x1, y1] as [number, number],
        rotation,
        size: [length, 0] as [number, number],
        height: updatedSegment.height,
        leftWidth: updatedSegment.leftWidth,
        rightWidth: updatedSegment.rightWidth,
        visible: updatedSegment.visible ?? true,
        opacity: updatedSegment.opacity ?? 100,
      }

      // TODO: Refaactor to use updateNode with command manager for undo/redo
      // const updatedLevels = updateNodeProperties(state.levels, nodeId, updates)
      // state.updateLevels(updatedLevels) // Don't push to undo during drag - final commit handled by drag handlers
    },
    [nodeId],
  )

  // Handle drag for edge manipulation
  const handleEdgeDrag = useCallback(
    (handleId: string, handleType: 'horizontal' | 'ridge') => {
      // Capture original segment state for undo
      const originalSegmentState = {
        start: roofSegment.start,
        end: roofSegment.end,
        height: roofSegment.height,
        leftWidth: roofSegment.leftWidth,
        rightWidth: roofSegment.rightWidth,
      }

      const plane = new THREE.Plane()
      const raycaster = new THREE.Raycaster()
      const pointer = new THREE.Vector2()

      // Setup plane based on handle type
      if (handleType === 'ridge') {
        // Ridge handle moves along Y axis
        const cameraDirection = new THREE.Vector3()
        camera.getWorldDirection(cameraDirection)
        cameraDirection.y = 0
        cameraDirection.normalize()
        plane.setFromNormalAndCoplanarPoint(cameraDirection, new THREE.Vector3(0, 0, 0))
      } else {
        // Horizontal edge handle moves on the ZX plane (ground plane)
        plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0))
      }

      const intersection = new THREE.Vector3()
      let startPoint: THREE.Vector3 | null = null
      let originalSegment = roofSegment
      let hasChanged = false

      const onPointerMove = (event: PointerEvent) => {
        // Calculate pointer position
        const rect = gl.domElement.getBoundingClientRect()
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

        raycaster.setFromCamera(pointer, camera)

        if (!raycaster.ray.intersectPlane(plane, intersection)) return

        if (!startPoint) {
          startPoint = intersection.clone()
          return
        }

        const delta = new THREE.Vector3().subVectors(intersection, startPoint)

        // Update segment based on handle type
        let updatedSegment: typeof roofSegment

        if (handleType === 'ridge') {
          // Ridge handle: adjust height
          let newHeight = Math.max(0.5, Math.min(10, originalSegment.height + delta.y))

          // Snap to 0.1 increments when Shift is held
          if (event.shiftKey) {
            newHeight = Math.round(newHeight * 10) / 10
          }

          updatedSegment = { ...originalSegment, height: newHeight }
        } else {
          // Extract edge type from handleId (front, right, back, left)
          const edgeType = handleId.split('-').pop()

          const startWorld = [
            originalSegment.start[0] * tileSize,
            originalSegment.start[1] * tileSize,
          ]
          const endWorld = [originalSegment.end[0] * tileSize, originalSegment.end[1] * tileSize]

          const dx = endWorld[0] - startWorld[0]
          const dz = endWorld[1] - startWorld[1]
          const ridgeLength = Math.sqrt(dx * dx + dz * dz)

          if (ridgeLength < 0.1) {
            updatedSegment = originalSegment
          } else {
            const ridgeDir = { x: dx / ridgeLength, z: dz / ridgeLength }
            const perpDir = { x: -ridgeDir.z, z: ridgeDir.x }

            // Snap to whole grid units when Shift is held
            const snapToGrid = (val: number) => (event.shiftKey ? Math.round(val) : val)

            const currentLeftWidth = originalSegment.leftWidth ?? ROOF_WIDTH / 2
            const currentRightWidth = originalSegment.rightWidth ?? ROOF_WIDTH / 2

            if (edgeType === 'front') {
              // Front edge: move the START point along the ridge direction
              const projectedDelta = delta.x * ridgeDir.x + delta.z * ridgeDir.z
              const newStartX = originalSegment.start[0] + (projectedDelta * ridgeDir.x) / tileSize
              const newStartY = originalSegment.start[1] + (projectedDelta * ridgeDir.z) / tileSize

              updatedSegment = {
                ...originalSegment,
                start: [snapToGrid(newStartX), snapToGrid(newStartY)] as [number, number],
              }
            } else if (edgeType === 'back') {
              // Back edge: move the END point along the ridge direction
              const projectedDelta = delta.x * ridgeDir.x + delta.z * ridgeDir.z
              const newEndX = originalSegment.end[0] + (projectedDelta * ridgeDir.x) / tileSize
              const newEndY = originalSegment.end[1] + (projectedDelta * ridgeDir.z) / tileSize

              updatedSegment = {
                ...originalSegment,
                end: [snapToGrid(newEndX), snapToGrid(newEndY)] as [number, number],
              }
            } else if (edgeType === 'left') {
              // Left edge: move the edge and shift ridge to stay centered
              const projectedDelta = delta.x * perpDir.x + delta.z * perpDir.z
              const newLeftWidth = Math.max(0.5, currentLeftWidth + projectedDelta)

              const ridgeShift = (newLeftWidth - currentLeftWidth) / 2
              const newStartX = originalSegment.start[0] + (ridgeShift * perpDir.x) / tileSize
              const newStartY = originalSegment.start[1] + (ridgeShift * perpDir.z) / tileSize
              const newEndX = originalSegment.end[0] + (ridgeShift * perpDir.x) / tileSize
              const newEndY = originalSegment.end[1] + (ridgeShift * perpDir.z) / tileSize

              const newRightWidth = currentRightWidth + ridgeShift

              updatedSegment = {
                ...originalSegment,
                start: [snapToGrid(newStartX), snapToGrid(newStartY)] as [number, number],
                end: [snapToGrid(newEndX), snapToGrid(newEndY)] as [number, number],
                leftWidth: snapToGrid(newLeftWidth - ridgeShift),
                rightWidth: snapToGrid(newRightWidth),
              }
            } else if (edgeType === 'right') {
              // Right edge: move the edge and shift ridge to stay centered
              const projectedDelta = -(delta.x * perpDir.x + delta.z * perpDir.z)
              const newRightWidth = Math.max(0.5, currentRightWidth + projectedDelta)

              const ridgeShift = -(newRightWidth - currentRightWidth) / 2
              const newStartX = originalSegment.start[0] + (ridgeShift * perpDir.x) / tileSize
              const newStartY = originalSegment.start[1] + (ridgeShift * perpDir.z) / tileSize
              const newEndX = originalSegment.end[0] + (ridgeShift * perpDir.x) / tileSize
              const newEndY = originalSegment.end[1] + (ridgeShift * perpDir.z) / tileSize

              const newLeftWidth = currentLeftWidth - ridgeShift

              updatedSegment = {
                ...originalSegment,
                start: [snapToGrid(newStartX), snapToGrid(newStartY)] as [number, number],
                end: [snapToGrid(newEndX), snapToGrid(newEndY)] as [number, number],
                leftWidth: snapToGrid(newLeftWidth),
                rightWidth: snapToGrid(newRightWidth + ridgeShift),
              }
            } else {
              updatedSegment = originalSegment
            }
          }
        }

        // Update in store
        updateRoofSegment(updatedSegment)
        hasChanged = true
      }

      const onPointerUp = () => {
        setIsDragging(false)
        setActiveHandle(null)
        document.removeEventListener('pointermove', onPointerMove)
        document.removeEventListener('pointerup', onPointerUp)
        gl.domElement.style.cursor = 'auto'

        // Record undo operation if there were changes
        if (hasChanged) {
          // Use updateNode to record the change with command manager
          useEditor.getState().updateNode(nodeId, {
            position: roofSegment.start,
            size: [
              Math.sqrt(
                (roofSegment.end[0] - roofSegment.start[0]) ** 2 +
                  (roofSegment.end[1] - roofSegment.start[1]) ** 2,
              ),
              0,
            ] as [number, number],
            height: roofSegment.height,
            leftWidth: roofSegment.leftWidth,
            rightWidth: roofSegment.rightWidth,
          })
        }
      }

      setIsDragging(true)
      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', onPointerUp)
      gl.domElement.style.cursor = 'grabbing'
    },
    [roofSegment, camera, gl, tileSize, updateRoofSegment, nodeId],
  )

  // Handle rotation around base center
  const handleRotationDrag = useCallback(() => {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()

    const startWorld = [roofSegment.start[0] * tileSize, roofSegment.start[1] * tileSize]
    const endWorld = [roofSegment.end[0] * tileSize, roofSegment.end[1] * tileSize]

    let initialAngle = 0
    let hasChanged = false
    const originalSegment = roofSegment
    let finalSegment: typeof roofSegment | null = null

    // Calculate geometric center
    const dx = endWorld[0] - startWorld[0]
    const dz = endWorld[1] - startWorld[1]
    const ridgeLength = Math.sqrt(dx * dx + dz * dz)
    if (ridgeLength < 0.1) return
    const ridgeDir = { x: dx / ridgeLength, z: dz / ridgeLength }
    const perpDir = { x: -ridgeDir.z, z: ridgeDir.x }
    const leftWidth = originalSegment.leftWidth ?? ROOF_WIDTH / 2
    const rightWidth = originalSegment.rightWidth ?? ROOF_WIDTH / 2
    const bottomLeft = [
      startWorld[0] + perpDir.x * leftWidth,
      0,
      startWorld[1] + perpDir.z * leftWidth,
    ]
    const bottomRight = [
      startWorld[0] - perpDir.x * rightWidth,
      0,
      startWorld[1] - perpDir.z * rightWidth,
    ]
    const bottomLeftEnd = [
      endWorld[0] + perpDir.x * leftWidth,
      0,
      endWorld[1] + perpDir.z * leftWidth,
    ]
    const bottomRightEnd = [
      endWorld[0] - perpDir.x * rightWidth,
      0,
      endWorld[1] - perpDir.z * rightWidth,
    ]
    const centerX = (bottomLeft[0] + bottomRight[0] + bottomLeftEnd[0] + bottomRightEnd[0]) / 4
    const centerZ = (bottomLeft[2] + bottomRight[2] + bottomLeftEnd[2] + bottomRightEnd[2]) / 4
    const center = new THREE.Vector3(centerX, 0, centerZ)

    let previousAngle = 0
    let totalDelta = 0

    const onPointerMove = (event: PointerEvent) => {
      // Calculate pointer position
      const rect = gl.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.setFromCamera(pointer, camera)

      const intersection = new THREE.Vector3()
      if (!raycaster.ray.intersectPlane(plane, intersection)) return

      const vector = intersection.clone().sub(center)
      const currentAngle = Math.atan2(vector.z, vector.x)

      if (!hasChanged) {
        initialAngle = currentAngle
        previousAngle = currentAngle
        totalDelta = 0
        hasChanged = true
        return
      }

      // Compute smallest delta handling wrap-around
      let delta = currentAngle - previousAngle
      delta = ((delta + Math.PI) % (2 * Math.PI)) - Math.PI

      totalDelta += delta
      previousAngle = currentAngle

      // Apply snapping when Shift is held (snap to 45-degree increments)
      let effectiveDelta = totalDelta
      if (event.shiftKey) {
        const degrees = (totalDelta * 180) / Math.PI
        const snappedDegrees = Math.round(degrees / 45) * 45
        effectiveDelta = (snappedDegrees * Math.PI) / 180
      }

      // Rotate using effectiveDelta
      const rotatePoint = (point: [number, number]) => {
        const worldX = point[0] * tileSize
        const worldZ = point[1] * tileSize
        const dX = worldX - centerX
        const dZ = worldZ - centerZ
        const cos = Math.cos(effectiveDelta)
        const sin = Math.sin(effectiveDelta)
        const newX = centerX + dX * cos + dZ * sin
        const newZ = centerZ - dX * sin + dZ * cos
        return [newX / tileSize, newZ / tileSize] as [number, number]
      }

      const newStart = rotatePoint(originalSegment.start)
      const newEnd = rotatePoint(originalSegment.end)

      const updatedSegment = {
        ...originalSegment,
        start: newStart,
        end: newEnd,
      }

      finalSegment = updatedSegment

      // Update in store
      updateRoofSegment(updatedSegment)
    }

    const onPointerUp = () => {
      setIsDragging(false)
      setActiveHandle(null)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      gl.domElement.style.cursor = 'auto'

      if (hasChanged && finalSegment) {
        // Apply final snap on release
        const snapToGrid = (val: number) => Math.round(val * 10) / 10

        const snappedSegment = {
          ...finalSegment,
          start: [snapToGrid(finalSegment.start[0]), snapToGrid(finalSegment.start[1])] as [
            number,
            number,
          ],
          end: [snapToGrid(finalSegment.end[0]), snapToGrid(finalSegment.end[1])] as [
            number,
            number,
          ],
        }

        updateRoofSegment(snappedSegment)

        // Record undo operation
        useEditor.getState().updateNode(nodeId, {
          position: snappedSegment.start,
          size: [
            Math.sqrt(
              (snappedSegment.end[0] - snappedSegment.start[0]) ** 2 +
                (snappedSegment.end[1] - snappedSegment.start[1]) ** 2,
            ),
            0,
          ] as [number, number],
          height: snappedSegment.height,
          leftWidth: snappedSegment.leftWidth,
          rightWidth: snappedSegment.rightWidth,
        })
      }
    }

    setIsDragging(true)
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
    gl.domElement.style.cursor = 'grabbing'
  }, [roofSegment, camera, gl, tileSize, updateRoofSegment, nodeId])

  // Handle translation for whole roof segment
  const handleTranslationDrag = useCallback(
    (axis: 'ridge' | 'perp' | 'xz') => {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      const raycaster = new THREE.Raycaster()
      const pointer = new THREE.Vector2()

      // Calculate roof orientation
      const startWorld = [roofSegment.start[0] * tileSize, roofSegment.start[1] * tileSize]
      const endWorld = [roofSegment.end[0] * tileSize, roofSegment.end[1] * tileSize]
      const dx = endWorld[0] - startWorld[0]
      const dz = endWorld[1] - startWorld[1]
      const ridgeLength = Math.sqrt(dx * dx + dz * dz)

      // Ridge and perpendicular directions in world space
      const ridgeDir = new THREE.Vector3(dx / ridgeLength, 0, dz / ridgeLength)
      const perpDir = new THREE.Vector3(-dz / ridgeLength, 0, dx / ridgeLength)

      const intersection = new THREE.Vector3()
      let startPoint: THREE.Vector3 | null = null
      const originalSegment = roofSegment
      let hasChanged = false

      const onPointerMove = (event: PointerEvent) => {
        // Calculate pointer position
        const rect = gl.domElement.getBoundingClientRect()
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

        raycaster.setFromCamera(pointer, camera)

        if (!raycaster.ray.intersectPlane(plane, intersection)) return

        if (!startPoint) {
          startPoint = intersection.clone()
          return
        }

        const delta = new THREE.Vector3().subVectors(intersection, startPoint)

        // Project delta onto roof-aligned axes
        let deltaX = 0
        let deltaZ = 0

        if (axis === 'ridge') {
          // Move along ridge direction
          const projectedDelta = delta.dot(ridgeDir)
          deltaX = projectedDelta * ridgeDir.x
          deltaZ = projectedDelta * ridgeDir.z
        } else if (axis === 'perp') {
          // Move perpendicular to ridge
          const projectedDelta = delta.dot(perpDir)
          deltaX = projectedDelta * perpDir.x
          deltaZ = projectedDelta * perpDir.z
        } else {
          // Free movement on XZ plane
          deltaX = delta.x
          deltaZ = delta.z
        }

        // Snap to grid when Shift is held
        if (event.shiftKey) {
          deltaX = Math.round(deltaX / tileSize) * tileSize
          deltaZ = Math.round(deltaZ / tileSize) * tileSize
        }

        // Update both start and end points
        const newStart: [number, number] = [
          originalSegment.start[0] + deltaX / tileSize,
          originalSegment.start[1] + deltaZ / tileSize,
        ]
        const newEnd: [number, number] = [
          originalSegment.end[0] + deltaX / tileSize,
          originalSegment.end[1] + deltaZ / tileSize,
        ]

        const updatedSegment = {
          ...originalSegment,
          start: newStart,
          end: newEnd,
        }

        // Update in store
        updateRoofSegment(updatedSegment)
        hasChanged = true
      }

      const onPointerUp = () => {
        setIsDragging(false)
        setActiveHandle(null)
        document.removeEventListener('pointermove', onPointerMove)
        document.removeEventListener('pointerup', onPointerUp)
        gl.domElement.style.cursor = 'auto'

        // Record undo operation if there were changes
        if (hasChanged) {
          // Use updateNode to record the change with command manager
          useEditor.getState().updateNode(nodeId, {
            position: roofSegment.start,
            size: [
              Math.sqrt(
                (roofSegment.end[0] - roofSegment.start[0]) ** 2 +
                  (roofSegment.end[1] - roofSegment.start[1]) ** 2,
              ),
              0,
            ] as [number, number],
            height: roofSegment.height,
            leftWidth: roofSegment.leftWidth,
            rightWidth: roofSegment.rightWidth,
          })
        }
      }

      setIsDragging(true)
      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', onPointerUp)
      gl.domElement.style.cursor = 'grabbing'
    },
    [roofSegment, camera, gl, tileSize, updateRoofSegment, nodeId],
  )

  // Visual states for handles
  const getHandleOpacity = (handleId: string) => {
    if (activeHandle === handleId || hoveredHandle === handleId) return 1
    return 0.6
  }

  const getHandleEmissiveIntensity = (handleId: string) => {
    if (activeHandle === handleId || hoveredHandle === handleId) return 0.5
    return 0.05
  }

  // Pre-calculate roof geometry
  // NOTE: Geometry is in LOCAL space - parent group handles position & rotation
  const roofGeometry = useMemo(() => {
    // Convert local grid coordinates to local world coordinates
    const startWorld = [localSegment.start[0] * tileSize, localSegment.start[1] * tileSize]
    const endWorld = [localSegment.end[0] * tileSize, localSegment.end[1] * tileSize]

    const dx = endWorld[0] - startWorld[0]
    const dz = endWorld[1] - startWorld[1]
    const ridgeLength = Math.sqrt(dx * dx + dz * dz)

    if (ridgeLength < 0.1) return null

    const ridgeDir = { x: dx / ridgeLength, z: dz / ridgeLength }
    const perpDir = { x: -ridgeDir.z, z: ridgeDir.x }

    const leftWidth = localSegment.leftWidth ?? ROOF_WIDTH / 2
    const rightWidth = localSegment.rightWidth ?? ROOF_WIDTH / 2
    const roofHeight = localSegment.height || 2

    // Bottom corners (at grid level y = 0)
    const bottomLeft = [
      startWorld[0] + perpDir.x * leftWidth,
      0,
      startWorld[1] + perpDir.z * leftWidth,
    ]
    const bottomRight = [
      startWorld[0] - perpDir.x * rightWidth,
      0,
      startWorld[1] - perpDir.z * rightWidth,
    ]
    const bottomLeftEnd = [
      endWorld[0] + perpDir.x * leftWidth,
      0,
      endWorld[1] + perpDir.z * leftWidth,
    ]
    const bottomRightEnd = [
      endWorld[0] - perpDir.x * rightWidth,
      0,
      endWorld[1] - perpDir.z * rightWidth,
    ]

    // Ridge points (at roofHeight above grid)
    const ridgeStart = [startWorld[0], roofHeight, startWorld[1]]
    const ridgeEnd = [endWorld[0], roofHeight, endWorld[1]]

    // Create gable end geometries
    const frontGableGeometry = new THREE.BufferGeometry()
    const frontGableVertices = new Float32Array([
      bottomLeft[0],
      bottomLeft[1],
      bottomLeft[2],
      bottomRight[0],
      bottomRight[1],
      bottomRight[2],
      ridgeStart[0],
      ridgeStart[1],
      ridgeStart[2],
    ])
    frontGableGeometry.setAttribute('position', new THREE.BufferAttribute(frontGableVertices, 3))
    frontGableGeometry.computeVertexNormals()

    const backGableGeometry = new THREE.BufferGeometry()
    const backGableVertices = new Float32Array([
      bottomLeftEnd[0],
      bottomLeftEnd[1],
      bottomLeftEnd[2],
      ridgeEnd[0],
      ridgeEnd[1],
      ridgeEnd[2],
      bottomRightEnd[0],
      bottomRightEnd[1],
      bottomRightEnd[2],
    ])
    backGableGeometry.setAttribute('position', new THREE.BufferAttribute(backGableVertices, 3))
    backGableGeometry.computeVertexNormals()

    // Create sloped roof planes
    const leftRoofGeometry = new THREE.BufferGeometry()
    const leftRoofVertices = new Float32Array([
      bottomLeft[0],
      bottomLeft[1],
      bottomLeft[2],
      bottomLeftEnd[0],
      bottomLeftEnd[1],
      bottomLeftEnd[2],
      ridgeEnd[0],
      ridgeEnd[1],
      ridgeEnd[2],

      bottomLeft[0],
      bottomLeft[1],
      bottomLeft[2],
      ridgeEnd[0],
      ridgeEnd[1],
      ridgeEnd[2],
      ridgeStart[0],
      ridgeStart[1],
      ridgeStart[2],
    ])
    leftRoofGeometry.setAttribute('position', new THREE.BufferAttribute(leftRoofVertices, 3))
    leftRoofGeometry.computeVertexNormals()

    const rightRoofGeometry = new THREE.BufferGeometry()
    const rightRoofVertices = new Float32Array([
      bottomRight[0],
      bottomRight[1],
      bottomRight[2],
      ridgeStart[0],
      ridgeStart[1],
      ridgeStart[2],
      ridgeEnd[0],
      ridgeEnd[1],
      ridgeEnd[2],

      bottomRight[0],
      bottomRight[1],
      bottomRight[2],
      ridgeEnd[0],
      ridgeEnd[1],
      ridgeEnd[2],
      bottomRightEnd[0],
      bottomRightEnd[1],
      bottomRightEnd[2],
    ])
    rightRoofGeometry.setAttribute('position', new THREE.BufferAttribute(rightRoofVertices, 3))
    rightRoofGeometry.computeVertexNormals()

    return {
      frontGable: frontGableGeometry,
      backGable: backGableGeometry,
      leftRoof: leftRoofGeometry,
      rightRoof: rightRoofGeometry,
      points: {
        bottomLeft,
        bottomRight,
        bottomLeftEnd,
        bottomRightEnd,
        ridgeStart,
        ridgeEnd,
      },
    }
  }, [localSegment, tileSize])

  if (!roofGeometry) return null

  // Determine opacity based on selected floor
  const isActiveFloor = selectedFloorId === null || levelId === selectedFloorId
  let opacity = isActiveFloor ? 1 : 0.3

  // Apply custom opacity if set (convert from 0-100 to 0-1)
  if (roofSegment.opacity !== undefined && roofSegment.opacity < 100) {
    opacity *= roofSegment.opacity / 100
  }

  const transparent = opacity < 1

  // Check if element should be visible
  const isHidden =
    roofSegment.visible === false ||
    (roofSegment.opacity !== undefined && roofSegment.opacity === 0)
  if (isHidden) return null

  const color = '#8b7355' // Brown roof color
  const emissive = '#8b7355'
  let emissiveIntensity = 0

  // TODO: If we want to bring back the isHovered we need to add it to our useEditor state
  // if (isSelected && isHovered) {
  //   emissiveIntensity = 0.6
  // } else if (isSelected) {
  //   emissiveIntensity = 0.4
  // } else if (isHovered) {
  //   emissiveIntensity = 0.3
  // }
  if (isSelected) {
    emissiveIntensity = 0.4
  }

  const material = (
    <meshStandardMaterial
      color={color}
      emissive={emissive}
      emissiveIntensity={emissiveIntensity}
      metalness={0.1}
      opacity={opacity}
      roughness={0.8}
      side={THREE.DoubleSide}
      transparent={transparent}
    />
  )

  // Calculate derived dimensions for handles
  const arrowHitRadius = ARROW_SHAFT_RADIUS * ARROW_HIT_RADIUS_SCALE
  const arrowHitLength = ARROW_SHAFT_LENGTH * ARROW_HIT_LENGTH_SCALE
  const arrowShaftPos = ARROW_SHAFT_LENGTH / 2
  const arrowHitPos = arrowHitLength / 2
  const arrowHeadPos = ARROW_SHAFT_LENGTH + ARROW_HEAD_LENGTH / 2

  const originHitSize = ORIGIN_MARKER_SIZE * ORIGIN_HIT_SCALE
  const originMarkerEdge = ORIGIN_MARKER_SIZE / 2
  const originHitEdge = originHitSize / 2
  const transArrowShaftPos = originMarkerEdge + ARROW_SHAFT_LENGTH / 2
  const transArrowHitPos = originHitEdge + arrowHitLength / 2
  const transArrowHeadPos = originMarkerEdge + ARROW_SHAFT_LENGTH + ARROW_HEAD_LENGTH / 2

  // Define horizontal edge handles
  const horizontalEdges = [
    {
      id: `${nodeId}-front`,
      edge: [roofGeometry.points.bottomLeft, roofGeometry.points.bottomRight],
      color: '#ff4444',
    },
    {
      id: `${nodeId}-right`,
      edge: [roofGeometry.points.bottomRight, roofGeometry.points.bottomRightEnd],
      color: '#44ff44',
    },
    {
      id: `${nodeId}-back`,
      edge: [roofGeometry.points.bottomRightEnd, roofGeometry.points.bottomLeftEnd],
      color: '#4444ff',
    },
    {
      id: `${nodeId}-left`,
      edge: [roofGeometry.points.bottomLeftEnd, roofGeometry.points.bottomLeft],
      color: '#ffff44',
    },
  ]

  // Calculate values for handle positioning (all in local space)
  const localStartWorld = [localSegment.start[0] * tileSize, localSegment.start[1] * tileSize]
  const localEndWorld = [localSegment.end[0] * tileSize, localSegment.end[1] * tileSize]
  const localDx = localEndWorld[0] - localStartWorld[0]
  const localDz = localEndWorld[1] - localStartWorld[1]
  const ridgeAngle = Math.atan2(localDz, localDx)

  const centerX =
    (roofGeometry.points.bottomLeft[0] +
      roofGeometry.points.bottomRight[0] +
      roofGeometry.points.bottomLeftEnd[0] +
      roofGeometry.points.bottomRightEnd[0]) /
    4
  const centerZ =
    (roofGeometry.points.bottomLeft[2] +
      roofGeometry.points.bottomRight[2] +
      roofGeometry.points.bottomLeftEnd[2] +
      roofGeometry.points.bottomRightEnd[2]) /
    4

  const corners = [
    roofGeometry.points.bottomLeft,
    roofGeometry.points.bottomRight,
    roofGeometry.points.bottomLeftEnd,
    roofGeometry.points.bottomRightEnd,
  ]
  const arcAngle = Math.PI / 2
  const rotationHitThickness = ROTATION_HANDLE_THICKNESS * ROTATION_HIT_SCALE
  const rotationHandleId = `${nodeId}-rotation`

  return (
    <group>
      {isPreview ? (
        <>
          {/* Preview rectangular footprint outline */}
          <Line
            color="#336633"
            dashed={false}
            depthTest={false}
            lineWidth={2}
            opacity={0.3}
            points={[
              roofGeometry.points.bottomLeft as [number, number, number],
              roofGeometry.points.bottomRight as [number, number, number],
              roofGeometry.points.bottomRightEnd as [number, number, number],
              roofGeometry.points.bottomLeftEnd as [number, number, number],
              roofGeometry.points.bottomLeft as [number, number, number], // Close the rectangle
            ]}
            transparent
          />
          <Line
            color="#44ff44"
            dashed={false}
            depthTest={true}
            lineWidth={3}
            points={[
              roofGeometry.points.bottomLeft as [number, number, number],
              roofGeometry.points.bottomRight as [number, number, number],
              roofGeometry.points.bottomRightEnd as [number, number, number],
              roofGeometry.points.bottomLeftEnd as [number, number, number],
              roofGeometry.points.bottomLeft as [number, number, number], // Close the rectangle
            ]}
          />

          {/* Preview geometry */}
          <mesh geometry={roofGeometry.frontGable} renderOrder={1}>
            <meshStandardMaterial
              color="#44ff44"
              depthTest={false}
              depthWrite={false}
              emissive="#22aa22"
              emissiveIntensity={0.1}
              opacity={0.15}
              side={THREE.DoubleSide}
              transparent
            />
          </mesh>
          <mesh geometry={roofGeometry.backGable} renderOrder={1}>
            <meshStandardMaterial
              color="#44ff44"
              depthTest={false}
              depthWrite={false}
              emissive="#22aa22"
              emissiveIntensity={0.1}
              opacity={0.15}
              side={THREE.DoubleSide}
              transparent
            />
          </mesh>
          <mesh geometry={roofGeometry.leftRoof} renderOrder={1}>
            <meshStandardMaterial
              color="#44ff44"
              depthTest={false}
              depthWrite={false}
              emissive="#22aa22"
              emissiveIntensity={0.1}
              opacity={0.15}
              side={THREE.DoubleSide}
              transparent
            />
          </mesh>
          <mesh geometry={roofGeometry.rightRoof} renderOrder={1}>
            <meshStandardMaterial
              color="#44ff44"
              depthTest={false}
              depthWrite={false}
              emissive="#22aa22"
              emissiveIntensity={0.1}
              opacity={0.15}
              side={THREE.DoubleSide}
              transparent
            />
          </mesh>

          <mesh geometry={roofGeometry.frontGable} renderOrder={2}>
            <meshStandardMaterial
              color="#44ff44"
              depthTest={true}
              depthWrite={false}
              emissive="#22aa22"
              emissiveIntensity={0.4}
              opacity={0.5}
              side={THREE.DoubleSide}
              transparent
            />
          </mesh>
          <mesh geometry={roofGeometry.backGable} renderOrder={2}>
            <meshStandardMaterial
              color="#44ff44"
              depthTest={true}
              depthWrite={false}
              emissive="#22aa22"
              emissiveIntensity={0.4}
              opacity={0.5}
              side={THREE.DoubleSide}
              transparent
            />
          </mesh>
          <mesh geometry={roofGeometry.leftRoof} renderOrder={2}>
            <meshStandardMaterial
              color="#44ff44"
              depthTest={true}
              depthWrite={false}
              emissive="#22aa22"
              emissiveIntensity={0.4}
              opacity={0.5}
              side={THREE.DoubleSide}
              transparent
            />
          </mesh>
          <mesh geometry={roofGeometry.rightRoof} renderOrder={2}>
            <meshStandardMaterial
              color="#44ff44"
              depthTest={true}
              depthWrite={false}
              emissive="#22aa22"
              emissiveIntensity={0.4}
              opacity={0.5}
              side={THREE.DoubleSide}
              transparent
            />
          </mesh>
        </>
      ) : (
        <>
          {/* Front gable end */}
          <mesh
            castShadow
            geometry={roofGeometry.frontGable}
            // TODO: Check if we need to re-enable these features
            // onClick={(e) => {
            //   if (movingCamera || controlMode === 'delete' || controlMode === 'guide') {
            //     return
            //   }
            //   e.stopPropagation()
            //   onClick?.(e)
            // }}
            // onPointerDown={(e) => {
            //   if (movingCamera || controlMode === 'delete') {
            //     return
            //   }
            //   e.stopPropagation()
            // }}
            // onPointerEnter={(e) => {
            //   if (controlMode !== 'delete' && !movingCamera) {
            //     e.stopPropagation()
            //     onPointerEnter?.()
            //   }
            // }}
            // onPointerLeave={(e) => {
            //   if (controlMode !== 'delete' && !movingCamera) {
            //     e.stopPropagation()
            //     onPointerLeave?.()
            //   }
            // }}
            receiveShadow
          >
            {material}
          </mesh>

          {/* Back gable end */}
          <mesh
            castShadow
            geometry={roofGeometry.backGable}
            // onClick={(e) => {
            //   if (movingCamera || controlMode === 'delete' || controlMode === 'guide') {
            //     return
            //   }
            //   e.stopPropagation()
            //   onClick?.(e)
            // }}
            // onPointerEnter={(e) => {
            //   if (controlMode !== 'delete' && !movingCamera) {
            //     e.stopPropagation()
            //     onPointerEnter?.()
            //   }
            // }}
            // onPointerLeave={(e) => {
            //   if (controlMode !== 'delete' && !movingCamera) {
            //     e.stopPropagation()
            //     onPointerLeave?.()
            //   }
            // }}
            receiveShadow
          >
            {material}
          </mesh>

          {/* Left roof plane */}
          <mesh
            castShadow
            geometry={roofGeometry.leftRoof}
            // onClick={(e) => {
            //   if (movingCamera || controlMode === 'delete' || controlMode === 'guide') {
            //     return
            //   }
            //   e.stopPropagation()
            //   onClick?.(e)
            // }}
            // onPointerEnter={(e) => {
            //   if (controlMode !== 'delete' && !movingCamera) {
            //     e.stopPropagation()
            //     onPointerEnter?.()
            //   }
            // }}
            // onPointerLeave={(e) => {
            //   if (controlMode !== 'delete' && !movingCamera) {
            //     e.stopPropagation()
            //     onPointerLeave?.()
            //   }
            // }}
            receiveShadow
          >
            {material}
          </mesh>

          {/* Right roof plane */}
          <mesh
            castShadow
            geometry={roofGeometry.rightRoof}
            // onClick={(e) => {
            //   if (movingCamera || controlMode === 'delete' || controlMode === 'guide') {
            //     return
            //   }
            //   e.stopPropagation()
            //   onClick?.(e)
            // }}
            // onPointerEnter={(e) => {
            //   if (controlMode !== 'delete' && !movingCamera) {
            //     e.stopPropagation()
            //     onPointerEnter?.()
            //   }
            // }}
            // onPointerLeave={(e) => {
            //   if (controlMode !== 'delete' && !movingCamera) {
            //     e.stopPropagation()
            //     onPointerLeave?.()
            //   }
            // }}
            receiveShadow
          >
            {material}
          </mesh>

          {/* Selection outline */}
          {isSelected && (
            <>
              {(() => {
                const {
                  bottomLeft,
                  bottomRight,
                  bottomLeftEnd,
                  bottomRightEnd,
                  ridgeStart,
                  ridgeEnd,
                } = roofGeometry.points

                const edges = [
                  [bottomLeft, bottomRight],
                  [bottomRight, bottomRightEnd],
                  [bottomRightEnd, bottomLeftEnd],
                  [bottomLeftEnd, bottomLeft],
                  [bottomLeft, ridgeStart],
                  [ridgeStart, ridgeEnd],
                  [ridgeEnd, bottomLeftEnd],
                  [bottomRight, ridgeStart],
                  [ridgeEnd, bottomRightEnd],
                ]

                return edges.map((edge, idx) => {
                  const {
                    geometry: cylGeom,
                    midpoint,
                    axis,
                    angle,
                  } = createEdgeCylinder(edge[0], edge[1])
                  return (
                    <mesh
                      geometry={cylGeom}
                      key={idx}
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
                  )
                })
              })()}
            </>
          )}

          {/* Edge manipulation handles */}
          {isSelected && controlMode === 'building' && (
            <>
              {/* Horizontal edge handles */}
              {horizontalEdges.map(({ id, edge, color }) => {
                const start = edge[0]
                const end = edge[1]

                const midX = (start[0] + end[0]) / 2
                const midY = (start[1] + end[1]) / 2
                const midZ = (start[2] + end[2]) / 2

                const edgeDir = new THREE.Vector3(
                  end[0] - start[0],
                  end[1] - start[1],
                  end[2] - start[2],
                ).normalize()

                const perpDir = new THREE.Vector3(edgeDir.z, 0, -edgeDir.x).normalize()

                const quaternion = new THREE.Quaternion().setFromUnitVectors(
                  new THREE.Vector3(1, 0, 0),
                  perpDir,
                )

                return (
                  <group key={id} position={[midX, midY, midZ]} quaternion={quaternion}>
                    <mesh
                      onPointerDown={(e) => {
                        if (e.button !== 0 || movingCamera || isDragging) return
                        e.stopPropagation()
                        setActiveHandle(id)
                        handleEdgeDrag(id, 'horizontal')
                      }}
                      onPointerEnter={() => !isDragging && setHoveredHandle(id)}
                      onPointerLeave={() => !isDragging && setHoveredHandle(null)}
                      position={[arrowHitPos, 0, 0]}
                      renderOrder={1000}
                      rotation={[0, 0, Math.PI / 2]}
                    >
                      <cylinderGeometry
                        args={[arrowHitRadius, arrowHitRadius, arrowHitLength, 8]}
                      />
                      <HitMaterial />
                    </mesh>

                    <mesh
                      position={[arrowShaftPos, 0, 0]}
                      renderOrder={1000}
                      rotation={[0, 0, Math.PI / 2]}
                    >
                      <cylinderGeometry
                        args={[ARROW_SHAFT_RADIUS, ARROW_SHAFT_RADIUS, ARROW_SHAFT_LENGTH, 16]}
                      />
                      <HandleMaterial
                        color={color}
                        emissiveIntensity={getHandleEmissiveIntensity(id)}
                        opacity={getHandleOpacity(id)}
                      />
                    </mesh>

                    <mesh
                      position={[arrowHeadPos, 0, 0]}
                      renderOrder={1000}
                      rotation={[0, 0, -Math.PI / 2]}
                    >
                      <coneGeometry args={[ARROW_HEAD_RADIUS, ARROW_HEAD_LENGTH, 16]} />
                      <HandleMaterial
                        color={color}
                        emissiveIntensity={getHandleEmissiveIntensity(id)}
                        opacity={getHandleOpacity(id)}
                      />
                    </mesh>
                  </group>
                )
              })}

              {/* Ridge handle */}
              {(() => {
                const ridgeId = `${nodeId}-ridge`
                const ridgeMidX =
                  (roofGeometry.points.ridgeStart[0] + roofGeometry.points.ridgeEnd[0]) / 2
                const ridgeMidY =
                  (roofGeometry.points.ridgeStart[1] + roofGeometry.points.ridgeEnd[1]) / 2
                const ridgeMidZ =
                  (roofGeometry.points.ridgeStart[2] + roofGeometry.points.ridgeEnd[2]) / 2

                return (
                  <group key={ridgeId} position={[ridgeMidX, ridgeMidY, ridgeMidZ]}>
                    <mesh
                      onPointerDown={(e) => {
                        if (e.button !== 0 || movingCamera || isDragging) return
                        e.stopPropagation()
                        setActiveHandle(ridgeId)
                        handleEdgeDrag(ridgeId, 'ridge')
                      }}
                      onPointerEnter={() => !isDragging && setHoveredHandle(ridgeId)}
                      onPointerLeave={() => !isDragging && setHoveredHandle(null)}
                      position={[0, arrowHitPos, 0]}
                      renderOrder={1000}
                    >
                      <cylinderGeometry
                        args={[arrowHitRadius, arrowHitRadius, arrowHitLength, 8]}
                      />
                      <HitMaterial />
                    </mesh>

                    <mesh position={[0, arrowShaftPos, 0]} renderOrder={1000}>
                      <cylinderGeometry
                        args={[ARROW_SHAFT_RADIUS, ARROW_SHAFT_RADIUS, ARROW_SHAFT_LENGTH, 16]}
                      />
                      <HandleMaterial
                        color="#ff44ff"
                        emissiveIntensity={getHandleEmissiveIntensity(ridgeId)}
                        opacity={getHandleOpacity(ridgeId)}
                      />
                    </mesh>

                    <mesh position={[0, arrowHeadPos, 0]} renderOrder={1000}>
                      <coneGeometry args={[ARROW_HEAD_RADIUS, ARROW_HEAD_LENGTH, 16]} />
                      <HandleMaterial
                        color="#ff44ff"
                        emissiveIntensity={getHandleEmissiveIntensity(ridgeId)}
                        opacity={getHandleOpacity(ridgeId)}
                      />
                    </mesh>
                  </group>
                )
              })()}

              {/* Rotation handles */}
              {corners.map((corner, idx) => {
                const cdx = corner[0] - centerX
                const cdz = corner[2] - centerZ
                const angle = Math.atan2(cdz, cdx)
                const groupRotation: [number, number, number] = [
                  Math.PI / 2,
                  0,
                  angle - arcAngle / 2,
                ]

                return (
                  <group
                    key={`${rotationHandleId}-${idx}`}
                    position={[corner[0], corner[1], corner[2]]}
                  >
                    <mesh
                      onPointerDown={(e) => {
                        if (e.button !== 0 || movingCamera || isDragging) return
                        e.stopPropagation()
                        setActiveHandle(rotationHandleId)
                        handleRotationDrag()
                      }}
                      onPointerEnter={() => !isDragging && setHoveredHandle(rotationHandleId)}
                      onPointerLeave={() => !isDragging && setHoveredHandle(null)}
                      renderOrder={1000}
                      rotation={groupRotation}
                    >
                      <torusGeometry
                        args={[ROTATION_HANDLE_RADIUS, rotationHitThickness, 16, 32, arcAngle]}
                      />
                      <HitMaterial />
                    </mesh>

                    <mesh renderOrder={1000} rotation={groupRotation}>
                      <torusGeometry
                        args={[ROTATION_HANDLE_RADIUS, ROTATION_HANDLE_THICKNESS, 16, 32, arcAngle]}
                      />
                      <HandleMaterial
                        color="#4444ff"
                        emissiveIntensity={getHandleEmissiveIntensity(rotationHandleId)}
                        opacity={getHandleOpacity(rotationHandleId)}
                      />
                    </mesh>
                  </group>
                )
              })}

              {/* Translation handles */}
              <group
                key={`${nodeId}-translation`}
                position={[centerX, 0, centerZ]}
                rotation={[0, -ridgeAngle, 0]}
              >
                {/* Center origin marker for XZ translation */}
                <group position={[0, 0, 0]}>
                  <mesh
                    onPointerDown={(e) => {
                      if (e.button !== 0 || movingCamera || isDragging) return
                      e.stopPropagation()
                      setActiveHandle(`${nodeId}-translate-xz`)
                      handleTranslationDrag('xz')
                    }}
                    onPointerEnter={() => !isDragging && setHoveredHandle(`${nodeId}-translate-xz`)}
                    onPointerLeave={() => !isDragging && setHoveredHandle(null)}
                    position={[0, 0, 0]}
                    renderOrder={1000}
                  >
                    <boxGeometry args={[originHitSize, originHitSize, originHitSize]} />
                    <HitMaterial />
                  </mesh>
                  <mesh position={[0, 0, 0]} renderOrder={1000}>
                    <boxGeometry
                      args={[ORIGIN_MARKER_SIZE, ORIGIN_MARKER_SIZE, ORIGIN_MARKER_SIZE]}
                    />
                    <HandleMaterial
                      color="white"
                      emissiveIntensity={getHandleEmissiveIntensity(`${nodeId}-translate-xz`)}
                      opacity={getHandleOpacity(`${nodeId}-translate-xz`)}
                    />
                  </mesh>
                </group>

                {/* Translate along ridge - Green arrow */}
                <group position={[0, 0, 0]}>
                  <mesh
                    onPointerDown={(e) => {
                      if (e.button !== 0 || movingCamera || isDragging) return
                      e.stopPropagation()
                      setActiveHandle(`${nodeId}-translate-ridge`)
                      handleTranslationDrag('ridge')
                    }}
                    onPointerEnter={() =>
                      !isDragging && setHoveredHandle(`${nodeId}-translate-ridge`)
                    }
                    onPointerLeave={() => !isDragging && setHoveredHandle(null)}
                    position={[transArrowHitPos, 0, 0]}
                    renderOrder={1000}
                    rotation={[0, 0, Math.PI / 2]}
                  >
                    <cylinderGeometry args={[arrowHitRadius, arrowHitRadius, arrowHitLength, 8]} />
                    <HitMaterial />
                  </mesh>
                  <mesh
                    position={[transArrowShaftPos, 0, 0]}
                    renderOrder={1000}
                    rotation={[0, 0, Math.PI / 2]}
                  >
                    <cylinderGeometry
                      args={[ARROW_SHAFT_RADIUS, ARROW_SHAFT_RADIUS, ARROW_SHAFT_LENGTH, 16]}
                    />
                    <HandleMaterial
                      color="#44ff44"
                      emissiveIntensity={getHandleEmissiveIntensity(`${nodeId}-translate-ridge`)}
                      opacity={getHandleOpacity(`${nodeId}-translate-ridge`)}
                    />
                  </mesh>
                  <mesh
                    position={[transArrowHeadPos, 0, 0]}
                    renderOrder={1000}
                    rotation={[0, 0, -Math.PI / 2]}
                  >
                    <coneGeometry args={[ARROW_HEAD_RADIUS, ARROW_HEAD_LENGTH, 16]} />
                    <HandleMaterial
                      color="#44ff44"
                      emissiveIntensity={getHandleEmissiveIntensity(`${nodeId}-translate-ridge`)}
                      opacity={getHandleOpacity(`${nodeId}-translate-ridge`)}
                    />
                  </mesh>
                </group>

                {/* Translate perpendicular - Red arrow */}
                <group position={[0, 0, 0]}>
                  <mesh
                    onPointerDown={(e) => {
                      if (e.button !== 0 || movingCamera || isDragging) return
                      e.stopPropagation()
                      setActiveHandle(`${nodeId}-translate-perp`)
                      handleTranslationDrag('perp')
                    }}
                    onPointerEnter={() =>
                      !isDragging && setHoveredHandle(`${nodeId}-translate-perp`)
                    }
                    onPointerLeave={() => !isDragging && setHoveredHandle(null)}
                    position={[0, 0, transArrowHitPos]}
                    renderOrder={1000}
                    rotation={[Math.PI / 2, 0, 0]}
                  >
                    <cylinderGeometry args={[arrowHitRadius, arrowHitRadius, arrowHitLength, 8]} />
                    <HitMaterial />
                  </mesh>
                  <mesh
                    position={[0, 0, transArrowShaftPos]}
                    renderOrder={1000}
                    rotation={[Math.PI / 2, 0, 0]}
                  >
                    <cylinderGeometry
                      args={[ARROW_SHAFT_RADIUS, ARROW_SHAFT_RADIUS, ARROW_SHAFT_LENGTH, 16]}
                    />
                    <HandleMaterial
                      color="#ff4444"
                      emissiveIntensity={getHandleEmissiveIntensity(`${nodeId}-translate-perp`)}
                      opacity={getHandleOpacity(`${nodeId}-translate-perp`)}
                    />
                  </mesh>
                  <mesh
                    position={[0, 0, transArrowHeadPos]}
                    renderOrder={1000}
                    rotation={[Math.PI / 2, 0, 0]}
                  >
                    <coneGeometry args={[ARROW_HEAD_RADIUS, ARROW_HEAD_LENGTH, 16]} />
                    <HandleMaterial
                      color="#ff4444"
                      emissiveIntensity={getHandleEmissiveIntensity(`${nodeId}-translate-perp`)}
                      opacity={getHandleOpacity(`${nodeId}-translate-perp`)}
                    />
                  </mesh>
                </group>
              </group>
            </>
          )}
        </>
      )}
    </group>
  )
}
