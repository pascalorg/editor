'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanGeometry,
  type FloorplanPalette,
  type GeometryContext,
  getDefaultLevelName,
  isNodeKindEnabled,
  nodeRegistry,
  useScene,
} from '@pascal-app/core'
import type { Translator } from '@pascal-app/core'
import { AnyNode as AnyNodeSchema } from '@pascal-app/core/schema'
import { useViewer } from '@pascal-app/viewer'
import { Maximize2, Minus, Plus } from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  FLOORPLAN_VIEW_ROTATION_DEG,
  floorplanLocalToWorldPoint,
  worldToFloorplanLocalPoint,
} from '../../lib/floorplan'
import { getFloorplanNodeExtension } from '../../lib/floorplan/floorplan-extension'
import { buildFloorplanContext, floorplanLayerRank } from '../../lib/floorplan/floorplan-readonly'
import { useTranslations } from '../../lib/i18n'
import { subscribeNavigationSyncPose } from '../../store/navigation-sync-pose-store'
import useEditor, { type NavigationSyncPose } from '../../store/use-editor'
import {
  subscribeFloorplanCameraNavigation,
  useFloorplanCameraSyncBridge,
} from '../editor/floorplan-camera-sync'
import {
  createFloorplanNavigationSyncScheduler,
  setFloorplanCompassRotation,
} from '../editor/floorplan-navigation-presentation'
import { FloorplanGeometryRenderer } from '../editor-2d/renderers/floorplan-geometry-renderer'
import { FloorplanCompassButton } from './floorplan-compass-button'
import {
  type FloorplanBounds,
  type FloorplanViewBox,
  getFloorplanBounds,
  padFloorplanBounds,
  panFloorplanViewBox,
  scaleFloorplanViewBox,
  scaleFloorplanViewBoxBetweenClients,
} from './floorplan-preview-geometry'
import {
  cameraAzimuthFromFloorplanRotation,
  floorplanRotationFromCameraAzimuth,
  floorplanViewBoxFromNavigationPose,
  nearestEquivalentDegrees,
  rotateFloorplanPoint,
  visibleFloorplanViewWidth,
} from './floorplan-preview-navigation'

const READ_ONLY_PALETTE: FloorplanPalette = {
  selectedStroke: '#4f46e5',
  selectedFill: '#e0e7ff',
  selectedHatch: '#818cf8',
  wallHoverStroke: '#64748b',
  endpointHandleFill: '#ffffff',
  endpointHandleStroke: '#f97316',
  endpointHandleHoverStroke: '#fb923c',
  endpointHandleActiveFill: '#fed7aa',
  endpointHandleActiveStroke: '#ea580c',
  curveHandleFill: '#ffffff',
  curveHandleStroke: '#0d9488',
  curveHandleHoverStroke: '#14b8a6',
  measurementStroke: '#475569',
  measurementLabelBackground: '#ffffff',
  measurementLabelText: '#0f172a',
}
const EMPTY_PREVIEW_NODES: Record<string, AnyNode> = {}
const EMPTY_INSTALLED_PLUGINS: readonly string[] = []

export type FloorplanPreviewScene = {
  nodes: Record<string, AnyNode>
  installedPlugins?: readonly string[]
}

export type FloorplanPreviewProps = {
  className?: string
  compassHost?: Element | null
  levelId?: string | null
  navigationVisible?: boolean
  onLevelChange?: (levelId: string) => void
  scene?: FloorplanPreviewScene | null
  showCompass?: boolean
  showLevelSelector?: boolean
  synchronizeNavigation?: boolean
}

type PointerPoint = { x: number; y: number }
type DragState = {
  mode: 'pan' | 'rotate'
  pointerId: number
  point: PointerPoint
  rotationDeg: number
  viewBox: FloorplanViewBox
}
type PinchState = {
  pointerIds: [number, number]
  midpoint: PointerPoint
  distance: number
  viewBox: FloorplanViewBox
}
type FloorplanRenderEntry = {
  id: string
  geometry: FloorplanGeometry
  includeInInitialFit: boolean
}
type FloorplanSourceEntry = {
  node: AnyNode
  contextOverrides?: Pick<GeometryContext, 'children' | 'siblings' | 'parent'>
}
type MeasuredFit = { key: string; bounds: FloorplanBounds }

const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

function FloorplanCameraSyncMount() {
  useFloorplanCameraSyncBridge()
  return null
}

