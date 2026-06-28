'use client'

import {
  type CeilingNode,
  emitter,
  resolveLevelId,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, type ThreeEvent, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BoxGeometry, type Group, type Object3D, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { useShallow } from 'zustand/react/shallow'
import {
  clearCeilingSnapFeedback,
  resolveCeilingPlanPointSnap,
} from '../../../lib/ceiling-plan-snap'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import useInteractionScope, {
  useIsCurveReshape,
  useMovingNode,
} from '../../../store/use-interaction-scope'
import { snapToHalf } from '../../tools/item/placement-math'
import { suppressBoxSelectForPointer } from '../../tools/select/box-select-state'

const BRACKET_THICKNESS = 0.04
const BRACKET_HEIGHT = 0.04
const BRACKET_Y_OFFSET = 0.035
const HIT_BOX_SIZE: [number, number, number] = [0.28, 0.08, 0.28]
const HANDLE_COLOR = '#d4d4d4'
const HANDLE_HOVER_COLOR = '#818cf8'
const HANDLE_OPACITY = 0.72
const HANDLE_HOVER_OPACITY = 0.92
const HANDLE_DRAG_THRESHOLD_PX = 4
const SHARED_HANDLE_BOX_GEOMETRY = new BoxGeometry(1, 1, 1)
// Draw the corner handles after the ceiling surface so they read cleanly
// when unobstructed, while material depth testing still lets other scene
// geometry hide them.
const CORNER_RENDER_ORDER = 1000

type CornerBracketData = {
  corner: [number, number]
  index: number
  incomingEdgeIndex: number
  incomingDirection: [number, number]
  outgoingEdgeIndex: number
  outgoingDirection: [number, number]
  incomingLength: number
  outgoingLength: number
}

type CornerDragState = {
  ceilingId: CeilingNode['id']
  cornerIndex: number
  didDrag: boolean
  initialPolygon: Array<[number, number]>
  inputDraggingSet: boolean
  pointerId: number
  previewPolygon: Array<[number, number]> | null
  previousSnappedPosition: [number, number] | null
  previousInputDragging: boolean
  startClientX: number
  startClientY: number
  startPlanePosition: [number, number]
}

function stopHandlePointerDown(event: ThreeEvent<PointerEvent>) {
  event.stopPropagation()
  suppressBoxSelectForPointer(event, { markHandled: false })
}

function suppressNextClick() {
  const suppressClick = (clickEvent: MouseEvent) => {
    clickEvent.stopImmediatePropagation()
    clickEvent.preventDefault()
    window.removeEventListener('click', suppressClick, true)
  }
  window.addEventListener('click', suppressClick, true)
  requestAnimationFrame(() => {
    window.removeEventListener('click', suppressClick, true)
  })
}

function clearCornerDragPreview(drag: CornerDragState) {
  if (drag.didDrag) {
    useLiveNodeOverrides.getState().clear(drag.ceilingId)
    useScene.getState().markDirty(drag.ceilingId)
  }
  if (drag.inputDraggingSet) {
    useViewer.getState().setInputDragging(drag.previousInputDragging)
  }
  clearCeilingSnapFeedback()
}

export const CeilingSelectionAffordanceSystem = () => {
  const phase = useEditor((state) => state.phase)
  const mode = useEditor((state) => state.mode)
  const structureLayer = useEditor((state) => state.structureLayer)
  const movingNode = useMovingNode()
  const isCurveReshape = useIsCurveReshape()
  const currentLevelId = useViewer((state) => state.selection.levelId)

  const ceilings = useScene(
    useShallow((state) =>
      Object.values(state.nodes).filter((node): node is CeilingNode => {
        return (
          node.type === 'ceiling' &&
          node.visible !== false &&
          currentLevelId !== null &&
          resolveLevelId(node, state.nodes) === currentLevelId
        )
      }),
    ),
  )

  const shouldRender =
    phase === 'structure' &&
    mode === 'select' &&
    structureLayer === 'elements' &&
    !movingNode &&
    !isCurveReshape &&
    currentLevelId !== null

  if (!shouldRender) return null

  return (
    <>
      {ceilings.map((ceiling) => (
        <CeilingSelectionAffordance ceiling={ceiling} key={ceiling.id} levelId={currentLevelId} />
      ))}
    </>
  )
}

const CeilingSelectionAffordance = ({
  ceiling,
  levelId,
}: {
  ceiling: CeilingNode
  levelId: string
}) => {
  const { camera, gl } = useThree()
  const liveOverride = useLiveNodeOverrides(
    (state) => state.overrides.get(ceiling.id) as Partial<CeilingNode> | undefined,
  )
  const effectiveCeiling = useMemo(
    () => (liveOverride ? ({ ...ceiling, ...liveOverride } as CeilingNode) : ceiling),
    [ceiling, liveOverride],
  )
  const [levelObject, setLevelObject] = useState<Object3D | null>(
    () => sceneRegistry.nodes.get(levelId) ?? null,
  )
  const [hoveredCornerIndex, setHoveredCornerIndex] = useState<number | null>(null)
  const [draggedCornerIndex, setDraggedCornerIndex] = useState<number | null>(null)
  const [previewPolygon, setPreviewPolygon] = useState<Array<[number, number]> | null>(null)
  const dragRef = useRef<CornerDragState | null>(null)
  const bracketsRootRef = useRef<Group>(null)
  const raycasterRef = useRef(new Raycaster())
  const ndcRef = useRef(new Vector2())
  const planeRef = useRef(new Plane())
  const planePointRef = useRef(new Vector3())
  const planeNormalRef = useRef(new Vector3())
  const planeOriginRef = useRef(new Vector3())
  const intersectionRef = useRef(new Vector3())
  const localIntersectionRef = useRef(new Vector3())

  const displayPolygon = previewPolygon ?? effectiveCeiling.polygon
  const activeCornerIndex = draggedCornerIndex ?? hoveredCornerIndex
  const corners = useMemo(() => buildCornerBrackets(displayPolygon), [displayPolygon])
  const highlightedEdgeIndices = useMemo(() => {
    const next = new Set<number>()
    if (activeCornerIndex === null || displayPolygon.length < 2) return next
    next.add(activeCornerIndex)
    next.add((activeCornerIndex - 1 + displayPolygon.length) % displayPolygon.length)
    return next
  }, [activeCornerIndex, displayPolygon.length])
  const highlightedCornerIndices = useMemo(() => {
    const next = new Set<number>()
    if (activeCornerIndex === null || displayPolygon.length < 2) return next
    next.add(activeCornerIndex)
    next.add((activeCornerIndex - 1 + displayPolygon.length) % displayPolygon.length)
    next.add((activeCornerIndex + 1) % displayPolygon.length)
    return next
  }, [activeCornerIndex, displayPolygon.length])

  useEffect(() => {
    if (activeCornerIndex === null) return

    useViewer.getState().setHoveredId(effectiveCeiling.id)
    return () => {
      if (useViewer.getState().hoveredId === effectiveCeiling.id) {
        useViewer.getState().setHoveredId(null)
      }
    }
  }, [activeCornerIndex, effectiveCeiling.id])

  const selectCeilingForEdit = useCallback(() => {
    const editor = useEditor.getState()
    editor.setMovingNode(null)
    useInteractionScope
      .getState()
      .endIf((sc) => sc.kind === 'reshaping' && sc.reshape === 'endpoint')
    useInteractionScope.getState().endIf((sc) => sc.kind === 'reshaping' && sc.reshape === 'curve')
    useInteractionScope.getState().endIf((sc) => sc.kind === 'reshaping' && sc.reshape === 'hole')
    editor.setMode('select')
    useViewer.getState().setSelection({ selectedIds: [effectiveCeiling.id] })
  }, [effectiveCeiling.id])

  const getHandlePlanePoint = useCallback(
    (event: MouseEvent | PointerEvent): [number, number] | null => {
      if (!levelObject) return null

      const rect = gl.domElement.getBoundingClientRect()
      ndcRef.current.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycasterRef.current.setFromCamera(ndcRef.current, camera)

      planePointRef.current.set(0, (effectiveCeiling.height ?? 2.5) + BRACKET_Y_OFFSET, 0)
      levelObject.localToWorld(planePointRef.current)

      planeOriginRef.current.set(0, 0, 0)
      levelObject.localToWorld(planeOriginRef.current)
      planeNormalRef.current.set(0, 1, 0)
      levelObject.localToWorld(planeNormalRef.current)
      planeNormalRef.current.sub(planeOriginRef.current).normalize()
      planeRef.current.setFromNormalAndCoplanarPoint(planeNormalRef.current, planePointRef.current)

      const hit = raycasterRef.current.ray.intersectPlane(planeRef.current, intersectionRef.current)
      if (!hit) return null

      localIntersectionRef.current.copy(intersectionRef.current)
      levelObject.worldToLocal(localIntersectionRef.current)
      return [localIntersectionRef.current.x, localIntersectionRef.current.z]
    },
    [camera, effectiveCeiling.height, gl.domElement, levelObject],
  )

  const handleCornerPointerDown = useCallback(
    (corner: CornerBracketData, event: ThreeEvent<PointerEvent>) => {
      if (event.button !== 0) return
      stopHandlePointerDown(event)

      const startPlanePosition = getHandlePlanePoint(event.nativeEvent)
      if (!startPlanePosition) return
      const initialCorner = effectiveCeiling.polygon[corner.index]
      if (!initialCorner) return

      dragRef.current = {
        ceilingId: effectiveCeiling.id,
        cornerIndex: corner.index,
        didDrag: false,
        initialPolygon: effectiveCeiling.polygon.map(([x, z]) => [x, z] as [number, number]),
        inputDraggingSet: false,
        pointerId: event.pointerId,
        previewPolygon: null,
        previousSnappedPosition: [initialCorner[0], initialCorner[1]],
        previousInputDragging: useViewer.getState().inputDragging,
        startClientX: event.nativeEvent.clientX,
        startClientY: event.nativeEvent.clientY,
        startPlanePosition,
      }
    },
    [effectiveCeiling.id, effectiveCeiling.polygon, getHandlePlanePoint],
  )

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || drag.ceilingId !== effectiveCeiling.id) return
      if (event.pointerId !== drag.pointerId) return

      const dragDistance = Math.hypot(
        event.clientX - drag.startClientX,
        event.clientY - drag.startClientY,
      )

      const planePosition = getHandlePlanePoint(event)
      if (!planePosition) return

      if (!drag.didDrag) {
        if (dragDistance < HANDLE_DRAG_THRESHOLD_PX) return

        drag.didDrag = true
        drag.inputDraggingSet = true
        useViewer.getState().setInputDragging(true)
        setDraggedCornerIndex(drag.cornerIndex)
        selectCeilingForEdit()
        sfxEmitter.emit('sfx:item-pick')
      }

      const initialCorner = drag.initialPolygon[drag.cornerIndex]
      if (!initialCorner) return

      const rawNextPosition: [number, number] = [
        initialCorner[0] + (planePosition[0] - drag.startPlanePosition[0]),
        initialCorner[1] + (planePosition[1] - drag.startPlanePosition[1]),
      ]
      const gridNextPosition: [number, number] = event.shiftKey
        ? rawNextPosition
        : [
            initialCorner[0] + snapToHalf(planePosition[0] - drag.startPlanePosition[0]),
            initialCorner[1] + snapToHalf(planePosition[1] - drag.startPlanePosition[1]),
          ]
      const nextPosition = resolveCeilingPlanPointSnap({
        rawPoint: rawNextPosition,
        fallbackPoint: gridNextPosition,
        levelId,
        excludeId: drag.ceilingId,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
      }).point

      if (
        !event.shiftKey &&
        drag.previousSnappedPosition &&
        (nextPosition[0] !== drag.previousSnappedPosition[0] ||
          nextPosition[1] !== drag.previousSnappedPosition[1])
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }
      drag.previousSnappedPosition = nextPosition

      const nextPolygon = drag.initialPolygon.map((polygonPoint, index) =>
        index === drag.cornerIndex ? nextPosition : polygonPoint,
      )

      drag.previewPolygon = nextPolygon
      setPreviewPolygon(nextPolygon)
      useLiveNodeOverrides.getState().set(drag.ceilingId, { polygon: nextPolygon })
      useScene.getState().markDirty(drag.ceilingId)
    }

    const finishDrag = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return

      dragRef.current = null
      setDraggedCornerIndex(null)
      setPreviewPolygon(null)

      if (drag.didDrag) {
        event.preventDefault()
        suppressNextClick()

        if (drag.previewPolygon) {
          useScene.getState().updateNode(drag.ceilingId, { polygon: drag.previewPolygon })
          useViewer.getState().setSelection({ selectedIds: [drag.ceilingId] })
        }

        sfxEmitter.emit('sfx:item-place')
      }

      clearCornerDragPreview(drag)
    }

    const cancelDrag = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return

      dragRef.current = null
      setDraggedCornerIndex(null)
      setPreviewPolygon(null)
      clearCornerDragPreview(drag)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finishDrag, true)
    window.addEventListener('pointercancel', cancelDrag, true)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishDrag, true)
      window.removeEventListener('pointercancel', cancelDrag, true)

      const drag = dragRef.current
      if (!drag || drag.ceilingId !== effectiveCeiling.id) return
      dragRef.current = null
      clearCornerDragPreview(drag)
    }
  }, [effectiveCeiling.id, getHandlePlanePoint, levelId, selectCeilingForEdit])

  // The brackets render on SCENE_LAYER (scene-depth occlusion), so unlike
  // EDITOR_LAYER affordances the thumbnail camera can't filter them — hide
  // them around captures via synchronous Object3D.visible mutation (the
  // capture renders right after the emit), same as `site-boundary-editor.tsx`.
  useEffect(() => {
    const hideForCapture = () => {
      if (bracketsRootRef.current) bracketsRootRef.current.visible = false
    }
    const restoreAfterCapture = () => {
      if (bracketsRootRef.current) bracketsRootRef.current.visible = true
    }
    emitter.on('thumbnail:before-capture', hideForCapture)
    emitter.on('thumbnail:after-capture', restoreAfterCapture)
    return () => {
      emitter.off('thumbnail:before-capture', hideForCapture)
      emitter.off('thumbnail:after-capture', restoreAfterCapture)
    }
  }, [])

  useEffect(() => {
    let frameId = 0

    const resolveLevelObject = () => {
      const nextLevelObject = sceneRegistry.nodes.get(levelId) ?? null
      setLevelObject((currentLevelObject) => {
        if (currentLevelObject === nextLevelObject) {
          return currentLevelObject
        }
        return nextLevelObject
      })

      if (!nextLevelObject) {
        frameId = window.requestAnimationFrame(resolveLevelObject)
      }
    }

    resolveLevelObject()

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [levelId])

  if (!levelObject || corners.length === 0) return null

  return createPortal(
    <group
      position={[0, (effectiveCeiling.height ?? 2.5) + BRACKET_Y_OFFSET, 0]}
      ref={bracketsRootRef}
    >
      {corners.map((corner, index) => (
        <CornerBracket
          ceiling={effectiveCeiling}
          corner={corner}
          highlightIncoming={highlightedEdgeIndices.has(corner.incomingEdgeIndex)}
          highlightOutgoing={highlightedEdgeIndices.has(corner.outgoingEdgeIndex)}
          isHovered={activeCornerIndex === corner.index}
          isLinkedHovered={
            activeCornerIndex !== null &&
            activeCornerIndex !== corner.index &&
            highlightedCornerIndices.has(corner.index)
          }
          key={`${ceiling.id}-corner-${index}`}
          onHoverChange={(hovered) => {
            setHoveredCornerIndex((current) => {
              if (hovered) return corner.index
              return current === corner.index ? null : current
            })
          }}
          onPointerDown={(event) => handleCornerPointerDown(corner, event)}
        />
      ))}
    </group>,
    levelObject,
  )
}

