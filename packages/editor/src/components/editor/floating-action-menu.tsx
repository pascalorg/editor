'use client'
// Trigger re-index after core build

import {
  type AnyNode,
  type AnyNodeId,
  ArchwayNode,
  type CeilingNode,
  DoorNode,
  FenceNode,
  ItemNode,
  RoofNode,
  RoofSegmentNode,
  type SlabNode,
  StairNode,
  StairSegmentNode,
  sceneRegistry,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame, type ThreeElements } from '@react-three/fiber'
import { Move } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'
import { NodeActionMenu } from './node-action-menu'

const ALLOWED_TYPES = [
  'item',
  'door',
  'window',
  'archway',
  'roof',
  'roof-segment',
  'stair',
  'stair-segment',
  'wall',
  'fence',
  'slab',
  'ceiling',
]
const DELETE_ONLY_TYPES: string[] = []
const HOLE_TYPES = ['slab', 'ceiling']

export function FloatingActionMenu() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const updateNode = useScene((s) => s.updateNode)
  const mode = useEditor((s) => s.mode)
  const isFloorplanHovered = useEditor((s) => s.isFloorplanHovered)
  const movingWallEndpoint = useEditor((s) => s.movingWallEndpoint)
  const movingFenceEndpoint = useEditor((s) => s.movingFenceEndpoint)
  const curvingFence = useEditor((s) => s.curvingFence)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const setMovingWallEndpoint = useEditor((s) => s.setMovingWallEndpoint)
  const setMovingFenceEndpoint = useEditor((s) => s.setMovingFenceEndpoint)
  const setCurvingWall = useEditor((s) => s.setCurvingWall)
  const setCurvingFence = useEditor((s) => s.setCurvingFence)
  const setSelection = useViewer((s) => s.setSelection)
  const setEditingHole = useEditor((s) => s.setEditingHole)

  const groupRef = useRef<THREE.Group>(null)
  const startEndpointGroupRef = useRef<THREE.Group>(null)
  const endEndpointGroupRef = useRef<THREE.Group>(null)
  const [altPressed, setAltPressed] = useState(false)

  // Only show for single selection of specific types
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null

  // Subscribe just to the selected node so unrelated scene updates do not
  // re-render this menu.
  const node = useScene((s) => (selectedId ? (s.nodes[selectedId as AnyNodeId] ?? null) : null))
  const isValidType = node ? ALLOWED_TYPES.includes(node.type) : false

  // Boolean selector, only re-renders when curving availability actually flips.
  const canCurveSelectedWall = useScene((s) => {
    if (!selectedId) return false
    const selectedNode = s.nodes[selectedId as AnyNodeId]
    if (selectedNode?.type !== 'wall') return false
    return !(selectedNode.children ?? []).some((childId) => {
      const child = s.nodes[childId as AnyNodeId]
      if (!child) return false
      if (child.type === 'door' || child.type === 'window') return true
      if (child.type === 'item') {
        const attachTo = child.asset?.attachTo
        return attachTo === 'wall' || attachTo === 'wall-side'
      }
      return false
    })
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        setAltPressed(true)
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        setAltPressed(false)
      }
    }

    const handleBlur = () => {
      setAltPressed(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  useFrame(() => {
    if (!(selectedId && isValidType && groupRef.current)) return

    const obj = sceneRegistry.nodes.get(selectedId)
    if (obj) {
      // Calculate bounding box in world space
      const box = new THREE.Box3().setFromObject(obj)
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3())
        // Position above the object, with extra offset for walls/slabs to avoid covering measurement labels
        const isStructural = node && [...DELETE_ONLY_TYPES, ...HOLE_TYPES].includes(node.type)
        const yOffset = isStructural ? 0.8 : 0.3
        groupRef.current.position.set(center.x, box.max.y + yOffset, center.z)
      }

      if (node?.type === 'wall' || node?.type === 'fence') {
        const segment = node as WallNode | FenceNode
        const endpointYOffset = 0.35
        const startWorld =
          node.type === 'wall'
            ? obj.localToWorld(new THREE.Vector3(0, 0, 0))
            : obj.localToWorld(new THREE.Vector3(segment.start[0], 0, segment.start[1]))
        const endWorld =
          node.type === 'wall'
            ? obj.localToWorld(
                new THREE.Vector3(
                  Math.hypot(
                    segment.end[0] - segment.start[0],
                    segment.end[1] - segment.start[1],
                  ),
                  0,
                  0,
                ),
              )
            : obj.localToWorld(new THREE.Vector3(segment.end[0], 0, segment.end[1]))

        if (startEndpointGroupRef.current) {
          startEndpointGroupRef.current.position.set(
            startWorld.x,
            startWorld.y + endpointYOffset,
            startWorld.z,
          )
        }
        if (endEndpointGroupRef.current) {
          endEndpointGroupRef.current.position.set(
            endWorld.x,
            endWorld.y + endpointYOffset,
            endWorld.z,
          )
        }
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
        node.type === 'archway' ||
        node.type === 'door' ||
        node.type === 'wall' ||
        node.type === 'fence' ||
        node.type === 'slab' ||
        node.type === 'ceiling' ||
        node.type === 'roof' ||
        node.type === 'roof-segment' ||
        node.type === 'stair' ||
        node.type === 'stair-segment'
      ) {
        setMovingNode(node as any)
      }
      setSelection({ selectedIds: [] })
    },
    [node, setMovingNode, setSelection],
  )
  const handleCurve = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!node) return
      sfxEmitter.emit('sfx:item-pick')
      if (node.type === 'wall') {
        if (!canCurveSelectedWall) return
        setCurvingWall(node)
      } else if (node.type === 'fence') {
        setCurvingFence(node)
      } else {
        return
      }
      setSelection({ selectedIds: [] })
    },
    [canCurveSelectedWall, node, setCurvingFence, setCurvingWall, setSelection],
  )
  const handleEndpointMove = useCallback(
    (endpoint: 'start' | 'end', e: React.MouseEvent) => {
      e.stopPropagation()
      if (!node) return
      sfxEmitter.emit('sfx:item-pick')
      if (node.type === 'wall') {
        setMovingWallEndpoint({ wall: node, endpoint })
      } else if (node.type === 'fence') {
        setMovingFenceEndpoint({ fence: node, endpoint })
      } else {
        return
      }
      setSelection({ selectedIds: [] })
    },
    [node, setMovingFenceEndpoint, setMovingWallEndpoint, setSelection],
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
        } else if (node.type === 'archway') {
          duplicate = ArchwayNode.parse(duplicateInfo)
        } else if (node.type === 'window') {
          duplicate = WindowNode.parse(duplicateInfo)
        } else if (node.type === 'item') {
          duplicate = ItemNode.parse(duplicateInfo)
        } else if (node.type === 'wall') {
          duplicate = WallNode.parse(duplicateInfo)
        } else if (node.type === 'fence') {
          duplicate = FenceNode.parse(duplicateInfo)
          duplicate.start = [duplicate.start[0] + 1, duplicate.start[1] + 1]
          duplicate.end = [duplicate.end[0] + 1, duplicate.end[1] + 1]
        } else if (node.type === 'roof') {
          duplicateInfo.children = []
          duplicate = RoofNode.parse(duplicateInfo)
        } else if (node.type === 'roof-segment') {
          duplicate = RoofSegmentNode.parse(duplicateInfo)
        } else if (node.type === 'stair') {
          duplicateInfo.children = []
          duplicateInfo.metadata = { ...duplicateInfo.metadata }
          delete duplicateInfo.metadata?.isNew
          duplicate = StairNode.parse(duplicateInfo)
        } else if (node.type === 'stair-segment') {
          duplicate = StairSegmentNode.parse(duplicateInfo)
        }
      } catch (error) {
        console.error('Failed to parse duplicate', error)
        useScene.temporal.getState().resume()
        return
      }

      if (!duplicate) {
        useScene.temporal.getState().resume()
        return
      }

      if (duplicate) {
        if (duplicate.type === 'door' || duplicate.type === 'window') {
          useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
        } else if (duplicate.type === 'wall') {
          useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
        } else if (duplicate.type === 'fence') {
          useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
        } else if (
          duplicate.type === 'roof' ||
          duplicate.type === 'roof-segment' ||
          duplicate.type === 'stair' ||
          duplicate.type === 'stair-segment'
        ) {
          // Add small offset to make it visible
          if ('position' in duplicate) {
            duplicate.position = [
              duplicate.position[0] + 1,
              duplicate.position[1],
              duplicate.position[2] + 1,
            ]
          }
          if (node.type === 'stair' && duplicate.type === 'stair') {
            const nodesState = useScene.getState().nodes
            const createOps: { node: AnyNode; parentId?: AnyNodeId }[] = [
              { node: duplicate, parentId: duplicate.parentId as AnyNodeId },
            ]

            for (const childId of node.children ?? []) {
              const childNode = nodesState[childId]
              if (childNode?.type !== 'stair-segment') {
                continue
              }

              let childDuplicateInfo = structuredClone(childNode) as any
              delete childDuplicateInfo.id
              childDuplicateInfo.metadata = { ...childDuplicateInfo.metadata }
              delete childDuplicateInfo.metadata?.isNew

              try {
                const childDuplicate = StairSegmentNode.parse(childDuplicateInfo)
                createOps.push({ node: childDuplicate, parentId: duplicate.id as AnyNodeId })
              } catch (e) {
                console.error('Failed to duplicate stair segment', e)
              }
            }

            useScene.getState().createNodes(createOps)
          } else {
            useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
          }

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

          // Duplicate children for stair nodes
        }
        if (
          duplicate.type === 'item' ||
          duplicate.type === 'wall' ||
          duplicate.type === 'fence' ||
          duplicate.type === 'window' ||
          duplicate.type === 'archway' ||
          duplicate.type === 'door' ||
          duplicate.type === 'roof' ||
          duplicate.type === 'roof-segment' ||
          duplicate.type === 'stair-segment'
        ) {
          setMovingNode(duplicate as any)
        } else if (duplicate.type === 'stair') {
          setSelection({ selectedIds: [duplicate.id as AnyNodeId] })
        }
        if (duplicate.type !== 'stair') {
          setSelection({ selectedIds: [] })
        }
      }
    },
    [node, setMovingNode, setSelection],
  )

  const handleAddHole = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!(node && selectedId && (node.type === 'slab' || node.type === 'ceiling'))) return

      const polygon = (node as SlabNode | CeilingNode).polygon
      let cx = 0
      let cz = 0
      for (const [x, z] of polygon) {
        cx += x
        cz += z
      }
      cx /= polygon.length
      cz /= polygon.length

      const holeSize = 0.5
      const newHole: Array<[number, number]> = [
        [cx - holeSize, cz - holeSize],
        [cx + holeSize, cz - holeSize],
        [cx + holeSize, cz + holeSize],
        [cx - holeSize, cz + holeSize],
      ]
      const surfaceNode = node as SlabNode | CeilingNode
      const currentHoles = surfaceNode.holes || []
      const currentMetadata = currentHoles.map(
        (_, index) => surfaceNode.holeMetadata?.[index] ?? { source: 'manual' as const },
      )
      updateNode(selectedId as AnyNodeId, {
        holes: [...currentHoles, newHole],
        holeMetadata: [...currentMetadata, { source: 'manual' }],
      })
      setEditingHole({ nodeId: selectedId, holeIndex: currentHoles.length })
      // Re-assert selection so the node stays selected
      setSelection({ selectedIds: [selectedId] })
    },
    [node, selectedId, updateNode, setEditingHole, setSelection],
  )

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!selectedId) return
      if (node?.type === 'item') {
        sfxEmitter.emit('sfx:item-delete')
      } else {
        sfxEmitter.emit('sfx:structure-delete')
      }
      setSelection({ selectedIds: [] })
      useScene.getState().deleteNode(selectedId as AnyNodeId)
    },
    [node?.type, selectedId, setSelection],
  )

  if (
    !(selectedId && node && isValidType && !isFloorplanHovered && mode !== 'delete') ||
    movingWallEndpoint ||
    movingFenceEndpoint ||
    curvingFence
  )
    return null

  return (
    <group>
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
            onAddHole={node && HOLE_TYPES.includes(node.type) ? handleAddHole : undefined}
            onCurve={
              node?.type === 'fence' || (node?.type === 'wall' && canCurveSelectedWall)
                ? handleCurve
                : undefined
            }
            onDelete={handleDelete}
            onDuplicate={
              node && !DELETE_ONLY_TYPES.includes(node.type) && !HOLE_TYPES.includes(node.type)
                ? handleDuplicate
                : undefined
            }
            onMove={node && !DELETE_ONLY_TYPES.includes(node.type) ? handleMove : undefined}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
          />
        </Html>
      </group>
      {(node?.type === 'wall' || node?.type === 'fence') && (
        <>
          <group ref={startEndpointGroupRef}>
            <Html
              center
              style={{ pointerEvents: 'auto', touchAction: 'none' }}
              zIndexRange={[100, 0]}
            >
              <button
                aria-label={node.type === 'wall' ? 'Move wall start' : 'Move fence start'}
                className={`pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border bg-background/95 shadow-lg backdrop-blur-md transition-colors ${
                  altPressed
                    ? 'border-amber-500/80 bg-amber-500/15 text-amber-100 hover:bg-amber-500/20 hover:text-white'
                    : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
                onClick={(e) => handleEndpointMove('start', e)}
                onPointerDown={(e) => e.stopPropagation()}
                title={
                  node.type === 'wall'
                    ? 'Move wall start (Alt to detach)'
                    : 'Move fence start (Alt to detach)'
                }
                type="button"
              >
                <Move className="h-4 w-4" />
              </button>
            </Html>
          </group>
          <group ref={endEndpointGroupRef}>
            <Html
              center
              style={{ pointerEvents: 'auto', touchAction: 'none' }}
              zIndexRange={[100, 0]}
            >
              <button
                aria-label={node.type === 'wall' ? 'Move wall end' : 'Move fence end'}
                className={`pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border bg-background/95 shadow-lg backdrop-blur-md transition-colors ${
                  altPressed
                    ? 'border-amber-500/80 bg-amber-500/15 text-amber-100 hover:bg-amber-500/20 hover:text-white'
                    : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
                onClick={(e) => handleEndpointMove('end', e)}
                onPointerDown={(e) => e.stopPropagation()}
                title={
                  node.type === 'wall'
                    ? 'Move wall end (Alt to detach)'
                    : 'Move fence end (Alt to detach)'
                }
                type="button"
              >
                <Move className="h-4 w-4" />
              </button>
            </Html>
          </group>
        </>
      )}
    </group>
  )
}
