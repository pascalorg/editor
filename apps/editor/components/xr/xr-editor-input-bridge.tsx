'use client'

import {
  type AnyNodeId,
  advanceStroke,
  applyHeightPatch,
  beginStroke,
  type EventSuffix,
  emitter,
  type GridEvent,
  minBrushRadius,
  type NodeEvent,
  raycastTerrain,
  type SiteNode,
  sceneRegistry,
  surfaceHeightAt,
  type TerrainField,
  type TerrainStroke,
  terrainFieldOf,
  useLiveTerrain,
  useScene,
  type WallEvent,
} from '@pascal-app/core'
import {
  cancelActiveTool,
  canDirectMoveNode,
  clipTerrainPatchToSite,
  commitStroke,
  createEditorApi,
  EDITOR_GRID_INPUT_NAME,
  getSpatialPointerId,
  resolveFlattenTarget,
  sculptFieldForSite,
  spatialPointerInput,
  terrainPointInsideSite,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useXR } from '@react-three/xr'
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  type Object3D,
  Plane,
  Quaternion,
  Raycaster,
  Vector3,
} from 'three'
import {
  didXRButtonPressStart,
  isXRCancelPressed,
  pulseXRInputSource,
  replayXRWallOpeningRelease,
  resolveXRReleaseAction,
  selectPrimaryXRInputSource,
  shouldReleaseCapturedXRInput,
  shouldRouteXRMove,
  XRSelectReleaseGuard,
} from '@/lib/xr/editor-input'
import { applyXRReferenceSpaceRayToWorld, setObjectFloorPlane } from '@/lib/xr/reference-space-ray'
import { XR_WAND_PANEL_INPUT_NAME } from './wand-panel/panel-layout'

type XRGridNativeEvent = {
  altKey: false
  button: 0
  buttons: number
  ctrlKey: false
  detail: number
  metaKey: false
  pointerId: number
  pointerType: 'xr'
  shiftKey: false
  stopImmediatePropagation: () => void
  stopPropagation: () => void
  target: HTMLCanvasElement
  timeStamp: number
}

type XRTerrainFocus = { radius: number; siteId: SiteNode['id']; x: number; z: number }
const TERRAIN_RING_SEGMENTS = 64

const xrInputSourceKey = (source: XRInputSource) =>
  `${source.handedness}:${source.targetRayMode}:${Boolean(source.hand)}`

const sameXRInputSource = (a: XRInputSource | null, b: XRInputSource | null) =>
  a === b || (a != null && b != null && xrInputSourceKey(a) === xrInputSourceKey(b))

function XRTerrainBrushCursor({ focusRef }: { focusRef: MutableRefObject<XRTerrainFocus | null> }) {
  const mode = useEditor((state) => state.mode)
  const shape = useEditor((state) => state.terrainBrush.shape)
  const verb = useEditor((state) => state.terrainVerb)
  const geometry = useMemo(() => {
    const result = new BufferGeometry()
    result.setAttribute(
      'position',
      new Float32BufferAttribute(new Float32Array((TERRAIN_RING_SEGMENTS + 1) * 3), 3),
    )
    return result
  }, [])
  const line = useMemo(() => {
    const result = new Line(
      geometry,
      new LineBasicMaterial({ color: '#38bdf8', depthTest: false, depthWrite: false }),
    )
    result.frustumCulled = false
    result.name = 'xr-terrain-brush-cursor'
    result.raycast = () => undefined
    result.renderOrder = 30
    return result
  }, [geometry])

  useEffect(
    () => () => {
      geometry.dispose()
      line.material.dispose()
    },
    [geometry, line],
  )
  useFrame(() => {
    const focus = focusRef.current
    line.visible = mode === 'terrain-sculpt' && focus !== null
    if (!(line.visible && focus)) return
    const site = useScene.getState().nodes[focus.siteId]
    if (site?.type !== 'site') return
    const field =
      useLiveTerrain.getState().strokeOf(site.id)?.field ??
      terrainFieldOf(site) ??
      sculptFieldForSite(site)
    const positions = geometry.getAttribute('position')
    for (let index = 0; index <= TERRAIN_RING_SEGMENTS; index += 1) {
      const angle = (index / TERRAIN_RING_SEGMENTS) * Math.PI * 2
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const scale =
        shape === 'square' ? 1 / Math.max(Math.abs(cos), Math.abs(sin), Number.EPSILON) : 1
      const x = focus.x + cos * focus.radius * scale
      const z = focus.z + sin * focus.radius * scale
      positions.setXYZ(index, x, surfaceHeightAt(field, x, z) + 0.02, z)
    }
    positions.needsUpdate = true
    geometry.computeBoundingSphere()
    line.material.color.set(verb === 'raise' ? '#22c55e' : verb === 'lower' ? '#ef4444' : '#38bdf8')
  })

  return <primitive object={line} />
}

