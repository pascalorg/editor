'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  ColumnNode,
  DoorNode,
  ElevatorNode,
  FenceNode,
  generateId,
  getPipeEndpoint3D,
  ItemNode,
  isPipeNearlyVertical,
  isRegistrySelectable,
  nodeRegistry,
  PipeNode,
  RoofSegmentNode,
  type SlabNode,
  SpawnNode,
  StairNode,
  StairSegmentNode,
  sceneRegistry,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Move } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { t } from '../../i18n'
import { isPlanDragMovableNode } from '../../lib/plan-drag'
import { duplicateRoofSubtree } from '../../lib/roof-duplication'
import { sfxEmitter } from '../../lib/sfx-bus'
import { duplicateStairSubtree } from '../../lib/stair-duplication'
import { duplicateNodeSubtree } from '../../lib/subtree-duplication'
import useEditor from '../../store/use-editor'
import { NodeActionMenu } from './node-action-menu'

const ALLOWED_TYPES = [
  'item',
  'door',
  'window',
  'elevator',
  'roof',
  'roof-segment',
  'stair',
  'stair-segment',
  'wall',
  'fence',
  'pipe',
  'column',
  'slab',
  'ceiling',
  'spawn',
]
const DELETE_ONLY_TYPES: string[] = []
const HOLE_TYPES = ['slab', 'ceiling']

