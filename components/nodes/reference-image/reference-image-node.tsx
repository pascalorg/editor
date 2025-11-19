'use client'

import { useThree } from '@react-three/fiber'
import { Image } from 'lucide-react'
import { type RefObject, useCallback, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { z } from 'zod'
import { useShallow } from 'zustand/shallow'
import { TILE_SIZE } from '@/components/editor'
import { emitter, type ImageManipulationEvent, type ImageUpdateEvent } from '@/events/bus'
import { useEditor } from '@/hooks/use-editor'
import { registerComponent } from '@/lib/nodes/registry'
import type { ImageNode } from '@/lib/scenegraph/schema/index'
import { ImageRenderer } from './image-renderer'

// ============================================================================
// REFERENCE IMAGE RENDERER PROPS SCHEMA
// ============================================================================

/**
 * Zod schema for reference image renderer props
 * These are renderer-specific properties, not the full node structure
 */
export const ReferenceImageRendererPropsSchema = z
  .object({
    // Add renderer-specific props here if needed
    // e.g., quality settings, LOD, etc.
  })
  .optional()

export type ReferenceImageRendererProps = z.infer<typeof ReferenceImageRendererPropsSchema>

// ============================================================================
// REFERENCE IMAGE NODE EDITOR
// ============================================================================

/**
 * Reference image node editor component
 * Uses useEditor hooks directly to manage image manipulation
 */
export function ReferenceImageNodeEditor() {
  const updateNode = useEditor((state) => state.updateNode)
  const setIsManipulatingImage = useEditor((state) => state.setIsManipulatingImage)

  // Track undo state changes for batch updates during manipulation
  const undoStateRef = useRef<{
    [nodeId: string]: {
      position?: [number, number]
      rotation?: number
      scale?: number
    }
  }>({})

  useEffect(() => {
    const handleImageUpdate = (event: ImageUpdateEvent) => {
      const { nodeId, updates, pushToUndo } = event

      // Update the node in the store
      updateNode(nodeId, updates)

      // If pushing to undo, clear the accumulated state for this node
      if (pushToUndo) {
        delete undoStateRef.current[nodeId]
      } else {
        // Accumulate updates during drag
        if (!undoStateRef.current[nodeId]) {
          undoStateRef.current[nodeId] = {}
        }
        Object.assign(undoStateRef.current[nodeId], updates)
      }
    }

    const handleManipulationStart = (event: ImageManipulationEvent) => {
      const { nodeId } = event
      // Initialize accumulated state
      undoStateRef.current[nodeId] = {}
      setIsManipulatingImage(true)
    }

    const handleManipulationEnd = (event: ImageManipulationEvent) => {
      setIsManipulatingImage(false)
    }

    // Register event listeners
    emitter.on('image:update', handleImageUpdate)
    emitter.on('image:manipulation-start', handleManipulationStart)
    emitter.on('image:manipulation-end', handleManipulationEnd)

    // Cleanup event listeners
    return () => {
      emitter.off('image:update', handleImageUpdate)
      emitter.off('image:manipulation-start', handleManipulationStart)
      emitter.off('image:manipulation-end', handleManipulationEnd)
    }
  }, [updateNode, setIsManipulatingImage])

  return null
}

// ============================================================================
// IMAGE MANIPULATION HOOK
// ============================================================================

/**
 * Custom hook for image manipulation handlers
 * Provides all the pointer event handlers for transforming reference images
 */
export function useImageManipulation(
  nodeId: ImageNode['id'],
  groupRef: RefObject<THREE.Group | null>,
  setActiveHandle?: (handleId: string | null) => void,
) {
  const { camera, gl } = useThree()
  const movingCamera = useEditor((state) => state.movingCamera)
  const controlMode = useEditor((state) => state.controlMode)
  const setSelectedImageIds = useEditor((state) => state.setSelectedImageIds)

  const { nodeRotationY, nodeScale } = useEditor(
    useShallow((state) => {
      const node = state.nodeIndex.get(nodeId!) as ImageNode | undefined
      return {
        nodeRotationY: node?.rotationY || 0,
        nodeScale: node?.scale || 1,
      }
    }),
  )

  const handleSelect = useCallback(() => {
    const node = useEditor.getState().nodeIndex.get(nodeId) as ImageNode | undefined
    if (controlMode === 'guide' || controlMode === 'select') {
      setSelectedImageIds([nodeId])
      emitter.emit('image:select', { node: node! })
    }
  }, [controlMode, nodeId, setSelectedImageIds])

  const handleTranslateDown = useCallback(
    (axis: 'x' | 'y') => (e: any) => {
      if (e.button !== 0) return
      if (movingCamera) return
      e.stopPropagation()
      if (!groupRef.current) return

      const handleId = axis === 'x' ? 'translate-x' : 'translate-z'
      setActiveHandle?.(handleId)
      emitter.emit('image:manipulation-start', { nodeId })

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
        emitter.emit('image:update', {
          nodeId,
          updates: { position: lastPosition },
          pushToUndo: false,
        })
      }

      const handleUp = () => {
        document.removeEventListener('pointermove', handleMove)
        document.removeEventListener('pointerup', handleUp)
        setActiveHandle?.(null)
        if (lastPosition) {
          emitter.emit('image:update', {
            nodeId,
            updates: { position: lastPosition },
            pushToUndo: true,
          })
        }
        emitter.emit('image:manipulation-end', { nodeId })
      }

      document.addEventListener('pointermove', handleMove)
      document.addEventListener('pointerup', handleUp)
    },
    [nodeId, movingCamera, camera, gl, groupRef, setActiveHandle],
  )

  const handleTranslateXZDown = useCallback(
    (e: any) => {
      if (e.button !== 0) return
      if (movingCamera) return
      e.stopPropagation()
      if (!groupRef.current) return

      setActiveHandle?.('translate-xz')
      emitter.emit('image:manipulation-start', { nodeId })

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
        emitter.emit('image:update', {
          nodeId,
          updates: { position: lastPosition },
          pushToUndo: false,
        })
      }

      const handleUp = () => {
        document.removeEventListener('pointermove', handleMove)
        document.removeEventListener('pointerup', handleUp)
        setActiveHandle?.(null)
        if (lastPosition) {
          emitter.emit('image:update', {
            nodeId,
            updates: { position: lastPosition },
            pushToUndo: true,
          })
        }
        emitter.emit('image:manipulation-end', { nodeId })
      }

      document.addEventListener('pointermove', handleMove)
      document.addEventListener('pointerup', handleUp)
    },
    [nodeId, movingCamera, camera, gl, groupRef, setActiveHandle],
  )

  const handleRotationDown = useCallback(
    (e: any) => {
      if (e.button !== 0) return
      if (movingCamera) return
      e.stopPropagation()
      if (!groupRef.current) return

      setActiveHandle?.('rotation')
      emitter.emit('image:manipulation-start', { nodeId })

      const center = groupRef.current.position.clone()
      const initialMouse = new THREE.Vector3()
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(e.pointer, camera)
      raycaster.ray.intersectPlane(plane, initialMouse)
      const initialVector = initialMouse.clone().sub(center)
      const initialAngle = Math.atan2(initialVector.z, initialVector.x)
      const initialRotation = nodeRotationY
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
        emitter.emit('image:update', {
          nodeId,
          updates: { rotation: lastRotation },
          pushToUndo: false,
        })
      }

      const handleUp = () => {
        document.removeEventListener('pointermove', handleMove)
        document.removeEventListener('pointerup', handleUp)
        setActiveHandle?.(null)
        if (lastRotation !== null) {
          emitter.emit('image:update', {
            nodeId,
            updates: { rotation: lastRotation },
            pushToUndo: true,
          })
        }
        emitter.emit('image:manipulation-end', { nodeId })
      }

      document.addEventListener('pointermove', handleMove)
      document.addEventListener('pointerup', handleUp)
    },
    [nodeId, nodeRotationY, movingCamera, camera, gl, groupRef, setActiveHandle],
  )

  const handleScaleDown = useCallback(
    (edge: 'right' | 'left' | 'top' | 'bottom') => (e: any) => {
      if (e.button !== 0) return
      if (movingCamera) return
      e.stopPropagation()
      if (!groupRef.current) return

      setActiveHandle?.('scale')
      emitter.emit('image:manipulation-start', { nodeId })

      const center = groupRef.current.position.clone()
      const initialMouse = new THREE.Vector3()
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(e.pointer, camera)
      raycaster.ray.intersectPlane(plane, initialMouse)
      const initialDist = center.distanceTo(initialMouse)
      const initialScale = nodeScale
      const getLocalDir = () => {
        switch (edge) {
          case 'right':
            return new THREE.Vector3(1, 0, 0)
          case 'left':
            return new THREE.Vector3(-1, 0, 0)
          case 'top':
            return new THREE.Vector3(0, 0, 1)
          case 'bottom':
            return new THREE.Vector3(0, 0, -1)
        }
      }
      const localDir = getLocalDir()
      const worldZero = new THREE.Vector3().applyMatrix4(groupRef.current.matrixWorld)
      const worldDir = localDir
        .clone()
        .applyMatrix4(groupRef.current.matrixWorld)
        .sub(worldZero)
        .normalize()
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

        if (ev.shiftKey) {
          newScale = Math.round(newScale * 10) / 10
        }

        lastScale = Math.max(0.1, newScale)
        emitter.emit('image:update', {
          nodeId,
          updates: { scale: lastScale },
          pushToUndo: false,
        })
      }

      const handleUp = () => {
        document.removeEventListener('pointermove', handleMove)
        document.removeEventListener('pointerup', handleUp)
        setActiveHandle?.(null)
        if (lastScale !== null) {
          emitter.emit('image:update', {
            nodeId,
            updates: { scale: lastScale },
            pushToUndo: true,
          })
        }
        emitter.emit('image:manipulation-end', { nodeId })
      }

      document.addEventListener('pointermove', handleMove)
      document.addEventListener('pointerup', handleUp)
    },
    [nodeId, nodeScale, movingCamera, camera, gl, groupRef, setActiveHandle],
  )

  return {
    handleSelect,
    handleTranslateDown,
    handleTranslateXZDown,
    handleRotationDown,
    handleScaleDown,
  }
}

// ============================================================================
// REGISTER REFERENCE IMAGE COMPONENT
// ============================================================================

registerComponent({
  nodeType: 'reference-image',
  nodeName: 'Reference Image',
  editorMode: 'guide',
  rendererPropsSchema: ReferenceImageRendererPropsSchema,
  nodeEditor: ReferenceImageNodeEditor,
  nodeRenderer: ImageRenderer,
  toolIcon: Image,
})
