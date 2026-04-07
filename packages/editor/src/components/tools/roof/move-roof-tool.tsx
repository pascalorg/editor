import {
  type AnyNodeId,
  emitter,
  type GridEvent,
  type RoofNode,
  type RoofSegmentNode,
  type StairNode,
  type StairSegmentNode,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

export const MoveRoofTool: React.FC<{
  node: RoofNode | RoofSegmentNode | StairNode | StairSegmentNode
}> = ({ node: movingNode }) => {
  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  const previousGridPosRef = useRef<[number, number] | null>(null)

  const [cursorWorldPos, setCursorWorldPos] = useState<[number, number, number]>(() => {
    const obj = sceneRegistry.nodes.get(movingNode.id)
    if (obj) {
      const pos = new THREE.Vector3()
      obj.getWorldPosition(pos)
      return [pos.x, pos.y, pos.z]
    }
    // Fallback if not registered (e.g. newly created duplicate without mesh yet)
    if (
      (movingNode.type === 'roof-segment' || movingNode.type === 'stair-segment') &&
      movingNode.parentId
    ) {
      const parentNode = useScene.getState().nodes[movingNode.parentId as AnyNodeId]
      if (parentNode && 'position' in parentNode && 'rotation' in parentNode) {
        const parentAngle = parentNode.rotation as number
        const px = parentNode.position[0] as number
        const py = parentNode.position[1] as number
        const pz = parentNode.position[2] as number
        const lx = movingNode.position[0]
        const ly = movingNode.position[1]
        const lz = movingNode.position[2]

        const wx = lx * Math.cos(parentAngle) - lz * Math.sin(parentAngle) + px
        const wz = lx * Math.sin(parentAngle) + lz * Math.cos(parentAngle) + pz
        return [wx, py + ly, wz]
      }
    }
    return [movingNode.position[0], movingNode.position[1], movingNode.position[2]]
  })

  useEffect(() => {
    useScene.temporal.getState().pause()

    const meta =
      typeof movingNode.metadata === 'object' && movingNode.metadata !== null
        ? (movingNode.metadata as Record<string, unknown>)
        : {}
    const isNew = !!meta.isNew
    const committedMeta: RoofNode['metadata'] = (() => {
      if (
        typeof movingNode.metadata !== 'object' ||
        movingNode.metadata === null ||
        Array.isArray(movingNode.metadata)
      ) {
        return movingNode.metadata
      }

      const nextMeta = { ...movingNode.metadata } as Record<string, unknown>
      delete nextMeta.isNew
      delete nextMeta.isTransient
      return nextMeta as RoofNode['metadata']
    })()

    const original = {
      position: [...movingNode.position] as [number, number, number],
      rotation: movingNode.rotation,
      parentId: movingNode.parentId,
      metadata: movingNode.metadata,
    }

    // Track whether the move was committed so cleanup knows whether to revert.
    // We avoid setting isTransient on the store to prevent RoofSystem from
    // resetting the mesh position (it resets on dirty) and from triggering
    // expensive merged-mesh CSG rebuilds on every frame.
    let wasCommitted = false

    // Track pending rotation — no store updates during drag
    let pendingRotation: number = movingNode.rotation as number

    // For roof-segment moves: the selection was cleared before entering move mode,
    // so isSelected=false on the parent roof, hiding individual segment meshes and
    // showing only the merged mesh. We directly flip Three.js visibility so the
    // user sees the individual segment tracking the cursor.
    let segmentWrapperGroup: THREE.Object3D | null = null
    let mergedRoofMesh: THREE.Object3D | null = null
    if (movingNode.type === 'roof-segment' || movingNode.type === 'stair-segment') {
      const segmentMesh = sceneRegistry.nodes.get(movingNode.id)
      if (segmentMesh?.parent) {
        // segmentMesh.parent = <group visible={isSelected}> wrapper in Roof/StairRenderer
        // segmentMesh.parent.parent = the registered roof/stair group
        segmentWrapperGroup = segmentMesh.parent
        const mergedName = movingNode.type === 'stair-segment' ? 'merged-stair' : 'merged-roof'
        mergedRoofMesh = segmentMesh.parent.parent?.getObjectByName(mergedName) ?? null
        segmentWrapperGroup.visible = true
        if (mergedRoofMesh) mergedRoofMesh.visible = false
      }
    }

    const computeLocal = (gridX: number, gridZ: number, y: number): [number, number] => {
      let localX = gridX
      let localZ = gridZ

      if (
        (movingNode.type === 'roof-segment' || movingNode.type === 'stair-segment') &&
        movingNode.parentId
      ) {
        const parentNode = useScene.getState().nodes[movingNode.parentId as AnyNodeId]
        if (parentNode && 'position' in parentNode && 'rotation' in parentNode) {
          const parentObj = sceneRegistry.nodes.get(movingNode.parentId)
          if (parentObj) {
            const worldVec = new THREE.Vector3(gridX, y, gridZ)
            parentObj.worldToLocal(worldVec)
            localX = worldVec.x
            localZ = worldVec.z
          } else {
            const dx = gridX - (parentNode.position[0] as number)
            const dz = gridZ - (parentNode.position[2] as number)
            const angle = -(parentNode.rotation as number)
            localX = dx * Math.cos(angle) - dz * Math.sin(angle)
            localZ = dx * Math.sin(angle) + dz * Math.cos(angle)
          }
        }
      }

      return [localX, localZ]
    }

    const onGridMove = (event: GridEvent) => {
      const gridX = Math.round(event.position[0] * 2) / 2
      const gridZ = Math.round(event.position[2] * 2) / 2
      const y = event.position[1]

      if (
        previousGridPosRef.current &&
        (gridX !== previousGridPosRef.current[0] || gridZ !== previousGridPosRef.current[1])
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      previousGridPosRef.current = [gridX, gridZ]
      setCursorWorldPos([gridX, y, gridZ])

      const [localX, localZ] = computeLocal(gridX, gridZ, y)

      // Directly update the Three.js mesh — no store update during drag
      const mesh = sceneRegistry.nodes.get(movingNode.id)
      if (mesh) {
        mesh.position.x = localX
        mesh.position.z = localZ
      }

      // Publish world-space position so the 2D floorplan can track the drag
      useLiveTransforms.getState().set(movingNode.id, {
        position: [gridX, y, gridZ],
        rotation: pendingRotation,
      })
    }

    const onGridClick = (event: GridEvent) => {
      const gridX = Math.round(event.position[0] * 2) / 2
      const gridZ = Math.round(event.position[2] * 2) / 2
      const y = event.position[1]

      const [localX, localZ] = computeLocal(gridX, gridZ, y)

      wasCommitted = true

      // The store still holds the original values (we didn't update during drag).
      // Resume temporal and apply the final state as a single undoable step.
      useScene.temporal.getState().resume()

      useScene.getState().updateNode(movingNode.id, {
        position: [localX, movingNode.position[1], localZ],
        rotation: pendingRotation,
        metadata: committedMeta,
      })

      useScene.temporal.getState().pause()

      sfxEmitter.emit('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [movingNode.id] })
      useLiveTransforms.getState().clear(movingNode.id)
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      useLiveTransforms.getState().clear(movingNode.id)
      if (isNew) {
        useScene.getState().deleteNode(movingNode.id)
      } else {
        useScene.getState().updateNode(movingNode.id, {
          position: original.position,
          rotation: original.rotation,
          metadata: original.metadata,
        })
      }
      useScene.temporal.getState().resume()
      exitMoveMode()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      const ROTATION_STEP = Math.PI / 4
      let rotationDelta = 0
      if (event.key === 'r' || event.key === 'R') rotationDelta = ROTATION_STEP
      else if (event.key === 't' || event.key === 'T') rotationDelta = -ROTATION_STEP

      if (rotationDelta !== 0) {
        event.preventDefault()
        sfxEmitter.emit('sfx:item-rotate')

        pendingRotation += rotationDelta

        // Directly update the Three.js mesh — no store update during drag
        const mesh = sceneRegistry.nodes.get(movingNode.id)
        if (mesh) mesh.rotation.y = pendingRotation

        // Update live transform rotation for 2D floorplan
        const currentLive = useLiveTransforms.getState().get(movingNode.id)
        if (currentLive) {
          useLiveTransforms.getState().set(movingNode.id, {
            ...currentLive,
            rotation: pendingRotation,
          })
        }
      }
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      // Restore segment wrapper visibility (React will re-sync on next render)
      if (segmentWrapperGroup) segmentWrapperGroup.visible = false
      if (mergedRoofMesh) mergedRoofMesh.visible = true

      // Clear ephemeral live transform
      useLiveTransforms.getState().clear(movingNode.id)

      if (!wasCommitted) {
        if (isNew) {
          useScene.getState().deleteNode(movingNode.id)
        } else {
          useScene.getState().updateNode(movingNode.id, {
            position: original.position,
            rotation: original.rotation,
            metadata: original.metadata,
          })
        }
      }
      useScene.temporal.getState().resume()
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [movingNode, exitMoveMode])

  return (
    <group>
      <CursorSphere position={cursorWorldPos} showTooltip={false} />
    </group>
  )
}
