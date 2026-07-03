'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type CableTrayNode,
  type CeilingNode,
  ColumnNode,
  type ConveyorBeltNode,
  DoorNode,
  ElevatorNode,
  FenceNode,
  generateId,
  getConveyorPortPoint,
  getPipeEndpoint3D,
  ItemNode,
  isPipeNearlyVertical,
  isRegistrySelectable,
  nodeRegistry,
  PipeNode,
  type RoadNode,
  RoofSegmentNode,
  type SlabNode,
  SpawnNode,
  StairNode,
  StairSegmentNode,
  type SteelBeamNode,
  sceneRegistry,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import useViewer from '@pascal-app/viewer/store'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
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
import { ACTION_MENU_DISTANCE_FACTOR, getActionMenuAnchor } from './action-menu-placement'
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
  'conveyor-belt',
  'cable-tray',
  'road',
  'steel-beam',
  'column',
  'slab',
  'ceiling',
  'spawn',
]
const DELETE_ONLY_TYPES: string[] = []
const HOLE_TYPES = ['slab', 'ceiling']
const ENDPOINT_BUTTON_BASE_CLASS =
  'pointer-events-auto flex h-6 w-6 items-center justify-center rounded-full border bg-background/95 shadow-lg backdrop-blur-md transition-colors'
const ENDPOINT_BUTTON_WALL_CLASS =
  'border-violet-400/60 bg-violet-500/10 text-violet-400 hover:border-violet-300/80 hover:bg-violet-500/20 hover:text-violet-200'
const ENDPOINT_BUTTON_DETACH_CLASS =
  'border-amber-500/80 bg-amber-500/15 text-amber-100 hover:bg-amber-500/20 hover:text-white'

function getEndpointMoveLabel(
  nodeType: string,
  endpoint: 'start' | 'end',
  detachHint: boolean,
): string {
  const isStart = endpoint === 'start'
  switch (nodeType) {
    case 'wall':
      return detachHint
        ? t(
            isStart ? 'actionMenu.moveWallStartDetach' : 'actionMenu.moveWallEndDetach',
            isStart ? 'Move wall start (Alt to detach)' : 'Move wall end (Alt to detach)',
          )
        : t(
            isStart ? 'actionMenu.moveWallStart' : 'actionMenu.moveWallEnd',
            isStart ? 'Move wall start' : 'Move wall end',
          )
    case 'fence':
      return detachHint
        ? t(
            isStart ? 'actionMenu.moveFenceStartDetach' : 'actionMenu.moveFenceEndDetach',
            isStart ? 'Move fence start (Alt to detach)' : 'Move fence end (Alt to detach)',
          )
        : t(
            isStart ? 'actionMenu.moveFenceStart' : 'actionMenu.moveFenceEnd',
            isStart ? 'Move fence start' : 'Move fence end',
          )
    case 'pipe':
      return detachHint
        ? t(
            isStart ? 'actionMenu.movePipeStartDetach' : 'actionMenu.movePipeEndDetach',
            isStart ? 'Move pipe start (Alt to detach)' : 'Move pipe end (Alt to detach)',
          )
        : t(
            isStart ? 'actionMenu.movePipeStart' : 'actionMenu.movePipeEnd',
            isStart ? 'Move pipe start' : 'Move pipe end',
          )
    case 'road':
      return t(
        isStart ? 'actionMenu.moveRoadStart' : 'actionMenu.moveRoadEnd',
        isStart ? 'Move road start' : 'Move road end',
      )
    case 'cable-tray':
      return t(
        isStart ? 'actionMenu.moveCableTrayStart' : 'actionMenu.moveCableTrayEnd',
        isStart ? 'Move cable tray start' : 'Move cable tray end',
      )
    case 'steel-beam':
      return t(
        isStart ? 'actionMenu.moveSteelBeamStart' : 'actionMenu.moveSteelBeamEnd',
        isStart ? 'Move steel beam start' : 'Move steel beam end',
      )
    default:
      return isStart ? 'Move start' : 'Move end'
  }
}