export function FloatingActionMenu() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const updateNode = useScene((s) => s.updateNode)
  const mode = useEditor((s) => s.mode)
  const isFloorplanHovered = useEditor((s) => s.isFloorplanHovered)
  const movingNode = useEditor((s) => s.movingNode)
  const movingWallEndpoint = useEditor((s) => s.movingWallEndpoint)
  const movingFenceEndpoint = useEditor((s) => s.movingFenceEndpoint)
  const movingPipeEndpoint = useEditor((s) => s.movingPipeEndpoint)
  const curvingFence = useEditor((s) => s.curvingFence)
  const curvingPipe = useEditor((s) => s.curvingPipe)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const setMovingWallEndpoint = useEditor((s) => s.setMovingWallEndpoint)
  const setMovingFenceEndpoint = useEditor((s) => s.setMovingFenceEndpoint)
  const setMovingPipeEndpoint = useEditor((s) => s.setMovingPipeEndpoint)
  const setCurvingWall = useEditor((s) => s.setCurvingWall)
  const setCurvingFence = useEditor((s) => s.setCurvingFence)
  const setCurvingPipe = useEditor((s) => s.setCurvingPipe)
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
  // ALLOWED_TYPES is the hardcoded set; registry-driven kinds (any
  // NodeDefinition with `capabilities.selectable`) get the floating menu
  // by default too. Phase 4 collapses these into a single registry check.
  const isValidType = node
    ? ALLOWED_TYPES.includes(node.type) || isRegistrySelectable(node.type)
    : false
  const isDirectPlanDraggable = node ? isPlanDragMovableNode(node) : false

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

      if (node?.type === 'wall' || node?.type === 'fence' || node?.type === 'pipe') {
        const segment = node as WallNode | FenceNode | PipeNode
        const endpointYOffset = node.type === 'pipe' ? 0.35 : 0.35
        const startWorld =
          node.type === 'wall'
            ? obj.localToWorld(new THREE.Vector3(0, 0, 0))
            : node.type === 'pipe'
              ? (() => {
                  const point = getPipeEndpoint3D(node as PipeNode, 'start')
                  return obj.localToWorld(new THREE.Vector3(point.x, 0, point.z))
                })()
              : obj.localToWorld(new THREE.Vector3(segment.start[0], 0, segment.start[1]))
        const endWorld =
          node.type === 'wall'
            ? obj.localToWorld(
                new THREE.Vector3(
                  Math.hypot(segment.end[0] - segment.start[0], segment.end[1] - segment.start[1]),
                  0,
                  0,
                ),
              )
            : node.type === 'pipe'
              ? (() => {
                  const point = getPipeEndpoint3D(node as PipeNode, 'end')
                  return obj.localToWorld(new THREE.Vector3(point.x, 0, point.z))
                })()
              : obj.localToWorld(new THREE.Vector3(segment.end[0], 0, segment.end[1]))
        const startY =
          node.type === 'pipe'
            ? getPipeEndpoint3D(node as PipeNode, 'start').y + endpointYOffset
            : startWorld.y + endpointYOffset
        const endY =
          node.type === 'pipe'
            ? getPipeEndpoint3D(node as PipeNode, 'end').y + endpointYOffset
            : endWorld.y + endpointYOffset

        if (startEndpointGroupRef.current) {
          startEndpointGroupRef.current.position.set(startWorld.x, startY, startWorld.z)
        }
        if (endEndpointGroupRef.current) {
          endEndpointGroupRef.current.position.set(endWorld.x, endY, endWorld.z)
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
        node.type === 'door' ||
        node.type === 'elevator' ||
        node.type === 'wall' ||
        node.type === 'fence' ||
        node.type === 'pipe' ||
        node.type === 'column' ||
        node.type === 'slab' ||
        node.type === 'ceiling' ||
        node.type === 'spawn' ||
        node.type === 'roof' ||
        node.type === 'roof-segment' ||
        node.type === 'stair' ||
        node.type === 'stair-segment' ||
        // Registry-driven kinds default to movable; MoveTool dispatches them
        // to MoveRegistryNodeTool. Phase 4 reads `capabilities.movable` to
        // gate this instead of the unconditional OR.
        isRegistrySelectable(node.type)
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
      } else if (node.type === 'pipe' && !isPipeNearlyVertical(node)) {
        setCurvingPipe(node)
      } else {
        return
      }
      setSelection({ selectedIds: [] })
    },
    [canCurveSelectedWall, node, setCurvingFence, setCurvingPipe, setCurvingWall, setSelection],
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
      } else if (node.type === 'pipe') {
        setMovingPipeEndpoint({ pipe: node, endpoint })
      } else {
        return
      }
      setSelection({ selectedIds: [] })
    },
    [node, setMovingFenceEndpoint, setMovingPipeEndpoint, setMovingWallEndpoint, setSelection],
  )

  const handleDuplicate = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!node?.parentId) return
      sfxEmitter.emit('sfx:item-pick')

      if (node.type === 'roof') {
        try {
          duplicateRoofSubtree(node.id as AnyNodeId, { mode: 'move' })
        } catch (error) {
          console.error('Failed to duplicate roof', error)
        }
        return
      }

      if (
        node.type !== 'stair' &&
        'children' in node &&
        Array.isArray(node.children) &&
        node.children.length > 0
      ) {
        useScene.temporal.getState().pause()
        try {
          const { root } = duplicateNodeSubtree(node.id as AnyNodeId, { markRootNew: true })
          setMovingNode(root as any)
          setSelection({ selectedIds: [] })
        } catch (error) {
          console.error('Failed to duplicate subtree', error)
        } finally {
          useScene.temporal.getState().resume()
        }
        return
      }

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
        } else if (node.type === 'elevator') {
          duplicate = ElevatorNode.parse(duplicateInfo)
        } else if (node.type === 'column') {
          duplicate = ColumnNode.parse(duplicateInfo)
        } else if (node.type === 'wall') {
          duplicate = WallNode.parse(duplicateInfo)
        } else if (node.type === 'fence') {
          duplicate = FenceNode.parse(duplicateInfo)
          duplicate.start = [duplicate.start[0] + 1, duplicate.start[1] + 1]
          duplicate.end = [duplicate.end[0] + 1, duplicate.end[1] + 1]
        } else if (node.type === 'pipe') {
          duplicate = PipeNode.parse(duplicateInfo)
          duplicate.start = [duplicate.start[0] + 1, duplicate.start[1] + 1]
          duplicate.end = [duplicate.end[0] + 1, duplicate.end[1] + 1]
        } else if (node.type === 'roof-segment') {
          duplicateInfo.id = generateId('rseg')
          duplicate = RoofSegmentNode.parse(duplicateInfo)
        } else if (node.type === 'stair') {
          duplicateInfo.children = []
          duplicateInfo.metadata = { ...duplicateInfo.metadata }
          delete duplicateInfo.metadata?.isNew
          duplicate = StairNode.parse(duplicateInfo)
        } else if (node.type === 'stair-segment') {
          duplicate = StairSegmentNode.parse(duplicateInfo)
        } else if (node.type === 'spawn') {
          duplicate = SpawnNode.parse(duplicateInfo)
        }

        // Registry-driven fallback: any kind with a NodeDefinition can be
        // duplicated through its schema's parse(). Future built-in kinds
        // get duplicate for free.
        if (!duplicate) {
          const def = nodeRegistry.get(node.type)
          if (def) {
            duplicate = def.schema.parse(duplicateInfo) as AnyNode
          }
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
        if (
          duplicate.type === 'door' ||
          duplicate.type === 'window' ||
          duplicate.type === 'elevator'
        ) {
          useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
        } else if (duplicate.type === 'wall') {
          useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
        } else if (duplicate.type === 'fence') {
          useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
        } else if (duplicate.type === 'pipe') {
          useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
        } else if (
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
            duplicateStairSubtree(node.id as AnyNodeId, { mode: 'move' })
          } else {
            useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
          }

          // Duplicate children for stair nodes
        } else if (nodeRegistry.has(duplicate.type)) {
          // Registry-driven kinds: offset the position slightly so the
          // duplicate doesn't overlap exactly, then create + hand to the
          // move tool. Mirrors the roof-segment / stair-segment behavior.
          if ('position' in duplicate && Array.isArray((duplicate as any).position)) {
            const pos = (duplicate as { position: [number, number, number] }).position
            ;(duplicate as { position: [number, number, number] }).position = [
              pos[0] + 1,
              pos[1],
              pos[2] + 1,
            ]
          }
          useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
        }
        if (
          duplicate.type === 'item' ||
          duplicate.type === 'elevator' ||
          duplicate.type === 'column' ||
          duplicate.type === 'wall' ||
          duplicate.type === 'fence' ||
          duplicate.type === 'pipe' ||
          duplicate.type === 'window' ||
          duplicate.type === 'door' ||
          duplicate.type === 'roof-segment' ||
          duplicate.type === 'spawn' ||
          duplicate.type === 'stair-segment' ||
          nodeRegistry.has(duplicate.type)
        ) {
          setMovingNode(duplicate as any)
        } else if (duplicate.type === 'stair') {
          useScene.temporal.getState().resume()
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
    movingNode ||
    movingWallEndpoint ||
    movingFenceEndpoint ||
    movingPipeEndpoint ||
    curvingFence ||
    curvingPipe
  )
    return null

  // Items + stairs: no center Html menu (blocks mesh drag / showed move icon).
  if (node.type === 'item' || node.type === 'stair') {
    return null
  }

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
              node?.type === 'fence' ||
              (node?.type === 'pipe' && !isPipeNearlyVertical(node)) ||
              (node?.type === 'wall' && canCurveSelectedWall)
                ? handleCurve
                : undefined
            }
            onDelete={handleDelete}
            onDuplicate={
              node &&
              node.type !== 'spawn' &&
              !DELETE_ONLY_TYPES.includes(node.type) &&
              !HOLE_TYPES.includes(node.type)
                ? handleDuplicate
                : undefined
            }
            onMove={
              node &&
              !isDirectPlanDraggable &&
              node.type !== 'wall' &&
              node.type !== 'fence' &&
              node.type !== 'pipe' &&
              !DELETE_ONLY_TYPES.includes(node.type)
                ? handleMove
                : undefined
            }
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
          />
        </Html>
      </group>
      {(node?.type === 'wall' || node?.type === 'fence' || node?.type === 'pipe') && (
        <>
          <group ref={startEndpointGroupRef}>
            <Html
              center
              style={{ pointerEvents: 'auto', touchAction: 'none' }}
              zIndexRange={[100, 0]}
            >
              <button
                aria-label={
                  node.type === 'wall'
                    ? t('actionMenu.moveWallStart', 'Move wall start')
                    : node.type === 'pipe'
                      ? t('actionMenu.movePipeStart', 'Move pipe start')
                      : t('actionMenu.moveFenceStart', 'Move fence start')
                }
                className={`pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border bg-background/95 shadow-lg backdrop-blur-md transition-colors ${
                  altPressed
                    ? 'border-amber-500/80 bg-amber-500/15 text-amber-100 hover:bg-amber-500/20 hover:text-white'
                    : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
                onClick={(e) => handleEndpointMove('start', e)}
                onPointerDown={(e) => e.stopPropagation()}
                title={
                  node.type === 'wall'
                    ? t('actionMenu.moveWallStartDetach', 'Move wall start (Alt to detach)')
                    : node.type === 'pipe'
                      ? t('actionMenu.movePipeStartDetach', 'Move pipe start (Alt to detach)')
                      : t('actionMenu.moveFenceStartDetach', 'Move fence start (Alt to detach)')
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
                aria-label={
                  node.type === 'wall'
                    ? t('actionMenu.moveWallEnd', 'Move wall end')
                    : node.type === 'pipe'
                      ? t('actionMenu.movePipeEnd', 'Move pipe end')
                      : t('actionMenu.moveFenceEnd', 'Move fence end')
                }
                className={`pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border bg-background/95 shadow-lg backdrop-blur-md transition-colors ${
                  altPressed
                    ? 'border-amber-500/80 bg-amber-500/15 text-amber-100 hover:bg-amber-500/20 hover:text-white'
                    : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
                onClick={(e) => handleEndpointMove('end', e)}
                onPointerDown={(e) => e.stopPropagation()}
                title={
                  node.type === 'wall'
                    ? t('actionMenu.moveWallEndDetach', 'Move wall end (Alt to detach)')
                    : node.type === 'pipe'
                      ? t('actionMenu.movePipeEndDetach', 'Move pipe end (Alt to detach)')
                      : t('actionMenu.moveFenceEndDetach', 'Move fence end (Alt to detach)')
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
