'use client'

import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { useMemo, useRef } from 'react'
import type { ControlMode } from '@/hooks/use-editor'
import { useThree } from '@react-three/fiber'

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
    const localDir = axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
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
        case 'top': return new THREE.Vector3(0, 1, 0)
        case 'bottom': return new THREE.Vector3(0, -1, 0)
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
    <group ref={groupRef} position={[position[0], 0.001, position[1]]} rotation={[-Math.PI / 2, rotation * Math.PI / 180, 0]}>
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
      {isSelected && controlMode === 'guide' && (
        <group scale={1 / scale}>
          {/* Translate X */}
          <group onPointerDown={handleTranslateDown('x')}>
            <mesh position={[1, 0, 0.01]} rotation={[0, Math.PI / 2, 0]}>
              <cylinderGeometry args={[0.05, 0.05, 2, 32]} />
              <meshStandardMaterial color="white" />
            </mesh>
            <mesh position={[2, 0, 0.01]} rotation={[0, Math.PI / 2, 0]}>
              <coneGeometry args={[0.1, 0.3, 32]} />
              <meshStandardMaterial color="white" />
            </mesh>
          </group>
          {/* Translate Y */}
          <group onPointerDown={handleTranslateDown('y')}>
            <mesh position={[0, 1, 0.01]} rotation={[0, 0, 0]}>
              <cylinderGeometry args={[0.05, 0.05, 2, 32]} />
              <meshStandardMaterial color="white" />
            </mesh>
            <mesh position={[0, 2, 0.01]} rotation={[0, 0, 0]}>
              <coneGeometry args={[0.1, 0.3, 32]} />
              <meshStandardMaterial color="white" />
            </mesh>
          </group>
          {/* Rotation handles */}
          <mesh position={[planeWidth / 2, planeHeight / 2, 0.01]} rotation={[0, 0, Math.PI / 2]} onPointerDown={handleRotationDown}>
            <torusGeometry args={[0.5, 0.05, 16, 100, Math.PI / 2]} />
            <meshStandardMaterial color="white" />
          </mesh>
          <mesh position={[-planeWidth / 2, planeHeight / 2, 0.01]} rotation={[0, 0, 0]} onPointerDown={handleRotationDown}>
            <torusGeometry args={[0.5, 0.05, 16, 100, Math.PI / 2]} />
            <meshStandardMaterial color="white" />
          </mesh>
          <mesh position={[-planeWidth / 2, -planeHeight / 2, 0.01]} rotation={[0, 0, -Math.PI / 2]} onPointerDown={handleRotationDown}>
            <torusGeometry args={[0.5, 0.05, 16, 100, Math.PI / 2]} />
            <meshStandardMaterial color="white" />
          </mesh>
          <mesh position={[planeWidth / 2, -planeHeight / 2, 0.01]} rotation={[0, 0, Math.PI]} onPointerDown={handleRotationDown}>
            <torusGeometry args={[0.5, 0.05, 16, 100, Math.PI / 2]} />
            <meshStandardMaterial color="white" />
          </mesh>
          {/* Scale handles */}
          <mesh position={[planeWidth / 2, 0, 0.01]} onPointerDown={handleScaleDown('right')}>
            <cylinderGeometry args={[0.1, 0.1, 0.2, 32]} />
            <meshStandardMaterial color="white" />
          </mesh>
          <mesh position={[-planeWidth / 2, 0, 0.01]} onPointerDown={handleScaleDown('left')}>
            <cylinderGeometry args={[0.1, 0.1, 0.2, 32]} />
            <meshStandardMaterial color="white" />
          </mesh>
          <mesh position={[0, planeHeight / 2, 0.01]} onPointerDown={handleScaleDown('top')}>
            <cylinderGeometry args={[0.1, 0.1, 0.2, 32]} />
            <meshStandardMaterial color="white" />
          </mesh>
          <mesh position={[0, -planeHeight / 2, 0.01]} onPointerDown={handleScaleDown('bottom')}>
            <cylinderGeometry args={[0.1, 0.1, 0.2, 32]} />
            <meshStandardMaterial color="white" />
          </mesh>
        </group>
      )}
    </group>
  )
}