const CornerBracket = ({
  ceiling,
  corner,
  highlightIncoming,
  highlightOutgoing,
  isHovered,
  isLinkedHovered,
  onHoverChange,
  onPointerDown,
}: {
  ceiling: CeilingNode
  corner: CornerBracketData
  highlightIncoming: boolean
  highlightOutgoing: boolean
  isHovered: boolean
  isLinkedHovered: boolean
  onHoverChange: (hovered: boolean) => void
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void
}) => {
  const cubeHighlighted = isHovered || isLinkedHovered
  const cubeColor = cubeHighlighted ? HANDLE_HOVER_COLOR : HANDLE_COLOR
  const cubeOpacity = cubeHighlighted ? HANDLE_HOVER_OPACITY : HANDLE_OPACITY

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()

    useEditor.getState().setMovingNode(null)
    useInteractionScope
      .getState()
      .endIf((sc) => sc.kind === 'reshaping' && sc.reshape === 'endpoint')
    useInteractionScope.getState().endIf((sc) => sc.kind === 'reshaping' && sc.reshape === 'curve')
    useInteractionScope.getState().endIf((sc) => sc.kind === 'reshaping' && sc.reshape === 'hole')
    useEditor.getState().setMode('select')

    emitter.emit('ceiling:click' as any, {
      node: ceiling,
      nativeEvent: e.nativeEvent,
      localPosition: [0, 0, 0],
      position: [corner.corner[0], ceiling.height ?? 2.5, corner.corner[1]],
      stopPropagation: () => e.stopPropagation(),
      viaHandle: true,
    })
  }

  return (
    <group position={[corner.corner[0], 0, corner.corner[1]]}>
      <BracketLeg
        color={highlightIncoming ? HANDLE_HOVER_COLOR : HANDLE_COLOR}
        direction={corner.incomingDirection}
        highlighted={highlightIncoming}
        length={corner.incomingLength}
        onClick={handleClick}
        onHoverChange={onHoverChange}
        onPointerDown={onPointerDown}
      />
      <BracketLeg
        color={highlightOutgoing ? HANDLE_HOVER_COLOR : HANDLE_COLOR}
        direction={corner.outgoingDirection}
        highlighted={highlightOutgoing}
        length={corner.outgoingLength}
        onClick={handleClick}
        onHoverChange={onHoverChange}
        onPointerDown={onPointerDown}
      />

      <mesh
        geometry={SHARED_HANDLE_BOX_GEOMETRY}
        onClick={handleClick}
        onPointerDown={onPointerDown}
        onPointerEnter={(e) => {
          e.stopPropagation()
          onHoverChange(true)
        }}
        onPointerLeave={(e) => {
          e.stopPropagation()
          onHoverChange(false)
        }}
        renderOrder={CORNER_RENDER_ORDER}
        scale={HIT_BOX_SIZE}
      >
        <meshBasicMaterial
          color={cubeColor}
          depthTest
          depthWrite={false}
          opacity={cubeOpacity}
          transparent
        />
      </mesh>
    </group>
  )
}

