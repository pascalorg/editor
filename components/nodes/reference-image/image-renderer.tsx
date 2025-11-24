'use client'

import { useTexture } from '@react-three/drei'
import { memo, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/shallow'
import { FLOOR_SPACING, TILE_SIZE } from '@/components/editor'
import { useImageManipulation } from '@/components/nodes/reference-image/reference-image-node'
import { useEditor } from '@/hooks/use-editor'
import type { ImageNode } from '@/lib/scenegraph/schema/index'

const GRID_SIZE = 30 // 30m x 30m

const DEBUG = false
const HANDLE_SCALE = 1 // Manual scale for manipulation handles

// Handle geometry dimensions - base sizes
const ORIGIN_MARKER_SIZE = 0.16
const ARROW_SHAFT_RADIUS = 0.06
const ARROW_SHAFT_LENGTH = 2
const ARROW_HEAD_RADIUS = 0.12
const ARROW_HEAD_LENGTH = 0.3
const ROTATION_HANDLE_RADIUS = 0.4
const ROTATION_HANDLE_THICKNESS = 0.06
const SCALE_HANDLE_RADIUS = 0.12
const SCALE_HANDLE_LENGTH = 0.3

// Hit target scale factors (multipliers for base dimensions)
const ORIGIN_HIT_SCALE = 2.5
const ARROW_HIT_RADIUS_SCALE = 2.5
const ARROW_HIT_LENGTH_SCALE = 1.1
const ROTATION_HIT_SCALE = 2
const SCALE_HIT_SCALE = 1.5

interface ImageRendererProps {
  nodeId: ImageNode['id']
}

const EMPTY_LEVELS: any[] = []

export const ImageRenderer = memo(({ nodeId }: ImageRendererProps) => {
  const hitAreaOpacity = DEBUG ? (0.5 as const) : 0
  const node = useEditor(
    useShallow((state) => state.graph.getNodeById(nodeId)?.data() as ImageNode | undefined),
  )
  const texture = useTexture(node?.url || '')
  const groupRef = useRef<THREE.Group>(null)

  // Get state from store
  const controlMode = useEditor((state) => state.controlMode)
  const movingCamera = useEditor((state) => state.movingCamera)
  const selectedNodeIds = useEditor((state) => state.selectedNodeIds)

  const isSelected = selectedNodeIds.includes(nodeId)

  // Track hover and active states for handles
  const [hoveredHandle, setHoveredHandle] = useState<string | null>(null)
  const [activeHandle, setActiveHandle] = useState<string | null>(null)

  // Get manipulation handlers from the builder hook
  const {
    handleSelect,
    handleTranslateDown,
    handleTranslateXZDown,
    handleRotationDown,
    handleScaleDown,
  } = useImageManipulation(nodeId, groupRef, setActiveHandle)

  // Get level for Y position
  const getLevelId = useEditor((state) => state.getLevelId)
  const levels = useEditor((state) => {
    const building = state.scene.root.children?.[0]?.children.find(c => c.type === 'building')
    return building ? building.children : EMPTY_LEVELS
  })
  const levelId = useMemo(() => getLevelId(nodeId), [getLevelId, nodeId])
  const level = useMemo(() => levels.find((l) => l.id === levelId), [levels, levelId])
  const levelNumber = (level as any)?.level ?? 0

  // Track hover state for the image itself
  const [isHovered, setIsHovered] = useState(false)

  // Visual states for handles
  const getHandleOpacity = (handleId: string) => {
    if (activeHandle === handleId || hoveredHandle === handleId) return 1
    return 0.6
  }

  const getHandleEmissiveIntensity = (handleId: string) => {
    if (activeHandle === handleId || hoveredHandle === handleId) return 0.5
    return 0.05
  }

  // Reusable material components
  const HitMaterial = () => (
    <meshStandardMaterial depthTest={false} opacity={hitAreaOpacity} transparent />
  )

  const HandleMaterial = ({ color, handleId }: { color: string; handleId: string }) => (
    <meshStandardMaterial
      color={color}
      depthTest={false}
      emissive={color}
      emissiveIntensity={getHandleEmissiveIntensity(handleId)}
      metalness={0.3}
      opacity={getHandleOpacity(handleId)}
      roughness={0.4}
      side={THREE.DoubleSide}
      transparent
    />
  )

  // Calculate aspect-ratio-preserving dimensions
  const [planeWidth, planeHeight] = useMemo(() => {
    if (!texture.image) return [GRID_SIZE, GRID_SIZE]

    const imageWidth = texture.image.width
    const imageHeight = texture.image.height
    const aspectRatio = imageWidth / imageHeight

    if (aspectRatio > 1) {
      return [GRID_SIZE, GRID_SIZE / aspectRatio]
    }
    return [GRID_SIZE * aspectRatio, GRID_SIZE]
  }, [texture])

  // Calculate derived dimensions from base sizes and scale factors
  const originHitSize = ORIGIN_MARKER_SIZE * ORIGIN_HIT_SCALE
  const arrowHitRadius = ARROW_SHAFT_RADIUS * ARROW_HIT_RADIUS_SCALE
  const arrowHitLength = ARROW_SHAFT_LENGTH * ARROW_HIT_LENGTH_SCALE
  const rotationHitThickness = ROTATION_HANDLE_THICKNESS * ROTATION_HIT_SCALE
  const scaleHitRadius = SCALE_HANDLE_RADIUS * SCALE_HIT_SCALE
  const scaleHitLength = SCALE_HANDLE_LENGTH * SCALE_HIT_SCALE

  // Calculate handle positions based on dimensions
  const originMarkerEdge = ORIGIN_MARKER_SIZE / 2
  const originHitEdge = originHitSize / 2

  const arrowShaftPos = originMarkerEdge + ARROW_SHAFT_LENGTH / 2
  const arrowHitPos = originHitEdge + arrowHitLength / 2
  const arrowHeadPos = originMarkerEdge + ARROW_SHAFT_LENGTH + ARROW_HEAD_LENGTH / 2

  // Convert grid position to world position
  const [worldX, worldZ] = useMemo(
    () => [(node?.position?.[0] ?? 0) * TILE_SIZE, (node?.position?.[1] ?? 0) * TILE_SIZE],
    [node?.position],
  )

  return (
    <group
      position={[worldX, levelNumber * FLOOR_SPACING + 0.001, worldZ]}
      ref={groupRef}
      rotation={[0, ((node?.rotationY ?? 0) * Math.PI) / 180, 0]}
    >
      {/* Image plane - rotated to lie flat on XZ plane */}
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <mesh
          onPointerDown={(e) => {
            if (e.button !== 0) return
            if ((controlMode === 'guide' || controlMode === 'select') && !movingCamera) {
              e.stopPropagation()
              handleSelect(e)
            }
          }}
          onPointerEnter={(e) => {
            if ((controlMode === 'guide' || controlMode === 'select') && !movingCamera) {
              setIsHovered(true)
            }
          }}
          onPointerLeave={() => {
            setIsHovered(false)
          }}
          scale={node?.scale ?? 1}
        >
          <planeGeometry args={[planeWidth, planeHeight]} />
          <meshStandardMaterial
            emissive={
              (controlMode === 'guide' || controlMode === 'select') && (isHovered || isSelected)
                ? '#ffffff'
                : '#000000'
            }
            emissiveIntensity={
              (controlMode === 'guide' || controlMode === 'select') && (isHovered || isSelected)
                ? 0.2
                : 0
            }
            map={texture}
            opacity={(node?.opacity ?? 100) / 100}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={1}
            side={THREE.DoubleSide}
            transparent
          />
        </mesh>
      </group>

      {/* Manipulation handles - stay upright, only rotate with Y rotation */}
      {isSelected && controlMode === 'guide' && (
        <group>
          {/* Center origin marker for reference with XZ plane translation hit box */}
          <group position={[0, 0, 0]}>
            <mesh
              onPointerDown={handleTranslateXZDown}
              onPointerEnter={() => setHoveredHandle('translate-xz')}
              onPointerLeave={() => setHoveredHandle(null)}
              position={[0, 0, 0]}
              renderOrder={1000}
              scale={HANDLE_SCALE}
            >
              <boxGeometry args={[originHitSize, originHitSize, originHitSize]} />
              <HitMaterial />
            </mesh>
            <mesh position={[0, 0, 0]} renderOrder={1000} scale={HANDLE_SCALE}>
              <boxGeometry args={[ORIGIN_MARKER_SIZE, ORIGIN_MARKER_SIZE, ORIGIN_MARKER_SIZE]} />
              <HandleMaterial color="white" handleId="translate-xz" />
            </mesh>
          </group>

          {/* Translate X (world X) - Red arrow pointing along X axis */}
          <group position={[0, 0, 0]}>
            <mesh
              onPointerDown={handleTranslateDown('x')}
              onPointerEnter={() => setHoveredHandle('translate-x')}
              onPointerLeave={() => setHoveredHandle(null)}
              position={[arrowHitPos, 0, 0]}
              renderOrder={1000}
              rotation={[0, 0, Math.PI / 2]}
              scale={HANDLE_SCALE}
            >
              <cylinderGeometry args={[arrowHitRadius, arrowHitRadius, arrowHitLength, 8]} />
              <HitMaterial />
            </mesh>
            <mesh
              position={[arrowShaftPos, 0, 0]}
              renderOrder={1000}
              rotation={[0, 0, Math.PI / 2]}
              scale={HANDLE_SCALE}
            >
              <cylinderGeometry
                args={[ARROW_SHAFT_RADIUS, ARROW_SHAFT_RADIUS, ARROW_SHAFT_LENGTH, 16]}
              />
              <HandleMaterial color="#ff4444" handleId="translate-x" />
            </mesh>
            <mesh
              position={[arrowHeadPos, 0, 0]}
              renderOrder={1000}
              rotation={[0, 0, -Math.PI / 2]}
              scale={HANDLE_SCALE}
            >
              <coneGeometry args={[ARROW_HEAD_RADIUS, ARROW_HEAD_LENGTH, 16]} />
              <HandleMaterial color="#ff4444" handleId="translate-x" />
            </mesh>
          </group>

          {/* Translate Z (world Z) - Green arrow pointing along Z axis */}
          <group position={[0, 0, 0]}>
            <mesh
              onPointerDown={handleTranslateDown('y')}
              onPointerEnter={() => setHoveredHandle('translate-z')}
              onPointerLeave={() => setHoveredHandle(null)}
              position={[0, 0, arrowHitPos]}
              renderOrder={1000}
              rotation={[Math.PI / 2, 0, 0]}
              scale={HANDLE_SCALE}
            >
              <cylinderGeometry args={[arrowHitRadius, arrowHitRadius, arrowHitLength, 8]} />
              <HitMaterial />
            </mesh>
            <mesh
              position={[0, 0, arrowShaftPos]}
              renderOrder={1000}
              rotation={[Math.PI / 2, 0, 0]}
              scale={HANDLE_SCALE}
            >
              <cylinderGeometry
                args={[ARROW_SHAFT_RADIUS, ARROW_SHAFT_RADIUS, ARROW_SHAFT_LENGTH, 16]}
              />
              <HandleMaterial color="#44ff44" handleId="translate-z" />
            </mesh>
            <mesh
              position={[0, 0, arrowHeadPos]}
              renderOrder={1000}
              rotation={[Math.PI / 2, 0, 0]}
              scale={HANDLE_SCALE}
            >
              <coneGeometry args={[ARROW_HEAD_RADIUS, ARROW_HEAD_LENGTH, 16]} />
              <HandleMaterial color="#44ff44" handleId="translate-z" />
            </mesh>
          </group>

          {/* Rotation handles at corners - Blue curved arrows around Y axis */}
          <group
            position={[
              (planeWidth * (node?.scale ?? 1)) / 2,
              0,
              (planeHeight * (node?.scale ?? 1)) / 2,
            ]}
          >
            <mesh
              onPointerDown={handleRotationDown}
              onPointerEnter={() => setHoveredHandle('rotation')}
              onPointerLeave={() => setHoveredHandle(null)}
              renderOrder={1000}
              rotation={[Math.PI / 2, 0, 0]}
              scale={HANDLE_SCALE}
            >
              <torusGeometry
                args={[ROTATION_HANDLE_RADIUS, rotationHitThickness, 16, 32, Math.PI / 2]}
              />
              <HitMaterial />
            </mesh>
            <mesh renderOrder={1000} rotation={[Math.PI / 2, 0, 0]} scale={HANDLE_SCALE}>
              <torusGeometry
                args={[ROTATION_HANDLE_RADIUS, ROTATION_HANDLE_THICKNESS, 16, 32, Math.PI / 2]}
              />
              <HandleMaterial color="#4444ff" handleId="rotation" />
            </mesh>
          </group>
          <group
            position={[
              -(planeWidth * (node?.scale ?? 1)) / 2,
              0,
              (planeHeight * (node?.scale ?? 1)) / 2,
            ]}
          >
            <mesh
              onPointerDown={handleRotationDown}
              onPointerEnter={() => setHoveredHandle('rotation')}
              onPointerLeave={() => setHoveredHandle(null)}
              renderOrder={1000}
              rotation={[Math.PI / 2, 0, Math.PI / 2]}
              scale={HANDLE_SCALE}
            >
              <torusGeometry
                args={[ROTATION_HANDLE_RADIUS, rotationHitThickness, 16, 32, Math.PI / 2]}
              />
              <HitMaterial />
            </mesh>
            <mesh renderOrder={1000} rotation={[Math.PI / 2, 0, Math.PI / 2]} scale={HANDLE_SCALE}>
              <torusGeometry
                args={[ROTATION_HANDLE_RADIUS, ROTATION_HANDLE_THICKNESS, 16, 32, Math.PI / 2]}
              />
              <HandleMaterial color="#4444ff" handleId="rotation" />
            </mesh>
          </group>
          <group
            position={[
              -(planeWidth * (node?.scale ?? 1)) / 2,
              0,
              -(planeHeight * (node?.scale ?? 1)) / 2,
            ]}
          >
            <mesh
              onPointerDown={handleRotationDown}
              onPointerEnter={() => setHoveredHandle('rotation')}
              onPointerLeave={() => setHoveredHandle(null)}
              renderOrder={1000}
              rotation={[Math.PI / 2, 0, Math.PI]}
              scale={HANDLE_SCALE}
            >
              <torusGeometry
                args={[ROTATION_HANDLE_RADIUS, rotationHitThickness, 16, 32, Math.PI / 2]}
              />
              <HitMaterial />
            </mesh>
            <mesh renderOrder={1000} rotation={[Math.PI / 2, 0, Math.PI]} scale={HANDLE_SCALE}>
              <torusGeometry
                args={[ROTATION_HANDLE_RADIUS, ROTATION_HANDLE_THICKNESS, 16, 32, Math.PI / 2]}
              />
              <HandleMaterial color="#4444ff" handleId="rotation" />
            </mesh>
          </group>
          <group
            position={[
              (planeWidth * (node?.scale ?? 1)) / 2,
              0,
              -(planeHeight * (node?.scale ?? 1)) / 2,
            ]}
          >
            <mesh
              onPointerDown={handleRotationDown}
              onPointerEnter={() => setHoveredHandle('rotation')}
              onPointerLeave={() => setHoveredHandle(null)}
              renderOrder={1000}
              rotation={[Math.PI / 2, 0, -Math.PI / 2]}
              scale={HANDLE_SCALE}
            >
              <torusGeometry
                args={[ROTATION_HANDLE_RADIUS, rotationHitThickness, 16, 32, Math.PI / 2]}
              />
              <HitMaterial />
            </mesh>
            <mesh renderOrder={1000} rotation={[Math.PI / 2, 0, -Math.PI / 2]} scale={HANDLE_SCALE}>
              <torusGeometry
                args={[ROTATION_HANDLE_RADIUS, ROTATION_HANDLE_THICKNESS, 16, 32, Math.PI / 2]}
              />
              <HandleMaterial color="#4444ff" handleId="rotation" />
            </mesh>
          </group>

          {/* Scale handles at edge midpoints - Yellow cones pointing outward */}
          <group position={[(planeWidth * (node?.scale ?? 1)) / 2, 0, 0]}>
            <mesh
              onPointerDown={handleScaleDown('right')}
              onPointerEnter={() => setHoveredHandle('scale')}
              onPointerLeave={() => setHoveredHandle(null)}
              renderOrder={1000}
              rotation={[0, 0, -Math.PI / 2]}
              scale={HANDLE_SCALE}
            >
              <coneGeometry args={[scaleHitRadius, scaleHitLength, 16]} />
              <HitMaterial />
            </mesh>
            <mesh renderOrder={1000} rotation={[0, 0, -Math.PI / 2]} scale={HANDLE_SCALE}>
              <coneGeometry args={[SCALE_HANDLE_RADIUS, SCALE_HANDLE_LENGTH, 16]} />
              <HandleMaterial color="#ffff44" handleId="scale" />
            </mesh>
          </group>
          <group position={[-(planeWidth * (node?.scale ?? 1)) / 2, 0, 0]}>
            <mesh
              onPointerDown={handleScaleDown('left')}
              onPointerEnter={() => setHoveredHandle('scale')}
              onPointerLeave={() => setHoveredHandle(null)}
              renderOrder={1000}
              rotation={[0, 0, Math.PI / 2]}
              scale={HANDLE_SCALE}
            >
              <coneGeometry args={[scaleHitRadius, scaleHitLength, 16]} />
              <HitMaterial />
            </mesh>
            <mesh renderOrder={1000} rotation={[0, 0, Math.PI / 2]} scale={HANDLE_SCALE}>
              <coneGeometry args={[SCALE_HANDLE_RADIUS, SCALE_HANDLE_LENGTH, 16]} />
              <HandleMaterial color="#ffff44" handleId="scale" />
            </mesh>
          </group>
          <group position={[0, 0, (planeHeight * (node?.scale ?? 1)) / 2]}>
            <mesh
              onPointerDown={handleScaleDown('top')}
              onPointerEnter={() => setHoveredHandle('scale')}
              onPointerLeave={() => setHoveredHandle(null)}
              renderOrder={1000}
              rotation={[Math.PI / 2, 0, 0]}
              scale={HANDLE_SCALE}
            >
              <coneGeometry args={[scaleHitRadius, scaleHitLength, 16]} />
              <HitMaterial />
            </mesh>
            <mesh renderOrder={1000} rotation={[Math.PI / 2, 0, 0]} scale={HANDLE_SCALE}>
              <coneGeometry args={[SCALE_HANDLE_RADIUS, SCALE_HANDLE_LENGTH, 16]} />
              <HandleMaterial color="#ffff44" handleId="scale" />
            </mesh>
          </group>
          <group position={[0, 0, -(planeHeight * (node?.scale ?? 1)) / 2]}>
            <mesh
              onPointerDown={handleScaleDown('bottom')}
              onPointerEnter={() => setHoveredHandle('scale')}
              onPointerLeave={() => setHoveredHandle(null)}
              renderOrder={1000}
              rotation={[-Math.PI / 2, 0, 0]}
              scale={HANDLE_SCALE}
            >
              <coneGeometry args={[scaleHitRadius, scaleHitLength, 16]} />
              <HitMaterial />
            </mesh>
            <mesh renderOrder={1000} rotation={[-Math.PI / 2, 0, 0]} scale={HANDLE_SCALE}>
              <coneGeometry args={[SCALE_HANDLE_RADIUS, SCALE_HANDLE_LENGTH, 16]} />
              <HandleMaterial color="#ffff44" handleId="scale" />
            </mesh>
          </group>
        </group>
      )}
    </group>
  )
})

ImageRenderer.displayName = 'ImageRenderer'
