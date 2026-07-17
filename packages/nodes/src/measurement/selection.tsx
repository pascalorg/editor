'use client'

import {
  type AlignmentAnchor,
  type AnyNode,
  type AnyNodeId,
  collectAlignmentAnchors,
  emitter,
  MeasurementNode,
  type MeasurementPayload,
  type MeasurementPoint,
  resolveLevelId,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  boundaryReshapeScope,
  EDITOR_LAYER,
  isAlignmentGuideActive,
  isMagneticSnapActive,
  MEASUREMENT_ACTIVE_COLOR,
  type MeasurementAxis,
  type MeasurementAxisGuide,
  swallowNextClick,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { createPortal, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BufferGeometry,
  Float32BufferAttribute,
  type Group,
  MathUtils,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  Vector3,
} from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { useShallow } from 'zustand/react/shallow'
import {
  measurementEditAnchor,
  measurementResolvedEditPoints,
  refreshMeasurementAnchorFallbacks,
  replaceMeasurementAnchor,
} from './edit'
import { measurementDependencyIds, resolveMeasurementNode } from './resolve'
import {
  associateSurfaceHit,
  createMeasurementSurfaceQuerySession,
  measurementVertexSnapAnchors,
} from './surface-query'

const HANDLE_RADIUS_PX = 7
const GUIDE_COLORS: Record<MeasurementAxis, string> = {
  x: '#ef4444',
  y: '#22c55e',
  z: '#3b82f6',
}
const NO_RAYCAST = () => {}

function MeasurementEditHandle({
  active,
  onPointerDown,
  position,
}: {
  active: boolean
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void
  position: MeasurementPoint
}) {
  const ref = useRef<Group>(null)
  const worldPosition = useMemo(() => new Vector3(), [])
  const cameraPosition = useMemo(() => new Vector3(), [])
  const materials = useMemo(
    () => ({
      halo: new MeshBasicNodeMaterial({
        color: '#f8fafc',
        depthTest: false,
        depthWrite: false,
      }),
      point: new MeshBasicNodeMaterial({
        color: MEASUREMENT_ACTIVE_COLOR,
        depthTest: false,
        depthWrite: false,
      }),
      hit: new MeshBasicNodeMaterial({
        visible: false,
      }),
    }),
    [],
  )

  useEffect(
    () => () => {
      materials.halo.dispose()
      materials.point.dispose()
      materials.hit.dispose()
    },
    [materials],
  )

  useFrame(({ camera, size }) => {
    const group = ref.current
    if (!group) return
    group.getWorldPosition(worldPosition)
    let worldUnitsPerPixel = 0.01
    if ((camera as PerspectiveCamera).isPerspectiveCamera) {
      const perspective = camera as PerspectiveCamera
      const depth = Math.abs(
        cameraPosition.copy(worldPosition).applyMatrix4(perspective.matrixWorldInverse).z,
      )
      worldUnitsPerPixel =
        (2 * depth * Math.tan(MathUtils.degToRad(perspective.getEffectiveFOV() * 0.5))) /
        Math.max(size.height, 1)
    } else if ((camera as OrthographicCamera).isOrthographicCamera) {
      const orthographic = camera as OrthographicCamera
      worldUnitsPerPixel =
        (orthographic.top - orthographic.bottom) / Math.max(orthographic.zoom * size.height, 1)
    }
    const scale = worldUnitsPerPixel * HANDLE_RADIUS_PX * (active ? 1.2 : 1)
    if (Number.isFinite(scale)) group.scale.setScalar(MathUtils.clamp(scale, 0.004, 0.3))
  })

  return (
    <group position={position} ref={ref} userData={{ measurementSurface: false }}>
      <mesh layers={EDITOR_LAYER} material={materials.halo} raycast={NO_RAYCAST} renderOrder={1010}>
        <sphereGeometry args={[1, 16, 12]} />
      </mesh>
      <mesh
        layers={EDITOR_LAYER}
        material={materials.point}
        raycast={NO_RAYCAST}
        renderOrder={1011}
        scale={0.62}
      >
        <sphereGeometry args={[1, 16, 12]} />
      </mesh>
      <mesh
        layers={EDITOR_LAYER}
        material={materials.hit}
        onPointerDown={onPointerDown}
        onPointerEnter={() => {
          document.body.style.cursor = 'grab'
        }}
        onPointerLeave={() => {
          if (!active) document.body.style.cursor = ''
        }}
        renderOrder={1012}
        scale={1.8}
      >
        <sphereGeometry args={[1, 12, 8]} />
      </mesh>
    </group>
  )
}

function MeasurementEditGuide({ guide }: { guide: MeasurementAxisGuide }) {
  const geometry = useMemo(() => {
    const next = new BufferGeometry()
    next.setAttribute('position', new Float32BufferAttribute([...guide.from, ...guide.to], 3))
    return next
  }, [guide])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <>
      <lineSegments
        frustumCulled={false}
        geometry={geometry}
        layers={EDITOR_LAYER}
        raycast={NO_RAYCAST}
        renderOrder={1009}
        userData={{ measurementSurface: false }}
      >
        <lineBasicNodeMaterial
          color={GUIDE_COLORS[guide.axis]}
          depthTest={false}
          depthWrite={false}
          linewidth={guide.snapped ? 3 : 2}
          opacity={guide.snapped ? 1 : 0.72}
          transparent
        />
      </lineSegments>
      <Html center position={guide.to} style={{ pointerEvents: 'none' }} zIndexRange={[80, 0]}>
        <div className="-translate-y-4 whitespace-nowrap rounded-full border border-indigo-400/70 bg-background/95 px-2.5 py-1 font-mono font-semibold text-[11px] text-foreground shadow-sm backdrop-blur">
          {guide.proximity ? 'Align ' : ''}
          {guide.axis.toUpperCase()}
        </div>
      </Html>
    </>
  )
}