const BracketLeg = ({
  direction,
  length,
  color,
  highlighted,
  onClick,
  onHoverChange,
  onPointerDown,
}: {
  direction: [number, number]
  length: number
  color: string
  highlighted: boolean
  onClick: (e: ThreeEvent<MouseEvent>) => void
  onHoverChange: (hovered: boolean) => void
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void
}) => {
  const angle = -Math.atan2(direction[1], direction[0])
  const position: [number, number, number] = [
    direction[0] * (length / 2),
    0,
    direction[1] * (length / 2),
  ]

  return (
    <mesh
      geometry={SHARED_HANDLE_BOX_GEOMETRY}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerEnter={(e) => {
        e.stopPropagation()
        onHoverChange(true)
      }}
      onPointerLeave={(e) => {
        e.stopPropagation()
        onHoverChange(false)
      }}
      position={position}
      renderOrder={CORNER_RENDER_ORDER}
      rotation={[0, angle, 0]}
      scale={[length, BRACKET_HEIGHT, BRACKET_THICKNESS]}
    >
      <meshBasicMaterial
        color={color}
        depthTest
        depthWrite={false}
        opacity={highlighted ? HANDLE_HOVER_OPACITY : HANDLE_OPACITY}
        transparent
      />
    </mesh>
  )
}