function isXRNodePointer(event: NodeEvent): boolean {
  return getSpatialPointerId(event.nativeEvent) != null
}

export function XREditorInputBridge() {
  const session = useXR((state) => state.session)
  const origin = useXR((state) => state.origin)
  const scene = useThree((state) => state.scene)
  const gl = useThree((state) => state.gl)
  // Logical XR pointer capture: the source that starts a scene press owns its
  // move/up stream until selectend, even when its ray crosses the wand.
  const capturedInputSource = useRef<XRInputSource | null>(null)
  const lastXRWallEvent = useRef<WallEvent | null>(null)
  const lastSyntheticWallEvent = useRef<WallEvent | null>(null)
  const terrainInputSources = useRef(new Set<string>())
  const terrainStroke = useRef<{
    field: TerrainField
    siteId: SiteNode['id']
    source: XRInputSource
    stroke: TerrainStroke
  } | null>(null)
  const terrainFocus = useRef<XRTerrainFocus | null>(null)
  const panelInputSources = useRef(new Set<string>())
  const cancelPressed = useRef(false)
  const pointerIds = useRef(new WeakMap<XRInputSource, number>())
  const nextPointerId = useRef(10_000)
  const raycaster = useRef(new Raycaster())
  const rayOrigin = useRef(new Vector3())
  const rayDirection = useRef(new Vector3())
  const rayRotation = useRef(new Quaternion())
  const gridPlane = useRef(new Plane())
  const gridPlaneNormal = useRef(new Vector3())
  const gridPlanePoint = useRef(new Vector3())
  const selectReleaseGuard = useRef(new XRSelectReleaseGuard())

  const activeSite = useCallback(() => {
    const state = useScene.getState()
    const node = state.rootNodeIds[0] ? state.nodes[state.rootNodeIds[0]] : undefined
    return node?.type === 'site' ? (node as SiteNode) : null
  }, [])

  const pointerIdFor = useCallback((source: XRInputSource) => {
    const existing = pointerIds.current.get(source)
    if (existing !== undefined) return existing
    const next = nextPointerId.current++
    pointerIds.current.set(source, next)
    return next
  }, [])

  const updateRay = useCallback(
    (frame: XRFrame, source: XRInputSource): boolean => {
      const referenceSpace = gl.xr.getReferenceSpace()
      if (!referenceSpace) return false
      const pose = frame.getPose(source.targetRaySpace, referenceSpace)
      if (!(origin && pose)) return false
      const { position, orientation } = pose.transform
      origin.updateWorldMatrix(true, false)
      rayOrigin.current.set(position.x, position.y, position.z)
      rayRotation.current.set(orientation.x, orientation.y, orientation.z, orientation.w)
      rayDirection.current.set(0, 0, -1).applyQuaternion(rayRotation.current)
      applyXRReferenceSpaceRayToWorld(rayOrigin.current, rayDirection.current, origin.matrixWorld)
      raycaster.current.ray.set(rayOrigin.current, rayDirection.current)
      raycaster.current.layers.enableAll()
      return true
    },
    [gl, origin],
  )

  const isWandPanelHit = useCallback(
    (frame: XRFrame, source: XRInputSource): boolean => {
      const panel = scene.getObjectByName(XR_WAND_PANEL_INPUT_NAME)
      if (!(panel && updateRay(frame, source))) return false
      panel.updateWorldMatrix(true, true)
      return raycaster.current.intersectObject(panel, true).length > 0
    },
    [scene, updateRay],
  )

  const terrainPoint = useCallback(
    (frame: XRFrame, source: XRInputSource, field: TerrainField, site: SiteNode) => {
      if (!updateRay(frame, source)) return null
      const origin = rayOrigin.current
      const direction = rayDirection.current
      const hit = raycastTerrain(
        field,
        [origin.x, origin.y, origin.z],
        [direction.x, direction.y, direction.z],
      )
      if (hit && terrainPointInsideSite(site, hit.x, hit.z)) return [hit.x, hit.z] as const

      // A site without persisted terrain has an implicit ground plane. Keep XR
      // strokes usable before the first terrain sample exists; the terrain
      // raycast only covers the finite heightfield once it has a valid hit.
      if (Math.abs(direction.y) < 1e-6) return null
      const t = -origin.y / direction.y
      if (t < 0) return null
      const x = origin.x + direction.x * t
      const z = origin.z + direction.z * t
      return terrainPointInsideSite(site, x, z) ? ([x, z] as const) : null
    },
    [updateRay],
  )

  const abandonTerrainStroke = useCallback(() => {
    const active = terrainStroke.current
    if (!active) return false
    terrainStroke.current = null
    useLiveTerrain.getState().end(active.siteId)
    return true
  }, [])

  const applyTerrainDab = useCallback(
    (frame: XRFrame, source: XRInputSource) => {
      const active = terrainStroke.current
      const site = activeSite()
      if (!(active && sameXRInputSource(active.source, source) && site?.id === active.siteId))
        return false
      const point = terrainPoint(frame, source, active.stroke.snapshot, site)
      if (!point) return false
      terrainFocus.current = {
        radius: active.stroke.settings.radius,
        siteId: site.id,
        x: point[0],
        z: point[1],
      }
      const brushPatch = advanceStroke(active.stroke, point[0], point[1])
      if (!brushPatch) return false
      const patch = clipTerrainPatchToSite(active.field, brushPatch, site)
      active.field = applyHeightPatch(active.field, patch)
      useLiveTerrain.getState().advance(active.siteId, active.field, patch)
      return true
    },
    [activeSite, terrainPoint],
  )

  const startTerrainStroke = useCallback(
    (frame: XRFrame, source: XRInputSource) => {
      const site = activeSite()
      if (!site) return false
      const editor = useEditor.getState()
      const field = sculptFieldForSite(site)
      const point = terrainPoint(frame, source, field, site)
      if (!point) return false
      if (editor.terrainSampling) {
        editor.setTerrainFlattenTarget(resolveFlattenTarget(field, null, point[0], point[1]))
        return true
      }
      const stroke = beginStroke({
        field,
        settings: {
          ...editor.terrainBrush,
          radius: Math.max(editor.terrainBrush.radius, minBrushRadius(field)),
        },
        target:
          editor.terrainVerb === 'flatten'
            ? resolveFlattenTarget(field, editor.terrainFlattenTarget, point[0], point[1])
            : undefined,
        verb: editor.terrainVerb,
      })
      terrainStroke.current = { field, siteId: site.id, source, stroke }
      useLiveTerrain.getState().begin(site.id, field)
      applyTerrainDab(frame, source)
      return true
    },
    [activeSite, applyTerrainDab, terrainPoint],
  )

  const finishTerrainStroke = useCallback((source: XRInputSource) => {
    const active = terrainStroke.current
    if (!(active && sameXRInputSource(active.source, source))) return false
    terrainStroke.current = null
    commitStroke(active.siteId, active.field)
    useLiveTerrain.getState().end(active.siteId)
    return true
  }, [])

  const createGridEvent = useCallback(
    (
      frame: XRFrame,
      source: XRInputSource,
      buttons: number,
      allowRayFallback = false,
    ): GridEvent | null => {
      const grid = scene.getObjectByName(EDITOR_GRID_INPUT_NAME)
      if (!updateRay(frame, source)) return null
      grid?.updateWorldMatrix(true, false)

      const selection = useViewer.getState().selection
      const levelMesh = selection.levelId
        ? sceneRegistry.nodes.get(selection.levelId as AnyNodeId)
        : null
      levelMesh?.updateWorldMatrix(true, false)
      let levelFloorPoint: Vector3 | null = null
      if (levelMesh) {
        setObjectFloorPlane(
          gridPlane.current,
          levelMesh.matrixWorld,
          gridPlanePoint.current,
          gridPlaneNormal.current,
        )
        levelFloorPoint = raycaster.current.ray.intersectPlane(gridPlane.current, new Vector3())
      }
      const hit =
        !levelFloorPoint && grid?.visible
          ? raycaster.current.intersectObject(grid, false)[0]
          : undefined
      if (!(levelFloorPoint || hit || allowRayFallback)) return null

      const worldPoint = levelFloorPoint ?? hit?.point ?? raycaster.current.ray.at(1, new Vector3())
      const buildingId = selection.buildingId
      const buildingMesh = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
      const localPoint = buildingMesh
        ? buildingMesh.worldToLocal(worldPoint.clone())
        : worldPoint.clone()
      const nativeEvent: XRGridNativeEvent = {
        altKey: false,
        button: 0,
        buttons,
        ctrlKey: false,
        detail: 1,
        metaKey: false,
        pointerId: pointerIdFor(source),
        pointerType: 'xr',
        shiftKey: false,
        stopImmediatePropagation: () => undefined,
        stopPropagation: () => undefined,
        target: gl.domElement,
        timeStamp: performance.now(),
      }
      return {
        localPosition: [localPoint.x, localPoint.y, localPoint.z],
        nativeEvent: nativeEvent as never,
        position: [worldPoint.x, worldPoint.y, worldPoint.z],
      }
    },
    [gl, pointerIdFor, scene, updateRay],
  )

  const emitGridEvent = useCallback(
    (suffix: EventSuffix, frame: XRFrame, source: XRInputSource, buttons: number): boolean => {
      const payload = createGridEvent(frame, source, buttons)
      if (!payload) return false
      emitter.emit(`grid:${suffix}` as `grid:${EventSuffix}`, payload)
      return true
    },
    [createGridEvent],
  )

  const emitWallOpeningHover = useCallback(
    (frame: XRFrame, source: XRInputSource): boolean => {
      if (!updateRay(frame, source)) return false

      let nearest:
        | {
            distance: number
            event: WallEvent
          }
        | undefined
      const nativeEvent = {
        button: 0,
        buttons: 0,
        inputSource: source,
        openingHoverBridge: true,
        pointerId: pointerIdFor(source),
        pointerType: 'xr',
        stopImmediatePropagation: () => undefined,
        stopPropagation: () => undefined,
        target: gl.domElement,
        timeStamp: performance.now(),
      }
      const registeredObjects = new Set(sceneRegistry.nodes.values())

      for (const node of Object.values(useScene.getState().nodes)) {
        if (node?.type !== 'wall') continue
        const object = sceneRegistry.nodes.get(node.id)
        if (!object) continue
        object.updateWorldMatrix(true, true)
        const hit = raycaster.current.intersectObject(object, true).find((intersection) => {
          let current: Object3D | null = intersection.object
          while (current && current !== object) {
            if (registeredObjects.has(current)) return false
            current = current.parent
          }
          return current === object
        })
        if (!(hit?.face && (!nearest || hit.distance < nearest.distance))) continue
        const localPoint = object.worldToLocal(hit.point.clone())
        nearest = {
          distance: hit.distance,
          event: {
            localPosition: [localPoint.x, localPoint.y, localPoint.z],
            nativeEvent: nativeEvent as never,
            node,
            normal: [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z],
            object: hit.object,
            position: [hit.point.x, hit.point.y, hit.point.z],
            stopPropagation: () => undefined,
          },
        }
      }

      if (!nearest) {
        const previous = lastSyntheticWallEvent.current
        if (previous) emitter.emit('wall:leave', previous)
        lastSyntheticWallEvent.current = null
        return false
      }

      lastSyntheticWallEvent.current = nearest.event
      emitter.emit('wall:move', nearest.event)
      return true
    },
    [gl, pointerIdFor, updateRay],
  )

  const dispatchWindowPointerEvent = useCallback(
    (type: 'pointerup' | 'pointercancel', source: XRInputSource) => {
      window.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          pointerId: pointerIdFor(source),
          pointerType: 'xr',
        }),
      )
    },
    [pointerIdFor],
  )

  useEffect(() => {
    const onNodePointerDown = (event: NodeEvent) => {
      if (!isXRNodePointer(event)) return
      if (useEditor.getState().mode !== 'select') return
      if (useInteractionScope.getState().scope.kind !== 'idle') return

      const selectedIds = useViewer.getState().selection.selectedIds
      if (!(selectedIds.length === 1 && selectedIds[0] === event.node.id)) return
      if (!canDirectMoveNode(event.node)) return

      event.stopPropagation()
      useViewer.getState().setInputDragging(true)
      createEditorApi().engageMoveDrag(event.node)
    }
    const onNodeClick = (event: NodeEvent) => {
      if (!isXRNodePointer(event)) return
      const source = getSpatialPointerId(event.nativeEvent)
      if (typeof source === 'object') {
        selectReleaseGuard.current.markNodeClick(source as XRInputSource)
      }
    }

    emitter.on('node:pointerdown', onNodePointerDown)
    emitter.on('node:click', onNodeClick)
    return () => {
      emitter.off('node:pointerdown', onNodePointerDown)
      emitter.off('node:click', onNodeClick)
    }
  }, [])

  useEffect(() => {
    if (!session) return

    const rememberXRWallEvent = (event: WallEvent) => {
      lastXRWallEvent.current = event
    }
    const clearXRWallEvent = (event: WallEvent) => {
      if (capturedInputSource.current != null) return
      lastXRWallEvent.current = null
    }
    emitter.on('wall:enter', rememberXRWallEvent)
    emitter.on('wall:move', rememberXRWallEvent)
    emitter.on('wall:leave', clearXRWallEvent)

    const onSelectStart = (event: XRInputSourceEvent) => {
      selectReleaseGuard.current.start(event.inputSource)
      if (isWandPanelHit(event.frame, event.inputSource)) {
        panelInputSources.current.add(xrInputSourceKey(event.inputSource))
        pulseXRInputSource(event.inputSource, 0.1, 20)
        return
      }
      capturedInputSource.current = event.inputSource
      pulseXRInputSource(event.inputSource)
      if (useEditor.getState().mode === 'terrain-sculpt') {
        terrainInputSources.current.add(xrInputSourceKey(event.inputSource))
        startTerrainStroke(event.frame, event.inputSource)
        return
      }
      emitGridEvent('pointerdown', event.frame, event.inputSource, 1)
    }
    const onSelectEnd = (event: XRInputSourceEvent) => {
      const releaseMode = useEditor.getState().mode
      const releaseTool = useEditor.getState().tool
      const wallOpeningToolActive =
        releaseMode === 'build' && (releaseTool === 'door' || releaseTool === 'window')
      if (panelInputSources.current.delete(xrInputSourceKey(event.inputSource))) {
        selectReleaseGuard.current.cancel(event.inputSource)
        return
      }
      if (releaseMode === 'terrain-sculpt') {
        terrainInputSources.current.delete(xrInputSourceKey(event.inputSource))
        finishTerrainStroke(event.inputSource)
        selectReleaseGuard.current.cancel(event.inputSource)
        capturedInputSource.current = null
        return
      }
      if (
        !sameXRInputSource(capturedInputSource.current, event.inputSource) &&
        !wallOpeningToolActive
      ) {
        selectReleaseGuard.current.cancel(event.inputSource)
        return
      }

      const handledSpatialRelease = spatialPointerInput.release(event.inputSource)

      const pressDrag = useEditor.getState().placementDragMode
      const mode = releaseMode
      const scope = useInteractionScope.getState().scope
      const releaseAction = resolveXRReleaseAction({
        mode,
        placementDrag: pressDrag,
        scopeKind: scope.kind,
      })
      const emptySelectionEvent =
        releaseAction === 'defer-empty-selection'
          ? createGridEvent(event.frame, event.inputSource, 0, true)
          : null
      pulseXRInputSource(event.inputSource, 0.08, 18)
      emitGridEvent('pointerup', event.frame, event.inputSource, 0)
      dispatchWindowPointerEvent('pointerup', event.inputSource)

      if (wallOpeningToolActive && lastXRWallEvent.current) {
        replayXRWallOpeningRelease(lastXRWallEvent.current, (suffix, wallEvent) => {
          if (suffix === 'move') emitter.emit('wall:move', wallEvent)
          else emitter.emit('wall:click', wallEvent)
        })
        lastXRWallEvent.current = null
      }

      if (handledSpatialRelease && !wallOpeningToolActive) {
        selectReleaseGuard.current.cancel(event.inputSource)
      } else if (releaseAction === 'finish-placement-drag') {
        useViewer.getState().setInputDragging(false)
        selectReleaseGuard.current.cancel(event.inputSource)
      } else if (releaseAction === 'emit-tool-grid-click') {
        emitGridEvent('click', event.frame, event.inputSource, 0)
        selectReleaseGuard.current.cancel(event.inputSource)
      } else if (releaseAction === 'defer-empty-selection' && emptySelectionEvent) {
        selectReleaseGuard.current.deferEmptyRelease(event.inputSource, () => {
          if (useEditor.getState().mode !== 'select') return
          if (useInteractionScope.getState().scope.kind !== 'idle') return
          if (useViewer.getState().inputDragging) return
          emitter.emit('grid:click', emptySelectionEvent)
        })
      } else {
        selectReleaseGuard.current.cancel(event.inputSource)
      }

      capturedInputSource.current = null
    }
    const onSelectCancel = (event: XRInputSourceEvent) => {
      if (panelInputSources.current.delete(xrInputSourceKey(event.inputSource))) {
        selectReleaseGuard.current.cancel(event.inputSource)
        return
      }
      if (terrainInputSources.current.delete(xrInputSourceKey(event.inputSource))) {
        abandonTerrainStroke()
        selectReleaseGuard.current.cancel(event.inputSource)
        capturedInputSource.current = null
        return
      }
      if (!sameXRInputSource(capturedInputSource.current, event.inputSource)) {
        selectReleaseGuard.current.cancel(event.inputSource)
        return
      }

      const handledSpatialCancel = spatialPointerInput.cancel(event.inputSource)
      emitGridEvent('pointerup', event.frame, event.inputSource, 0)
      dispatchWindowPointerEvent('pointercancel', event.inputSource)
      if (!handledSpatialCancel && useEditor.getState().placementDragMode) {
        useViewer.getState().setInputDragging(false)
      }
      selectReleaseGuard.current.cancel(event.inputSource)
      capturedInputSource.current = null
    }

    session.addEventListener('selectstart', onSelectStart)
    session.addEventListener('selectend', onSelectEnd)
    session.addEventListener('selectcancel', onSelectCancel as unknown as EventListener)
    return () => {
      session.removeEventListener('selectstart', onSelectStart)
      session.removeEventListener('selectend', onSelectEnd)
      session.removeEventListener('selectcancel', onSelectCancel as unknown as EventListener)
      abandonTerrainStroke()
      emitter.off('wall:enter', rememberXRWallEvent)
      emitter.off('wall:move', rememberXRWallEvent)
      emitter.off('wall:leave', clearXRWallEvent)
    }
  }, [
    abandonTerrainStroke,
    createGridEvent,
    dispatchWindowPointerEvent,
    emitGridEvent,
    finishTerrainStroke,
    isWandPanelHit,
    session,
    startTerrainStroke,
  ])

  useFrame((_, __, frame) => {
    if (!(frame && session)) return
    const inputSources = Array.from(session.inputSources)
    if (shouldReleaseCapturedXRInput(inputSources, capturedInputSource.current)) {
      spatialPointerInput.cancel(capturedInputSource.current!)
      dispatchWindowPointerEvent('pointercancel', capturedInputSource.current!)
      if (useEditor.getState().placementDragMode) {
        useViewer.getState().setInputDragging(false)
      }
      selectReleaseGuard.current.cancel(capturedInputSource.current!)
      capturedInputSource.current = null
    }
    const source = selectPrimaryXRInputSource(inputSources, capturedInputSource.current)
    const panelHit = source ? isWandPanelHit(frame, source) : false
    if (source && useEditor.getState().mode === 'terrain-sculpt' && !panelHit) {
      const site = activeSite()
      if (site) {
        const field = terrainStroke.current?.stroke.snapshot ?? sculptFieldForSite(site)
        const point = terrainPoint(frame, source, field, site)
        const radius = Math.max(useEditor.getState().terrainBrush.radius, minBrushRadius(field))
        terrainFocus.current = point ? { radius, siteId: site.id, x: point[0], z: point[1] } : null
      }
    } else if (useEditor.getState().mode !== 'terrain-sculpt' || panelHit) {
      terrainFocus.current = null
    }
    if (
      source &&
      shouldRouteXRMove(source, capturedInputSource.current, panelHit) &&
      (capturedInputSource.current == null ||
        sameXRInputSource(capturedInputSource.current, source))
    ) {
      if (useEditor.getState().mode === 'terrain-sculpt') {
        if (capturedInputSource.current === source) applyTerrainDab(frame, source)
      } else {
        emitGridEvent('move', frame, source, capturedInputSource.current ? 1 : 0)
        const editor = useEditor.getState()
        if (editor.mode === 'build' && (editor.tool === 'door' || editor.tool === 'window')) {
          emitWallOpeningHover(frame, source)
        } else {
          lastSyntheticWallEvent.current = null
        }
        spatialPointerInput.move(source, raycaster.current.ray)
      }
    }

    const nextCancelPressed = isXRCancelPressed(inputSources)
    if (didXRButtonPressStart(cancelPressed.current, nextCancelPressed)) {
      abandonTerrainStroke()
      cancelActiveTool()
      const rightController = inputSources.find(
        (inputSource) => inputSource.handedness === 'right' && inputSource.gamepad != null,
      )
      if (rightController) pulseXRInputSource(rightController, 0.25, 35)
      useViewer.getState().setInputDragging(false)
    }
    cancelPressed.current = nextCancelPressed
  })

  return <XRTerrainBrushCursor focusRef={terrainFocus} />
}
