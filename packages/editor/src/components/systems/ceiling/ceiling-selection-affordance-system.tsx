'use client'

import {
  type CeilingNode,
  emitter,
  resolveCeilingHeight,
  resolveLevelId,
  sceneRegistry,
  snapPointToGrid,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { Group, type Object3D, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { useShallow } from 'zustand/react/shallow'
import {
  clearCeilingSnapFeedback,
  resolveCeilingPlanPointSnap,
} from '../../../lib/ceiling-plan-snap'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor, { isGridSnapActive } from '../../../store/use-editor'
import useInteractionScope from '../../../store/use-interaction-scope'
import { suppressBoxSelectForPointer } from '../../tools/select/box-select-state'
import {
  BRACKET_Y_OFFSET,
  BracketPointerState,
  type BracketTarget,
  bracketTargetKey,
  buildCornerBrackets,
  CeilingBracketBatchStore,
  type CornerBracketData,
} from './ceiling-bracket-batch'

const HANDLE_DRAG_THRESHOLD_PX = 4

type CeilingBracketController = {
  onHoverChange: (cornerIndex: number, hovered: boolean) => void
  onPointerDown: (cornerIndex: number, event: ThreeEvent<PointerEvent>) => void
  onClick: (cornerIndex: number, event: ThreeEvent<MouseEvent>) => void
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
  // ANY active interaction (moving/placing a node, reshaping a boundary or
  // curve, dragging a handle) unmounts the brackets: their ceiling-height hit
  // boxes would otherwise catch drag-time hover, set `hoveredId` to the
  // ceiling, and flash the ceiling grid mid-gesture (e.g. while dragging a
  // slab polygon vertex). The brackets' own corner drag doesn't begin a
  // scope, so it can't unmount itself.
  const scopeIdle = useInteractionScope((state) => state.scope.kind === 'idle')
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
    scopeIdle &&
    currentLevelId !== null

  if (!shouldRender) return null

  return <LevelCeilingBrackets ceilings={ceilings} key={currentLevelId} levelId={currentLevelId} />
}

const LevelCeilingBrackets = ({
  ceilings,
  levelId,
}: {
  ceilings: CeilingNode[]
  levelId: string
}) => {
  const [store] = useState(() => new CeilingBracketBatchStore())
  const [controllers] = useState(() => new Map<CeilingNode['id'], CeilingBracketController>())
  const [levelObject, setLevelObject] = useState<Object3D | null>(
    () => sceneRegistry.nodes.get(levelId) ?? null,
  )
  // A stable portal container preserves instance event records when the level object changes.
  const [bracketsRoot] = useState(() => new Group())
  const registryRevision = useRef(sceneRegistry.revision)

  useFrame(() => {
    if (registryRevision.current === sceneRegistry.revision) return
    registryRevision.current = sceneRegistry.revision
    setLevelObject(sceneRegistry.nodes.get(levelId) ?? null)
  })

  useLayoutEffect(() => {
    if (!levelObject) return
    levelObject.add(bracketsRoot)
    return () => {
      bracketsRoot.removeFromParent()
    }
  }, [bracketsRoot, levelObject])

  // The brackets render on SCENE_LAYER (scene-depth occlusion), so unlike
  // EDITOR_LAYER affordances the thumbnail camera can't filter them — hide
  // them around captures via synchronous Object3D.visible mutation (the
  // capture renders right after the emit), same as `site-boundary-editor.tsx`.
  useEffect(() => {
    const hideForCapture = () => {
      bracketsRoot.visible = false
    }
    const restoreAfterCapture = () => {
      bracketsRoot.visible = true
    }
    emitter.on('thumbnail:before-capture', hideForCapture)
    emitter.on('thumbnail:after-capture', restoreAfterCapture)
    return () => {
      emitter.off('thumbnail:before-capture', hideForCapture)
      emitter.off('thumbnail:after-capture', restoreAfterCapture)
    }
  }, [bracketsRoot])

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

  useEffect(() => () => store.dispose(), [store])

  return (
    <>
      {ceilings.map((ceiling) => (
        <CeilingSelectionAffordance
          ceiling={ceiling}
          controllers={controllers}
          key={ceiling.id}
          levelId={levelId}
          store={store}
        />
      ))}
      {levelObject &&
        createPortal(
          <CeilingBracketMeshes controllers={controllers} store={store} />,
          bracketsRoot,
        )}
    </>
  )
}

const CeilingBracketMeshes = memo(
  ({
    store,
    controllers,
  }: {
    store: CeilingBracketBatchStore
    controllers: Map<CeilingNode['id'], CeilingBracketController>
  }) => {
    const get = useThree((state) => state.get)
    const [pointer] = useState(() => new BracketPointerState())
    const previousMeshes = useRef(store.getSnapshot())
    const meshes = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

    useLayoutEffect(() => {
      for (const [index, previous] of previousMeshes.current.entries()) {
        const next = meshes[index]!
        if (previous !== next) pointer.replaceObject(previous.uuid, next.uuid)
      }
      previousMeshes.current = meshes
    }, [meshes, pointer])

    useLayoutEffect(
      () => () => {
        for (const target of pointer.clearHover()) {
          controllers.get(target.ceilingId)?.onHoverChange(target.cornerIndex, false)
        }
      },
      [controllers, pointer],
    )

    const hover = (target: BracketTarget, hovered: boolean) => {
      controllers.get(target.ceilingId)?.onHoverChange(target.cornerIndex, hovered)
    }
    const eventKey = (event: ThreeEvent<PointerEvent>) =>
      `${event.object.uuid}/${event.index}/${event.instanceId}`
    const handleOver = (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation()
      const target = store.resolveHitTarget(event, event.intersections)
      if (!target) return
      const previous = pointer.over(eventKey(event), target)
      if (previous && bracketTargetKey(previous) === bracketTargetKey(target)) return
      if (previous) hover(previous, false)
      hover(target, true)
    }
    const handleOut = (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation()
      const target = pointer.out(eventKey(event))
      if (target) hover(target, false)
    }
    const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
      const target = store.resolveHitTarget(event, event.intersections)
      if (!target) return
      pointer.pointerDown(
        event.intersections.flatMap((hit) => {
          const hitTarget = store.getTarget(hit.object, hit.instanceId)
          return hitTarget ? [hitTarget] : []
        }),
      )
      // R3F gates clicks by mesh, not instance. Allow transfers between highlight batches,
      // then enforce the original per-part pointer-down targets in handleClick.
      let root = get()
      while (root.previousRoot) root = root.previousRoot.getState()
      const initialHits = root.internal.initialHits
      for (const mesh of meshes) {
        if (!initialHits.includes(mesh)) initialHits.push(mesh)
      }
      controllers.get(target.ceilingId)?.onPointerDown(target.cornerIndex, event)
    }
    const handleClick = (event: ThreeEvent<MouseEvent>) => {
      const target = store.resolveHitTarget(event, event.intersections)
      if (!target || !pointer.canClick(target)) return
      controllers.get(target.ceilingId)?.onClick(target.cornerIndex, event)
    }

    return (
      <>
        {meshes.map((mesh) => (
          <primitive
            // Stable keys let R3F transfer hover and initial-hit records on capacity growth.
            key={mesh.name}
            object={mesh}
            onClick={handleClick}
            onPointerDown={handlePointerDown}
            onPointerMove={handleOver}
            onPointerOut={handleOut}
            onPointerOver={handleOver}
          />
        ))}
      </>
    )
  },
)

const CeilingSelectionAffordance = memo(function CeilingSelectionAffordance({
  ceiling,
  levelId,
  store,
  controllers,
}: {
  ceiling: CeilingNode
  levelId: string
  store: CeilingBracketBatchStore
  controllers: Map<CeilingNode['id'], CeilingBracketController>
}) {
  const { camera, gl, invalidate } = useThree()
  const liveOverride = useLiveNodeOverrides(
    (state) => state.overrides.get(ceiling.id) as Partial<CeilingNode> | undefined,
  )
  const effectiveCeiling = useMemo(
    () => (liveOverride ? ({ ...ceiling, ...liveOverride } as CeilingNode) : ceiling),
    [ceiling, liveOverride],
  )
  // Explicit height when stored, else the live level-top bound the ceiling
  // follows (primitive selector — re-render-safe).
  const resolvedHeight = useScene((s) => resolveCeilingHeight(effectiveCeiling, s.nodes))
  const [hoveredCornerIndex, setHoveredCornerIndex] = useState<number | null>(null)
  const [draggedCornerIndex, setDraggedCornerIndex] = useState<number | null>(null)
  const [previewPolygon, setPreviewPolygon] = useState<Array<[number, number]> | null>(null)
  const dragRef = useRef<CornerDragState | null>(null)
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
      const levelObject = sceneRegistry.nodes.get(levelId)
      if (!levelObject) return null

      const rect = gl.domElement.getBoundingClientRect()
      ndcRef.current.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycasterRef.current.setFromCamera(ndcRef.current, camera)

      planePointRef.current.set(0, resolvedHeight + BRACKET_Y_OFFSET, 0)
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
    [camera, resolvedHeight, gl.domElement, levelId],
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
      const rawDelta: [number, number] = [
        planePosition[0] - drag.startPlanePosition[0],
        planePosition[1] - drag.startPlanePosition[1],
      ]
      const gridStep = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const snappedDelta = snapPointToGrid(rawDelta, gridStep)
      const gridNextPosition: [number, number] = [
        initialCorner[0] + snappedDelta[0],
        initialCorner[1] + snappedDelta[1],
      ]
      const nextPosition = resolveCeilingPlanPointSnap({
        rawPoint: rawNextPosition,
        fallbackPoint: gridNextPosition,
        levelId,
        excludeId: drag.ceilingId,
      }).point

      const snapEpsilon = 1e-6
      const alignmentSnapped =
        Math.abs(nextPosition[0] - gridNextPosition[0]) > snapEpsilon ||
        Math.abs(nextPosition[1] - gridNextPosition[1]) > snapEpsilon
      if (
        (gridStep > 0 || alignmentSnapped) &&
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

  useLayoutEffect(() => {
    store.setGeometry(ceiling.id, corners, resolvedHeight)
    invalidate()
  }, [ceiling.id, corners, resolvedHeight, store, invalidate])

  useLayoutEffect(() => {
    store.setHighlight(ceiling.id, activeCornerIndex)
    invalidate()
  }, [ceiling.id, activeCornerIndex, store, invalidate])

  useLayoutEffect(
    () => () => {
      store.removeCeiling(ceiling.id)
      invalidate()
    },
    [ceiling.id, store, invalidate],
  )

  useLayoutEffect(() => {
    controllers.set(ceiling.id, {
      onHoverChange: (cornerIndex, hovered) => {
        setHoveredCornerIndex((current) => {
          if (hovered) return cornerIndex
          return current === cornerIndex ? null : current
        })
      },
      onPointerDown: (cornerIndex, event) => {
        const corner = corners[cornerIndex]
        if (corner) handleCornerPointerDown(corner, event)
      },
      onClick: (cornerIndex, event) => {
        const corner = corners[cornerIndex]
        if (!corner) return
        event.stopPropagation()
        useEditor.getState().setMovingNode(null)
        useInteractionScope
          .getState()
          .endIf((sc) => sc.kind === 'reshaping' && sc.reshape === 'endpoint')
        useInteractionScope
          .getState()
          .endIf((sc) => sc.kind === 'reshaping' && sc.reshape === 'curve')
        useInteractionScope
          .getState()
          .endIf((sc) => sc.kind === 'reshaping' && sc.reshape === 'hole')
        useEditor.getState().setMode('select')

        emitter.emit('ceiling:click' as any, {
          node: effectiveCeiling,
          nativeEvent: event.nativeEvent,
          localPosition: [0, 0, 0],
          // Position is level-local, matching the original ceiling handle payload.
          position: [
            corner.corner[0],
            resolveCeilingHeight(effectiveCeiling, useScene.getState().nodes),
            corner.corner[1],
          ],
          stopPropagation: () => event.stopPropagation(),
          viaHandle: true,
        })
      },
    })
    return () => {
      controllers.delete(ceiling.id)
    }
  }, [ceiling.id, controllers, corners, effectiveCeiling, handleCornerPointerDown])

  return null
})