function buildCornerBrackets(polygon: Array<[number, number]>): CornerBracketData[] {
  if (polygon.length < 3) return []

  return polygon.map((corner, index) => {
    const previous = polygon[(index - 1 + polygon.length) % polygon.length]!
    const next = polygon[(index + 1) % polygon.length]!
    const incomingVector = [previous[0] - corner[0], previous[1] - corner[1]] as [number, number]
    const outgoingVector = [next[0] - corner[0], next[1] - corner[1]] as [number, number]
    const incomingDirection = normalize2D(incomingVector)
    const outgoingDirection = normalize2D(outgoingVector)

    const incomingLength = Math.hypot(incomingVector[0], incomingVector[1])
    const outgoingLength = Math.hypot(outgoingVector[0], outgoingVector[1])

    return {
      corner,
      index,
      incomingEdgeIndex: (index - 1 + polygon.length) % polygon.length,
      incomingDirection,
      outgoingEdgeIndex: index,
      outgoingDirection,
      incomingLength: getBracketLength(incomingLength),
      outgoingLength: getBracketLength(outgoingLength),
    }
  })
}

function normalize2D(vector: [number, number]): [number, number] {
  const length = Math.hypot(vector[0], vector[1])
  if (length < 1e-6) return [1, 0]
  return [vector[0] / length, vector[1] / length]
}

function getBracketLength(edgeLength: number): number {
  return Math.max(0.14, Math.min(0.38, edgeLength * 0.22))
}