function MeasurementEditHandles({
  levelId,
  levelObject,
  node,
}: {
  levelId: string
  levelObject: Object3D
  node: MeasurementNode
}) {
  const { camera, gl, scene } = useThree()
  const ownOverride = useLiveNodeOverrides((state) => state.overrides.get(node.id)) as
    | Partial<MeasurementNode>
    | undefined
  const effectiveNode = useMemo(
    () => (ownOverride ? ({ ...node, ...ownOverride } as MeasurementNode) : node),
    [node, ownOverride],
  )
  const dependencyIds = measurementDependencyIds(
    effectiveNode.measurement,
    (id) => useScene.getState().nodes[id],
  )
  useScene(useShallow((state) => dependencyIds.map((id) => state.nodes[id])))
  useLiveNodeOverrides(useShallow((state) => dependencyIds.map((id) => state.overrides.get(id))))
  const resolved = resolveMeasurementNode(effectiveNode, (id) => {
    const dependency = useScene.getState().nodes[id]
    if (!dependency) return undefined
    const override = useLiveNodeOverrides.getState().overrides.get(id)
    return override ? ({ ...dependency, ...override } as AnyNode) : dependency
  })
  const points = measurementResolvedEditPoints(resolved.payload)
  const polygon =
    resolved.payload.kind === 'area' ||
    resolved.payload.kind === 'perimeter' ||
    resolved.payload.kind === 'volume'
  const surfaceQuery = useMemo(() => createMeasurementSurfaceQuerySession(scene), [scene])
  const proximityCache = useRef<{ anchors: AlignmentAnchor[]; timestamp: number }>({
    anchors: [],
    timestamp: Number.NEGATIVE_INFINITY,
  })
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [axisGuide, setAxisGuide] = useState<MeasurementAxisGuide | null>(null)
  const endDragRef = useRef<(commit: boolean) => void>(() => {})

  useEffect(
    () => () => {
      endDragRef.current(false)
      surfaceQuery.dispose()
      useLiveNodeOverrides.getState().clear(node.id)
      document.body.style.cursor = ''
    },
    [node.id, surfaceQuery],
  )

  const startDrag = useCallback(
    (index: number, event: ThreeEvent<PointerEvent>) => {
      if (event.button !== 0 || useViewer.getState().cameraDragging) return
      event.stopPropagation()
      event.nativeEvent.preventDefault()
      event.nativeEvent.stopImmediatePropagation()

      const baseResolved = resolveMeasurementNode(node, (id) => {
        const dependency = useScene.getState().nodes[id]
        if (!dependency) return undefined
        const override = useLiveNodeOverrides.getState().overrides.get(id)
        return override ? ({ ...dependency, ...override } as AnyNode) : dependency
      })
      const basePayload = refreshMeasurementAnchorFallbacks(node.measurement, baseResolved.payload)
      const basePoints = measurementResolvedEditPoints(baseResolved.payload)
      if (!basePoints[index]) return

      const previousInputDragging = useViewer.getState().inputDragging
      const previousCursor = document.body.style.cursor
      let latestPayload: MeasurementPayload | null = null
      let latestGuide: MeasurementAxisGuide | null = null
      const pointerId = event.pointerId
      setActiveIndex(index)
      useViewer.getState().setInputDragging(true)
      useInteractionScope.getState().begin(boundaryReshapeScope(node.id))
      document.body.style.cursor = 'grabbing'

      const getProximityAnchors = () => {
        const now = performance.now()
        if (now - proximityCache.current.timestamp > 120) {
          proximityCache.current = {
            anchors: collectAlignmentAnchors(useScene.getState().nodes, node.id, levelId),
            timestamp: now,
          }
        }
        return proximityCache.current.anchors
      }

      const onMove = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerId) return
        pointerEvent.preventDefault()
        pointerEvent.stopPropagation()
        const anchors = measurementVertexSnapAnchors(basePoints, index, polygon)
        const applyMagneticSnap = isMagneticSnapActive() && !pointerEvent.altKey
        const surface = surfaceQuery.resolvePointer({
          event: pointerEvent,
          camera,
          canvas: gl.domElement,
          levelObject,
          anchorOrAnchors: anchors,
          lockedGuide: applyMagneticSnap && latestGuide?.snapped === true ? latestGuide : null,
          planarProximityAnchors: getProximityAnchors(),
          applyMagneticSnap,
          showAlignmentGuides: isAlignmentGuideActive(),
        })
        if (!surface) return
        const associated = associateSurfaceHit(surface.hit, applyMagneticSnap ? 0.2 : 0.012)
        const anchor = measurementEditAnchor(
          baseResolved.payload,
          associated.point,
          associated.anchor,
        )
        const next = replaceMeasurementAnchor(basePayload, index, anchor)
        if (!next || !MeasurementNode.safeParse({ ...node, measurement: next }).success) return
        latestPayload = next
        latestGuide = surface.guide
        useLiveNodeOverrides.getState().set(node.id, { measurement: next })
        setAxisGuide(surface.guide)
      }

      const cleanup = (commit: boolean) => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        window.removeEventListener('blur', onBlur)
        emitter.off('tool:cancel', onToolCancel)
        useLiveNodeOverrides.getState().clear(node.id)
        useViewer.getState().setInputDragging(previousInputDragging)
        useInteractionScope
          .getState()
          .endIf(
            (scope) =>
              scope.kind === 'reshaping' &&
              scope.reshape === 'boundary' &&
              scope.nodeId === node.id,
          )
        document.body.style.cursor = previousCursor
        setActiveIndex(null)
        setAxisGuide(null)
        const payload = latestPayload
        latestPayload = null
        latestGuide = null
        endDragRef.current = () => {}
        if (commit && payload) useScene.getState().updateNode(node.id, { measurement: payload })
      }

      const onUp = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerId) return
        pointerEvent.preventDefault()
        swallowNextClick()
        cleanup(true)
      }
      const onCancel = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId === pointerId) cleanup(false)
      }
      const onBlur = () => cleanup(false)
      const onToolCancel = () => cleanup(false)

      endDragRef.current = cleanup
      emitter.on('tool:cancel', onToolCancel)
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      window.addEventListener('blur', onBlur)
    },
    [camera, gl.domElement, levelId, levelObject, node, polygon, surfaceQuery],
  )

  return (
    <>
      {axisGuide ? <MeasurementEditGuide guide={axisGuide} /> : null}
      {points.map((point, index) => (
        <MeasurementEditHandle
          active={activeIndex === index}
          key={index}
          onPointerDown={(event) => startDrag(index, event)}
          position={point}
        />
      ))}
    </>
  )
}

