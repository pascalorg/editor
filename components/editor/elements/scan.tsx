'use client'

import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { FLOOR_SPACING } from '@/components/editor'
import type { ControlMode } from '@/hooks/use-editor'

const DEBUG = false
const HANDLE_SCALE = 1 // Manual scale for manipulation handles

// Handle geometry dimensions - base sizes (same as reference-image)
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

const TILE_SIZE = 0.5 // Grid spacing in meters (matches editor grid)

type ScanProps = {
  id: string
  url: string
  opacity: number
  scale: number
  position: [number, number]
  rotation: number // degrees
  level: number // Floor level (Y position)
  yOffset?: number // Additional Y offset from floor level
  isSelected: boolean
  controlMode: ControlMode
  movingCamera: boolean
  onSelect: () => void
  onUpdate: (
    updates: Partial<{
      position: [number, number]
      rotation: number
      scale: number
      yOffset: number
    }>,
    pushToUndo?: boolean,
  ) => void
  onManipulationStart: () => void
  onManipulationEnd: () => void
}

export const Scan = ({
  id,
  url,
  opacity,
  scale,
  position,
  rotation,
  level,
  yOffset = 0,
  isSelected,
  controlMode,
  movingCamera,
  onSelect,
  onUpdate,
  onManipulationStart,
  onManipulationEnd,
}: ScanProps) => {
  const hitAreaOpacity = DEBUG ? (0.5 as const) : 0
  const { scene } = useGLTF(url)
  const { camera, gl } = useThree()
  const groupRef = useRef<THREE.Group>(null)

  // Track hover and active states for handles
  const [hoveredHandle, setHoveredHandle] = useState<string | null>(null)
  const [activeHandle, setActiveHandle] = useState<string | null>(null)

  // Track hover state for the scan itself
  const [isHovered, setIsHovered] = useState(false)

  // Apply opacity to scan materials
  useMemo(() => {
    scene.traverse((child: any) => {
      if (child.isMesh && child.material) {
        child.material = child.material.clone()
        child.material.transparent = opacity < 1
        child.material.opacity = opacity
      }
    })
  }, [scene, opacity])

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

  // Calculate handle positions based on dimensions
  const originMarkerEdge = ORIGIN_MARKER_SIZE / 2
  const originHitSize = ORIGIN_MARKER_SIZE * ORIGIN_HIT_SCALE
  const originHitEdge = originHitSize / 2

  const arrowShaftPos = originMarkerEdge + ARROW_SHAFT_LENGTH / 2
  const arrowHitRadius = ARROW_SHAFT_RADIUS * ARROW_HIT_RADIUS_SCALE
  const arrowHitLength = ARROW_SHAFT_LENGTH * ARROW_HIT_LENGTH_SCALE
  const arrowHitPos = originHitEdge + arrowHitLength / 2
  const arrowHeadPos = originMarkerEdge + ARROW_SHAFT_LENGTH + ARROW_HEAD_LENGTH / 2

  const rotationHitThickness = ROTATION_HANDLE_THICKNESS * ROTATION_HIT_SCALE
  const scaleHitRadius = SCALE_HANDLE_RADIUS * SCALE_HIT_SCALE
  const scaleHitLength = SCALE_HANDLE_LENGTH * SCALE_HIT_SCALE

  // Calculate bounding box for the scan
  const bbox = new THREE.Box3().setFromObject(scene)
  const bboxSize = new THREE.Vector3()
  bbox.getSize(bboxSize)

  const handleTranslateDown = (axis: 'x' | 'z') => (e: any) => {
    if (e.button !== 0) return
    if (movingCamera) return
    e.stopPropagation()
    if (!groupRef.current) return
    const handleId = axis === 'x' ? 'translate-x' : 'translate-z'
    setActiveHandle(handleId)
    onManipulationStart()
    const initialMouse = new THREE.Vector3()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(e.pointer, camera)
    raycaster.ray.intersectPlane(plane, initialMouse)
    const initialPosition = groupRef.current.position.clone()
    const localDir = axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1)
    const worldZero = new THREE.Vector3().applyMatrix4(groupRef.current.matrixWorld)
    const worldAxis = localDir
      .clone()
      .applyMatrix4(groupRef.current.matrixWorld)
      .sub(worldZero)
      .normalize()
    let lastPosition: [number, number] | null = null
    const handleMove = (ev: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect()
      const mx = ((ev.clientX - rect.left) / rect.width) * 2 - 1
      const my = -((ev.clientY - rect.top) / rect.height) * 2 + 1
      const mouseVec = new THREE.Vector2(mx, my)
      raycaster.setFromCamera(mouseVec, camera)
      const intersect = new THREE.Vector3()
      raycaster.ray.intersectPlane(plane, intersect)
      const delta = intersect.clone().sub(initialMouse)
      const projected = delta.dot(worldAxis)
      const newPos = initialPosition.clone().add(worldAxis.clone().multiplyScalar(projected))

      let finalX = newPos.x
      let finalZ = newPos.z
      if (ev.shiftKey) {
        finalX = Math.round(newPos.x / TILE_SIZE) * TILE_SIZE
        finalZ = Math.round(newPos.z / TILE_SIZE) * TILE_SIZE
      }

      lastPosition = [finalX, finalZ]
      onUpdate({ position: lastPosition }, false)
    }
    const handleUp = () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
      setActiveHandle(null)
      if (lastPosition) {
        onUpdate({ position: lastPosition }, true)
      }
      onManipulationEnd()
    }
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }

  const handleTranslateXZDown = (e: any) => {
    if (e.button !== 0) return
    if (movingCamera) return
    e.stopPropagation()
    if (!groupRef.current) return
    setActiveHandle('translate-xz')
    onManipulationStart()
    const initialMouse = new THREE.Vector3()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(e.pointer, camera)
    raycaster.ray.intersectPlane(plane, initialMouse)
    const initialPosition = groupRef.current.position.clone()
    let lastPosition: [number, number] | null = null
    const handleMove = (ev: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect()
      const mx = ((ev.clientX - rect.left) / rect.width) * 2 - 1
      const my = -((ev.clientY - rect.top) / rect.height) * 2 + 1
      const mouseVec = new THREE.Vector2(mx, my)
      raycaster.setFromCamera(mouseVec, camera)
      const intersect = new THREE.Vector3()
      raycaster.ray.intersectPlane(plane, intersect)
      const delta = intersect.clone().sub(initialMouse)
      const newPos = initialPosition.clone().add(delta)

      let finalX = newPos.x
      let finalZ = newPos.z
      if (ev.shiftKey) {
        finalX = Math.round(newPos.x / TILE_SIZE) * TILE_SIZE
        finalZ = Math.round(newPos.z / TILE_SIZE) * TILE_SIZE
      }

      lastPosition = [finalX, finalZ]
      onUpdate({ position: lastPosition }, false)
    }
    const handleUp = () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
      setActiveHandle(null)
      if (lastPosition) {
        onUpdate({ position: lastPosition }, true)
      }
      onManipulationEnd()
    }
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }

  const handleRotationDown = (e: any) => {
    if (e.button !== 0) return
    if (movingCamera) return
    e.stopPropagation()
    if (!groupRef.current) return
    setActiveHandle('rotation')
    onManipulationStart()
    const center = groupRef.current.position.clone()
    const initialMouse = new THREE.Vector3()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(e.pointer, camera)
    raycaster.ray.intersectPlane(plane, initialMouse)
    const initialVector = initialMouse.clone().sub(center)
    const initialAngle = Math.atan2(initialVector.z, initialVector.x)
    const initialRotation = rotation
    let lastRotation: number | null = null
    const handleMove = (ev: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect()
      const mx = ((ev.clientX - rect.left) / rect.width) * 2 - 1
      const my = -((ev.clientY - rect.top) / rect.height) * 2 + 1
      const mouseVec = new THREE.Vector2(mx, my)
      raycaster.setFromCamera(mouseVec, camera)
      const intersect = new THREE.Vector3()
      raycaster.ray.intersectPlane(plane, intersect)
      const vector = intersect.clone().sub(center)
      const angle = Math.atan2(vector.z, vector.x)
      const delta = angle - initialAngle
      let newRotation = initialRotation - delta * (180 / Math.PI)

      if (ev.shiftKey) {
        newRotation = Math.round(newRotation / 45) * 45
      }

      lastRotation = newRotation
      onUpdate({ rotation: lastRotation }, false)
    }
    const handleUp = () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
      setActiveHandle(null)
      if (lastRotation !== null) {
        onUpdate({ rotation: lastRotation }, true)
      }
      onManipulationEnd()
    }
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }

  const handleTranslateYDown = (e: any) => {
    if (e.button !== 0) return
    if (movingCamera) return
    e.stopPropagation()
    if (!groupRef.current) return
    setActiveHandle('translate-y')
    onManipulationStart()
    const initialMouseY = e.pointer.y
    const initialYOffset = yOffset
    let lastYOffset: number | null = null
    const handleMove = (ev: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect()
      const my = -((ev.clientY - rect.top) / rect.height) * 2 + 1
      const deltaY = my - initialMouseY
      // Scale the movement - adjust multiplier as needed for responsiveness
      let newYOffset = initialYOffset + deltaY * 2

      if (ev.shiftKey) {
        newYOffset = Math.round(newYOffset / 0.5) * 0.5
      }

      lastYOffset = newYOffset
      onUpdate({ yOffset: lastYOffset }, false)
    }
    const handleUp = () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
      setActiveHandle(null)
      if (lastYOffset !== null) {
        onUpdate({ yOffset: lastYOffset }, true)
      }
      onManipulationEnd()
    }
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }

  const handleScaleDown = (e: any) => {
    if (e.button !== 0) return
    if (movingCamera) return
    e.stopPropagation()
    if (!groupRef.current) return
    setActiveHandle('scale')
    onManipulationStart()
    const center = groupRef.current.position.clone()
    const initialMouse = new THREE.Vector3()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(e.pointer, camera)
    raycaster.ray.intersectPlane(plane, initialMouse)
    const initialDist = center.distanceTo(initialMouse)
    const initialScale = scale
    let lastScale: number | null = null
    const handleMove = (ev: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect()
      const mx = ((ev.clientX - rect.left) / rect.width) * 2 - 1
      const my = -((ev.clientY - rect.top) / rect.height) * 2 + 1
      const mouseVec = new THREE.Vector2(mx, my)
      raycaster.setFromCamera(mouseVec, camera)
      const intersect = new THREE.Vector3()
      raycaster.ray.intersectPlane(plane, intersect)
      const newDist = center.distanceTo(intersect)
      let newScale = initialScale * (newDist / initialDist)

      if (ev.shiftKey) {
        newScale = Math.round(newScale * 10) / 10
      }

      lastScale = Math.max(0.1, newScale)
      onUpdate({ scale: lastScale }, false)
    }
    const handleUp = () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
      setActiveHandle(null)
      if (lastScale !== null) {
        onUpdate({ scale: lastScale }, true)
      }
      onManipulationEnd()
    }
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }

  return (
    <group
      position={[position[0], level * FLOOR_SPACING + 0.001 + yOffset, position[1]]}
      ref={groupRef}
      rotation={[0, (rotation * Math.PI) / 180, 0]}
    >
      {/* The 3D scan model */}
      <group scale={scale}>
        <primitive
          object={scene.clone()}
          onPointerDown={(e: any) => {
            if (e.button !== 0) return
            if ((controlMode === 'guide' || controlMode === 'select') && !movingCamera) {
              e.stopPropagation()
              onSelect()
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
          <group position={[(bboxSize.x * scale) / 2, 0, (bboxSize.z * scale) / 2]}>
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
          <group position={[-(bboxSize.x * scale) / 2, 0, (bboxSize.z * scale) / 2]}>
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
          <group position={[-(bboxSize.x * scale) / 2, 0, -(bboxSize.z * scale) / 2]}>
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
          <group position={[(bboxSize.x * scale) / 2, 0, -(bboxSize.z * scale) / 2]}>
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
          <group position={[(bboxSize.x * scale) / 2, 0, 0]}>
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
          <group position={[-(bboxSize.x * scale) / 2, 0, 0]}>
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
          <group position={[0, 0, (bboxSize.z * scale) / 2]}>
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
          <group position={[0, 0, -(bboxSize.z * scale) / 2]}>
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
}
