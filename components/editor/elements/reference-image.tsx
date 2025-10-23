'use client'

import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { useMemo, useRef, useState } from 'react'
import type { ControlMode } from '@/hooks/use-editor'
import { useThree } from '@react-three/fiber'

const GRID_SIZE = 30 // 30m x 30m
const TILE_SIZE = 0.5 // Grid spacing in meters (matches editor grid)

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
const ORIGIN_HIT_SCALE = 2.5        // 0.4 / 0.16 = 2.5x
const ARROW_HIT_RADIUS_SCALE = 2.5  // 0.15 / 0.06 = 2.5x
const ARROW_HIT_LENGTH_SCALE = 1.1 // 2.5 / 2 = 1.25x
const ROTATION_HIT_SCALE = 2        // 0.12 / 0.06 = 2x
const SCALE_HIT_SCALE = 1.5         // 0.18 / 0.12 = 1.5x (radius), 0.4 / 0.3 = 1.33x (length, use 1.5 for consistency)

type ReferenceImageProps = {
  id: string
  url: string
  opacity: number
  scale: number
  position: [number, number]
  rotation: number // degrees
  isSelected: boolean
  controlMode: ControlMode
  movingCamera: boolean
  onSelect: () => void
  onUpdate: (updates: Partial<{ position: [number, number]; rotation: number; scale: number }>, pushToUndo?: boolean) => void
  onManipulationStart: () => void
  onManipulationEnd: () => void
}

