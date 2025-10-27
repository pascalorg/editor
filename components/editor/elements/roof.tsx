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
const DEBUG = true
const ARROW_SHAFT_RADIUS = 0.06
const ARROW_SHAFT_LENGTH = 0.5
const ARROW_HEAD_RADIUS = 0.12
const ARROW_HEAD_LENGTH = 0.3

// Hit target scale factors
const ARROW_HIT_RADIUS_SCALE = 2.5
const ARROW_HIT_LENGTH_SCALE = 1.7

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
          plane.setFromNormalAndCoplanarPoint(cameraDirection, new THREE.Vector3(0, baseHeight, 0))
        } else {
          // Horizontal edge handle moves on the ZX plane (ground plane)
          plane.setFromNormalAndCoplanarPoint(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0, baseHeight, 0),
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
            const newHeight = Math.max(0.5, Math.min(10, originalSegment.height + delta.y))
            updatedSegment = { ...originalSegment, height: newHeight }
          } else {
            // Horizontal edge handle: displace the ridge line perpendicular to itself
            // Extract edge direction from handleId (front, right, back, left)
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

              // Project delta onto perpendicular direction
              const projectedDelta = delta.x * perpDir.x + delta.z * perpDir.z

              // Determine displacement direction based on edge type
              // Front/Left edges: move ridge in +perpDir direction
              // Back/Right edges: move ridge in -perpDir direction
              let displacement = 0
              if (edgeType === 'front' || edgeType === 'left') {
                displacement = projectedDelta
              } else if (edgeType === 'back' || edgeType === 'right') {
                displacement = -projectedDelta
              }

              // Move both start and end points of the ridge
              const newStartX = originalSegment.start[0] + (displacement * perpDir.x) / tileSize
              const newStartY = originalSegment.start[1] + (displacement * perpDir.z) / tileSize
              const newEndX = originalSegment.end[0] + (displacement * perpDir.x) / tileSize
              const newEndY = originalSegment.end[1] + (displacement * perpDir.z) / tileSize

              // Snap to grid (0.1 precision)
              const snapToGrid = (val: number) => Math.round(val * 10) / 10

              updatedSegment = {
                ...originalSegment,
                start: [snapToGrid(newStartX), snapToGrid(newStartY)],
                end: [snapToGrid(newEndX), snapToGrid(newEndY)],
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
          const halfWidth = ROOF_WIDTH / 2
          const roofHeight = seg.height || 2 // Default 2m peak height above base

          // Bottom corners (at baseHeight)
          const bottomLeft = [
            startWorld[0] + perpDir.x * halfWidth,
            baseHeight,
            startWorld[1] + perpDir.z * halfWidth,
          ]
          const bottomRight = [
            startWorld[0] - perpDir.x * halfWidth,
            baseHeight,
            startWorld[1] - perpDir.z * halfWidth,
          ]
          const bottomLeftEnd = [
            endWorld[0] + perpDir.x * halfWidth,
            baseHeight,
            endWorld[1] + perpDir.z * halfWidth,
          ]
          const bottomRightEnd = [
            endWorld[0] - perpDir.x * halfWidth,
            baseHeight,
            endWorld[1] - perpDir.z * halfWidth,
          ]

          // Ridge points (at baseHeight + roofHeight)
          const ridgeStart = [startWorld[0], baseHeight + roofHeight, startWorld[1]]
          const ridgeEnd = [endWorld[0], baseHeight + roofHeight, endWorld[1]]

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

                    // Calculate derived dimensions
                    const arrowHitRadius = ARROW_SHAFT_RADIUS * ARROW_HIT_RADIUS_SCALE
                    const arrowHitLength = ARROW_SHAFT_LENGTH * ARROW_HIT_LENGTH_SCALE
                    const arrowShaftPos = ARROW_SHAFT_LENGTH / 2
                    const arrowHitPos = arrowHitLength / 2
                    const arrowHeadPos = ARROW_SHAFT_LENGTH + ARROW_HEAD_LENGTH / 2

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

                    return [...horizontalHandles, ridgeHandle]
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
}

export const RoofShadowPreview = memo(
  ({ start, end, tileSize, baseHeight, height = 2 }: RoofShadowPreviewProps) => {
    const geometries = useMemo(() => {
      const startWorld = [start[0] * tileSize, start[1] * tileSize]
      const endWorld = [end[0] * tileSize, end[1] * tileSize]

      const dx = endWorld[0] - startWorld[0]
      const dz = endWorld[1] - startWorld[1]
      const ridgeLength = Math.sqrt(dx * dx + dz * dz)

      if (ridgeLength < 0.1) return null

      const ridgeDir = { x: dx / ridgeLength, z: dz / ridgeLength }
      const perpDir = { x: -ridgeDir.z, z: ridgeDir.x }

      const halfWidth = ROOF_WIDTH / 2

      const bottomLeft = [
        startWorld[0] + perpDir.x * halfWidth,
        baseHeight,
        startWorld[1] + perpDir.z * halfWidth,
      ]
      const bottomRight = [
        startWorld[0] - perpDir.x * halfWidth,
        baseHeight,
        startWorld[1] - perpDir.z * halfWidth,
      ]
      const bottomLeftEnd = [
        endWorld[0] + perpDir.x * halfWidth,
        baseHeight,
        endWorld[1] + perpDir.z * halfWidth,
      ]
      const bottomRightEnd = [
        endWorld[0] - perpDir.x * halfWidth,
        baseHeight,
        endWorld[1] - perpDir.z * halfWidth,
      ]

      const ridgeStart = [startWorld[0], baseHeight + height, startWorld[1]]
      const ridgeEnd = [endWorld[0], baseHeight + height, endWorld[1]]

      // Create simplified preview geometries
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

      return { frontGable: frontGableGeometry, leftRoof: leftRoofGeometry }
    }, [start, end, tileSize, baseHeight, height])

    if (!geometries) return null

    return (
      <group>
        {/* Occluded version */}
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

        {/* Visible version */}
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
      </group>
    )
  },
)

RoofShadowPreview.displayName = 'RoofShadowPreview'