export function FloatingActionMenu() {
  const { camera } = useThree()
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const updateNode = useScene((s) => s.updateNode)
  const mode = useEditor((s) => s.mode)
  const isFloorplanHovered = useEditor((s) => s.isFloorplanHovered)
  const movingNode = useEditor((s) => s.movingNode)
  const movingWallEndpoint = useEditor((s) => s.movingWallEndpoint)
  const movingFenceEndpoint = useEditor((s) => s.movingFenceEndpoint)
  const movingPipeEndpoint = useEditor((s) => s.movingPipeEndpoint)
  const movingCableTrayEndpoint = useEditor((s) => s.movingCableTrayEndpoint)
  const movingConveyorBeltEndpoint = useEditor((s) => s.movingConveyorBeltEndpoint)
  const movingRoadEndpoint = useEditor((s) => s.movingRoadEndpoint)
  const movingSteelBeamEndpoint = useEditor((s) => s.movingSteelBeamEndpoint)
  const curvingFence = useEditor((s) => s.curvingFence)
  const curvingPipe = useEditor((s) => s.curvingPipe)
  const curvingCableTray = useEditor((s) => s.curvingCableTray)
  const curvingRoad = useEditor((s) => s.curvingRoad)
  const curvingSteelBeam = useEditor((s) => s.curvingSteelBeam)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const setMovingWallEndpoint = useEditor((s) => s.setMovingWallEndpoint)
  const setMovingFenceEndpoint = useEditor((s) => s.setMovingFenceEndpoint)
  const setMovingPipeEndpoint = useEditor((s) => s.setMovingPipeEndpoint)
  const setMovingCableTrayEndpoint = useEditor((s) => s.setMovingCableTrayEndpoint)
  const setMovingConveyorBeltEndpoint = useEditor((s) => s.setMovingConveyorBeltEndpoint)
  const setMovingRoadEndpoint = useEditor((s) => s.setMovingRoadEndpoint)
  const setMovingSteelBeamEndpoint = useEditor((s) => s.setMovingSteelBeamEndpoint)
  const setCurvingWall = useEditor((s) => s.setCurvingWall)
  const setCurvingFence = useEditor((s) => s.setCurvingFence)
  const setCurvingPipe = useEditor((s) => s.setCurvingPipe)
  const setCurvingCableTray = useEditor((s) => s.setCurvingCableTray)
  const setCurvingRoad = useEditor((s) => s.setCurvingRoad)
  const setCurvingSteelBeam = useEditor((s) => s.setCurvingSteelBeam)
  const setSelection = useViewer((s) => s.setSelection)
  const setEditingHole = useEditor((s) => s.setEditingHole)

  const startEndpointGroupRef = useRef<THREE.Group>(null)
  const endEndpointGroupRef = useRef<THREE.Group>(null)
  const menuGroupRef = useRef<THREE.Group>(null)
  const boxRef = useRef(new THREE.Box3())
  const sizeRef = useRef(new THREE.Vector3())
  const menuAnchorRef = useRef(new THREE.Vector3())
  const projectedAnchorRef = useRef(new THREE.Vector3())
  const [altPressed, setAltPressed] = useState(false)
  const [menuVisible, setMenuVisible] = useState(false)

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
  const canDetachEndpoint = node?.type === 'wall' || node?.type === 'fence' || node?.type === 'pipe'
  const endpointButtonClass = `${ENDPOINT_BUTTON_BASE_CLASS} ${
    altPressed && canDetachEndpoint ? ENDPOINT_BUTTON_DETACH_CLASS : ENDPOINT_BUTTON_WALL_CLASS
  }`

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
    if (!(selectedId && isValidType)) {
      if (menuVisible) setMenuVisible(false)
      return
    }

    const obj = sceneRegistry.nodes.get(selectedId)
    if (obj) {
      obj.updateWorldMatrix(true, false)

      const box = boxRef.current.setFromObject(obj)
      if (!box.isEmpty() && node) {
        const anchor = getActionMenuAnchor(node, box, menuAnchorRef.current, sizeRef.current)
        menuGroupRef.current?.position.copy(anchor)
        const projected = projectedAnchorRef.current.copy(anchor).project(camera)
        const nextVisible = projected.z >= -1 && projected.z <= 1
        if (menuVisible !== nextVisible) setMenuVisible(nextVisible)
      } else if (menuVisible) {
        setMenuVisible(false)
      }

      if (
        node?.type === 'wall' ||
        node?.type === 'fence' ||
        node?.type === 'pipe' ||
        node?.type === 'conveyor-belt' ||
        node?.type === 'cable-tray' ||
        node?.type === 'road' ||
        node?.type === 'steel-beam'
      ) {
        const segment = node as
          | WallNode
          | FenceNode
          | PipeNode
          | CableTrayNode
          | RoadNode
          | SteelBeamNode
        const endpointYOffset = 0.35
        const startWorld =
          node.type === 'wall'
            ? obj.localToWorld(new THREE.Vector3(0, 0, 0))
            : node.type === 'pipe'
              ? (() => {
                  const point = getPipeEndpoint3D(node as PipeNode, 'start')
                  return obj.localToWorld(new THREE.Vector3(point.x, 0, point.z))
                })()
              : node.type === 'conveyor-belt'
                ? (() => {
                    const point = getConveyorPortPoint(node as ConveyorBeltNode, 'in') ??
                      (node as ConveyorBeltNode).points[0] ?? [0, 0, 0]
                    return obj.localToWorld(new THREE.Vector3(point[0], 0, point[2]))
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
              : node.type === 'conveyor-belt'
                ? (() => {
                    const conveyor = node as ConveyorBeltNode
                    const point = getConveyorPortPoint(conveyor, 'out') ??
                      conveyor.points[conveyor.points.length - 1] ?? [0, 0, 0]
                    return obj.localToWorld(new THREE.Vector3(point[0], 0, point[2]))
                  })()
                : obj.localToWorld(new THREE.Vector3(segment.end[0], 0, segment.end[1]))
        const startY =
          node.type === 'pipe'
            ? getPipeEndpoint3D(node as PipeNode, 'start').y + endpointYOffset
            : node.type === 'conveyor-belt'
              ? ((node as ConveyorBeltNode).elevation ?? 0) + endpointYOffset
              : node.type === 'cable-tray' || node.type === 'steel-beam'
                ? ((node as CableTrayNode | SteelBeamNode).elevation ?? 0) + endpointYOffset
                : startWorld.y + endpointYOffset
        const endY =
          node.type === 'pipe'
            ? getPipeEndpoint3D(node as PipeNode, 'end').y + endpointYOffset
            : node.type === 'conveyor-belt'
              ? ((node as ConveyorBeltNode).elevation ?? 0) + endpointYOffset
              : node.type === 'cable-tray' || node.type === 'steel-beam'
                ? ((node as CableTrayNode | SteelBeamNode).elevation ?? 0) + endpointYOffset
                : endWorld.y + endpointYOffset

        if (startEndpointGroupRef.current) {
          startEndpointGroupRef.current.position.set(startWorld.x, startY, startWorld.z)
        }
        if (endEndpointGroupRef.current) {
          endEndpointGroupRef.current.position.set(endWorld.x, endY, endWorld.z)
        }
      }
    } else if (menuVisible) {
      setMenuVisible(false)
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
      } else if (node.type === 'cable-tray') {
        setCurvingCableTray(node)
      } else if (node.type === 'road') {
        setCurvingRoad(node)
      } else if (node.type === 'steel-beam') {
        setCurvingSteelBeam(node)
      } else {
        return
      }
      setSelection({ selectedIds: [] })
    },
    [
      canCurveSelectedWall,
      node,
      setCurvingCableTray,
      setCurvingFence,
      setCurvingPipe,
      setCurvingRoad,
      setCurvingSteelBeam,
      setCurvingWall,
      setSelection,
    ],
  )
  const handleEndpointMove = useCallback(
    (endpoint: 'start' | 'end', e: React.MouseEvent | React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!node) return
      sfxEmitter.emit('sfx:item-pick')
      if (node.type === 'wall') {
        setMovingWallEndpoint({ wall: node, endpoint })
      } else if (node.type === 'fence') {
        setMovingFenceEndpoint({ fence: node, endpoint })
      } else if (node.type === 'pipe') {
        setMovingPipeEndpoint({ pipe: node, endpoint })
      } else if (node.type === 'cable-tray') {
        setMovingCableTrayEndpoint({ cableTray: node, endpoint })
      } else if (node.type === 'conveyor-belt') {
        setMovingConveyorBeltEndpoint({ conveyorBelt: node, endpoint })
      } else if (node.type === 'road') {
        setMovingRoadEndpoint({ road: node, endpoint })
      } else if (node.type === 'steel-beam') {
        setMovingSteelBeamEndpoint({ steelBeam: node, endpoint })
      } else {
        return
      }
      setSelection({ selectedIds: [] })
    },
    [
      node,
      setMovingCableTrayEndpoint,
      setMovingConveyorBeltEndpoint,
      setMovingFenceEndpoint,
      setMovingPipeEndpoint,
      setMovingRoadEndpoint,
      setMovingSteelBeamEndpoint,
      setMovingWallEndpoint,
      setSelection,
    ],
  )

  const handleEndpointPointerDown = useCallback(
    (endpoint: 'start' | 'end', e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return
      handleEndpointMove(endpoint, e)
    },
    [handleEndpointMove],
  )

  const handleEndpointClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

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
    movingCableTrayEndpoint ||
    movingConveyorBeltEndpoint ||
    movingRoadEndpoint ||
    movingSteelBeamEndpoint ||
    curvingFence ||
    curvingPipe ||
    curvingCableTray ||
    curvingRoad ||
    curvingSteelBeam
  )
    return null

  return (
    <group>
      <group ref={menuGroupRef} visible={menuVisible}>
        <Html
          center
          distanceFactor={ACTION_MENU_DISTANCE_FACTOR}
          style={{ pointerEvents: 'auto', touchAction: 'none' }}
          zIndexRange={[100, 0]}
        >
          <NodeActionMenu
            onAddHole={node && HOLE_TYPES.includes(node.type) ? handleAddHole : undefined}
            onCurve={
              node?.type === 'fence' ||
              node?.type === 'cable-tray' ||
              node?.type === 'road' ||
              node?.type === 'steel-beam' ||
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
      {(node?.type === 'wall' ||
        node?.type === 'fence' ||
        node?.type === 'pipe' ||
        node?.type === 'conveyor-belt' ||
        node?.type === 'cable-tray' ||
        node?.type === 'road' ||
        node?.type === 'steel-beam') && (
        <>
          <group ref={startEndpointGroupRef}>
            <Html
              center
              distanceFactor={ACTION_MENU_DISTANCE_FACTOR}
              style={{ pointerEvents: 'auto', touchAction: 'none' }}
              zIndexRange={[100, 0]}
            >
              <button
                aria-label={getEndpointMoveLabel(node.type, 'start', false)}
                className={endpointButtonClass}
                onClick={handleEndpointClick}
                onPointerDown={(e) => handleEndpointPointerDown('start', e)}
                title={getEndpointMoveLabel(node.type, 'start', true)}
                type="button"
              >
                <Move className="h-3 w-3" />
              </button>
            </Html>
          </group>
          <group ref={endEndpointGroupRef}>
            <Html
              center
              distanceFactor={ACTION_MENU_DISTANCE_FACTOR}
              style={{ pointerEvents: 'auto', touchAction: 'none' }}
              zIndexRange={[100, 0]}
            >
              <button
                aria-label={getEndpointMoveLabel(node.type, 'end', false)}
                className={endpointButtonClass}
                onClick={handleEndpointClick}
                onPointerDown={(e) => handleEndpointPointerDown('end', e)}
                title={getEndpointMoveLabel(node.type, 'end', true)}
                type="button"
              >
                <Move className="h-3 w-3" />
              </button>
            </Html>
          </group>
        </>
      )}
    </group>
  )
}