export const ReferenceImage = ({ id, url, opacity, scale, position, rotation, isSelected, controlMode, movingCamera, onSelect, onUpdate, onManipulationStart, onManipulationEnd }: ReferenceImageProps) => {
  const hitAreaOpacity = DEBUG ? 0.5 as const : 0
  const texture = useTexture(url)
  const { camera, gl } = useThree()
  const groupRef = useRef<THREE.Group>(null!)
  
  // Track hover and active states for handles
  const [hoveredHandle, setHoveredHandle] = useState<string | null>(null)
  const [activeHandle, setActiveHandle] = useState<string | null>(null)
  
  // Track hover state for the image itself
  const [isHovered, setIsHovered] = useState(false)
  
  // Visual states for handles
  const getHandleOpacity = (handleId: string) => {
    if (activeHandle === handleId || hoveredHandle === handleId) return 1
    return 0.6
  }
  
  const getHandleEmissiveIntensity = (handleId: string) => {
    if (activeHandle === handleId || hoveredHandle === handleId) return 0.5
    return 0.05 // No emissive when inactive - prevents glow from overpowering opacity
  }
  
  // Calculate aspect-ratio-preserving dimensions
  const [planeWidth, planeHeight] = useMemo(() => {
    if (!texture.image) return [GRID_SIZE, GRID_SIZE]
    
    const imageWidth = texture.image.width
    const imageHeight = texture.image.height
    const aspectRatio = imageWidth / imageHeight
    
    // Fit within GRID_SIZE while preserving aspect ratio
    if (aspectRatio > 1) {
      // Wider than tall - width constrained to GRID_SIZE
      return [GRID_SIZE, GRID_SIZE / aspectRatio]
    } else {
      // Taller than wide - height constrained to GRID_SIZE
      return [GRID_SIZE * aspectRatio, GRID_SIZE]
    }
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
  
  const handleTranslateDown = (axis: 'x' | 'y') => (e: any) => {
    // Only respond to left-click (button 0), ignore right-click (button 2) for camera
    if (e.button !== 0) return;
    if (movingCamera) return;
    e.stopPropagation()
    const handleId = axis === 'x' ? 'translate-x' : 'translate-z'
    setActiveHandle(handleId)
    onManipulationStart() // Start tracking manipulation
    const initialMouse = new THREE.Vector3()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(e.pointer, camera)
    raycaster.ray.intersectPlane(plane, initialMouse)
    const initialPosition = groupRef.current.position.clone()
    // Now handles are in outer group space: x axis = world X, y axis = world Z
    const localDir = axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1)
    const worldZero = new THREE.Vector3().applyMatrix4(groupRef.current.matrixWorld)
    const worldAxis = localDir.clone().applyMatrix4(groupRef.current.matrixWorld).sub(worldZero).normalize()
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
      
      // Snap to grid when Shift is held
      let finalX = newPos.x
      let finalZ = newPos.z
      if (ev.shiftKey) {
        finalX = Math.round(newPos.x / TILE_SIZE) * TILE_SIZE
        finalZ = Math.round(newPos.z / TILE_SIZE) * TILE_SIZE
      }
      
      lastPosition = [finalX, finalZ]
      onUpdate({ position: lastPosition }, false) // Don't push to undo during drag
    }
    const handleUp = () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
      setActiveHandle(null)
      // Commit final state to undo stack
      if (lastPosition) {
        onUpdate({ position: lastPosition }, true)
      }
      onManipulationEnd()
    }
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }
  
  const handleTranslateXZDown = (e: any) => {
    // Only respond to left-click (button 0), ignore right-click (button 2) for camera
    if (e.button !== 0) return;
    if (movingCamera) return;
    e.stopPropagation()
    setActiveHandle('translate-xz')
    onManipulationStart() // Start tracking manipulation
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
      
      // Snap to grid when Shift is held
      let finalX = newPos.x
      let finalZ = newPos.z
      if (ev.shiftKey) {
        finalX = Math.round(newPos.x / TILE_SIZE) * TILE_SIZE
        finalZ = Math.round(newPos.z / TILE_SIZE) * TILE_SIZE
      }
      
      lastPosition = [finalX, finalZ]
      onUpdate({ position: lastPosition }, false) // Don't push to undo during drag
    }
    const handleUp = () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
      setActiveHandle(null)
      // Commit final state to undo stack
      if (lastPosition) {
        onUpdate({ position: lastPosition }, true)
      }
      onManipulationEnd()
    }
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }
  const handleRotationDown = (e: any) => {
    // Only respond to left-click (button 0), ignore right-click (button 2) for camera
    if (e.button !== 0) return;
    if (movingCamera) return;
    e.stopPropagation()
    setActiveHandle('rotation')
    onManipulationStart() // Start tracking manipulation
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
      
      // Snap to 45-degree increments when Shift is held
      if (ev.shiftKey) {
        newRotation = Math.round(newRotation / 45) * 45
      }
      
      lastRotation = newRotation
      onUpdate({ rotation: lastRotation }, false) // Don't push to undo during drag
    }
    const handleUp = () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
      setActiveHandle(null)
      // Commit final state to undo stack
      if (lastRotation !== null) {
        onUpdate({ rotation: lastRotation }, true)
      }
      onManipulationEnd()
    }
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }
  const handleScaleDown = (edge: 'right' | 'left' | 'top' | 'bottom') => (e: any) => {
    // Only respond to left-click (button 0), ignore right-click (button 2) for camera
    if (e.button !== 0) return;
    if (movingCamera) return;
    e.stopPropagation()
    setActiveHandle('scale')
    onManipulationStart() // Start tracking manipulation
    const center = groupRef.current.position.clone()
    const initialMouse = new THREE.Vector3()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(e.pointer, camera)
    raycaster.ray.intersectPlane(plane, initialMouse)
    const initialDist = center.distanceTo(initialMouse)
    const initialScale = scale
    const getLocalDir = () => {
      switch (edge) {
        case 'right': return new THREE.Vector3(1, 0, 0)
        case 'left': return new THREE.Vector3(-1, 0, 0)
        case 'top': return new THREE.Vector3(0, 0, 1) // World Z (was Y)
        case 'bottom': return new THREE.Vector3(0, 0, -1) // World -Z (was -Y)
      }
    }
    const localDir = getLocalDir()
    const worldZero = new THREE.Vector3().applyMatrix4(groupRef.current.matrixWorld)
    const worldDir = localDir.clone().applyMatrix4(groupRef.current.matrixWorld).sub(worldZero).normalize()
    let lastScale: number | null = null
    const handleMove = (ev: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect()
      const mx = ((ev.clientX - rect.left) / rect.width) * 2 - 1
      const my = -((ev.clientY - rect.top) / rect.height) * 2 + 1
      const mouseVec = new THREE.Vector2(mx, my)
      raycaster.setFromCamera(mouseVec, camera)
      const intersect = new THREE.Vector3()
      raycaster.ray.intersectPlane(plane, intersect)
      const delta = intersect.clone().sub(initialMouse)
      const projected = delta.dot(worldDir)
      const projectedPoint = initialMouse.clone().add(worldDir.clone().multiplyScalar(projected))
      const newDist = center.distanceTo(projectedPoint)
      let newScale = initialScale * (newDist / initialDist)
      
      // Snap to 0.1 increments when Shift is held
      if (ev.shiftKey) {
        newScale = Math.round(newScale * 10) / 10
      }
      
      lastScale = Math.max(0.1, newScale)
      onUpdate({ scale: lastScale }, false) // Don't push to undo during drag
    }
    const handleUp = () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
      setActiveHandle(null)
      // Commit final state to undo stack
      if (lastScale !== null) {
        onUpdate({ scale: lastScale }, true)
      }
      onManipulationEnd()
    }
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }

  
  
  return (
    <group ref={groupRef} position={[position[0], 0.001, position[1]]} rotation={[0, rotation * Math.PI / 180, 0]}>
      {/* Image plane - rotated to lie flat on XZ plane */}
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <mesh 
          scale={scale} 
          onPointerDown={(e) => {
            // Only respond to left-click, ignore right-click for camera
            if (e.button !== 0) return;
            if (controlMode === 'guide' && !movingCamera) {
              e.stopPropagation()
              onSelect()
            }
          }}
          onPointerEnter={(e) => {
            if (controlMode === 'guide' && !movingCamera) {
              setIsHovered(true)
            }
          }}
          onPointerLeave={() => {
            setIsHovered(false)
          }}
        >
          <planeGeometry args={[planeWidth, planeHeight]} />
          <meshStandardMaterial 
            map={texture}
            transparent
            opacity={opacity}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={1}
            emissive={controlMode === 'guide' && (isHovered || isSelected) ? "#ffffff" : "#000000"}
            emissiveIntensity={controlMode === 'guide' && (isHovered || isSelected) ? 0.2 : 0}
          />
        </mesh>
      </group>
      
      {/* Manipulation handles - stay upright, only rotate with Y rotation */}
      {isSelected && controlMode === 'guide' && (
        <group>
          {/* Center origin marker for reference with XZ plane translation hit box */}
          <group position={[0, 0, 0]}>
            {/* Invisible larger hit target for XZ translation */}
            <mesh 
              position={[0, 0, 0]} 
              onPointerDown={handleTranslateXZDown}
              onPointerEnter={() => setHoveredHandle('translate-xz')}
              onPointerLeave={() => setHoveredHandle(null)}
              renderOrder={1000} 
              scale={HANDLE_SCALE}
            >
              <boxGeometry args={[originHitSize, originHitSize, originHitSize]} />
              <meshStandardMaterial transparent opacity={hitAreaOpacity} depthTest={false} />
            </mesh>
            {/* Visible origin marker */}
            <mesh position={[0, 0, 0]} renderOrder={1000} scale={HANDLE_SCALE}>
              <boxGeometry args={[ORIGIN_MARKER_SIZE, ORIGIN_MARKER_SIZE, ORIGIN_MARKER_SIZE]} />
              <meshStandardMaterial 
                color="white" 
                emissive="white" 
                emissiveIntensity={getHandleEmissiveIntensity('translate-xz')}
                transparent
                opacity={getHandleOpacity('translate-xz')}
                depthTest={false} 
              />
            </mesh>
          </group>
          
          {/* Translate X (world X) - Red arrow pointing along X axis */}
          <group position={[0, 0, 0]}>
            {/* Invisible larger hit target - anchored to hit box edge */}
            <mesh 
              position={[arrowHitPos, 0, 0]} 
              rotation={[0, 0, Math.PI / 2]} 
              onPointerDown={handleTranslateDown('x')}
              onPointerEnter={() => setHoveredHandle('translate-x')}
              onPointerLeave={() => setHoveredHandle(null)}
              renderOrder={1000} 
              scale={HANDLE_SCALE}
            >
              <cylinderGeometry args={[arrowHitRadius, arrowHitRadius, arrowHitLength, 8]} />
              <meshStandardMaterial transparent opacity={hitAreaOpacity} depthTest={false} />
            </mesh>
            {/* Visible arrow shaft - anchored to visible marker edge */}
            <mesh position={[arrowShaftPos, 0, 0]} rotation={[0, 0, Math.PI / 2]} renderOrder={1000} scale={HANDLE_SCALE}>
              <cylinderGeometry args={[ARROW_SHAFT_RADIUS, ARROW_SHAFT_RADIUS, ARROW_SHAFT_LENGTH, 16]} />
              <meshStandardMaterial 
                color="#ff4444" 
                emissive="#ff4444" 
                emissiveIntensity={getHandleEmissiveIntensity('translate-x')}
                transparent
                opacity={getHandleOpacity('translate-x')}
                depthTest={false} 
              />
            </mesh>
            {/* Arrow head */}
            <mesh position={[arrowHeadPos, 0, 0]} rotation={[0, 0, -Math.PI / 2]} renderOrder={1000} scale={HANDLE_SCALE}>
              <coneGeometry args={[ARROW_HEAD_RADIUS, ARROW_HEAD_LENGTH, 16]} />
              <meshStandardMaterial 
                color="#ff4444" 
                emissive="#ff4444" 
                emissiveIntensity={getHandleEmissiveIntensity('translate-x')}
                transparent
                opacity={getHandleOpacity('translate-x')}
                depthTest={false} 
              />
            </mesh>
          </group>
          
          {/* Translate Z (world Z) - Green arrow pointing along Z axis */}
          <group position={[0, 0, 0]}>
            {/* Invisible larger hit target - anchored to hit box edge */}
            <mesh 
              position={[0, 0, arrowHitPos]} 
              rotation={[Math.PI / 2, 0, 0]} 
              onPointerDown={handleTranslateDown('y')}
              onPointerEnter={() => setHoveredHandle('translate-z')}
              onPointerLeave={() => setHoveredHandle(null)}
              renderOrder={1000} 
              scale={HANDLE_SCALE}
            >
              <cylinderGeometry args={[arrowHitRadius, arrowHitRadius, arrowHitLength, 8]} />
              <meshStandardMaterial transparent opacity={hitAreaOpacity} depthTest={false} />
            </mesh>
            {/* Visible arrow shaft - anchored to visible marker edge */}
            <mesh position={[0, 0, arrowShaftPos]} rotation={[Math.PI / 2, 0, 0]} renderOrder={1000} scale={HANDLE_SCALE}>
              <cylinderGeometry args={[ARROW_SHAFT_RADIUS, ARROW_SHAFT_RADIUS, ARROW_SHAFT_LENGTH, 16]} />
              <meshStandardMaterial 
                color="#44ff44" 
                emissive="#44ff44" 
                emissiveIntensity={getHandleEmissiveIntensity('translate-z')}
                transparent
                opacity={getHandleOpacity('translate-z')}
                depthTest={false} 
              />
            </mesh>
            {/* Arrow head */}
            <mesh position={[0, 0, arrowHeadPos]} rotation={[Math.PI / 2, 0, 0]} renderOrder={1000} scale={HANDLE_SCALE}>
              <coneGeometry args={[ARROW_HEAD_RADIUS, ARROW_HEAD_LENGTH, 16]} />
              <meshStandardMaterial 
                color="#44ff44" 
                emissive="#44ff44" 
                emissiveIntensity={getHandleEmissiveIntensity('translate-z')}
                transparent
                opacity={getHandleOpacity('translate-z')}
                depthTest={false} 
              />
            </mesh>
          </group>
          
          {/* Rotation handles at corners - Blue curved arrows around Y axis */}
          <group position={[(planeWidth * scale) / 2, 0, (planeHeight * scale) / 2]}>
            <mesh 
              rotation={[Math.PI / 2, 0, 0]} 
              onPointerDown={handleRotationDown}
              onPointerEnter={() => setHoveredHandle('rotation')}
              onPointerLeave={() => setHoveredHandle(null)}
              renderOrder={1000} 
              scale={HANDLE_SCALE}
            >
              <torusGeometry args={[ROTATION_HANDLE_RADIUS, rotationHitThickness, 16, 32, Math.PI / 2]} />
              <meshStandardMaterial transparent opacity={hitAreaOpacity} depthTest={false} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={1000} scale={HANDLE_SCALE}>
              <torusGeometry args={[ROTATION_HANDLE_RADIUS, ROTATION_HANDLE_THICKNESS, 16, 32, Math.PI / 2]} />
              <meshStandardMaterial 
                color="#4444ff" 
                emissive="#4444ff" 
                emissiveIntensity={getHandleEmissiveIntensity('rotation')}
                transparent
                opacity={getHandleOpacity('rotation')}
                depthTest={false} 
              />
            </mesh>
          </group>
          <group position={[-(planeWidth * scale) / 2, 0, (planeHeight * scale) / 2]}>
            <mesh 
              rotation={[Math.PI / 2, 0, Math.PI / 2]} 
              onPointerDown={handleRotationDown}
              onPointerEnter={() => setHoveredHandle('rotation')}
              onPointerLeave={() => setHoveredHandle(null)}
              renderOrder={1000} 
              scale={HANDLE_SCALE}
            >
              <torusGeometry args={[ROTATION_HANDLE_RADIUS, rotationHitThickness, 16, 32, Math.PI / 2]} />
              <meshStandardMaterial transparent opacity={hitAreaOpacity} depthTest={false} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, Math.PI / 2]} renderOrder={1000} scale={HANDLE_SCALE}>
              <torusGeometry args={[ROTATION_HANDLE_RADIUS, ROTATION_HANDLE_THICKNESS, 16, 32, Math.PI / 2]} />
              <meshStandardMaterial 
                color="#4444ff" 
                emissive="#4444ff" 
                emissiveIntensity={getHandleEmissiveIntensity('rotation')}
                transparent
                opacity={getHandleOpacity('rotation')}
                depthTest={false} 
              />
            </mesh>
          </group>
          <group position={[-(planeWidth * scale) / 2, 0, -(planeHeight * scale) / 2]}>
            <mesh 
              rotation={[Math.PI / 2, 0, Math.PI]} 
              onPointerDown={handleRotationDown}
              onPointerEnter={() => setHoveredHandle('rotation')}
              onPointerLeave={() => setHoveredHandle(null)}
              renderOrder={1000} 
              scale={HANDLE_SCALE}
            >
              <torusGeometry args={[ROTATION_HANDLE_RADIUS, rotationHitThickness, 16, 32, Math.PI / 2]} />
              <meshStandardMaterial transparent opacity={hitAreaOpacity} depthTest={false} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, Math.PI]} renderOrder={1000} scale={HANDLE_SCALE}>
              <torusGeometry args={[ROTATION_HANDLE_RADIUS, ROTATION_HANDLE_THICKNESS, 16, 32, Math.PI / 2]} />
              <meshStandardMaterial 
                color="#4444ff" 
                emissive="#4444ff" 
                emissiveIntensity={getHandleEmissiveIntensity('rotation')}
                transparent
                opacity={getHandleOpacity('rotation')}
                depthTest={false} 
              />
            </mesh>
          </group>
          <group position={[(planeWidth * scale) / 2, 0, -(planeHeight * scale) / 2]}>
            <mesh 
              rotation={[Math.PI / 2, 0, -Math.PI / 2]} 
              onPointerDown={handleRotationDown}
              onPointerEnter={() => setHoveredHandle('rotation')}
              onPointerLeave={() => setHoveredHandle(null)}
              renderOrder={1000} 
              scale={HANDLE_SCALE}
            >
              <torusGeometry args={[ROTATION_HANDLE_RADIUS, rotationHitThickness, 16, 32, Math.PI / 2]} />
              <meshStandardMaterial transparent opacity={hitAreaOpacity} depthTest={false} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, -Math.PI / 2]} renderOrder={1000} scale={HANDLE_SCALE}>
              <torusGeometry args={[ROTATION_HANDLE_RADIUS, ROTATION_HANDLE_THICKNESS, 16, 32, Math.PI / 2]} />
              <meshStandardMaterial 
                color="#4444ff" 
                emissive="#4444ff" 
                emissiveIntensity={getHandleEmissiveIntensity('rotation')}
                transparent
                opacity={getHandleOpacity('rotation')}
                depthTest={false} 
              />
            </mesh>
          </group>
          
          {/* Scale handles at edge midpoints - Yellow cones pointing outward */}
          <group position={[(planeWidth * scale) / 2, 0, 0]}>
            <mesh 
              rotation={[0, 0, -Math.PI / 2]} 
              onPointerDown={handleScaleDown('right')}
              onPointerEnter={() => setHoveredHandle('scale')}
              onPointerLeave={() => setHoveredHandle(null)}
              renderOrder={1000} 
              scale={HANDLE_SCALE}
            >
              <coneGeometry args={[scaleHitRadius, scaleHitLength, 16]} />
              <meshStandardMaterial transparent opacity={hitAreaOpacity} depthTest={false} />
            </mesh>
            <mesh rotation={[0, 0, -Math.PI / 2]} renderOrder={1000} scale={HANDLE_SCALE}>
              <coneGeometry args={[SCALE_HANDLE_RADIUS, SCALE_HANDLE_LENGTH, 16]} />
              <meshStandardMaterial 
                color="#ffff44" 
                emissive="#ffff44" 
                emissiveIntensity={getHandleEmissiveIntensity('scale')}
                transparent
                opacity={getHandleOpacity('scale')}
                depthTest={false} 
              />
            </mesh>
          </group>
          <group position={[-(planeWidth * scale) / 2, 0, 0]}>
            <mesh 
              rotation={[0, 0, Math.PI / 2]} 
              onPointerDown={handleScaleDown('left')}
              onPointerEnter={() => setHoveredHandle('scale')}
              onPointerLeave={() => setHoveredHandle(null)}
              renderOrder={1000} 
              scale={HANDLE_SCALE}
            >
              <coneGeometry args={[scaleHitRadius, scaleHitLength, 16]} />
              <meshStandardMaterial transparent opacity={hitAreaOpacity} depthTest={false} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 2]} renderOrder={1000} scale={HANDLE_SCALE}>
              <coneGeometry args={[SCALE_HANDLE_RADIUS, SCALE_HANDLE_LENGTH, 16]} />
              <meshStandardMaterial 
                color="#ffff44" 
                emissive="#ffff44" 
                emissiveIntensity={getHandleEmissiveIntensity('scale')}
                transparent
                opacity={getHandleOpacity('scale')}
                depthTest={false} 
              />
            </mesh>
          </group>
          <group position={[0, 0, (planeHeight * scale) / 2]}>
            <mesh 
              rotation={[Math.PI / 2, 0, 0]} 
              onPointerDown={handleScaleDown('top')}
              onPointerEnter={() => setHoveredHandle('scale')}
              onPointerLeave={() => setHoveredHandle(null)}
              renderOrder={1000} 
              scale={HANDLE_SCALE}
            >
              <coneGeometry args={[scaleHitRadius, scaleHitLength, 16]} />
              <meshStandardMaterial transparent opacity={hitAreaOpacity} depthTest={false} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={1000} scale={HANDLE_SCALE}>
              <coneGeometry args={[SCALE_HANDLE_RADIUS, SCALE_HANDLE_LENGTH, 16]} />
              <meshStandardMaterial 
                color="#ffff44" 
                emissive="#ffff44" 
                emissiveIntensity={getHandleEmissiveIntensity('scale')}
                transparent
                opacity={getHandleOpacity('scale')}
                depthTest={false} 
              />
            </mesh>
          </group>
          <group position={[0, 0, -(planeHeight * scale) / 2]}>
            <mesh 
              rotation={[-Math.PI / 2, 0, 0]} 
              onPointerDown={handleScaleDown('bottom')}
              onPointerEnter={() => setHoveredHandle('scale')}
              onPointerLeave={() => setHoveredHandle(null)}
              renderOrder={1000} 
              scale={HANDLE_SCALE}
            >
              <coneGeometry args={[scaleHitRadius, scaleHitLength, 16]} />
              <meshStandardMaterial transparent opacity={hitAreaOpacity} depthTest={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={1000} scale={HANDLE_SCALE}>
              <coneGeometry args={[SCALE_HANDLE_RADIUS, SCALE_HANDLE_LENGTH, 16]} />
              <meshStandardMaterial 
                color="#ffff44" 
                emissive="#ffff44" 
                emissiveIntensity={getHandleEmissiveIntensity('scale')}
                transparent
                opacity={getHandleOpacity('scale')}
                depthTest={false} 
              />
            </mesh>
          </group>
        </group>
      )}
    </group>
  )
}

