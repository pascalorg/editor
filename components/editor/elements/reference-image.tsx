'use client'

import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { useMemo, useRef, useState } from 'react'
import type { ControlMode } from '@/hooks/use-editor'
import { useThree, useFrame } from '@react-three/fiber'

const GRID_SIZE = 30 // 30m x 30m

type ReferenceImageProps = {
  id: string
  url: string
  opacity: number
  scale: number
  position: [number, number]
  rotation: number // degrees
  isSelected: boolean
  controlMode: ControlMode
  onSelect: () => void
  onUpdate: (updates: Partial<{ position: [number, number]; rotation: number; scale: number }>) => void
}

export const ReferenceImage = ({ id, url, opacity, scale, position, rotation, isSelected, controlMode, onSelect, onUpdate }: ReferenceImageProps) => {
  const texture = useTexture(url)
  const { camera, gl } = useThree()
  const groupRef = useRef<THREE.Group>(null!)
  const [cameraScale, setCameraScale] = useState(1)
  
  // Update handle scale based on camera distance to maintain constant screen size
  useFrame(() => {
    if (groupRef.current && isSelected && controlMode === 'guide') {
      const distance = camera.position.distanceTo(groupRef.current.position)
      // Scale factor adjusted for perspective - tune the 0.08 multiplier to adjust handle size
      const newScale = distance * 0.08
      setCameraScale(newScale)
    }
  })
  
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
  
  const handleTranslateDown = (axis: 'x' | 'y') => (e: any) => {
    e.stopPropagation()
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
      onUpdate({ position: [newPos.x, newPos.z] })
    }
    const handleUp = () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
    }
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }
  const handleRotationDown = (e: any) => {
    e.stopPropagation()
    const center = groupRef.current.position.clone()
    const initialMouse = new THREE.Vector3()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(e.pointer, camera)
    raycaster.ray.intersectPlane(plane, initialMouse)
    const initialVector = initialMouse.clone().sub(center)
    const initialAngle = Math.atan2(initialVector.z, initialVector.x)
    const initialRotation = rotation
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
      const newRotation = initialRotation + delta * (180 / Math.PI)
      onUpdate({ rotation: newRotation })
    }
    const handleUp = () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
    }
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }
  const handleScaleDown = (edge: 'right' | 'left' | 'top' | 'bottom') => (e: any) => {
    e.stopPropagation()
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
      const newScale = initialScale * (newDist / initialDist)
      onUpdate({ scale: Math.max(0.1, newScale) })
    }
    const handleUp = () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
    }
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }
  
  return (
    <group ref={groupRef} position={[position[0], 0.001, position[1]]} rotation={[0, rotation * Math.PI / 180, 0]}>
      {/* Image plane - rotated to lie flat on XZ plane */}
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <mesh scale={scale} onClick={(e) => {
          if (controlMode === 'guide') {
            e.stopPropagation()
            onSelect()
          }
        }}>
          <planeGeometry args={[planeWidth, planeHeight]} />
          <meshStandardMaterial 
            map={texture}
            transparent
            opacity={opacity}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={1}
          />
        </mesh>
      </group>
      
      {/* Manipulation handles - stay upright, only rotate with Y rotation */}
      {isSelected && controlMode === 'guide' && (
        <group>
          {/* Center origin marker for reference */}
          <mesh position={[0, 0, 0]} renderOrder={1000} scale={cameraScale}>
            <sphereGeometry args={[0.08, 16, 16]} />
            <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.5} depthTest={false} />
          </mesh>
          
          {/* Translate X (world X) - Red arrow pointing along X axis */}
          <group position={[(planeWidth * scale) / 2 + 0.5, 0, 0]}>
            {/* Invisible larger hit target */}
            <mesh rotation={[0, 0, Math.PI / 2]} onPointerDown={handleTranslateDown('x')} renderOrder={1000} scale={cameraScale}>
              <cylinderGeometry args={[0.15, 0.15, 2.5, 8]} />
              <meshStandardMaterial transparent opacity={0} depthTest={false} />
            </mesh>
            {/* Visible arrow shaft */}
            <mesh rotation={[0, 0, Math.PI / 2]} renderOrder={1000} scale={cameraScale}>
              <cylinderGeometry args={[0.06, 0.06, 2, 16]} />
              <meshStandardMaterial color="#ff4444" emissive="#ff4444" emissiveIntensity={0.3} depthTest={false} />
            </mesh>
            {/* Arrow head */}
            <mesh position={[1.15, 0, 0]} rotation={[0, 0, Math.PI / 2]} renderOrder={1000} scale={cameraScale}>
              <coneGeometry args={[0.12, 0.3, 16]} />
              <meshStandardMaterial color="#ff4444" emissive="#ff4444" emissiveIntensity={0.3} depthTest={false} />
            </mesh>
          </group>
          
          {/* Translate Z (world Z) - Green arrow pointing along Z axis */}
          <group position={[0, 0, (planeHeight * scale) / 2 + 0.5]}>
            {/* Invisible larger hit target */}
            <mesh rotation={[Math.PI / 2, 0, 0]} onPointerDown={handleTranslateDown('y')} renderOrder={1000} scale={cameraScale}>
              <cylinderGeometry args={[0.15, 0.15, 2.5, 8]} />
              <meshStandardMaterial transparent opacity={0} depthTest={false} />
            </mesh>
            {/* Visible arrow shaft */}
            <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={1000} scale={cameraScale}>
              <cylinderGeometry args={[0.06, 0.06, 2, 16]} />
              <meshStandardMaterial color="#44ff44" emissive="#44ff44" emissiveIntensity={0.3} depthTest={false} />
            </mesh>
            {/* Arrow head */}
            <mesh position={[0, 0, 1.15]} rotation={[Math.PI / 2, 0, 0]} renderOrder={1000} scale={cameraScale}>
              <coneGeometry args={[0.12, 0.3, 16]} />
              <meshStandardMaterial color="#44ff44" emissive="#44ff44" emissiveIntensity={0.3} depthTest={false} />
            </mesh>
          </group>
          
          {/* Rotation handles at corners - Blue curved arrows around Y axis */}
          <group position={[(planeWidth * scale) / 2, 0, (planeHeight * scale) / 2]}>
            <mesh rotation={[Math.PI / 2, 0, 0]} onPointerDown={handleRotationDown} renderOrder={1000} scale={cameraScale}>
              <torusGeometry args={[0.4, 0.12, 16, 32, Math.PI / 2]} />
              <meshStandardMaterial transparent opacity={0} depthTest={false} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={1000} scale={cameraScale}>
              <torusGeometry args={[0.4, 0.06, 16, 32, Math.PI / 2]} />
              <meshStandardMaterial color="#4444ff" emissive="#4444ff" emissiveIntensity={0.3} depthTest={false} />
            </mesh>
          </group>
          <group position={[-(planeWidth * scale) / 2, 0, (planeHeight * scale) / 2]}>
            <mesh rotation={[Math.PI / 2, 0, Math.PI / 2]} onPointerDown={handleRotationDown} renderOrder={1000} scale={cameraScale}>
              <torusGeometry args={[0.4, 0.12, 16, 32, Math.PI / 2]} />
              <meshStandardMaterial transparent opacity={0} depthTest={false} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, Math.PI / 2]} renderOrder={1000} scale={cameraScale}>
              <torusGeometry args={[0.4, 0.06, 16, 32, Math.PI / 2]} />
              <meshStandardMaterial color="#4444ff" emissive="#4444ff" emissiveIntensity={0.3} depthTest={false} />
            </mesh>
          </group>
          <group position={[-(planeWidth * scale) / 2, 0, -(planeHeight * scale) / 2]}>
            <mesh rotation={[Math.PI / 2, 0, Math.PI]} onPointerDown={handleRotationDown} renderOrder={1000} scale={cameraScale}>
              <torusGeometry args={[0.4, 0.12, 16, 32, Math.PI / 2]} />
              <meshStandardMaterial transparent opacity={0} depthTest={false} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, Math.PI]} renderOrder={1000} scale={cameraScale}>
              <torusGeometry args={[0.4, 0.06, 16, 32, Math.PI / 2]} />
              <meshStandardMaterial color="#4444ff" emissive="#4444ff" emissiveIntensity={0.3} depthTest={false} />
            </mesh>
          </group>
          <group position={[(planeWidth * scale) / 2, 0, -(planeHeight * scale) / 2]}>
            <mesh rotation={[Math.PI / 2, 0, -Math.PI / 2]} onPointerDown={handleRotationDown} renderOrder={1000} scale={cameraScale}>
              <torusGeometry args={[0.4, 0.12, 16, 32, Math.PI / 2]} />
              <meshStandardMaterial transparent opacity={0} depthTest={false} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, -Math.PI / 2]} renderOrder={1000} scale={cameraScale}>
              <torusGeometry args={[0.4, 0.06, 16, 32, Math.PI / 2]} />
              <meshStandardMaterial color="#4444ff" emissive="#4444ff" emissiveIntensity={0.3} depthTest={false} />
            </mesh>
          </group>
          
          {/* Scale handles at edge midpoints - Yellow spheres */}
          <group position={[(planeWidth * scale) / 2, 0, 0]}>
            <mesh onPointerDown={handleScaleDown('right')} renderOrder={1000} scale={cameraScale}>
              <sphereGeometry args={[0.18, 16, 16]} />
              <meshStandardMaterial transparent opacity={0} depthTest={false} />
            </mesh>
            <mesh renderOrder={1000} scale={cameraScale}>
              <sphereGeometry args={[0.12, 16, 16]} />
              <meshStandardMaterial color="#ffff44" emissive="#ffff44" emissiveIntensity={0.3} depthTest={false} />
            </mesh>
          </group>
          <group position={[-(planeWidth * scale) / 2, 0, 0]}>
            <mesh onPointerDown={handleScaleDown('left')} renderOrder={1000} scale={cameraScale}>
              <sphereGeometry args={[0.18, 16, 16]} />
              <meshStandardMaterial transparent opacity={0} depthTest={false} />
            </mesh>
            <mesh renderOrder={1000} scale={cameraScale}>
              <sphereGeometry args={[0.12, 16, 16]} />
              <meshStandardMaterial color="#ffff44" emissive="#ffff44" emissiveIntensity={0.3} depthTest={false} />
            </mesh>
          </group>
          <group position={[0, 0, (planeHeight * scale) / 2]}>
            <mesh onPointerDown={handleScaleDown('top')} renderOrder={1000} scale={cameraScale}>
              <sphereGeometry args={[0.18, 16, 16]} />
              <meshStandardMaterial transparent opacity={0} depthTest={false} />
            </mesh>
            <mesh renderOrder={1000} scale={cameraScale}>
              <sphereGeometry args={[0.12, 16, 16]} />
              <meshStandardMaterial color="#ffff44" emissive="#ffff44" emissiveIntensity={0.3} depthTest={false} />
            </mesh>
          </group>
          <group position={[0, 0, -(planeHeight * scale) / 2]}>
            <mesh onPointerDown={handleScaleDown('bottom')} renderOrder={1000} scale={cameraScale}>
              <sphereGeometry args={[0.18, 16, 16]} />
              <meshStandardMaterial transparent opacity={0} depthTest={false} />
            </mesh>
            <mesh renderOrder={1000} scale={cameraScale}>
              <sphereGeometry args={[0.12, 16, 16]} />
              <meshStandardMaterial color="#ffff44" emissive="#ffff44" emissiveIntensity={0.3} depthTest={false} />
            </mesh>
          </group>
        </group>
      )}
    </group>
  )
}

