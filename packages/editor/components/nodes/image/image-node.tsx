'use client'

import { useThree } from '@react-three/fiber'
import { Image } from 'lucide-react'
import { type RefObject, useCallback, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { z } from 'zod'
import { useShallow } from 'zustand/shallow'
import { TILE_SIZE } from '@/components/editor'
import { emitter, type ImageManipulationEvent, type ImageUpdateEvent } from '@pascal/core/events'
import { useEditor } from '@/hooks/use-editor'
import { registerComponent } from '@/lib/nodes/registry'
import type { ImageNode } from '@pascal/core'
import { ImageNode as ImageNodeSchema } from '@pascal/core/scenegraph/schema/nodes/image'
import { ImageRenderer } from './image-renderer'

// ============================================================================
// REFERENCE IMAGE NODE EDITOR
// ============================================================================

/**
 * Reference image node editor component
 * Uses useEditor hooks directly to manage image manipulation
 */
export function ImageNodeEditor() {
  const updateNode = useEditor((state) => state.updateNode)
  const setIsManipulatingImage = useEditor((state) => state.setIsManipulatingImage)

  // Track undo state changes for batch updates during manipulation
  const undoStateRef = useRef<{
    [nodeId: string]: {
      position?: [number, number]
      rotation?: [number, number, number]
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
  const handleNodeSelect = useEditor((state) => state.handleNodeSelect)

  const { nodeRotation, nodeScale, nodePosition } = useEditor(
    useShallow((state) => {
      const handle = state.graph.getNodeById(nodeId!)
      const node = handle?.data() as ImageNode | undefined
      return {
        nodeRotation: node?.rotation || [0, 0, 0],
        nodeScale: node?.scale || 1,
        nodePosition: node?.position || [0, 0],
      }
    }),
  )

  const handleSelect = useCallback(
    (e?: any) => {
      const node = useEditor.getState().graph.getNodeById(nodeId)?.data() as ImageNode | undefined
      if (controlMode === 'guide' || controlMode === 'select') {
        handleNodeSelect(nodeId, e || {})
        emitter.emit('image:select', { node: node! })
      }
    },
    [controlMode, nodeId, handleNodeSelect],
  )

  const handleTranslateDown = useCallback(
    (axis: 'x' | 'y') => (e: any) => {
      if (e.button !== 0) return
      if (movingCamera) return
      e.stopPropagation()
      if (!groupRef.current) return

      const handleId = axis === 'x' ? 'translate-x' : 'translate-z'
      setActiveHandle?.(handleId)
      emitter.emit('image:manipulation-start', { nodeId })

      // Hierarchy: ImageRenderer Group -> NodeRenderer Inner Group -> NodeRenderer Outer Group -> Parent
      const imageGroup = groupRef.current
      if (!imageGroup?.parent?.parent) return

      const nodeGroup = imageGroup.parent.parent
      const parentGroup = nodeGroup.parent
      if (!parentGroup) return

      // 1. Calculate World Axis Direction
      const localAxis = axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1)
      const nodeOrigin = new THREE.Vector3().setFromMatrixPosition(nodeGroup.matrixWorld)
      // Get a point 1 unit along the axis in local space, convert to world
      const pointOnAxis = localAxis.clone().applyMatrix4(nodeGroup.matrixWorld)
      // The direction is the difference
      const worldAxis = pointOnAxis.sub(nodeOrigin).normalize()

      // 2. Setup Intersection Plane
      const initialMouse = new THREE.Vector3()
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -nodeOrigin.y)
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(e.pointer, camera)
      raycaster.ray.intersectPlane(plane, initialMouse)

      // 3. Calculate initial projection offset
      // This is the distance from the node origin to the clicked point along the axis
      const clickOffsetVector = initialMouse.clone().sub(nodeOrigin)
      const initialProjection = clickOffsetVector.dot(worldAxis)

      // Capture starting position
      const startWorldPos = nodeOrigin.clone()

      let lastPosition: [number, number] | null = null

      const handleMove = (ev: PointerEvent) => {
        const rect = gl.domElement.getBoundingClientRect()
        const mx = ((ev.clientX - rect.left) / rect.width) * 2 - 1
        const my = -((ev.clientY - rect.top) / rect.height) * 2 + 1
        const mouseVec = new THREE.Vector2(mx, my)

        raycaster.setFromCamera(mouseVec, camera)
        const intersect = new THREE.Vector3()
        if (!raycaster.ray.intersectPlane(plane, intersect)) return

        // 4. Calculate new projection
        const vectorFromStart = intersect.clone().sub(startWorldPos)
        const currentProjection = vectorFromStart.dot(worldAxis)

        // 5. Calculate delta (movement required)
        let delta = currentProjection - initialProjection

        if (ev.shiftKey) {
          delta = Math.round(delta / TILE_SIZE) * TILE_SIZE
        }

        // 6. Apply delta along world axis to start position
        const newWorldPos = startWorldPos.clone().add(worldAxis.clone().multiplyScalar(delta))

        // 7. Convert back to local space for storage
        const newLocalPos = parentGroup.worldToLocal(newWorldPos)

        // Store as simple X/Z
        lastPosition = [newLocalPos.x / TILE_SIZE, newLocalPos.z / TILE_SIZE]

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

      // Get the NodeRenderer's outer group (the one with the actual position)
      // Hierarchy: ImageRenderer Group -> NodeRenderer Inner Group -> NodeRenderer Outer Group -> Parent
      const imageGroup = groupRef.current
      if (!imageGroup?.parent?.parent) return

      const nodeGroup = imageGroup.parent.parent
      const parentGroup = nodeGroup.parent
      if (!parentGroup) return

      // Calculate the offset between the click point and the node's origin in world space
      const initialMouse = new THREE.Vector3()
      const plane = new THREE.Plane(
        new THREE.Vector3(0, 1, 0),
        -nodeGroup.getWorldPosition(new THREE.Vector3()).y,
      )
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(e.pointer, camera)
      raycaster.ray.intersectPlane(plane, initialMouse)

      const nodeWorldPos = new THREE.Vector3()
      nodeGroup.getWorldPosition(nodeWorldPos)
      const clickOffset = nodeWorldPos.clone().sub(initialMouse)

      let lastPosition: [number, number] | null = null

      const handleMove = (ev: PointerEvent) => {
        const rect = gl.domElement.getBoundingClientRect()
        const mx = ((ev.clientX - rect.left) / rect.width) * 2 - 1
        const my = -((ev.clientY - rect.top) / rect.height) * 2 + 1
        const mouseVec = new THREE.Vector2(mx, my)

        raycaster.setFromCamera(mouseVec, camera)
        const intersect = new THREE.Vector3()
        if (!raycaster.ray.intersectPlane(plane, intersect)) return

        // Calculate target world position
        const targetWorldPos = intersect.clone().add(clickOffset)

        // Convert to parent local space
        const targetLocalPos = parentGroup.worldToLocal(targetWorldPos.clone())

        let finalX = targetLocalPos.x
        let finalZ = targetLocalPos.z

        if (ev.shiftKey) {
          finalX = Math.round(finalX / TILE_SIZE) * TILE_SIZE
          finalZ = Math.round(finalZ / TILE_SIZE) * TILE_SIZE
        }

        lastPosition = [finalX / TILE_SIZE, finalZ / TILE_SIZE]
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

      // Hierarchy: ImageRenderer Group -> NodeRenderer Inner Group -> NodeRenderer Outer Group -> Parent
      const imageGroup = groupRef.current
      if (!imageGroup?.parent?.parent) return

      const nodeGroup = imageGroup.parent.parent

      const nodeOrigin = new THREE.Vector3().setFromMatrixPosition(nodeGroup.matrixWorld)
      const center = nodeOrigin.clone()
      const initialMouse = new THREE.Vector3()
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -nodeOrigin.y)
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(e.pointer, camera)
      raycaster.ray.intersectPlane(plane, initialMouse)
      const initialVector = initialMouse.clone().sub(center)
      const initialAngle = Math.atan2(initialVector.z, initialVector.x)
      const initialYRotation = nodeRotation[1] // Y component in radians
      let lastRotation: [number, number, number] | null = null

      const handleMove = (ev: PointerEvent) => {
        const rect = gl.domElement.getBoundingClientRect()
        const mx = ((ev.clientX - rect.left) / rect.width) * 2 - 1
        const my = -((ev.clientY - rect.top) / rect.height) * 2 + 1
        const mouseVec = new THREE.Vector2(mx, my)
        raycaster.setFromCamera(mouseVec, camera)
        const intersect = new THREE.Vector3()
        if (!raycaster.ray.intersectPlane(plane, intersect)) return

        const vector = intersect.clone().sub(center)
        const angle = Math.atan2(vector.z, vector.x)
        const delta = angle - initialAngle
        let newYRotation = initialYRotation - delta // Already in radians

        if (ev.shiftKey) {
          // Snap to 45° increments (π/4 radians)
          newYRotation = Math.round(newYRotation / (Math.PI / 4)) * (Math.PI / 4)
        }

        lastRotation = [nodeRotation[0], newYRotation, nodeRotation[2]]
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
    [nodeId, nodeRotation, movingCamera, camera, gl, groupRef, setActiveHandle],
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
  schema: ImageNodeSchema,
  nodeEditor: ImageNodeEditor,
  nodeRenderer: ImageRenderer,
  toolIcon: Image,
})