function boundsToViewBox(bounds: FloorplanBounds): FloorplanViewBox {
  return {
    x: bounds.minX,
    y: bounds.minY,
    width: Math.max(bounds.maxX - bounds.minX, 1),
    height: Math.max(bounds.maxY - bounds.minY, 1),
  }
}

function levelLabel(level: AnyNode, t: Translator): string {
  const named = (level as { name?: string }).name?.trim()
  if (named) return named
  return getDefaultLevelName((level as { level?: number }).level ?? 0, t)
}

function collectLevelTree(root: AnyNode, nodes: Record<string, AnyNode>): AnyNode[] {
  const result: AnyNode[] = [root]
  const seen = new Set<string>()
  const queue = [...((root as { children?: AnyNodeId[] }).children ?? [])]
  let index = 0
  while (index < queue.length) {
    const id = queue[index++]
    if (!id || seen.has(id)) continue
    seen.add(id)
    const node = nodes[id]
    if (!node) continue
    result.push(node)
    queue.push(...((node as { children?: AnyNodeId[] }).children ?? []))
  }
  return result
}

export function normalizeFloorplanPreviewNodes(
  nodes: Record<string, unknown>,
): Record<string, AnyNode> {
  const normalized: Record<string, AnyNode> = {}
  for (const [id, node] of Object.entries(nodes)) {
    const builtin = AnyNodeSchema.safeParse(node)
    if (builtin.success) {
      normalized[builtin.data.id] = builtin.data
      continue
    }
    const type =
      node && typeof node === 'object' && !Array.isArray(node)
        ? (node as { type?: unknown }).type
        : null
    const registered =
      typeof type === 'string' ? nodeRegistry.get(type)?.schema.safeParse(node) : null
    if (registered?.success) {
      const parsed = registered.data as AnyNode
      normalized[parsed.id] = parsed
    } else {
      console.warn(`[floorplan-preview] Skipping invalid node ${id}`, builtin.error.issues)
    }
  }
  return normalized
}

function isVisibleInFloorplan(node: AnyNode, nodes: Record<string, AnyNode>): boolean {
  const seen = new Set<string>()
  let current: AnyNode | undefined = node
  while (current) {
    if (seen.has(current.id)) return true
    seen.add(current.id)
    if (current.visible === false) return false
    current = current.parentId ? nodes[current.parentId] : undefined
  }
  return true
}

function buildFloorplanGeometries(
  nodes: Record<string, AnyNode>,
  installedPlugins: readonly string[] | undefined,
  level: AnyNode,
  unit: 'metric' | 'imperial',
  metricNotation: 'meters' | 'millimeters',
): FloorplanRenderEntry[] {
  const building = level.parentId ? nodes[level.parentId] : undefined
  const levelTree = collectLevelTree(level, nodes)
  const entries: FloorplanSourceEntry[] = levelTree.map((node) => ({ node }))
  const entryIds = new Set(entries.map((entry) => entry.node.id))
  if (building) {
    for (const candidate of Object.values(nodes)) {
      const definition = nodeRegistry.get(candidate.type)
      if (
        definition?.floorplanScope === 'building' &&
        candidate.parentId === building.id &&
        !entryIds.has(candidate.id)
      ) {
        entries.push({
          node: candidate,
          contextOverrides: { children: [], siblings: [], parent: level },
        })
        entryIds.add(candidate.id)
      }
    }
  }
  for (const candidate of Object.values(nodes)) {
    const definition = nodeRegistry.get(candidate.type)
    const linkedLevelIds = getFloorplanNodeExtension(definition)?.linkedLevelIds
    if (
      definition?.floorplan &&
      linkedLevelIds?.(candidate).includes(level.id) &&
      !entryIds.has(candidate.id)
    ) {
      const childIds = (candidate as { children?: AnyNodeId[] }).children
      const children = Array.isArray(childIds)
        ? childIds.map((id) => nodes[id]).filter((child): child is AnyNode => child !== undefined)
        : []
      entries.push({
        node: candidate,
        contextOverrides: { children, siblings: [], parent: level },
      })
      entryIds.add(candidate.id)
    }
  }

  const renderable = entries
    .filter((entry) => isVisibleInFloorplan(entry.node, nodes))
    .filter((entry) => isNodeKindEnabled(entry.node.type, installedPlugins))
    .filter((entry) => nodeRegistry.get(entry.node.type)?.floorplan)
    .sort((a, b) => floorplanLayerRank(a.node.type) - floorplanLayerRank(b.node.type))
  const byType = new Map<string, AnyNode[]>()
  for (const node of levelTree) {
    if (!isNodeKindEnabled(node.type, installedPlugins)) continue
    if (!nodeRegistry.get(node.type)?.computeFloorplanLevelData) continue
    const siblings = byType.get(node.type) ?? []
    siblings.push(node)
    byType.set(node.type, siblings)
  }
  const levelData = new Map<string, unknown>()
  for (const [type, siblings] of byType) {
    const definition = nodeRegistry.get(type)
    if (definition?.computeFloorplanLevelData) {
      levelData.set(type, definition.computeFloorplanLevelData({ siblings, nodes }))
    }
  }

  const geometries: FloorplanRenderEntry[] = []
  for (const { node, contextOverrides } of renderable) {
    const definition = nodeRegistry.get(node.type)
    if (!definition?.floorplan) continue
    const baseContext = buildFloorplanContext(
      node,
      nodes,
      {
        automaticDimensions: false,
        selected: false,
        unit,
        metricNotation,
        purpose: 'document',
        highlighted: false,
        hovered: false,
        moving: false,
        palette: READ_ONLY_PALETTE,
      },
      levelData.get(node.type),
    )
    const context = contextOverrides ? { ...baseContext, ...contextOverrides } : baseContext
    try {
      const geometry = definition.floorplan(node as never, context)
      if (geometry) {
        geometries.push({
          id: node.id,
          geometry,
          includeInInitialFit: definition.category !== 'furnish',
        })
      }
    } catch (error) {
      console.error(`[floorplan-preview] Failed to render ${node.type}:${node.id}`, error)
    }
  }
  return geometries
}

