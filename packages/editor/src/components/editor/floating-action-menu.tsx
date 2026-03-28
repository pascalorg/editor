'use client'

import {
  type AnyNode,
  type AnyNodeId,
  DoorNode,
  ItemNode,
  RoofNode,
  RoofSegmentNode,
  sceneRegistry,
  useScene,
  WindowNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useCallback, useRef } from 'react'
import * as THREE from 'three'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'
import { NodeActionMenu } from './node-action-menu'

const ALLOWED_TYPES = ['item', 'door', 'window', 'roof', 'roof-segment', 'wall', 'slab']
const DELETE_ONLY_TYPES = ['wall', 'slab']

export function FloatingActionMenu() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const nodes = useScene((s) => s.nodes)
  const mode = useEditor((s) => s.mode)
  const setMode = useEditor((s) => s.setMode)
  const isFloorplanHovered = useEditor((s) => s.isFloorplanHovered)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const setSelection = useViewer((s) => s.setSelection)

  const groupRef = useRef<THREE.Group>(null)

  // Only show for single selection of specific types
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const node = selectedId ? nodes[selectedId as AnyNodeId] : null
  const isValidType = node ? ALLOWED_TYPES.includes(node.type) : false

  useFrame(() => {
    if (!(selectedId && isValidType && groupRef.current)) return

    const obj = sceneRegistry.nodes.get(selectedId)
    if (obj) {
      // Calculate bounding box in world space
      const box = new THREE.Box3().setFromObject(obj)
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3())
        // Position above the object, with extra offset for walls/slabs to avoid covering measurement labels
        const isDeleteOnly = node && DELETE_ONLY_TYPES.includes(node.type)
        const yOffset = isDeleteOnly ? 0.8 : 0.3
        groupRef.current.position.set(center.x, box.max.y + yOffset, center.z)
      }
    }
  })

  const handleMove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!node) return
      sfxEmitter.emit('sfx:item-pick')
      if (
        node.type === 'item' ||
        node.type === 'window' ||
        node.type === 'door' ||
        node.type === 'roof' ||
        node.type === 'roof-segment'
      ) {
        setMovingNode(node as any)
      }
      setSelection({ selectedIds: [] })
    },
    [node, setMovingNode, setSelection],
  )

  const handleDuplicate = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!node?.parentId) return
      sfxEmitter.emit('sfx:item-pick')
      useScene.temporal.getState().pause()

      let duplicateInfo = structuredClone(node) as any
      delete duplicateInfo.id
      duplicateInfo.metadata = { ...duplicateInfo.metadata, isNew: true }

      let duplicate: AnyNode | null = null
      try {
        if (node.type === 'door') {
          duplicate = DoorNode.parse(duplicateInfo)
        } else if (node.type === 'window') {
          duplicate = WindowNode.parse(duplicateInfo)
        } else if (node.type === 'item') {
          duplicate = ItemNode.parse(duplicateInfo)
        } else if (node.type === 'roof') {
          duplicate = RoofNode.parse(duplicateInfo)
        } else if (node.type === 'roof-segment') {
          duplicate = RoofSegmentNode.parse(duplicateInfo)
        }
      } catch (error) {
        console.error('Failed to parse duplicate', error)
        return
      }

      if (duplicate) {
        if (duplicate.type === 'door' || duplicate.type === 'window') {
          useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
        } else if (duplicate.type === 'roof' || duplicate.type === 'roof-segment') {
          // Add small offset to make it visible
          if ('position' in duplicate) {
            duplicate.position = [
              duplicate.position[0] + 1,
              duplicate.position[1],
              duplicate.position[2] + 1,
            ]
          }
          useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)

          // Duplicate children for roof nodes
          if (node.type === 'roof' && node.children) {
            const nodesState = useScene.getState().nodes
            for (const childId of node.children) {
              const childNode = nodesState[childId]
              if (childNode && childNode.type === 'roof-segment') {
                let childDuplicateInfo = structuredClone(childNode) as any
                delete childDuplicateInfo.id
                childDuplicateInfo.metadata = { ...childDuplicateInfo.metadata, isNew: true }
                try {
                  const childDuplicate = RoofSegmentNode.parse(childDuplicateInfo)
                  useScene.getState().createNode(childDuplicate, duplicate.id as AnyNodeId)
                } catch (e) {
                  console.error('Failed to duplicate roof segment', e)
                }
              }
            }
          }
        }
        if (
          duplicate.type === 'item' ||
          duplicate.type === 'window' ||
          duplicate.type === 'door' ||
          duplicate.type === 'roof' ||
          duplicate.type === 'roof-segment'
        ) {
          setMovingNode(duplicate as any)
        }
        setSelection({ selectedIds: [] })
      }
    },
    [node, setMovingNode, setSelection],
  )

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      // Activate delete mode (sledgehammer tool) instead of deleting directly
      setSelection({ selectedIds: [] })
      setMode('delete')
    },
    [setSelection, setMode],
  )

  if (!(selectedId && node && isValidType && !isFloorplanHovered && mode !== 'delete')) return null

  return (
    <group ref={groupRef}>
      <Html
        center
        style={{
          pointerEvents: 'auto',
          touchAction: 'none',
        }}
        zIndexRange={[100, 0]}
      >
        <NodeActionMenu
          onDelete={handleDelete}
          onDuplicate={node && !DELETE_ONLY_TYPES.includes(node.type) ? handleDuplicate : undefined}
          onMove={node && !DELETE_ONLY_TYPES.includes(node.type) ? handleMove : undefined}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        />
      </Html>
    </group>
  )
}
