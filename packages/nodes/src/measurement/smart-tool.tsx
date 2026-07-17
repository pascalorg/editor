'use client'

import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import {
  activateQuickMeasurementHudSource,
  clearQuickMeasurementHudSource,
  createQuickMeasurementPointerScheduler,
  EDITOR_LAYER,
  NO_RAYCAST,
  publishQuickMeasurementHudSource,
  resolveQuickMeasurementReport,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { memo, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  DoubleSide,
  type Group,
  MathUtils,
  type OrthographicCamera,
  type PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { resolveSmartMeasurementSurfaceHit } from './smart-surface'
import { createMeasurementSurfaceQuerySession, type LocalSurfaceHit } from './surface-query'

const MARKER_NORMAL = new Vector3(0, 0, 1)
const MARKER_ORIGIN = new Vector3()
const MARKER_USER_DATA = { measurementSurface: false }
const HALO_RING_ARGS: [number, number, number] = [0.5, 1, 48]
const LIVE_TARGET_RING_ARGS: [number, number, number] = [0.64, 0.84, 48]
const PINNED_TARGET_RING_ARGS: [number, number, number] = [0.48, 0.84, 48]
const PINNED_CENTER_ARGS: [number, number] = [0.22, 32]

function localPointToBuildingFrame(
  levelObject: Group,
  buildingObject: Group | null,
  point: readonly [number, number, number],
): Vector3 {
  const worldPoint = levelObject.localToWorld(new Vector3(...point))
  return buildingObject ? buildingObject.worldToLocal(worldPoint) : worldPoint
}

function localNormalToBuildingFrame(
  levelObject: Group,
  buildingObject: Group | null,
  normal: readonly [number, number, number],
): Vector3 {
  const value = new Vector3(...normal).applyQuaternion(
    levelObject.getWorldQuaternion(new Quaternion()),
  )
  if (buildingObject)
    value.applyQuaternion(buildingObject.getWorldQuaternion(new Quaternion()).invert())
  return value.normalize()
}

const SmartSurfaceMarker = memo(function SmartSurfaceMarker({
  position,
  normal,
  pinned,
  markerRef,
}: {
  position?: Vector3
  normal?: Vector3
  pinned: boolean
  markerRef?: RefObject<Group | null>
}) {
  const localRef = useRef<Group>(null)
  const ref = markerRef ?? localRef
  const worldPosition = useMemo(() => new Vector3(), [])
  const cameraPosition = useMemo(() => new Vector3(), [])
  const rotation = useMemo(
    () =>
      new Quaternion().setFromUnitVectors(
        MARKER_NORMAL,
        normal && normal.lengthSq() > 1e-12 ? normal.clone().normalize() : MARKER_NORMAL,
      ),
    [normal],
  )
  const materials = useMemo(
    () => ({
      halo: new MeshBasicNodeMaterial({
        color: '#f8fafc',
        depthTest: true,
        depthWrite: false,
        opacity: 0.96,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        side: DoubleSide,
        transparent: true,
      }),
      target: new MeshBasicNodeMaterial({
        color: pinned ? '#0e7490' : '#0891b2',
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
        side: DoubleSide,
      }),
      center: new MeshBasicNodeMaterial({
        color: '#0e7490',
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        side: DoubleSide,
      }),
    }),
    [pinned],
  )

  useLayoutEffect(() => {
    if (!position && ref.current) ref.current.visible = false
  }, [position, ref])

  useEffect(
    () => () => {
      materials.halo.dispose()
      materials.target.dispose()
      materials.center.dispose()
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
    const scale = worldUnitsPerPixel * 13
    if (Number.isFinite(scale)) group.scale.setScalar(MathUtils.clamp(scale, 0.003, 0.42))
  })

  return (
    <group
      position={position ?? MARKER_ORIGIN}
      quaternion={rotation}
      ref={ref}
      userData={MARKER_USER_DATA}
    >
      <mesh layers={EDITOR_LAYER} material={materials.halo} raycast={NO_RAYCAST} renderOrder={1002}>
        <ringGeometry args={HALO_RING_ARGS} />
      </mesh>
      <mesh
        layers={EDITOR_LAYER}
        material={materials.target}
        raycast={NO_RAYCAST}
        renderOrder={1003}
      >
        <ringGeometry args={pinned ? PINNED_TARGET_RING_ARGS : LIVE_TARGET_RING_ARGS} />
      </mesh>
      {pinned ? (
        <mesh
          layers={EDITOR_LAYER}
          material={materials.center}
          raycast={NO_RAYCAST}
          renderOrder={1004}
        >
          <circleGeometry args={PINNED_CENTER_ARGS} />
        </mesh>
      ) : null}
    </group>
  )
})

function showSmartSurfaceMarker(
  marker: Group | null,
  levelObject: Group,
  buildingObject: Group | null,
  hit: LocalSurfaceHit,
) {
  if (!marker) return
  levelObject.updateWorldMatrix(true, false)
  buildingObject?.updateWorldMatrix(true, false)
  marker.position.copy(localPointToBuildingFrame(levelObject, buildingObject, hit.point))
  marker.quaternion.setFromUnitVectors(
    MARKER_NORMAL,
    localNormalToBuildingFrame(levelObject, buildingObject, hit.normal),
  )
  marker.visible = true
}

function hideSmartSurfaceMarker(marker: Group | null) {
  if (marker) marker.visible = false
}

export function SmartMeasurementTool() {
  const { camera, gl, scene } = useThree()
  const buildingId = useViewer((state) => state.selection.buildingId)
  const levelId = useViewer((state) => state.selection.levelId)
  const levelRef = useRef(levelId)
  const nodes = useScene((state) => state.nodes)
  const hoverRef = useRef<LocalSurfaceHit | null>(null)
  const hoverNodeIdRef = useRef<string | null>(null)
  const candidateNodeIdRef = useRef<string | null | undefined>(undefined)
  const candidateHasReportRef = useRef(false)
  const candidateNodesRef = useRef(nodes)
  const hoverMarkerRef = useRef<Group>(null)
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null)
  const [pinned, setPinned] = useState<LocalSurfaceHit | null>(null)
  const surfaceQuery = useMemo(
    () => createMeasurementSurfaceQuerySession(scene, { includeZoneLayer: true }),
    [scene],
  )
  const hoverReport = useMemo(
    () => resolveQuickMeasurementReport(hoverNodeId, nodes),
    [hoverNodeId, nodes],
  )
  const pinnedReport = useMemo(
    () => resolveQuickMeasurementReport(pinned?.targetNodeId ?? null, nodes),
    [pinned?.targetNodeId, nodes],
  )

  useEffect(() => () => surfaceQuery.dispose(), [surfaceQuery])

  useEffect(() => {
    if (levelRef.current === levelId) return
    levelRef.current = levelId
    hoverRef.current = null
    hoverNodeIdRef.current = null
    candidateNodeIdRef.current = undefined
    candidateHasReportRef.current = false
    hideSmartSurfaceMarker(hoverMarkerRef.current)
    setHoverNodeId(null)
    setPinned(null)
  }, [levelId])

  useEffect(() => {
    const scope = useInteractionScope.getState()
    scope.begin({ kind: 'drafting', tool: 'measurement' })
    return () => {
      useInteractionScope
        .getState()
        .endIf((active) => active.kind === 'drafting' && active.tool === 'measurement')
    }
  }, [])

  useEffect(() => {
    const canvas = gl.domElement
    const updateHover = (
      next: LocalSurfaceHit | null,
      levelObject?: Group,
      buildingObject?: Group | null,
    ) => {
      hoverRef.current = next
      if (next && levelObject) {
        showSmartSurfaceMarker(hoverMarkerRef.current, levelObject, buildingObject ?? null, next)
      } else {
        hideSmartSurfaceMarker(hoverMarkerRef.current)
      }
      const nextNodeId = next?.targetNodeId ?? null
      if (nextNodeId === hoverNodeIdRef.current) return
      hoverNodeIdRef.current = nextNodeId
      setHoverNodeId(nextNodeId)
    }
    const processPointerMove = (event: PointerEvent) => {
      activateQuickMeasurementHudSource('3d')
      if (useViewer.getState().cameraDragging || !levelId) {
        updateHover(null)
        return
      }
      const levelObject = sceneRegistry.nodes.get(levelId)
      if (!levelObject) {
        updateHover(null)
        return
      }
      const buildingObject = buildingId
        ? ((sceneRegistry.nodes.get(buildingId as AnyNodeId) as Group | undefined) ?? null)
        : null
      const resolved = surfaceQuery.resolvePointer({
        event,
        camera,
        canvas,
        levelObject,
        anchorOrAnchors: null,
        applyMagneticSnap: false,
        showAlignmentGuides: false,
      })
      const sceneNodes = useScene.getState().nodes
      const next = resolved
        ? resolveSmartMeasurementSurfaceHit(resolved.hit, sceneNodes, levelId)
        : null
      if (candidateNodesRef.current !== sceneNodes) {
        candidateNodesRef.current = sceneNodes
        candidateNodeIdRef.current = undefined
      }
      const candidateNodeId = next?.targetNodeId ?? null
      if (candidateNodeId !== candidateNodeIdRef.current) {
        candidateNodeIdRef.current = candidateNodeId
        candidateHasReportRef.current = Boolean(
          resolveQuickMeasurementReport(candidateNodeId, sceneNodes),
        )
      }
      updateHover(candidateHasReportRef.current ? next : null, levelObject as Group, buildingObject)
    }
    const pointerScheduler = createQuickMeasurementPointerScheduler(processPointerMove)
    const onPointerMove = (event: PointerEvent) => pointerScheduler.enqueue(event)
    const clear = () => {
      pointerScheduler.clear()
      updateHover(null)
    }
    const onPointerLeave = (event: PointerEvent) => {
      if (document.elementFromPoint(event.clientX, event.clientY) === canvas) return
      clear()
    }
    const onClick = (event: MouseEvent) => {
      const next = hoverRef.current
      if (!(next && event.button === 0) || useViewer.getState().cameraDragging) return
      event.preventDefault()
      event.stopImmediatePropagation()
      activateQuickMeasurementHudSource('3d')
      setPinned(next)
    }

    canvas.addEventListener('pointermove', onPointerMove, true)
    canvas.addEventListener('pointerleave', onPointerLeave, true)
    canvas.addEventListener('click', onClick, true)
    return () => {
      canvas.removeEventListener('pointermove', onPointerMove, true)
      canvas.removeEventListener('pointerleave', onPointerLeave, true)
      canvas.removeEventListener('click', onClick, true)
      pointerScheduler.clear()
    }
  }, [buildingId, camera, gl, levelId, surfaceQuery])

  const pinnedPreview = useMemo(() => {
    if (!levelId) return null
    const levelObject = sceneRegistry.nodes.get(levelId) as Group | undefined
    if (!levelObject) return null
    const buildingObject = buildingId
      ? ((sceneRegistry.nodes.get(buildingId as AnyNodeId) as Group | undefined) ?? null)
      : null
    levelObject.updateWorldMatrix(true, false)
    buildingObject?.updateWorldMatrix(true, false)
    return pinned && pinnedReport
      ? {
          normal: localNormalToBuildingFrame(levelObject, buildingObject, pinned.normal),
          position: localPointToBuildingFrame(levelObject, buildingObject, pinned.point),
        }
      : null
  }, [buildingId, levelId, pinned, pinnedReport])

  const activeHit = hoverReport ? hoverRef.current : pinnedReport ? pinned : null
  const report = hoverReport ?? pinnedReport
  const lensState =
    pinnedReport && activeHit?.targetNodeId === pinned?.targetNodeId
      ? ('pinned' as const)
      : ('live' as const)

  useEffect(() => {
    publishQuickMeasurementHudSource('3d', report ? { lensState, report } : null)
  }, [lensState, report])

  useEffect(() => () => clearQuickMeasurementHudSource('3d'), [])

  return (
    <group>
      {pinnedPreview ? (
        <SmartSurfaceMarker
          normal={pinnedPreview.normal}
          pinned
          position={pinnedPreview.position}
        />
      ) : null}
      <SmartSurfaceMarker markerRef={hoverMarkerRef} pinned={false} />
    </group>
  )
}

export default SmartMeasurementTool