const MeasurementSelectionAffordance = () => {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const showMeasurements = useViewer((state) => state.showMeasurements)
  const node = useScene((state) => {
    if (selectedIds.length !== 1) return null
    const selected = state.nodes[selectedIds[0] as AnyNodeId]
    return selected?.type === 'measurement' ? selected : null
  }) as MeasurementNode | null
  const levelId = node ? resolveLevelId(node, useScene.getState().nodes) : null
  const [levelObject, setLevelObject] = useState<Object3D | null>(() =>
    levelId ? (sceneRegistry.nodes.get(levelId) ?? null) : null,
  )

  useEffect(() => {
    if (!levelId) {
      setLevelObject(null)
      return
    }
    let frameId = 0
    const resolve = () => {
      const next = sceneRegistry.nodes.get(levelId) ?? null
      setLevelObject((current) => (current === next ? current : next))
      if (!next) frameId = window.requestAnimationFrame(resolve)
    }
    resolve()
    return () => window.cancelAnimationFrame(frameId)
  }, [levelId])

  if (!(showMeasurements && node && node.visible !== false && levelId && levelObject)) return null
  return createPortal(
    <MeasurementEditHandles levelId={levelId} levelObject={levelObject} node={node} />,
    levelObject,
  )
}

export default MeasurementSelectionAffordance
