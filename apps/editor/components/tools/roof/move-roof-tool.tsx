import {
  type AnyNodeId,
  emitter,
  type GridEvent,
  type RoofNode,
  type RoofSegmentNode,
  useScene,
  sceneRegistry,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { sfxEmitter } from '@/lib/sfx-bus'
import useEditor from '@/store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

export const MoveRoofTool: React.FC<{ node: RoofNode | RoofSegmentNode }> = ({ node: movingNode }) => {
  const exitMoveMode = () => {
    useEditor.getState().setMovingNode(null)
  }

  const previousGridPosRef = useRef<[number, number] | null>(null)

  const [cursorWorldPos, setCursorWorldPos] = useState<[number, number, number]>(() => {
    const obj = sceneRegistry.nodes.get(movingNode.id)
    if (obj) {
      const pos = new THREE.Vector3()
      obj.getWorldPosition(pos)
      return [pos.x, pos.y, pos.z]
    }
    // Fallback if not registered (e.g. newly created duplicate without mesh yet)
    if (movingNode.type === 'roof-segment' && movingNode.parentId) {
      const parentNode = useScene.getState().nodes[movingNode.parentId]
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

    const meta = (typeof movingNode.metadata === 'object' && movingNode.metadata !== null)
      ? movingNode.metadata as Record<string, unknown>
      : {}
    const isNew = !!meta.isNew

    const original = {
      position: [...movingNode.position] as [number, number, number],
      rotation: movingNode.rotation,
      parentId: movingNode.parentId,
      metadata: movingNode.metadata,
    }

    if (!isNew) {
      useScene.getState().updateNode(movingNode.id, {
        metadata: { ...meta, isTransient: true },
      })
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

      let localX = gridX
      let localZ = gridZ

      if (movingNode.type === 'roof-segment' && movingNode.parentId) {
        const parentNode = useScene.getState().nodes[movingNode.parentId]
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

      useScene.getState().updateNode(movingNode.id, {
        position: [localX, movingNode.position[1], localZ],
      })
    }

    const onGridClick = (event: GridEvent) => {
      const gridX = Math.round(event.position[0] * 2) / 2
      const gridZ = Math.round(event.position[2] * 2) / 2
      const y = event.position[1]

      let localX = gridX
      let localZ = gridZ

      if (movingNode.type === 'roof-segment' && movingNode.parentId) {
        const parentNode = useScene.getState().nodes[movingNode.parentId]
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

      let placedId: string

      if (isNew) {
        useScene.temporal.getState().resume()
        
        useScene.getState().updateNode(movingNode.id, {
          position: [localX, movingNode.position[1], localZ],
          metadata: { ...meta, isNew: undefined, isTransient: undefined },
        })
        
        placedId = movingNode.id
      } else {
        // Grab the current rotation that might have been modified during the move
        const currentRotation = useScene.getState().nodes[movingNode.id]?.rotation

        // Revert to original, then apply the new position to record it properly in undo history
        useScene.getState().updateNode(movingNode.id, {
          position: original.position,
          rotation: original.rotation,
          metadata: original.metadata,
        })
        useScene.temporal.getState().resume()

        useScene.getState().updateNode(movingNode.id, {
          position: [localX, movingNode.position[1], localZ],
          rotation: currentRotation,
          metadata: { ...meta, isTransient: undefined },
        })

        placedId = movingNode.id
      }

      useScene.temporal.getState().pause()

      sfxEmitter.emit('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [placedId] })
      exitMoveMode()
      event.stopPropagation()
    }

    const onCancel = () => {
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
        
        const currentRotation = useScene.getState().nodes[movingNode.id]?.rotation as number || 0
        const newRotationY = currentRotation + rotationDelta
        useScene.getState().updateNode(movingNode.id, { rotation: newRotationY })
      }
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      const current = useScene.getState().nodes[movingNode.id as AnyNodeId]
      const currentMeta = current?.metadata as Record<string, unknown> | undefined
      if (currentMeta?.isTransient) {
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
  }, [movingNode])

  return (
    <group>
      <CursorSphere position={cursorWorldPos} showTooltip={false} />
    </group>
  )
}
