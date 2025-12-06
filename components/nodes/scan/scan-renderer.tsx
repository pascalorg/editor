'use client'

import { useGLTF } from '@react-three/drei'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { useShallow } from 'zustand/shallow'
import { FLOOR_SPACING, TILE_SIZE } from '@/components/editor'
import { useScanManipulation } from '@/components/nodes/scan/scan-node'
import { useEditor } from '@/hooks/use-editor'
import { loadAssetUrl } from '@/lib/asset-storage'
import type { ScanNode } from '@/lib/scenegraph/schema/index'

const ktx2LoaderInstance = new KTX2Loader()
ktx2LoaderInstance.setTranscoderPath(
  'https://cdn.jsdelivr.net/gh/pmndrs/drei-assets@master/basis/',
)

const useGLTFKTX2 = (path: string) => {
  const gl = useThree((state) => state.gl)
  
  return useGLTF(path, true, true, (loader) => {
    ktx2LoaderInstance.detectSupport(gl)
    loader.setKTX2Loader(ktx2LoaderInstance)
    loader.setMeshoptDecoder(MeshoptDecoder)
  })
}

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

interface ScanRendererProps {
  nodeId: ScanNode['id']
}

interface ScanRendererContentProps extends ScanRendererProps {
  resolvedUrl: string
}

const EMPTY_LEVELS: any[] = []

