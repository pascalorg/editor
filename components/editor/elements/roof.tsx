'use client'

import { useThree } from '@react-three/fiber'
import { forwardRef, memo, type Ref, useCallback, useMemo, useState } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import type { RoofSegment } from '@/hooks/use-editor'
import { useEditor } from '@/hooks/use-editor'
import {
  handleElementClick,
  isElementSelected,
  type SelectedElement,
} from '@/lib/building-elements'

const ROOF_WIDTH = 6 // 6m total width (3m on each side of ridge)
const ROOF_THICKNESS = 0.05 // 5cm roof thickness
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

type RoofsProps = {
  floorId: string
  isActive: boolean
  isOverviewMode?: boolean
  tileSize: number
  baseHeight: number // Height at which the roof starts (typically wall height)
  hoveredRoofIndex: number | null
  selectedElements: SelectedElement[]
  setSelectedElements: (elements: SelectedElement[]) => void
  onRoofHover: (index: number | null) => void
  onRoofRightClick?: (e: any, roofSegment: RoofSegment) => void
  isCameraEnabled?: boolean
  controlMode: string
  setControlMode: (mode: 'select' | 'building' | 'delete' | 'guide') => void
  movingCamera: boolean
  onDeleteRoofs: () => void
}

export const Roofs = forwardRef(
  (
    {
      floorId,
      isActive,
      isOverviewMode = false,
      tileSize,
      baseHeight,
      hoveredRoofIndex,
      selectedElements,
      setSelectedElements,
      onRoofHover,
      onRoofRightClick,
      isCameraEnabled,
      controlMode,
      setControlMode,
      movingCamera,
      onDeleteRoofs,
    }: RoofsProps,
    ref: Ref<THREE.Group>,
  ) => {
    // Track hover and active states for handles
    const [hoveredHandle, setHoveredHandle] = useState<string | null>(null)
    const [activeHandle, setActiveHandle] = useState<string | null>(null)
    const [isDragging, setIsDragging] = useState(false)

    // Three.js scene utilities
    const { camera, gl } = useThree()

    // Fetch roof segments for this floor from the store
    const roofSegments = useEditor(
      useShallow((state) => {
        const roofComponent = state.components.find((c) => c.type === 'roof' && c.group === floorId)
        return roofComponent?.type === 'roof'
          ? roofComponent.data.segments.filter((seg) => seg.visible !== false)
          : []
      }),
    )

    // Update roof segment in the store
    const setComponents = useCallback(
      (updatedSegments: RoofSegment[]) => {
        useEditor.setState((state) => ({
          components: state.components.map((comp) =>
            comp.type === 'roof' && comp.group === floorId
              ? { ...comp, data: { segments: updatedSegments } }
              : comp,
          ),
        }))
      },
      [floorId],
    )

    // Handle drag for edge manipulation
    const handleEdgeDrag = useCallback(
      (handleId: string, segmentId: string, handleType: 'horizontal' | 'ridge') => {
        const segment = roofSegments.find((s) => s.id === segmentId)
        if (!segment) return

        // Capture state for undo
        const storeState = useEditor.getState()
        const originalComponents = storeState.components
        const originalImages = storeState.images

        const plane = new THREE.Plane()
        const raycaster = new THREE.Raycaster()
        const pointer = new THREE.Vector2()

        // Setup plane based on handle type
        if (handleType === 'ridge') {
          // Ridge handle moves along Y axis
          // Create a plane perpendicular to camera view for vertical dragging
          const cameraDirection = new THREE.Vector3()
          camera.getWorldDirection(cameraDirection)
          cameraDirection.y = 0
          cameraDirection.normalize()
          plane.setFromNormalAndCoplanarPoint(cameraDirection, new THREE.Vector3(0, 0, 0))
        } else {
          // Horizontal edge handle moves on the ZX plane (ground plane)
          plane.setFromNormalAndCoplanarPoint(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0, 0, 0),
          )
        }

        const intersection = new THREE.Vector3()
        let startPoint: THREE.Vector3 | null = null
        let originalSegment: RoofSegment | null = segment
        let hasChanged = false

        const onPointerMove = (event: PointerEvent) => {
          if (!originalSegment) return

          // Calculate pointer position in normalized device coordinates
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
          let updatedSegment: RoofSegment

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

              // Get current widths (use defaults if not set)
              const currentLeftWidth = originalSegment.leftWidth ?? ROOF_WIDTH / 2
              const currentRightWidth = originalSegment.rightWidth ?? ROOF_WIDTH / 2

              if (edgeType === 'front') {
                // Front edge: move the START point along the ridge direction
                const projectedDelta = delta.x * ridgeDir.x + delta.z * ridgeDir.z
                const newStartX =
                  originalSegment.start[0] + (projectedDelta * ridgeDir.x) / tileSize
                const newStartY =
                  originalSegment.start[1] + (projectedDelta * ridgeDir.z) / tileSize

                updatedSegment = {
                  ...originalSegment,
                  start: [snapToGrid(newStartX), snapToGrid(newStartY)],
                }
              } else if (edgeType === 'back') {
                // Back edge: move the END point along the ridge direction
                const projectedDelta = delta.x * ridgeDir.x + delta.z * ridgeDir.z
                const newEndX = originalSegment.end[0] + (projectedDelta * ridgeDir.x) / tileSize
                const newEndY = originalSegment.end[1] + (projectedDelta * ridgeDir.z) / tileSize

                updatedSegment = {
                  ...originalSegment,
                  end: [snapToGrid(newEndX), snapToGrid(newEndY)],
                }
              } else if (edgeType === 'left') {
                // Left edge: move the edge and shift ridge to stay centered
                const projectedDelta = delta.x * perpDir.x + delta.z * perpDir.z
                const newLeftWidth = Math.max(0.5, currentLeftWidth + projectedDelta)

                // Ridge shifts by half the change to stay centered between edges
                const ridgeShift = (newLeftWidth - currentLeftWidth) / 2
                const newStartX = originalSegment.start[0] + (ridgeShift * perpDir.x) / tileSize
                const newStartY = originalSegment.start[1] + (ridgeShift * perpDir.z) / tileSize
                const newEndX = originalSegment.end[0] + (ridgeShift * perpDir.x) / tileSize
                const newEndY = originalSegment.end[1] + (ridgeShift * perpDir.z) / tileSize

                // Both widths change to keep ridge centered
                const newRightWidth = currentRightWidth + ridgeShift

                updatedSegment = {
                  ...originalSegment,
                  start: [snapToGrid(newStartX), snapToGrid(newStartY)],
                  end: [snapToGrid(newEndX), snapToGrid(newEndY)],
                  leftWidth: snapToGrid(newLeftWidth - ridgeShift),
                  rightWidth: snapToGrid(newRightWidth),
                }
              } else if (edgeType === 'right') {
                // Right edge: move the edge and shift ridge to stay centered
                const projectedDelta = -(delta.x * perpDir.x + delta.z * perpDir.z)
                const newRightWidth = Math.max(0.5, currentRightWidth + projectedDelta)

                // Ridge shifts by half the change (in opposite direction) to stay centered
                const ridgeShift = -(newRightWidth - currentRightWidth) / 2
                const newStartX = originalSegment.start[0] + (ridgeShift * perpDir.x) / tileSize
                const newStartY = originalSegment.start[1] + (ridgeShift * perpDir.z) / tileSize
                const newEndX = originalSegment.end[0] + (ridgeShift * perpDir.x) / tileSize
                const newEndY = originalSegment.end[1] + (ridgeShift * perpDir.z) / tileSize

                // Both widths change to keep ridge centered
                const newLeftWidth = currentLeftWidth - ridgeShift

                updatedSegment = {
                  ...originalSegment,
                  start: [snapToGrid(newStartX), snapToGrid(newStartY)],
                  end: [snapToGrid(newEndX), snapToGrid(newEndY)],
                  leftWidth: snapToGrid(newLeftWidth),
                  rightWidth: snapToGrid(newRightWidth + ridgeShift),
                }
              } else {
                updatedSegment = originalSegment
              }
            }
          }

          // Update in store
          const updatedSegments = roofSegments.map((s) => (s.id === segmentId ? updatedSegment : s))
          setComponents(updatedSegments)
          hasChanged = true
        }

        const onPointerUp = () => {
          setIsDragging(false)
          setActiveHandle(null)
          document.removeEventListener('pointermove', onPointerMove)
          document.removeEventListener('pointerup', onPointerUp)
          gl.domElement.style.cursor = 'auto'

          // Push to undo stack if there were changes
          if (hasChanged) {
            useEditor.setState((state) => ({
              undoStack: [
                ...state.undoStack,
                { images: originalImages, components: originalComponents },
              ].slice(-50),
              redoStack: [],
            }))
          }
        }

        setIsDragging(true)
        document.addEventListener('pointermove', onPointerMove)
        document.addEventListener('pointerup', onPointerUp)
        gl.domElement.style.cursor = 'grabbing'
      },
      [roofSegments, camera, gl, baseHeight, tileSize, setComponents],
    )

    // Handle rotation around base center
    const handleRotationDrag = useCallback(
      (segmentId: string) => {
        const segment = roofSegments.find((s) => s.id === segmentId)
        if (!segment) return

        // Capture state for undo
        const storeState = useEditor.getState()
        const originalComponents = storeState.components
        const originalImages = storeState.images

        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
        const raycaster = new THREE.Raycaster()
        const pointer = new THREE.Vector2()

        const startWorld = [segment.start[0] * tileSize, segment.start[1] * tileSize]
        const endWorld = [segment.end[0] * tileSize, segment.end[1] * tileSize]

        let initialAngle = 0
        let hasChanged = false
        const originalSegment = segment
        let finalSegment: RoofSegment | null = null

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
          if (!originalSegment) return

          // Calculate pointer position in normalized device coordinates
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
            hasChanged = true // Mark as started
            return
          }

          // Compute smallest delta handling wrap-around
          let delta = currentAngle - previousAngle
          delta = ((delta + Math.PI) % (2 * Math.PI)) - Math.PI // Normalize to -pi to pi

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

          const updatedSegment: RoofSegment = {
            ...originalSegment,
            start: newStart,
            end: newEnd,
          }

          finalSegment = updatedSegment

          // Update in store
          const updatedSegments = roofSegments.map((s) => (s.id === segmentId ? updatedSegment : s))
          setComponents(updatedSegments)
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

            const snappedSegment: RoofSegment = {
              ...finalSegment,
              start: [snapToGrid(finalSegment.start[0]), snapToGrid(finalSegment.start[1])],
              end: [snapToGrid(finalSegment.end[0]), snapToGrid(finalSegment.end[1])],
            }

            const snappedSegments = roofSegments.map((s) =>
              s.id === segmentId ? snappedSegment : s,
            )
            setComponents(snappedSegments)

            // Push to undo stack if there were changes
            useEditor.setState((state) => ({
              undoStack: [
                ...state.undoStack,
                { images: originalImages, components: originalComponents },
              ].slice(-50),
              redoStack: [],
            }))
          }
        }

        setIsDragging(true)
        document.addEventListener('pointermove', onPointerMove)
        document.addEventListener('pointerup', onPointerUp)
        gl.domElement.style.cursor = 'grabbing'
      },
      [roofSegments, camera, gl, baseHeight, tileSize, setComponents],
    )

    // Handle translation for whole roof segment
    const handleTranslationDrag = useCallback(
      (segmentId: string, axis: 'ridge' | 'perp' | 'xz') => {
        const segment = roofSegments.find((s) => s.id === segmentId)
        if (!segment) return

        // Capture state for undo
        const storeState = useEditor.getState()
        const originalComponents = storeState.components
        const originalImages = storeState.images

        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
        const raycaster = new THREE.Raycaster()
        const pointer = new THREE.Vector2()

        // Calculate roof orientation
        const startWorld = [segment.start[0] * tileSize, segment.start[1] * tileSize]
        const endWorld = [segment.end[0] * tileSize, segment.end[1] * tileSize]
        const dx = endWorld[0] - startWorld[0]
        const dz = endWorld[1] - startWorld[1]
        const ridgeLength = Math.sqrt(dx * dx + dz * dz)

        // Ridge and perpendicular directions in world space
        const ridgeDir = new THREE.Vector3(dx / ridgeLength, 0, dz / ridgeLength)
        const perpDir = new THREE.Vector3(-dz / ridgeLength, 0, dx / ridgeLength)

        const intersection = new THREE.Vector3()
        let startPoint: THREE.Vector3 | null = null
        const originalSegment = segment
        let hasChanged = false

        const onPointerMove = (event: PointerEvent) => {
          if (!originalSegment) return

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

          const updatedSegment: RoofSegment = {
            ...originalSegment,
            start: newStart,
            end: newEnd,
          }

          // Update in store
          const updatedSegments = roofSegments.map((s) => (s.id === segmentId ? updatedSegment : s))
          setComponents(updatedSegments)
          hasChanged = true
        }

        const onPointerUp = () => {
          setIsDragging(false)
          setActiveHandle(null)
          document.removeEventListener('pointermove', onPointerMove)
          document.removeEventListener('pointerup', onPointerUp)
          gl.domElement.style.cursor = 'auto'

          // Push to undo stack if there were changes
          if (hasChanged) {
            useEditor.setState((state) => ({
              undoStack: [
                ...state.undoStack,
                { images: originalImages, components: originalComponents },
              ].slice(-50),
              redoStack: [],
            }))
          }
        }

        setIsDragging(true)
        document.addEventListener('pointermove', onPointerMove)
        document.addEventListener('pointerup', onPointerUp)
        gl.domElement.style.cursor = 'grabbing'
      },
      [roofSegments, camera, gl, baseHeight, tileSize, setComponents],
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

    // Pre-calculate roof geometries
    const roofGeometries = useMemo(() => {
      return roofSegments
        .map((seg) => {
          const startWorld = [seg.start[0] * tileSize, seg.start[1] * tileSize]
          const endWorld = [seg.end[0] * tileSize, seg.end[1] * tileSize]

          // Calculate ridge line direction and length
          const dx = endWorld[0] - startWorld[0]
          const dz = endWorld[1] - startWorld[1]
          const ridgeLength = Math.sqrt(dx * dx + dz * dz)

          if (ridgeLength < 0.1) return null // Skip very short ridges

          // Ridge direction unit vector
          const ridgeDir = { x: dx / ridgeLength, z: dz / ridgeLength }
          // Perpendicular direction (for roof width)
          const perpDir = { x: -ridgeDir.z, z: ridgeDir.x }

          // Calculate the 4 bottom corners and 2 top (ridge) points
          // Use asymmetric widths if specified, otherwise default to symmetric
          const leftWidth = seg.leftWidth ?? ROOF_WIDTH / 2
          const rightWidth = seg.rightWidth ?? ROOF_WIDTH / 2
          const roofHeight = seg.height || 2 // Default 2m peak height above base

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

          // Create two triangular faces for the gable ends
          const frontGableGeometry = new THREE.BufferGeometry()
          const frontGableVertices = new Float32Array([
            // Triangle 1: bottom edge to ridge point
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
          frontGableGeometry.setAttribute(
            'position',
            new THREE.BufferAttribute(frontGableVertices, 3),
          )
          frontGableGeometry.computeVertexNormals()

          const backGableGeometry = new THREE.BufferGeometry()
          const backGableVertices = new Float32Array([
            // Triangle: bottom edge to ridge point (reversed winding for back face)
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
          backGableGeometry.setAttribute(
            'position',
            new THREE.BufferAttribute(backGableVertices, 3),
          )
          backGableGeometry.computeVertexNormals()

          // Create two sloped roof planes
          const leftRoofGeometry = new THREE.BufferGeometry()
          const leftRoofVertices = new Float32Array([
            // Quad as two triangles
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
            // Quad as two triangles (reversed winding)
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
          rightRoofGeometry.setAttribute(
            'position',
            new THREE.BufferAttribute(rightRoofVertices, 3),
          )
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
        })
        .filter(Boolean) as Array<{
        frontGable: THREE.BufferGeometry
        backGable: THREE.BufferGeometry
        leftRoof: THREE.BufferGeometry
        rightRoof: THREE.BufferGeometry
        points: {
          bottomLeft: number[]
          bottomRight: number[]
          bottomLeftEnd: number[]
          bottomRightEnd: number[]
          ridgeStart: number[]
          ridgeEnd: number[]
        }
      }>
    }, [roofSegments, tileSize, baseHeight])

    return (
      <group ref={ref}>
        {roofGeometries.map((geom, i) => {
          const seg = roofSegments[i]
          if (!seg) return null

          const isSelected = isElementSelected(selectedElements, seg.id, 'roof')
          const isHovered = isActive && hoveredRoofIndex === i

          const color = '#8b7355' // Brown roof color
          const emissive = '#8b7355' // Same as base color for emissive
          let emissiveIntensity = 0

          if (isSelected && isHovered) {
            emissiveIntensity = 0.6
          } else if (isSelected) {
            emissiveIntensity = 0.4
          } else if (isHovered) {
            emissiveIntensity = 0.3
          }

          const opacity = isOverviewMode || isActive ? 1 : 0.2
          const transparent = opacity < 1

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

          return (
            <group key={seg.id}>
              {/* Front gable end */}
              <mesh
                castShadow
                geometry={geom.frontGable}
                onClick={(e) => {
                  if (!isActive || movingCamera || controlMode === 'delete') {
                    return
                  }
                  e.stopPropagation()

                  // Handle element selection using the shared handler
                  const updatedSelection = handleElementClick({
                    selectedElements,
                    segments: roofSegments,
                    elementId: seg.id,
                    type: 'roof',
                    event: e,
                  })
                  setSelectedElements(updatedSelection)

                  // Automatically activate building mode when selecting a building element
                  setControlMode('building')
                }}
                onPointerDown={(e) => {
                  if (!isActive || movingCamera || controlMode === 'delete') {
                    return
                  }
                  // Stop propagation to prevent camera controls from intercepting
                  e.stopPropagation()
                }}
                onPointerEnter={(e) => {
                  if (isActive && controlMode !== 'delete' && !movingCamera) {
                    e.stopPropagation()
                    onRoofHover(i)
                  }
                }}
                onPointerLeave={(e) => {
                  if (isActive && controlMode !== 'delete' && !movingCamera) {
                    e.stopPropagation()
                    onRoofHover(null)
                  }
                }}
                receiveShadow
              >
                {material}
              </mesh>

              {/* Back gable end */}
              <mesh
                castShadow
                geometry={geom.backGable}
                onClick={(e) => {
                  if (
                    !isActive ||
                    movingCamera ||
                    controlMode === 'building' ||
                    controlMode === 'delete'
                  ) {
                    return
                  }
                  e.stopPropagation()

                  const updatedSelection = handleElementClick({
                    selectedElements,
                    segments: roofSegments,
                    elementId: seg.id,
                    type: 'roof',
                    event: e,
                  })
                  setSelectedElements(updatedSelection)
                  setControlMode('building')
                }}
                onPointerEnter={(e) => {
                  if (isActive && controlMode !== 'delete' && !movingCamera) {
                    e.stopPropagation()
                    onRoofHover(i)
                  }
                }}
                onPointerLeave={(e) => {
                  if (isActive && controlMode !== 'delete' && !movingCamera) {
                    e.stopPropagation()
                    onRoofHover(null)
                  }
                }}
                receiveShadow
              >
                {material}
              </mesh>

              {/* Left roof plane */}
              <mesh
                castShadow
                geometry={geom.leftRoof}
                onClick={(e) => {
                  if (
                    !isActive ||
                    movingCamera ||
                    controlMode === 'building' ||
                    controlMode === 'delete'
                  ) {
                    return
                  }
                  e.stopPropagation()

                  const updatedSelection = handleElementClick({
                    selectedElements,
                    segments: roofSegments,
                    elementId: seg.id,
                    type: 'roof',
                    event: e,
                  })
                  setSelectedElements(updatedSelection)
                  setControlMode('building')
                }}
                onPointerEnter={(e) => {
                  if (isActive && controlMode !== 'delete' && !movingCamera) {
                    e.stopPropagation()
                    onRoofHover(i)
                  }
                }}
                onPointerLeave={(e) => {
                  if (isActive && controlMode !== 'delete' && !movingCamera) {
                    e.stopPropagation()
                    onRoofHover(null)
                  }
                }}
                receiveShadow
              >
                {material}
              </mesh>

              {/* Right roof plane */}
              <mesh
                castShadow
                geometry={geom.rightRoof}
                onClick={(e) => {
                  if (
                    !isActive ||
                    movingCamera ||
                    controlMode === 'building' ||
                    controlMode === 'delete'
                  ) {
                    return
                  }
                  e.stopPropagation()

                  const updatedSelection = handleElementClick({
                    selectedElements,
                    segments: roofSegments,
                    elementId: seg.id,
                    type: 'roof',
                    event: e,
                  })
                  setSelectedElements(updatedSelection)
                  setControlMode('building')
                }}
                onPointerEnter={(e) => {
                  if (isActive && controlMode !== 'delete' && !movingCamera) {
                    e.stopPropagation()
                    onRoofHover(i)
                  }
                }}
                onPointerLeave={(e) => {
                  if (isActive && controlMode !== 'delete' && !movingCamera) {
                    e.stopPropagation()
                    onRoofHover(null)
                  }
                }}
                receiveShadow
              >
                {material}
              </mesh>

              {/* Selection outline - 3D cylinders */}
              {isSelected && (
                <>
                  {/* Bottom rectangle edges */}
                  {(() => {
                    const {
                      bottomLeft,
                      bottomRight,
                      bottomLeftEnd,
                      bottomRightEnd,
                      ridgeStart,
                      ridgeEnd,
                    } = geom.points

                    const edges = [
                      [bottomLeft, bottomRight], // front bottom
                      [bottomRight, bottomRightEnd], // right bottom
                      [bottomRightEnd, bottomLeftEnd], // back bottom
                      [bottomLeftEnd, bottomLeft], // left bottom
                      [bottomLeft, ridgeStart], // left front slope
                      [ridgeStart, ridgeEnd], // ridge
                      [ridgeEnd, bottomLeftEnd], // left back slope
                      [bottomRight, ridgeStart], // right front slope
                      [ridgeEnd, bottomRightEnd], // right back slope
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
                  {(() => {
                    const {
                      bottomLeft,
                      bottomRight,
                      bottomLeftEnd,
                      bottomRightEnd,
                      ridgeStart,
                      ridgeEnd,
                    } = geom.points

                    // Calculate derived dimensions for edge handles
                    const arrowHitRadius = ARROW_SHAFT_RADIUS * ARROW_HIT_RADIUS_SCALE
                    const arrowHitLength = ARROW_SHAFT_LENGTH * ARROW_HIT_LENGTH_SCALE
                    const arrowShaftPos = ARROW_SHAFT_LENGTH / 2
                    const arrowHitPos = arrowHitLength / 2
                    const arrowHeadPos = ARROW_SHAFT_LENGTH + ARROW_HEAD_LENGTH / 2

                    // Calculate derived dimensions for translation handles
                    const originHitSize = ORIGIN_MARKER_SIZE * ORIGIN_HIT_SCALE
                    const originMarkerEdge = ORIGIN_MARKER_SIZE / 2
                    const originHitEdge = originHitSize / 2
                    const transArrowShaftPos = originMarkerEdge + ARROW_SHAFT_LENGTH / 2
                    const transArrowHitPos = originHitEdge + arrowHitLength / 2
                    const transArrowHeadPos =
                      originMarkerEdge + ARROW_SHAFT_LENGTH + ARROW_HEAD_LENGTH / 2

                    // Define horizontal edge handles (on ZX plane)
                    const horizontalEdges = [
                      {
                        id: `${seg.id}-front`,
                        edge: [bottomLeft, bottomRight],
                        color: '#ff4444',
                      },
                      {
                        id: `${seg.id}-right`,
                        edge: [bottomRight, bottomRightEnd],
                        color: '#44ff44',
                      },
                      {
                        id: `${seg.id}-back`,
                        edge: [bottomRightEnd, bottomLeftEnd],
                        color: '#4444ff',
                      },
                      {
                        id: `${seg.id}-left`,
                        edge: [bottomLeftEnd, bottomLeft],
                        color: '#ffff44',
                      },
                    ]

                    const horizontalHandles = horizontalEdges.map(({ id, edge, color }) => {
                      const start = edge[0]
                      const end = edge[1]

                      // Calculate midpoint
                      const midX = (start[0] + end[0]) / 2
                      const midY = (start[1] + end[1]) / 2
                      const midZ = (start[2] + end[2]) / 2

                      // Calculate edge direction
                      const edgeDir = new THREE.Vector3(
                        end[0] - start[0],
                        end[1] - start[1],
                        end[2] - start[2],
                      ).normalize()

                      // Calculate perpendicular direction on ZX plane (pointing outward)
                      const perpDir = new THREE.Vector3(edgeDir.z, 0, -edgeDir.x).normalize()

                      // Calculate arrow rotation to point in perpDir direction
                      const quaternion = new THREE.Quaternion().setFromUnitVectors(
                        new THREE.Vector3(1, 0, 0), // Arrow points along +X by default
                        perpDir,
                      )

                      return (
                        <group key={id} position={[midX, midY, midZ]} quaternion={quaternion}>
                          {/* Invisible larger hit target */}
                          <mesh
                            onPointerDown={(e) => {
                              if (e.button !== 0 || movingCamera || isDragging) return
                              e.stopPropagation()
                              setActiveHandle(id)
                              handleEdgeDrag(id, seg.id, 'horizontal')
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

                          {/* Visible arrow shaft */}
                          <mesh
                            position={[arrowShaftPos, 0, 0]}
                            renderOrder={1000}
                            rotation={[0, 0, Math.PI / 2]}
                          >
                            <cylinderGeometry
                              args={[
                                ARROW_SHAFT_RADIUS,
                                ARROW_SHAFT_RADIUS,
                                ARROW_SHAFT_LENGTH,
                                16,
                              ]}
                            />
                            <HandleMaterial
                              color={color}
                              emissiveIntensity={getHandleEmissiveIntensity(id)}
                              opacity={getHandleOpacity(id)}
                            />
                          </mesh>

                          {/* Arrow head */}
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
                    })

                    // Ridge handle - independent, always points up along Y axis
                    const ridgeId = `${seg.id}-ridge`
                    const ridgeMidX = (ridgeStart[0] + ridgeEnd[0]) / 2
                    const ridgeMidY = (ridgeStart[1] + ridgeEnd[1]) / 2
                    const ridgeMidZ = (ridgeStart[2] + ridgeEnd[2]) / 2

                    const ridgeHandle = (
                      <group key={ridgeId} position={[ridgeMidX, ridgeMidY, ridgeMidZ]}>
                        {/* Invisible larger hit target - no rotation, cylinder points up by default */}
                        <mesh
                          onPointerDown={(e) => {
                            if (e.button !== 0 || movingCamera || isDragging) return
                            e.stopPropagation()
                            setActiveHandle(ridgeId)
                            handleEdgeDrag(ridgeId, seg.id, 'ridge')
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

                        {/* Visible arrow shaft - no rotation, cylinder points up by default */}
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

                        {/* Arrow head - no rotation, cone points up by default */}
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

                    // Calculate geometric center for rotation and translation
                    const centerX =
                      (bottomLeft[0] + bottomRight[0] + bottomLeftEnd[0] + bottomRightEnd[0]) / 4
                    const centerY = 0
                    const centerZ =
                      (bottomLeft[2] + bottomRight[2] + bottomLeftEnd[2] + bottomRightEnd[2]) / 4

                    // Calculate roof ridge orientation for translation handles
                    const startWorld = [seg.start[0] * tileSize, seg.start[1] * tileSize]
                    const endWorld = [seg.end[0] * tileSize, seg.end[1] * tileSize]
                    const dx = endWorld[0] - startWorld[0]
                    const dz = endWorld[1] - startWorld[1]
                    const ridgeAngle = Math.atan2(dz, dx)

                    // Corner positions
                    const corners = [bottomLeft, bottomRight, bottomLeftEnd, bottomRightEnd]

                    // Rotation handle parameters
                    const arcAngle = Math.PI / 2 // Fixed 90-degree arc
                    const rotationHitThickness = ROTATION_HANDLE_THICKNESS * ROTATION_HIT_SCALE
                    const rotationHandleId = `${seg.id}-rotation`

                    // Create small arc rotation handles at each corner
                    const rotationHandles = corners.map((corner, idx) => {
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
                          {/* Invisible hit target */}
                          <mesh
                            onPointerDown={(e) => {
                              if (e.button !== 0 || movingCamera || isDragging) return
                              e.stopPropagation()
                              setActiveHandle(rotationHandleId)
                              handleRotationDrag(seg.id)
                            }}
                            onPointerEnter={() => !isDragging && setHoveredHandle(rotationHandleId)}
                            onPointerLeave={() => !isDragging && setHoveredHandle(null)}
                            renderOrder={1000}
                            rotation={groupRotation}
                          >
                            <torusGeometry
                              args={[
                                ROTATION_HANDLE_RADIUS,
                                rotationHitThickness,
                                16,
                                32,
                                arcAngle,
                              ]}
                            />
                            <HitMaterial />
                          </mesh>

                          {/* Visible torus */}
                          <mesh renderOrder={1000} rotation={groupRotation}>
                            <torusGeometry
                              args={[
                                ROTATION_HANDLE_RADIUS,
                                ROTATION_HANDLE_THICKNESS,
                                16,
                                32,
                                arcAngle,
                              ]}
                            />
                            <HandleMaterial
                              color="#4444ff"
                              emissiveIntensity={getHandleEmissiveIntensity(rotationHandleId)}
                              opacity={getHandleOpacity(rotationHandleId)}
                            />
                          </mesh>
                        </group>
                      )
                    })

                    // Translation handles at center (box + ridge/perp arrows) - rotated to align with roof
                    // Rotation makes: local +X → ridge direction, local +Z → perpendicular direction
                    const translationHandles = (
                      <group
                        key={`${seg.id}-translation`}
                        position={[centerX, centerY, centerZ]}
                        rotation={[0, -ridgeAngle, 0]}
                      >
                        {/* Center origin marker for XZ translation */}
                        <group position={[0, 0, 0]}>
                          {/* Invisible larger hit target for XZ translation */}
                          <mesh
                            onPointerDown={(e) => {
                              if (e.button !== 0 || movingCamera || isDragging) return
                              e.stopPropagation()
                              setActiveHandle(`${seg.id}-translate-xz`)
                              handleTranslationDrag(seg.id, 'xz')
                            }}
                            onPointerEnter={() =>
                              !isDragging && setHoveredHandle(`${seg.id}-translate-xz`)
                            }
                            onPointerLeave={() => !isDragging && setHoveredHandle(null)}
                            position={[0, 0, 0]}
                            renderOrder={1000}
                          >
                            <boxGeometry args={[originHitSize, originHitSize, originHitSize]} />
                            <HitMaterial />
                          </mesh>
                          {/* Visible origin marker */}
                          <mesh position={[0, 0, 0]} renderOrder={1000}>
                            <boxGeometry
                              args={[ORIGIN_MARKER_SIZE, ORIGIN_MARKER_SIZE, ORIGIN_MARKER_SIZE]}
                            />
                            <HandleMaterial
                              color="white"
                              emissiveIntensity={getHandleEmissiveIntensity(
                                `${seg.id}-translate-xz`,
                              )}
                              opacity={getHandleOpacity(`${seg.id}-translate-xz`)}
                            />
                          </mesh>
                        </group>

                        {/* Translate along ridge - Green arrow pointing along local X (ridge direction) */}
                        <group position={[0, 0, 0]}>
                          {/* Invisible larger hit target */}
                          <mesh
                            onPointerDown={(e) => {
                              if (e.button !== 0 || movingCamera || isDragging) return
                              e.stopPropagation()
                              setActiveHandle(`${seg.id}-translate-ridge`)
                              handleTranslationDrag(seg.id, 'ridge')
                            }}
                            onPointerEnter={() =>
                              !isDragging && setHoveredHandle(`${seg.id}-translate-ridge`)
                            }
                            onPointerLeave={() => !isDragging && setHoveredHandle(null)}
                            position={[transArrowHitPos, 0, 0]}
                            renderOrder={1000}
                            rotation={[0, 0, Math.PI / 2]}
                          >
                            <cylinderGeometry
                              args={[arrowHitRadius, arrowHitRadius, arrowHitLength, 8]}
                            />
                            <HitMaterial />
                          </mesh>
                          {/* Visible arrow shaft */}
                          <mesh
                            position={[transArrowShaftPos, 0, 0]}
                            renderOrder={1000}
                            rotation={[0, 0, Math.PI / 2]}
                          >
                            <cylinderGeometry
                              args={[
                                ARROW_SHAFT_RADIUS,
                                ARROW_SHAFT_RADIUS,
                                ARROW_SHAFT_LENGTH,
                                16,
                              ]}
                            />
                            <HandleMaterial
                              color="#44ff44"
                              emissiveIntensity={getHandleEmissiveIntensity(
                                `${seg.id}-translate-ridge`,
                              )}
                              opacity={getHandleOpacity(`${seg.id}-translate-ridge`)}
                            />
                          </mesh>
                          {/* Arrow head */}
                          <mesh
                            position={[transArrowHeadPos, 0, 0]}
                            renderOrder={1000}
                            rotation={[0, 0, -Math.PI / 2]}
                          >
                            <coneGeometry args={[ARROW_HEAD_RADIUS, ARROW_HEAD_LENGTH, 16]} />
                            <HandleMaterial
                              color="#44ff44"
                              emissiveIntensity={getHandleEmissiveIntensity(
                                `${seg.id}-translate-ridge`,
                              )}
                              opacity={getHandleOpacity(`${seg.id}-translate-ridge`)}
                            />
                          </mesh>
                        </group>

                        {/* Translate perpendicular to ridge - Red arrow pointing along local Z (perpendicular direction) */}
                        <group position={[0, 0, 0]}>
                          {/* Invisible larger hit target */}
                          <mesh
                            onPointerDown={(e) => {
                              if (e.button !== 0 || movingCamera || isDragging) return
                              e.stopPropagation()
                              setActiveHandle(`${seg.id}-translate-perp`)
                              handleTranslationDrag(seg.id, 'perp')
                            }}
                            onPointerEnter={() =>
                              !isDragging && setHoveredHandle(`${seg.id}-translate-perp`)
                            }
                            onPointerLeave={() => !isDragging && setHoveredHandle(null)}
                            position={[0, 0, transArrowHitPos]}
                            renderOrder={1000}
                            rotation={[Math.PI / 2, 0, 0]}
                          >
                            <cylinderGeometry
                              args={[arrowHitRadius, arrowHitRadius, arrowHitLength, 8]}
                            />
                            <HitMaterial />
                          </mesh>
                          {/* Visible arrow shaft */}
                          <mesh
                            position={[0, 0, transArrowShaftPos]}
                            renderOrder={1000}
                            rotation={[Math.PI / 2, 0, 0]}
                          >
                            <cylinderGeometry
                              args={[
                                ARROW_SHAFT_RADIUS,
                                ARROW_SHAFT_RADIUS,
                                ARROW_SHAFT_LENGTH,
                                16,
                              ]}
                            />
                            <HandleMaterial
                              color="#ff4444"
                              emissiveIntensity={getHandleEmissiveIntensity(
                                `${seg.id}-translate-perp`,
                              )}
                              opacity={getHandleOpacity(`${seg.id}-translate-perp`)}
                            />
                          </mesh>
                          {/* Arrow head */}
                          <mesh
                            position={[0, 0, transArrowHeadPos]}
                            renderOrder={1000}
                            rotation={[Math.PI / 2, 0, 0]}
                          >
                            <coneGeometry args={[ARROW_HEAD_RADIUS, ARROW_HEAD_LENGTH, 16]} />
                            <HandleMaterial
                              color="#ff4444"
                              emissiveIntensity={getHandleEmissiveIntensity(
                                `${seg.id}-translate-perp`,
                              )}
                              opacity={getHandleOpacity(`${seg.id}-translate-perp`)}
                            />
                          </mesh>
                        </group>
                      </group>
                    )

                    return [
                      ...horizontalHandles,
                      ridgeHandle,
                      ...rotationHandles,
                      translationHandles,
                    ]
                  })()}
                </>
              )}
            </group>
          )
        })}
      </group>
    )
  },
)

Roofs.displayName = 'Roofs'

// --- Roof Shadow Preview ---
type RoofShadowPreviewProps = {
  start: [number, number]
  end: [number, number]
  tileSize: number
  baseHeight: number
  height?: number
  leftWidth?: number
  rightWidth?: number
}

export const RoofShadowPreview = memo(
  ({
    start,
    end,
    tileSize,
    baseHeight,
    height = 2,
    leftWidth,
    rightWidth,
  }: RoofShadowPreviewProps) => {
    const geometries = useMemo(() => {
      const startWorld = [start[0] * tileSize, start[1] * tileSize]
      const endWorld = [end[0] * tileSize, end[1] * tileSize]

      const dx = endWorld[0] - startWorld[0]
      const dz = endWorld[1] - startWorld[1]
      const ridgeLength = Math.sqrt(dx * dx + dz * dz)

      if (ridgeLength < 0.1) return null

      const ridgeDir = { x: dx / ridgeLength, z: dz / ridgeLength }
      const perpDir = { x: -ridgeDir.z, z: ridgeDir.x }

      // Use provided widths or default to symmetric
      const finalLeftWidth = leftWidth ?? ROOF_WIDTH / 2
      const finalRightWidth = rightWidth ?? ROOF_WIDTH / 2

      const bottomLeft = [
        startWorld[0] + perpDir.x * finalLeftWidth,
        0,
        startWorld[1] + perpDir.z * finalLeftWidth,
      ]
      const bottomRight = [
        startWorld[0] - perpDir.x * finalRightWidth,
        0,
        startWorld[1] - perpDir.z * finalRightWidth,
      ]
      const bottomLeftEnd = [
        endWorld[0] + perpDir.x * finalLeftWidth,
        0,
        endWorld[1] + perpDir.z * finalLeftWidth,
      ]
      const bottomRightEnd = [
        endWorld[0] - perpDir.x * finalRightWidth,
        0,
        endWorld[1] - perpDir.z * finalRightWidth,
      ]

      const ridgeStart = [startWorld[0], height, startWorld[1]]
      const ridgeEnd = [endWorld[0], height, endWorld[1]]

      // Create complete preview geometries (all 4 faces)
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
      }
    }, [start, end, tileSize, baseHeight, height, leftWidth, rightWidth])

    if (!geometries) return null

    return (
      <group>
        {/* Occluded version - all 4 faces */}
        <mesh geometry={geometries.frontGable} renderOrder={1}>
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
        <mesh geometry={geometries.backGable} renderOrder={1}>
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
        <mesh geometry={geometries.leftRoof} renderOrder={1}>
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
        <mesh geometry={geometries.rightRoof} renderOrder={1}>
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

        {/* Visible version - all 4 faces */}
        <mesh geometry={geometries.frontGable} renderOrder={2}>
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
        <mesh geometry={geometries.backGable} renderOrder={2}>
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
        <mesh geometry={geometries.leftRoof} renderOrder={2}>
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
        <mesh geometry={geometries.rightRoof} renderOrder={2}>
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
      </group>
    )
  },
)

RoofShadowPreview.displayName = 'RoofShadowPreview'
