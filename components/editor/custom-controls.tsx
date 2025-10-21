'use client'

import { useRef, useEffect } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

type CustomControlsProps = {
  tileSize: number
  controlMode: string
}

export function CustomControls({ tileSize, controlMode }: CustomControlsProps) {
  const { camera, gl } = useThree()
  const dragging = useRef(false)
  const dragType = useRef<'pan' | 'rotate' | null>(null)
  const startMouse = useRef(new THREE.Vector2())
  const initialPosition = useRef(new THREE.Vector3())
  const initialTarget = useRef(new THREE.Vector3())
  const currentTarget = useRef(new THREE.Vector3(0, 0, 0))
  const grabbedPoint = useRef(new THREE.Vector3())
  const rotationTarget = useRef(new THREE.Vector3())
  const raycaster = useRef(new THREE.Raycaster())
  const floorPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0))
  
  // Damping state for smooth camera movement
  const targetPosition = useRef(new THREE.Vector3())
  const currentVelocity = useRef(new THREE.Vector3())
  
  // Performance optimization for pointer events
  const pendingPointerMove = useRef<PointerEvent | null>(null)
  const rafId = useRef<number | null>(null)

  useEffect(() => {
    const h = 30 * tileSize
    camera.position.set(h, 0, h)
    targetPosition.current.copy(camera.position)
    currentTarget.current.set(0, 0, 0)
    camera.lookAt(currentTarget.current)
  }, [tileSize, camera])

  useEffect(() => {
    const domElement = gl.domElement

    const handlePointerDown = (event: PointerEvent) => {
      const mouse = new THREE.Vector2(
        (event.clientX / domElement.clientWidth) * 2 - 1,
        -(event.clientY / domElement.clientHeight) * 2 + 1
      )
      raycaster.current.setFromCamera(mouse, camera)
      const hitPoint = new THREE.Vector3()
      if (!raycaster.current.ray.intersectPlane(floorPlane.current, hitPoint)) {
        return
      }

      startMouse.current.set(event.clientX, event.clientY)
      initialPosition.current.copy(camera.position)
      initialTarget.current.copy(currentTarget.current)
      dragging.current = true

      if (event.button === 0) { // left - pan (only in select mode)
        // Only allow panning in select mode
        if (controlMode === 'select') {
          dragType.current = 'pan'
          grabbedPoint.current.copy(hitPoint)
        }
      } else if (event.button === 1) { // middle - pan (works in any mode)
        dragType.current = 'pan'
        grabbedPoint.current.copy(hitPoint)
      } else if (event.button === 2) { // right - rotate (always enabled)
        dragType.current = 'rotate'
        const centerMouse = new THREE.Vector2(0, 0)
        raycaster.current.setFromCamera(centerMouse, camera)
        const hitPoint = new THREE.Vector3()
        if (raycaster.current.ray.intersectPlane(floorPlane.current, hitPoint)) {
          rotationTarget.current.copy(hitPoint)
          currentTarget.current.copy(hitPoint)
        }
      }
    }

    const processPointerMove = (event: PointerEvent) => {
      if (dragType.current === 'pan') {
        const mouse = new THREE.Vector2(
          (event.clientX / domElement.clientWidth) * 2 - 1,
          -(event.clientY / domElement.clientHeight) * 2 + 1
        )
        raycaster.current.setFromCamera(mouse, camera)
        const newPoint = new THREE.Vector3()
        if (raycaster.current.ray.intersectPlane(floorPlane.current, newPoint)) {
          const delta = grabbedPoint.current.clone().sub(newPoint)
          const newPos = initialPosition.current.clone().add(delta)
          camera.position.copy(newPos)
          targetPosition.current.copy(newPos)
          currentTarget.current.copy(initialTarget.current.clone().add(delta))
          camera.lookAt(currentTarget.current)
        }
      } else if (dragType.current === 'rotate') {
        const deltaX = event.clientX - startMouse.current.x
        const angle = deltaX * -0.002 // sensitivity
        const relative = initialPosition.current.clone().sub(rotationTarget.current)
        const cosA = Math.cos(angle)
        const sinA = Math.sin(angle)
        const newX = relative.x * cosA - relative.y * sinA
        const newY = relative.x * sinA + relative.y * cosA
        const newPos = new THREE.Vector3(
          rotationTarget.current.x + newX,
          rotationTarget.current.y + newY,
          initialPosition.current.z // keep height fixed
        )
        camera.position.copy(newPos)
        targetPosition.current.copy(newPos)
        camera.lookAt(rotationTarget.current)
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!dragging.current) return
      
      // Store the latest event
      pendingPointerMove.current = event
      
      // Use RAF to batch updates and sync with display refresh
      if (rafId.current === null) {
        rafId.current = requestAnimationFrame(() => {
          if (pendingPointerMove.current) {
            processPointerMove(pendingPointerMove.current)
            pendingPointerMove.current = null
          }
          rafId.current = null
        })
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      dragging.current = false
      dragType.current = null
      // Cancel any pending RAF
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current)
        rafId.current = null
      }
      pendingPointerMove.current = null
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      const zoomSpeed = 0.001 // Much smaller for smoother zoom
      const direction = targetPosition.current.clone().sub(currentTarget.current).normalize()
      const currentDistance = targetPosition.current.distanceTo(currentTarget.current)
      let newDistance = currentDistance * (1 + event.deltaY * zoomSpeed)

      const minDistance = 5 * tileSize * Math.sqrt(2)
      const maxDistance = 100 * tileSize * Math.sqrt(2)
      newDistance = Math.max(minDistance, Math.min(maxDistance, newDistance))

      targetPosition.current.copy(currentTarget.current.clone().add(direction.multiplyScalar(newDistance)))
    }

    domElement.addEventListener('pointerdown', handlePointerDown)
    domElement.addEventListener('pointermove', handlePointerMove)
    domElement.addEventListener('pointerup', handlePointerUp)
    domElement.addEventListener('pointercancel', handlePointerUp)
    domElement.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      domElement.removeEventListener('pointerdown', handlePointerDown)
      domElement.removeEventListener('pointermove', handlePointerMove)
      domElement.removeEventListener('pointerup', handlePointerUp)
      domElement.removeEventListener('pointercancel', handlePointerUp)
      domElement.removeEventListener('wheel', handleWheel)
      // Clean up any pending RAF
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current)
      }
    }
  }, [camera, gl, tileSize, controlMode])

  // Smooth damping animation
  useFrame((state, delta) => {
    // Skip damping when actively dragging for instant response
    if (dragging.current) return

    const dampingFactor = 8 // Higher = faster response
    const epsilon = 0.001 // Threshold to stop interpolation

    // Calculate smooth damped movement
    const distance = camera.position.distanceTo(targetPosition.current)
    
    if (distance > epsilon) {
      // Smooth damp using lerp
      const t = Math.min(1, dampingFactor * delta)
      camera.position.lerp(targetPosition.current, t)
      camera.lookAt(currentTarget.current)
    }
  })

  return null
}