const ScanRendererContent = memo(({ nodeId, resolvedUrl }: ScanRendererContentProps) => {
  const hitAreaOpacity = DEBUG ? (0.5 as const) : 0

  const { levelId, nodeOpacity, nodePosition, nodeScale, nodeRotation } = useEditor(
    useShallow((state) => {
      const handle = state.graph.getNodeById(nodeId)
      const node = handle?.data() as ScanNode | undefined
      return {
        levelId: state.getLevelId(nodeId),
        nodeOpacity: node?.opacity,
        nodePosition: node?.position || [0, 0],
        nodeRotation: node?.rotation || [0, 0, 0],
        nodeScale: node?.scale || 1,
      }
    }),
  )
  const { scene } = useGLTFKTX2(resolvedUrl)
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
    handleTranslateYDown,
    handleScaleDown,
  } = useScanManipulation(nodeId, groupRef, setActiveHandle)

  // Get level for Y position
  const levels = useEditor((state) => {
    const building = state.scene.root.children?.[0]?.children.find((c) => c.type === 'building')
    return building ? building.children : EMPTY_LEVELS
  })
  const level = useMemo(() => levels.find((l) => l.id === levelId), [levels, levelId])
  const levelNumber = level?.level ?? 0

  // Track hover state for the scan itself
  const [isHovered, setIsHovered] = useState(false)

  // Apply opacity to scan materials
  const clonedScene = useMemo(() => {
    const cloned = scene.clone()
    cloned.traverse((child: any) => {
      if (child.isMesh && child.material) {
        child.material = child.material.clone()
        child.material.transparent = (nodeOpacity ?? 100) < 100
        child.material.opacity = (nodeOpacity ?? 100) / 100
      }
    })
    return cloned
  }, [scene, nodeOpacity])
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

  // Calculate bounding box for the scan
  const bbox = useMemo(() => new THREE.Box3().setFromObject(clonedScene), [clonedScene])
  const bboxSize = useMemo(() => {
    const size = new THREE.Vector3()
    bbox.getSize(size)
    return size
  }, [bbox])

  // Convert grid position to world position
  const [worldX, worldZ] = useMemo(
    () => [nodePosition[0] * TILE_SIZE, nodePosition[1] * TILE_SIZE],
    [nodePosition],
  )

  return (
    <group
      position={[worldX, levelNumber * FLOOR_SPACING + 0.001 + (nodePosition[2] || 0), worldZ]}
      ref={groupRef}
      rotation={[0, (nodeRotation[1] * Math.PI) / 180, 0]}
    >
      {/* The 3D scan model */}
      <group scale={nodeScale}>
        <primitive
          object={clonedScene}
          onPointerDown={(e: any) => {
            if (e.button !== 0) return
            if ((controlMode === 'guide' || controlMode === 'select') && !movingCamera) {
              e.stopPropagation()
              handleSelect(e)
            }
          }}
          onPointerEnter={() => {
            if ((controlMode === 'guide' || controlMode === 'select') && !movingCamera) {
              setIsHovered(true)
            }
          }}
          onPointerLeave={() => {
            setIsHovered(false)
          }}
        />
        {/* Add emissive highlight when selected or hovered */}
        {(controlMode === 'guide' || controlMode === 'select') && (isHovered || isSelected) && (
          <meshStandardMaterial
            attach="material"
            emissive="#ffffff"
            emissiveIntensity={0.2}
            transparent
          />
        )}
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
              onPointerDown={handleTranslateDown('z')}
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

          {/* Translate Y (world Y) - Blue arrow pointing upward along Y axis */}
          <group position={[0, 0, 0]}>
            <mesh
              onPointerDown={handleTranslateYDown}
              onPointerEnter={() => setHoveredHandle('translate-y')}
              onPointerLeave={() => setHoveredHandle(null)}
              position={[0, arrowHitPos, 0]}
              renderOrder={1000}
              scale={HANDLE_SCALE}
            >
              <cylinderGeometry args={[arrowHitRadius, arrowHitRadius, arrowHitLength, 8]} />
              <HitMaterial />
            </mesh>
            <mesh position={[0, arrowShaftPos, 0]} renderOrder={1000} scale={HANDLE_SCALE}>
              <cylinderGeometry
                args={[ARROW_SHAFT_RADIUS, ARROW_SHAFT_RADIUS, ARROW_SHAFT_LENGTH, 16]}
              />
              <HandleMaterial color="#4444ff" handleId="translate-y" />
            </mesh>
            <mesh position={[0, arrowHeadPos, 0]} renderOrder={1000} scale={HANDLE_SCALE}>
              <coneGeometry args={[ARROW_HEAD_RADIUS, ARROW_HEAD_LENGTH, 16]} />
              <HandleMaterial color="#4444ff" handleId="translate-y" />
            </mesh>
          </group>

          {/* Rotation handles at corners - Cyan curved arrows around Y axis */}
          <group position={[(bboxSize.x * nodeScale) / 2, 0, (bboxSize.z * nodeScale) / 2]}>
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
              <HandleMaterial color="#44ffff" handleId="rotation" />
            </mesh>
          </group>
          <group position={[-(bboxSize.x * nodeScale) / 2, 0, (bboxSize.z * nodeScale) / 2]}>
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
              <HandleMaterial color="#44ffff" handleId="rotation" />
            </mesh>
          </group>
          <group position={[-(bboxSize.x * nodeScale) / 2, 0, -(bboxSize.z * nodeScale) / 2]}>
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
              <HandleMaterial color="#44ffff" handleId="rotation" />
            </mesh>
          </group>
          <group position={[(bboxSize.x * nodeScale) / 2, 0, -(bboxSize.z * nodeScale) / 2]}>
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
              <HandleMaterial color="#44ffff" handleId="rotation" />
            </mesh>
          </group>

          {/* Scale handles at edge midpoints - Yellow cones pointing outward */}
          <group position={[(bboxSize.x * nodeScale) / 2, 0, 0]}>
            <mesh
              onPointerDown={handleScaleDown}
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
          <group position={[-(bboxSize.x * nodeScale) / 2, 0, 0]}>
            <mesh
              onPointerDown={handleScaleDown}
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
          <group position={[0, 0, (bboxSize.z * nodeScale) / 2]}>
            <mesh
              onPointerDown={handleScaleDown}
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
          <group position={[0, 0, -(bboxSize.z * nodeScale) / 2]}>
            <mesh
              onPointerDown={handleScaleDown}
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

ScanRendererContent.displayName = 'ScanRendererContent'

export const ScanRenderer = memo(({ nodeId }: ScanRendererProps) => {
  const nodeUrl = useEditor((state) => {
    const handle = state.graph.getNodeById(nodeId)
    return (handle?.data() as ScanNode | undefined)?.url
  })

  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    loadAssetUrl(nodeUrl || '').then((url) => {
      if (active) setResolvedUrl(url)
    })
    return () => {
      active = false
    }
  }, [nodeUrl])

  if (!resolvedUrl) return null

  // Pre-load the GLTF to avoid suspense fallback causing flickering if this is a remount
  // (though useGLTF has its own cache, stable URL helps)
  
  return <ScanRendererContent nodeId={nodeId} resolvedUrl={resolvedUrl} />
})

ScanRenderer.displayName = 'ScanRenderer'
