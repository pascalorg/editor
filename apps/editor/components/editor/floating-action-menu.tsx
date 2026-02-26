'use client'

import { type AnyNode, type AnyNodeId, ItemNode, WindowNode, DoorNode, sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Copy, Move, Trash2 } from 'lucide-react'
import { useCallback, useRef } from 'react'
import * as THREE from 'three'
import { sfxEmitter } from '@/lib/sfx-bus'
import useEditor from '@/store/use-editor'

const ALLOWED_TYPES = ['item', 'door', 'window']

export function FloatingActionMenu() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const nodes = useScene((s) => s.nodes)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const setSelection = useViewer((s) => s.setSelection)
  const isEditor = useViewer((state) => state.isEditor)

  const groupRef = useRef<THREE.Group>(null)

  // Only show for single selection of specific types
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const node = selectedId ? nodes[selectedId as AnyNodeId] : null
  const isValidType = node ? ALLOWED_TYPES.includes(node.type) : false

  useFrame(() => {
    if (!selectedId || !isValidType || !groupRef.current) return

    const obj = sceneRegistry.nodes.get(selectedId)
    if (obj) {
      // Calculate bounding box in world space
      const box = new THREE.Box3().setFromObject(obj)
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3())
        // Position slightly above the object
        groupRef.current.position.set(center.x, box.max.y + 0.3, center.z)
      }
    }
  })

  const handleMove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!node) return
    sfxEmitter.emit('sfx:item-pick')
    if (node.type === 'item' || node.type === 'window' || node.type === 'door') {
      setMovingNode(node as any)
    }
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  const handleDuplicate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!node || !node.parentId) return
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
      }
    } catch (error) {
      console.error('Failed to parse duplicate', error)
      return
    }
    
    if (duplicate) {
      if (duplicate.type === 'door' || duplicate.type === 'window') {
        useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
      }
      if (duplicate.type === 'item' || duplicate.type === 'window' || duplicate.type === 'door') {
        setMovingNode(duplicate as any)
      }
      setSelection({ selectedIds: [] })
    }
  }, [node, setMovingNode, setSelection])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!selectedId || !node) return
    sfxEmitter.emit('sfx:item-delete')
    deleteNode(selectedId as AnyNodeId)
    if (node.parentId) useScene.getState().dirtyNodes.add(node.parentId as AnyNodeId)
    setSelection({ selectedIds: [] })
  }, [selectedId, node, deleteNode, setSelection])

  if (!isEditor || !selectedId || !node || !isValidType) return null

  return (
    <group ref={groupRef}>
      <Html
        center
        zIndexRange={[100, 0]}
        style={{
          pointerEvents: 'auto',
          touchAction: 'none'
        }}
      >
        <div 
          className="flex items-center gap-1 p-1 rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur-md"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleMove}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors tooltip-trigger"
            title="Move"
          >
            <Move className="w-4 h-4" />
          </button>
          <button
            onClick={handleDuplicate}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors tooltip-trigger"
            title="Duplicate"
          >
            <Copy className="w-4 h-4" />
          </button>
          <button
            onClick={handleDelete}
            className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors tooltip-trigger"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </Html>
    </group>
  )
}
