'use client'

import { useThree } from '@react-three/fiber'
import { Box } from 'lucide-react'
import { type RefObject, useCallback, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { z } from 'zod'
import { useShallow } from 'zustand/shallow'
import { TILE_SIZE } from '@/components/editor'
import { emitter, type ScanManipulationEvent, type ScanUpdateEvent } from '@pascal/core/events'
import { useEditor } from '@/hooks/use-editor'
import { registerComponent } from '@/lib/nodes/registry'
import type { ScanNode } from '@pascal/core'
import { ScanNode as ScanNodeSchema } from '@pascal/core/scenegraph/schema/nodes/scan'
import { ScanRenderer } from './scan-renderer'

// ============================================================================
// SCAN NODE EDITOR
// ============================================================================

/**
 * Scan node editor component
 * Uses useEditor hooks directly to manage scan manipulation
 */
export function ScanNodeEditor() {
  const updateNode = useEditor((state) => state.updateNode)
  const setIsManipulatingScan = useEditor((state) => state.setIsManipulatingScan)

  // Track undo state changes for batch updates during manipulation
  const undoStateRef = useRef<{
    [nodeId: string]: {
      position?: [number, number, number]
      rotation?: [number, number, number]
      scale?: number
      yOffset?: number
    }
  }>({})

  useEffect(() => {
    const handleScanUpdate = (event: ScanUpdateEvent) => {
      const { nodeId, updates, pushToUndo } = event

      // Update the node in the store
      // Pass skipUndo = !pushToUndo (if pushing to undo, skipUndo is false)
      updateNode(nodeId, updates as Partial<ScanNode>, !pushToUndo)

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

    const handleManipulationStart = (event: ScanManipulationEvent) => {
      const { nodeId } = event
      // Initialize accumulated state
      undoStateRef.current[nodeId] = {}
      setIsManipulatingScan(true)
    }

    const handleManipulationEnd = (event: ScanManipulationEvent) => {
      setIsManipulatingScan(false)
    }

    // Register event listeners
    emitter.on('scan:update', handleScanUpdate)
    emitter.on('scan:manipulation-start', handleManipulationStart)
    emitter.on('scan:manipulation-end', handleManipulationEnd)

    // Cleanup event listeners
    return () => {
      emitter.off('scan:update', handleScanUpdate)
      emitter.off('scan:manipulation-start', handleManipulationStart)
      emitter.off('scan:manipulation-end', handleManipulationEnd)
    }
  }, [updateNode, setIsManipulatingScan])

  return null
}

// ============================================================================
// SCAN MANIPULATION HOOK
// ============================================================================

/**
 * Custom hook for scan manipulation handlers
 * Provides all the pointer event handlers for transforming 3D scans
 */
export function useScanManipulation(
  nodeId: ScanNode['id'],
  groupRef: RefObject<THREE.Group | null>,
  setActiveHandle?: (handleId: string | null) => void,
) {
  const { camera, gl } = useThree()
  const movingCamera = useEditor((state) => state.movingCamera)
  const controlMode = useEditor((state) => state.controlMode)
  const setControlMode = useEditor((state) => state.setControlMode)
  const handleNodeSelect = useEditor((state) => state.handleNodeSelect)

  const { nodePosition, nodeScale, nodeRotation } = useEditor(
    useShallow((state) => {
      const handle = state.graph.getNodeById(nodeId)
      const node = handle?.data() as ScanNode | undefined
      return {
        nodePosition: node?.position || [0, 0, 0],
        nodeScale: node?.scale || 1,
        nodeRotation: node?.rotation || [0, 0, 0],
      }
    }),
  )

  const handleSelect = useCallback(
    (e?: any) => {
      if (controlMode === 'guide' || controlMode === 'select') {
        handleNodeSelect(nodeId, e || {})
        setControlMode('guide')
      }
    },
    [controlMode, nodeId, handleNodeSelect, setControlMode],
  )

  const handleTranslateDown = useCallback(
    (axis: 'x' | 'z') => (e: any) => {
      if (e.button !== 0) return
      if (movingCamera) return
      e.stopPropagation()
      if (!groupRef.current) return

      const handleId = axis === 'x' ? 'translate-x' : 'translate-z'
      setActiveHandle?.(handleId)
      emitter.emit('scan:manipulation-start', { nodeId })

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

        let finalX = newPos.x / TILE_SIZE
        let finalZ = newPos.z / TILE_SIZE
        if (ev.shiftKey) {
          finalX = Math.round(finalX)
          finalZ = Math.round(finalZ)
        }

        lastPosition = [finalX, finalZ]
        emitter.emit('scan:update', {
          nodeId,
          updates: { position: [finalX, finalZ, nodePosition[2]] },
          pushToUndo: false,
        })
      }

      const handleUp = () => {
        document.removeEventListener('pointermove', handleMove)
        document.removeEventListener('pointerup', handleUp)
        setActiveHandle?.(null)
        if (lastPosition) {
          emitter.emit('scan:update', {
            nodeId,
            updates: { position: [lastPosition[0], lastPosition[1], nodePosition[2]] },
            pushToUndo: true,
          })
        }
        emitter.emit('scan:manipulation-end', { nodeId })
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
      emitter.emit('scan:manipulation-start', { nodeId })

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

        let finalX = newPos.x / TILE_SIZE
        let finalZ = newPos.z / TILE_SIZE
        if (ev.shiftKey) {
          finalX = Math.round(finalX)
          finalZ = Math.round(finalZ)
        }

        lastPosition = [finalX, finalZ]
        emitter.emit('scan:update', {
          nodeId,
          updates: { position: [finalX, finalZ, nodePosition[2]] },
          pushToUndo: false,
        })
      }

      const handleUp = () => {
        document.removeEventListener('pointermove', handleMove)
        document.removeEventListener('pointerup', handleUp)
        setActiveHandle?.(null)
        if (lastPosition) {
          emitter.emit('scan:update', {
            nodeId,
            updates: { position: [lastPosition[0], lastPosition[1], nodePosition[2]] },
            pushToUndo: true,
          })
        }
        emitter.emit('scan:manipulation-end', { nodeId })
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
      emitter.emit('scan:manipulation-start', { nodeId })

      const center = groupRef.current.position.clone()
      const initialMouse = new THREE.Vector3()
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(e.pointer, camera)
      raycaster.ray.intersectPlane(plane, initialMouse)
      const initialVector = initialMouse.clone().sub(center)
      const initialAngle = Math.atan2(initialVector.z, initialVector.x)
      const initialRotation = nodeRotation
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
        let newRotation = (initialRotation[1] ?? 0) - delta * (180 / Math.PI)

        if (ev.shiftKey) {
          newRotation = Math.round(newRotation / 45) * 45
        }

        lastRotation = newRotation
        emitter.emit('scan:update', {
          nodeId,
          updates: { rotation: [initialRotation[0], lastRotation, initialRotation[2]] },
          pushToUndo: false,
        })
      }

      const handleUp = () => {
        document.removeEventListener('pointermove', handleMove)
        document.removeEventListener('pointerup', handleUp)
        setActiveHandle?.(null)
        if (lastRotation !== null) {
          emitter.emit('scan:update', {
            nodeId,
            updates: { rotation: [initialRotation[0], lastRotation, initialRotation[2]] },
            pushToUndo: true,
          })
        }
        emitter.emit('scan:manipulation-end', { nodeId })
      }

      document.addEventListener('pointermove', handleMove)
      document.addEventListener('pointerup', handleUp)
    },
    [nodeId, nodeRotation, movingCamera, camera, gl, groupRef, setActiveHandle],
  )

  const handleTranslateYDown = useCallback(
    (e: any) => {
      if (e.button !== 0) return
      if (movingCamera) return
      e.stopPropagation()
      if (!groupRef.current) return

      setActiveHandle?.('translate-y')
      emitter.emit('scan:manipulation-start', { nodeId })

      const initialMouseY = e.pointer.y
      const initialYOffset = nodePosition[2] ?? 0
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
        emitter.emit('scan:update', {
          nodeId,
          updates: { position: [nodePosition[0], nodePosition[1], lastYOffset] },
          pushToUndo: false,
        })
      }

      const handleUp = () => {
        document.removeEventListener('pointermove', handleMove)
        document.removeEventListener('pointerup', handleUp)
        setActiveHandle?.(null)
        if (lastYOffset !== null) {
          emitter.emit('scan:update', {
            nodeId,
            updates: { position: [nodePosition[0], nodePosition[1], lastYOffset] },
            pushToUndo: true,
          })
        }
        emitter.emit('scan:manipulation-end', { nodeId })
      }

      document.addEventListener('pointermove', handleMove)
      document.addEventListener('pointerup', handleUp)
    },
    [nodeId, nodePosition, movingCamera, camera, gl, groupRef, setActiveHandle],
  )

  const handleScaleDown = useCallback(
    (e: any) => {
      if (e.button !== 0) return
      if (movingCamera) return
      e.stopPropagation()
      if (!groupRef.current) return

      setActiveHandle?.('scale')
      emitter.emit('scan:manipulation-start', { nodeId })

      const center = groupRef.current.position.clone()
      const initialMouse = new THREE.Vector3()
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(e.pointer, camera)
      raycaster.ray.intersectPlane(plane, initialMouse)
      const initialDist = center.distanceTo(initialMouse)
      const initialScale = nodeScale
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
        emitter.emit('scan:update', {
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
          emitter.emit('scan:update', {
            nodeId,
            updates: { scale: lastScale },
            pushToUndo: true,
          })
        }
        emitter.emit('scan:manipulation-end', { nodeId })
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
    handleTranslateYDown,
    handleScaleDown,
  }
}

// ============================================================================
// REGISTER SCAN COMPONENT
// ============================================================================

registerComponent({
  nodeType: 'scan',
  nodeName: '3D Scan',
  editorMode: 'guide',
  schema: ScanNodeSchema,
  nodeEditor: ScanNodeEditor,
  nodeRenderer: ScanRenderer,
  toolIcon: Box,
})
