'use client'

import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  createQuickMeasurementPointerScheduler,
  resolveQuickMeasurementReport,
} from '../../lib/quick-measurement'
import {
  activateQuickMeasurementHudSource,
  clearQuickMeasurementHudSource,
  publishQuickMeasurementHudSource,
} from '../../store/use-quick-measurement-hud'
import { useFloorplanRender } from './floorplan-render-context'

type FloorplanQuickMeasureHit = {
  nodeId: string
  point: { x: number; y: number }
}

function nodeIdFromElement(element: Element | null): string | null {
  const entry = element?.closest<SVGGElement>('.floorplan-registry-entry[data-node-id]')
  return entry?.dataset.nodeId ?? null
}

function nodeIdAtPointer(svg: SVGSVGElement, event: PointerEvent): string | null {
  const direct = event.target instanceof Element ? nodeIdFromElement(event.target) : null
  if (direct) return direct
  for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
    if (!svg.contains(element)) continue
    const nodeId = nodeIdFromElement(element)
    if (nodeId) return nodeId
  }
  return null
}

function pointAtPointer(
  group: SVGGElement,
  event: PointerEvent,
): FloorplanQuickMeasureHit['point'] | null {
  const matrix = group.getScreenCTM()
  if (!matrix) return null
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  return { x: point.x, y: point.y }
}

function FloorplanSmartMarker({
  hit,
  pinned,
  unitsPerPixel,
  markerRef,
}: {
  hit?: FloorplanQuickMeasureHit
  pinned: boolean
  unitsPerPixel: number
  markerRef?: RefObject<SVGGElement | null>
}) {
  const localRef = useRef<SVGGElement>(null)
  const ref = markerRef ?? localRef

  useLayoutEffect(() => {
    if (!hit) ref.current?.setAttribute('display', 'none')
  }, [hit, ref])

  return (
    <g ref={ref} transform={hit ? `translate(${hit.point.x} ${hit.point.y})` : undefined}>
      <circle
        cx={0}
        cy={0}
        fill="none"
        r={(pinned ? 11 : 8) * unitsPerPixel}
        stroke={pinned ? '#0e7490' : '#0891b2'}
        strokeWidth={pinned ? 2.5 : 2}
        vectorEffect="non-scaling-stroke"
      />
      {pinned ? <circle cx={0} cy={0} fill="#0e7490" r={2.75 * unitsPerPixel} /> : null}
    </g>
  )
}

function showFloorplanSmartMarker(
  marker: SVGGElement | null,
  point: FloorplanQuickMeasureHit['point'],
) {
  if (!marker) return
  marker.setAttribute('transform', `translate(${point.x} ${point.y})`)
  marker.removeAttribute('display')
}

function hideFloorplanSmartMarker(marker: SVGGElement | null) {
  marker?.setAttribute('display', 'none')
}

export function FloorplanQuickMeasureLayer() {
  const groupRef = useRef<SVGGElement>(null)
  const hoverRef = useRef<FloorplanQuickMeasureHit | null>(null)
  const hoverNodeIdRef = useRef<string | null>(null)
  const candidateNodeIdRef = useRef<string | null | undefined>(undefined)
  const candidateHasReportRef = useRef(false)
  const hoverMarkerRef = useRef<SVGGElement>(null)
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null)
  const [pinned, setPinned] = useState<FloorplanQuickMeasureHit | null>(null)
  const nodes = useScene((state) => state.nodes)
  const candidateNodesRef = useRef(nodes)
  const levelId = useViewer((state) => state.selection.levelId)
  const levelRef = useRef(levelId)
  const renderContext = useFloorplanRender()
  const hoverReport = useMemo(
    () => resolveQuickMeasurementReport(hoverNodeId, nodes),
    [hoverNodeId, nodes],
  )
  const pinnedReport = useMemo(
    () => resolveQuickMeasurementReport(pinned?.nodeId ?? null, nodes),
    [pinned?.nodeId, nodes],
  )

  useEffect(() => {
    if (levelRef.current === levelId) return
    levelRef.current = levelId
    hoverRef.current = null
    hoverNodeIdRef.current = null
    candidateNodeIdRef.current = undefined
    candidateHasReportRef.current = false
    hideFloorplanSmartMarker(hoverMarkerRef.current)
    setHoverNodeId(null)
    setPinned(null)
  }, [levelId])

  useEffect(() => {
    const group = groupRef.current
    const svg = groupRef.current?.ownerSVGElement
    if (!(group && svg)) return
    const updateHover = (next: FloorplanQuickMeasureHit | null) => {
      hoverRef.current = next
      if (next) showFloorplanSmartMarker(hoverMarkerRef.current, next.point)
      else hideFloorplanSmartMarker(hoverMarkerRef.current)
      const nextNodeId = next?.nodeId ?? null
      if (nextNodeId === hoverNodeIdRef.current) return
      hoverNodeIdRef.current = nextNodeId
      setHoverNodeId(nextNodeId)
    }
    const processPointerMove = (event: PointerEvent) => {
      activateQuickMeasurementHudSource('2d')
      const candidateNodeId = nodeIdAtPointer(svg, event)
      const sceneNodes = useScene.getState().nodes
      if (candidateNodesRef.current !== sceneNodes) {
        candidateNodesRef.current = sceneNodes
        candidateNodeIdRef.current = undefined
      }
      if (candidateNodeId !== candidateNodeIdRef.current) {
        candidateNodeIdRef.current = candidateNodeId
        candidateHasReportRef.current = Boolean(
          resolveQuickMeasurementReport(candidateNodeId, sceneNodes),
        )
      }
      const point = candidateHasReportRef.current ? pointAtPointer(group, event) : null
      updateHover(candidateNodeId && point ? { nodeId: candidateNodeId, point } : null)
    }
    const pointerScheduler = createQuickMeasurementPointerScheduler(processPointerMove)
    const onPointerMove = (event: PointerEvent) => pointerScheduler.enqueue(event)
    const clear = () => {
      pointerScheduler.clear()
      updateHover(null)
    }
    const onClick = (event: MouseEvent) => {
      const next = hoverRef.current
      if (!(next && event.button === 0)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      activateQuickMeasurementHudSource('2d')
      setPinned(next)
    }

    svg.addEventListener('pointermove', onPointerMove, true)
    svg.addEventListener('pointerleave', clear)
    svg.addEventListener('click', onClick, true)
    return () => {
      svg.removeEventListener('pointermove', onPointerMove, true)
      svg.removeEventListener('pointerleave', clear)
      svg.removeEventListener('click', onClick, true)
      pointerScheduler.clear()
    }
  }, [])

  const unitsPerPixel = Math.max(renderContext?.unitsPerPixel ?? 0.01, 1e-6)
  const activeHit = hoverReport ? hoverRef.current : pinnedReport ? pinned : null
  const report = hoverReport ?? pinnedReport
  const lensState =
    pinnedReport && activeHit?.nodeId === pinned?.nodeId ? ('pinned' as const) : ('live' as const)

  useEffect(() => {
    publishQuickMeasurementHudSource('2d', report ? { lensState, report } : null)
  }, [lensState, report])

  useEffect(() => () => clearQuickMeasurementHudSource('2d'), [])

  return (
    <g pointerEvents="none" ref={groupRef}>
      {pinned && pinnedReport ? (
        <FloorplanSmartMarker hit={pinned} pinned unitsPerPixel={unitsPerPixel} />
      ) : null}
      <FloorplanSmartMarker
        markerRef={hoverMarkerRef}
        pinned={false}
        unitsPerPixel={unitsPerPixel}
      />
    </g>
  )
}

export default FloorplanQuickMeasureLayer