export function FloorplanPreview({
  className,
  compassHost,
  levelId,
  navigationVisible = true,
  onLevelChange,
  scene,
  showCompass = true,
  showLevelSelector = true,
  synchronizeNavigation = false,
}: FloorplanPreviewProps) {
  const t = useTranslations()
  const storeNodes = useScene((state) => (scene ? EMPTY_PREVIEW_NODES : state.nodes))
  const storeInstalledPlugins = useScene((state) =>
    scene ? EMPTY_INSTALLED_PLUGINS : state.installedPlugins,
  )
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const externalNodes = useMemo(
    () => (scene?.nodes ? normalizeFloorplanPreviewNodes(scene.nodes) : null),
    [scene?.nodes],
  )
  const nodes = externalNodes ?? storeNodes
  const installedPlugins = scene ? scene.installedPlugins : storeInstalledPlugins
  const levels = useMemo(
    () =>
      Object.values(nodes)
        .filter((node) => node.type === 'level')
        .sort(
          (a, b) => ((a as { level?: number }).level ?? 0) - ((b as { level?: number }).level ?? 0),
        ),
    [nodes],
  )
  const [internalLevelId, setInternalLevelId] = useState<string | null>(null)
  const activeLevelId =
    (levelId && levels.some((level) => level.id === levelId) ? levelId : null) ??
    (internalLevelId && levels.some((level) => level.id === internalLevelId)
      ? internalLevelId
      : null) ??
    levels[0]?.id ??
    null
  const activeLevel = activeLevelId ? nodes[activeLevelId as AnyNodeId] : undefined
  const activeBuilding = activeLevel?.parentId
    ? nodes[activeLevel.parentId as AnyNodeId]
    : undefined
  const buildingPosition = useMemo<[number, number, number]>(
    () => (activeBuilding?.type === 'building' ? activeBuilding.position : [0, 0, 0]),
    [activeBuilding],
  )
  const buildingRotationY = activeBuilding?.type === 'building' ? activeBuilding.rotation[1] : 0
  const buildingRotationDeg = (buildingRotationY * 180) / Math.PI
  const renderEntries = useMemo(
    () =>
      activeLevel
        ? buildFloorplanGeometries(nodes, installedPlugins, activeLevel, unit, metricNotation)
        : [],
    [activeLevel, installedPlugins, metricNotation, nodes, unit],
  )
  const framingEntries = useMemo(() => {
    const structural = renderEntries.filter((entry) => entry.includeInInitialFit)
    return structural.length > 0 ? structural : renderEntries
  }, [renderEntries])
  const fitKey = `${activeLevelId ?? 'none'}:${framingEntries.map((entry) => entry.id).join('|')}`
  const geometricFitBounds = useMemo(
    () => getFloorplanBounds(framingEntries.map((entry) => entry.geometry)),
    [framingEntries],
  )
  const [measuredFit, setMeasuredFit] = useState<MeasuredFit | null>(null)
  const fittedViewBox = useMemo(() => {
    const bounds = measuredFit?.key === fitKey ? measuredFit.bounds : geometricFitBounds
    return bounds
      ? boundsToViewBox(padFloorplanBounds(bounds))
      : { x: -5, y: -5, width: 10, height: 10 }
  }, [fitKey, geometricFitBounds, measuredFit])
  const [viewBox, setViewBox] = useState<FloorplanViewBox>(fittedViewBox)
  const viewBoxRef = useRef(viewBox)
  const interactionRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const gridRef = useRef<SVGRectElement | null>(null)
  const sceneRef = useRef<SVGGElement | null>(null)
  const compassNeedleRef = useRef<SVGSVGElement | null>(null)
  const fitElementRefs = useRef(new Map<string, SVGGElement>())
  const pointersRef = useRef(new Map<number, PointerPoint>())
  const dragRef = useRef<DragState | null>(null)
  const pinchRef = useRef<PinchState | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [isRotating, setIsRotating] = useState(false)
  const [viewportSize, setViewportSize] = useState({ width: 1000, height: 1000 })
  const [rotationDeg, setRotationDeg] = useState(0)
  const rotationDegRef = useRef(rotationDeg)
  const latestNavigationPoseRef = useRef<NavigationSyncPose | null>(null)
  const gridPatternId = useId().replaceAll(':', '')

  const updateViewBox = useCallback(
    (update: FloorplanViewBox | ((current: FloorplanViewBox) => FloorplanViewBox)) => {
      setViewBox((current) => {
        const next = typeof update === 'function' ? update(current) : update
        viewBoxRef.current = next
        return next
      })
    },
    [],
  )

  const presentViewBox = useCallback((next: FloorplanViewBox) => {
    viewBoxRef.current = next
    const value = `${next.x} ${next.y} ${next.width} ${next.height}`
    svgRef.current?.setAttribute('viewBox', value)
    const grid = gridRef.current
    if (grid) {
      grid.setAttribute('x', String(next.x))
      grid.setAttribute('y', String(next.y))
      grid.setAttribute('width', String(next.width))
      grid.setAttribute('height', String(next.height))
    }
  }, [])

  const presentRotation = useCallback(
    (nextRotationDeg: number) => {
      rotationDegRef.current = nextRotationDeg
      const sceneRotationDeg = FLOORPLAN_VIEW_ROTATION_DEG + nextRotationDeg - buildingRotationDeg
      const sceneElement = sceneRef.current
      if (sceneElement) {
        if (sceneRotationDeg === 0) sceneElement.removeAttribute('transform')
        else sceneElement.setAttribute('transform', `rotate(${sceneRotationDeg})`)
      }
      setFloorplanCompassRotation(compassNeedleRef.current, nextRotationDeg)
    },
    [buildingRotationDeg],
  )

  const commitPresentation = useCallback(
    (nextViewBox: FloorplanViewBox, nextRotationDeg: number) => {
      presentViewBox(nextViewBox)
      presentRotation(nextRotationDeg)
      setViewBox(nextViewBox)
      setRotationDeg(nextRotationDeg)
    },
    [presentRotation, presentViewBox],
  )

  const publishNavigation = useCallback(
    (nextViewBox: FloorplanViewBox, nextRotationDeg: number) => {
      if (!synchronizeNavigation) return
      const sceneRotationDeg = FLOORPLAN_VIEW_ROTATION_DEG + nextRotationDeg - buildingRotationDeg
      const displayedCenter = {
        x: nextViewBox.x + nextViewBox.width / 2,
        y: nextViewBox.y + nextViewBox.height / 2,
      }
      const localCenter = rotateFloorplanPoint(displayedCenter, -sceneRotationDeg)
      const worldCenter = floorplanLocalToWorldPoint(
        localCenter,
        buildingPosition,
        buildingRotationY,
      )
      useEditor.getState().publishNavigationSyncPose({
        source: '2d',
        target: [
          worldCenter.x,
          latestNavigationPoseRef.current?.target[1] ?? buildingPosition[1],
          worldCenter.z,
        ],
        azimuth: cameraAzimuthFromFloorplanRotation(nextRotationDeg),
        viewWidth: visibleFloorplanViewWidth(nextViewBox, viewportSize),
      })
    },
    [buildingPosition, buildingRotationDeg, buildingRotationY, synchronizeNavigation, viewportSize],
  )

  const applyNavigationPresentationRef = useRef<(pose: NavigationSyncPose) => void>(() => {})
  const commitNavigationPresentationRef = useRef<(pose: NavigationSyncPose) => void>(() => {})
  const navigationSchedulerRef = useRef<ReturnType<
    typeof createFloorplanNavigationSyncScheduler<NavigationSyncPose>
  > | null>(null)
  if (!navigationSchedulerRef.current) {
    navigationSchedulerRef.current = createFloorplanNavigationSyncScheduler<NavigationSyncPose>({
      applyPresentation: (pose) => applyNavigationPresentationRef.current(pose),
      commit: (pose) => commitNavigationPresentationRef.current(pose),
    })
  }

  applyNavigationPresentationRef.current = (pose) => {
    latestNavigationPoseRef.current = pose
    const nextRotationDeg = floorplanRotationFromCameraAzimuth(pose.azimuth, rotationDegRef.current)
    presentRotation(nextRotationDeg)
    if (!navigationVisible) return
    const localCenter = worldToFloorplanLocalPoint(
      pose.target[0],
      pose.target[2],
      buildingPosition,
      buildingRotationY,
    )
    presentViewBox(
      floorplanViewBoxFromNavigationPose(
        pose,
        localCenter,
        FLOORPLAN_VIEW_ROTATION_DEG + nextRotationDeg - buildingRotationDeg,
        viewportSize,
      ),
    )
  }

  commitNavigationPresentationRef.current = (_pose) => {
    if (!navigationVisible) return
    setViewBox(viewBoxRef.current)
    setRotationDeg(rotationDegRef.current)
  }

  useClientLayoutEffect(() => {
    let bounds: FloorplanBounds | null = null
    for (const entry of framingEntries) {
      const element = fitElementRefs.current.get(entry.id)
      if (!element || typeof element.getBBox !== 'function') continue
      let box: DOMRect
      try {
        box = element.getBBox()
      } catch {
        continue
      }
      if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) continue
      if (box.width === 0 && box.height === 0) continue
      const next = {
        minX: box.x,
        minY: box.y,
        maxX: box.x + box.width,
        maxY: box.y + box.height,
      }
      bounds = bounds
        ? {
            minX: Math.min(bounds.minX, next.minX),
            minY: Math.min(bounds.minY, next.minY),
            maxX: Math.max(bounds.maxX, next.maxX),
            maxY: Math.max(bounds.maxY, next.maxY),
          }
        : next
    }
    if (bounds) setMeasuredFit({ key: fitKey, bounds })
  }, [fitKey, framingEntries])

  useClientLayoutEffect(() => {
    if (synchronizeNavigation && latestNavigationPoseRef.current) return
    updateViewBox(fittedViewBox)
    pointersRef.current.clear()
    dragRef.current = null
    pinchRef.current = null
    setIsPanning(false)
    setIsRotating(false)
  }, [fittedViewBox, synchronizeNavigation, updateViewBox])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const updateSize = () => {
      const rect = svg.getBoundingClientRect()
      setViewportSize({ width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) })
    }
    updateSize()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize)
      return () => window.removeEventListener('resize', updateSize)
    }
    const observer = new ResizeObserver(updateSize)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  useClientLayoutEffect(() => {
    presentRotation(rotationDegRef.current)
  }, [presentRotation])

  useEffect(() => {
    if (!synchronizeNavigation) return
    const scheduler = navigationSchedulerRef.current
    if (!scheduler) return
    const receivePose = (pose: NavigationSyncPose) => {
      latestNavigationPoseRef.current = pose
      if (navigationVisible) scheduler.update(pose)
      else applyNavigationPresentationRef.current(pose)
    }
    const unsubscribeCamera = subscribeFloorplanCameraNavigation(receivePose)
    const unsubscribeStored = subscribeNavigationSyncPose((pose) => {
      if (pose.source === '2d' && !navigationVisible) receivePose(pose)
    })
    return () => {
      unsubscribeCamera()
      unsubscribeStored()
      scheduler.discard()
    }
  }, [navigationVisible, synchronizeNavigation])

  useEffect(() => {
    if (!(synchronizeNavigation && navigationVisible && latestNavigationPoseRef.current)) return
    navigationSchedulerRef.current?.update(latestNavigationPoseRef.current)
  }, [navigationVisible, synchronizeNavigation])

  const chooseLevel = useCallback(
    (nextLevelId: string) => {
      setInternalLevelId(nextLevelId)
      onLevelChange?.(nextLevelId)
    },
    [onLevelChange],
  )

  const updateLocalViewBox = useCallback(
    (
      update: FloorplanViewBox | ((current: FloorplanViewBox) => FloorplanViewBox),
      commit = true,
    ) => {
      const current = viewBoxRef.current
      const next = typeof update === 'function' ? update(current) : update
      presentViewBox(next)
      if (commit) setViewBox(next)
      publishNavigation(next, rotationDegRef.current)
      return next
    },
    [presentViewBox, publishNavigation],
  )

  const zoom = useCallback(
    (factor: number, anchorX = 0.5, anchorY = 0.5) => {
      updateLocalViewBox((current) => scaleFloorplanViewBox(current, factor, anchorX, anchorY))
    },
    [updateLocalViewBox],
  )

  const onWheel = useCallback(
    (event: ReactWheelEvent<SVGSVGElement>) => {
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      updateLocalViewBox((current) =>
        scaleFloorplanViewBoxBetweenClients(
          current,
          event.deltaY > 0 ? 1.12 : 0.88,
          rect,
          [event.clientX, event.clientY],
          [event.clientX, event.clientY],
        ),
      )
    },
    [updateLocalViewBox],
  )

  const onPointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 2) return
    event.preventDefault()
    interactionRef.current?.focus()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is an enhancement; the gesture still works while events stay over the SVG.
    }
    const point = { x: event.clientX, y: event.clientY }
    pointersRef.current.set(event.pointerId, point)
    const pointers = Array.from(pointersRef.current.entries())
    if (pointers.length === 1) {
      dragRef.current = {
        mode: event.pointerType === 'mouse' && event.button === 2 ? 'rotate' : 'pan',
        pointerId: event.pointerId,
        point,
        rotationDeg: rotationDegRef.current,
        viewBox: viewBoxRef.current,
      }
      pinchRef.current = null
    } else {
      const [first, second] = pointers
      if (!first || !second) return
      const dx = second[1].x - first[1].x
      const dy = second[1].y - first[1].y
      pinchRef.current = {
        pointerIds: [first[0], second[0]],
        midpoint: { x: (first[1].x + second[1].x) / 2, y: (first[1].y + second[1].y) / 2 },
        distance: Math.max(Math.hypot(dx, dy), 1),
        viewBox: viewBoxRef.current,
      }
      dragRef.current = null
    }
    setIsPanning(true)
    setIsRotating(dragRef.current?.mode === 'rotate')
  }, [])

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!pointersRef.current.has(event.pointerId)) return
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const rect = event.currentTarget.getBoundingClientRect()
      const pinch = pinchRef.current
      if (pinch) {
        const first = pointersRef.current.get(pinch.pointerIds[0])
        const second = pointersRef.current.get(pinch.pointerIds[1])
        if (!(first && second)) return
        const dx = second.x - first.x
        const dy = second.y - first.y
        const midpoint: PointerPoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
        updateLocalViewBox(
          scaleFloorplanViewBoxBetweenClients(
            pinch.viewBox,
            pinch.distance / Math.max(Math.hypot(dx, dy), 1),
            rect,
            [pinch.midpoint.x, pinch.midpoint.y],
            [midpoint.x, midpoint.y],
          ),
          false,
        )
        return
      }
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      if (drag.mode === 'rotate') {
        const nextRotationDeg = drag.rotationDeg + (event.clientX - drag.point.x) * 0.35
        const initialSceneRotationDeg =
          FLOORPLAN_VIEW_ROTATION_DEG + drag.rotationDeg - buildingRotationDeg
        const nextSceneRotationDeg =
          FLOORPLAN_VIEW_ROTATION_DEG + nextRotationDeg - buildingRotationDeg
        const displayedCenter = {
          x: drag.viewBox.x + drag.viewBox.width / 2,
          y: drag.viewBox.y + drag.viewBox.height / 2,
        }
        const localCenter = rotateFloorplanPoint(displayedCenter, -initialSceneRotationDeg)
        const nextCenter = rotateFloorplanPoint(localCenter, nextSceneRotationDeg)
        const nextViewBox = {
          ...drag.viewBox,
          x: nextCenter.x - drag.viewBox.width / 2,
          y: nextCenter.y - drag.viewBox.height / 2,
        }
        presentRotation(nextRotationDeg)
        presentViewBox(nextViewBox)
        publishNavigation(nextViewBox, nextRotationDeg)
        return
      }
      updateLocalViewBox(
        panFloorplanViewBox(
          drag.viewBox,
          rect,
          [drag.point.x, drag.point.y],
          [event.clientX, event.clientY],
        ),
        false,
      )
    },
    [buildingRotationDeg, presentRotation, presentViewBox, publishNavigation, updateLocalViewBox],
  )

  const onPointerUp = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    pointersRef.current.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    pinchRef.current = null
    const [remaining] = pointersRef.current.entries()
    if (remaining) {
      dragRef.current = {
        mode: 'pan',
        pointerId: remaining[0],
        point: remaining[1],
        rotationDeg: rotationDegRef.current,
        viewBox: viewBoxRef.current,
      }
      setIsRotating(false)
    } else {
      dragRef.current = null
      setIsPanning(false)
      setIsRotating(false)
      setViewBox(viewBoxRef.current)
      setRotationDeg(rotationDegRef.current)
    }
  }, [])

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const panStep = 0.08
      switch (event.key) {
        case '+':
        case '=':
          event.preventDefault()
          zoom(0.8)
          return
        case '-':
        case '_':
          event.preventDefault()
          zoom(1.2)
          return
        case '0':
        case 'f':
        case 'F':
          event.preventDefault()
          updateLocalViewBox(fittedViewBox)
          return
        case 'ArrowLeft':
          event.preventDefault()
          updateLocalViewBox((current) => ({
            ...current,
            x: current.x - current.width * panStep,
          }))
          return
        case 'ArrowRight':
          event.preventDefault()
          updateLocalViewBox((current) => ({
            ...current,
            x: current.x + current.width * panStep,
          }))
          return
        case 'ArrowUp':
          event.preventDefault()
          updateLocalViewBox((current) => ({
            ...current,
            y: current.y - current.height * panStep,
          }))
          return
        case 'ArrowDown':
          event.preventDefault()
          updateLocalViewBox((current) => ({
            ...current,
            y: current.y + current.height * panStep,
          }))
      }
    },
    [fittedViewBox, updateLocalViewBox, zoom],
  )

  const alignToNorth = useCallback(() => {
    const currentRotationDeg = rotationDegRef.current
    const nextRotationDeg = nearestEquivalentDegrees(0, currentRotationDeg)
    if (!navigationVisible) {
      const pose = latestNavigationPoseRef.current
      if (!pose) return
      useEditor.getState().publishNavigationSyncPose({
        source: '2d',
        target: [...pose.target],
        azimuth: cameraAzimuthFromFloorplanRotation(nextRotationDeg),
        viewWidth: pose.viewWidth,
      })
      return
    }

    const currentViewBox = viewBoxRef.current
    const currentSceneRotationDeg =
      FLOORPLAN_VIEW_ROTATION_DEG + currentRotationDeg - buildingRotationDeg
    const nextSceneRotationDeg = FLOORPLAN_VIEW_ROTATION_DEG + nextRotationDeg - buildingRotationDeg
    const currentCenter = {
      x: currentViewBox.x + currentViewBox.width / 2,
      y: currentViewBox.y + currentViewBox.height / 2,
    }
    const localCenter = rotateFloorplanPoint(currentCenter, -currentSceneRotationDeg)
    const nextCenter = rotateFloorplanPoint(localCenter, nextSceneRotationDeg)
    const nextViewBox = {
      ...currentViewBox,
      x: nextCenter.x - currentViewBox.width / 2,
      y: nextCenter.y - currentViewBox.height / 2,
    }
    commitPresentation(nextViewBox, nextRotationDeg)
    publishNavigation(nextViewBox, nextRotationDeg)
  }, [buildingRotationDeg, commitPresentation, navigationVisible, publishNavigation])

  const screenUnitsPerPixel = Math.max(
    viewBox.width / Math.max(viewportSize.width, 1),
    viewBox.height / Math.max(viewportSize.height, 1),
  )

  const compassControl = (
    <FloorplanCompassButton
      needleRef={compassNeedleRef}
      northRotationDeg={rotationDeg}
      onAlignNorth={alignToNorth}
    />
  )

  if (levels.length === 0) {
    return (
      <div
        className={className}
        style={{ display: 'grid', placeItems: 'center', background: '#f8fafc', color: '#64748b' }}
      >
        No floor plans are available for this scene.
      </div>
    )
  }

  return (
    <div
      className={className}
      style={{ position: 'relative', overflow: 'hidden', background: '#f8fafc' }}
    >
      {synchronizeNavigation ? <FloorplanCameraSyncMount /> : null}
      <div
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight + - 0 F"
        aria-label={`${activeLevel ? levelLabel(activeLevel, t) : 'Floor plan'} 2D view`}
        onKeyDown={onKeyDown}
        role="application"
        ref={interactionRef}
        style={{ width: '100%', height: '100%' }}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The plan canvas supports keyboard pan, zoom, and fit controls.
        tabIndex={0}
      >
        <svg
          aria-hidden="true"
          data-floorplan-preview=""
          onContextMenu={(event) => event.preventDefault()}
          onPointerCancel={onPointerUp}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
          preserveAspectRatio="xMidYMid meet"
          ref={svgRef}
          style={{
            width: '100%',
            height: '100%',
            cursor: isRotating ? 'ew-resize' : isPanning ? 'grabbing' : 'grab',
            touchAction: 'none',
          }}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        >
          <defs>
            <pattern height="1" id={gridPatternId} patternUnits="userSpaceOnUse" width="1">
              <path
                d="M 1 0 L 0 0 0 1"
                fill="none"
                stroke="#cbd5e1"
                strokeOpacity="0.32"
                strokeWidth="0.012"
              />
            </pattern>
          </defs>
          <rect
            fill={`url(#${gridPatternId})`}
            height={viewBox.height}
            ref={gridRef}
            width={viewBox.width}
            x={viewBox.x}
            y={viewBox.y}
          />
          <g
            pointerEvents="none"
            ref={sceneRef}
            transform={
              FLOORPLAN_VIEW_ROTATION_DEG + rotationDeg - buildingRotationDeg === 0
                ? undefined
                : `rotate(${FLOORPLAN_VIEW_ROTATION_DEG + rotationDeg - buildingRotationDeg})`
            }
          >
            {renderEntries.map((entry) => (
              <g
                key={entry.id}
                ref={(element) => {
                  if (element) fitElementRefs.current.set(entry.id, element)
                  else fitElementRefs.current.delete(entry.id)
                }}
              >
                <FloorplanGeometryRenderer
                  geometry={entry.geometry}
                  pointerEventsOverride="none"
                  screenUnitsPerPixel={screenUnitsPerPixel}
                />
              </g>
            ))}
          </g>
        </svg>
      </div>

      {showLevelSelector && levels.length > 1 ? (
        <label
          style={{
            position: 'absolute',
            bottom: 16,
            left: 64,
            display: 'grid',
            gap: 4,
            color: '#475569',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {t('editor.floor')}
          <select
            aria-label={t('editor.floor')}
            onChange={(event) => chooseLevel(event.target.value)}
            style={{
              border: '1px solid rgba(148,163,184,.55)',
              borderRadius: 999,
              background: 'rgba(255,255,255,.94)',
              padding: '8px 30px 8px 12px',
              color: '#0f172a',
              boxShadow: '0 8px 24px rgba(15,23,42,.10)',
            }}
            value={activeLevelId ?? ''}
          >
            {levels.map((level) => (
              <option key={level.id} value={level.id}>
                {levelLabel(level, t)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {showCompass
        ? compassHost
          ? createPortal(compassControl, compassHost)
          : compassControl
        : null}

      <div
        style={{
          position: 'absolute',
          right: 16,
          bottom: 16,
          display: 'flex',
          gap: 4,
          border: '1px solid rgba(148,163,184,.45)',
          borderRadius: 999,
          background: 'rgba(255,255,255,.94)',
          padding: 4,
          boxShadow: '0 8px 24px rgba(15,23,42,.10)',
        }}
      >
        <button
          aria-label={t('editor.zoomOut')}
          onClick={() => zoom(1.2)}
          style={controlStyle}
          title={t('editor.zoomOut')}
          type="button"
        >
          <Minus size={16} />
        </button>
        <button
          aria-label={t('editor.fitFloorPlan')}
          onClick={() => updateLocalViewBox(fittedViewBox)}
          style={controlStyle}
          title={t('editor.fitFloorPlan')}
          type="button"
        >
          <Maximize2 size={15} />
        </button>
        <button
          aria-label={t('editor.zoomIn')}
          onClick={() => zoom(0.8)}
          style={controlStyle}
          title={t('editor.zoomIn')}
          type="button"
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  )
}

const controlStyle = {
  display: 'grid',
  width: 32,
  height: 32,
  placeItems: 'center',
  border: 0,
  borderRadius: 999,
  background: 'transparent',
  color: '#334155',
  cursor: 'pointer',
} as const
