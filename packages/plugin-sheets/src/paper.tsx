'use client'

/**
 * The paper.
 *
 * One SVG sized in SHEET INCHES. The title block and every plate primitive
 * are drawn by the editor's own `FloorplanGeometryRenderer` — the same
 * component the 2D editor uses — and each live viewport is a nested `<svg>`
 * whose viewBox is the world window the viewport frames, which is what makes
 * the drawing scale exact and the clipping free.
 *
 * Wheel zooms about the pointer, drag pans, double-click fits.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import { FloorplanGeometryRenderer } from '@pascal-app/editor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComposedSheet } from './page'
import { updateViewport } from './model'
import type { ViewportNode } from './schema'

const MIN_ZOOM = 4
const MAX_ZOOM = 400

function Primitives({
  list,
  renderMode,
  screenUnitsPerPixel,
  sceneRotationDeg,
}: {
  list: readonly FloorplanGeometry[]
  renderMode?: 'screen' | 'pdf'
  screenUnitsPerPixel?: number
  sceneRotationDeg?: number
}) {
  return (
    <>
      {list.map((geometry, i) => (
        <FloorplanGeometryRenderer
          // Index keys are stable here: the list is rebuilt wholesale from the
          // scene on every change, never spliced.
          key={i}
          geometry={geometry}
          renderMode={renderMode}
          screenUnitsPerPixel={screenUnitsPerPixel}
          sceneRotationDeg={sceneRotationDeg ?? 0}
          pointerEventsOverride="none"
        />
      ))}
    </>
  )
}

type Drag =
  | null
  | { mode: 'pan'; x: number; y: number; panX: number; panY: number }
  | {
      mode: 'move' | 'resize'
      id: string
      x: number
      y: number
      start: { x: number; y: number; w: number; h: number }
    }

export function Paper({
  composed,
  selectedId,
  onSelect,
  zoom,
  pan,
  onView,
}: {
  composed: ComposedSheet
  selectedId: string | null
  onSelect: (id: string | null) => void
  zoom: number
  pan: { x: number; y: number }
  onView: (zoom: number, pan: { x: number; y: number }) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<Drag>(null)
  const [, force] = useState(0)

  const fit = useCallback(() => {
    const host = hostRef.current
    if (!host) return
    const rect = host.getBoundingClientRect()
    const margin = 48
    const z = Math.max(
      MIN_ZOOM,
      Math.min(
        (rect.width - margin * 2) / composed.widthIn,
        (rect.height - margin * 2) / composed.heightIn,
      ),
    )
    onView(z, {
      x: (rect.width - composed.widthIn * z) / 2,
      y: (rect.height - composed.heightIn * z) / 2,
    })
  }, [composed.widthIn, composed.heightIn, onView])

  // Fit on first mount and whenever the paper size changes.
  const sizeKey = `${composed.widthIn}x${composed.heightIn}`
  const fittedRef = useRef<string>('')
  useEffect(() => {
    if (fittedRef.current === sizeKey) return
    fittedRef.current = sizeKey
    fit()
  }, [fit, sizeKey])

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      event.preventDefault()
      const host = hostRef.current
      if (!host) return
      const rect = host.getBoundingClientRect()
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      const factor = Math.exp(-event.deltaY * 0.0015)
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor))
      const k = next / zoom
      onView(next, { x: px - (px - pan.x) * k, y: py - (py - pan.y) * k })
    },
    [onView, pan.x, pan.y, zoom],
  )

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      const target = event.target as HTMLElement
      const handle = target.closest?.('[data-sheet-handle]') as HTMLElement | null
      const frame = target.closest?.('[data-sheet-viewport]') as HTMLElement | null
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      if (handle || frame) {
        const el = handle ?? frame
        const id = el?.dataset.sheetViewport ?? el?.dataset.sheetHandle ?? ''
        const vp = composed.placements.find((p) => p.viewport.id === id)?.viewport
        if (vp) {
          onSelect(id)
          if (vp.locked) {
            // Locked: select only. Unlock from the Layers tab to move or resize.
            dragRef.current = null
            return
          }
          dragRef.current = {
            mode: handle ? 'resize' : 'move',
            id,
            x: event.clientX,
            y: event.clientY,
            start: { x: vp.x, y: vp.y, w: vp.w, h: vp.h },
          }
          return
        }
      }
      onSelect(null)
      dragRef.current = { mode: 'pan', x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }
    },
    [composed.placements, onSelect, pan.x, pan.y],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      if (drag.mode === 'pan') {
        onView(zoom, {
          x: drag.panX + (event.clientX - drag.x),
          y: drag.panY + (event.clientY - drag.y),
        })
        return
      }
      const dx = (event.clientX - drag.x) / zoom
      const dy = (event.clientY - drag.y) / zoom
      const snap = (value: number) => Math.round(value * 8) / 8
      if (drag.mode === 'move') {
        updateViewport(drag.id, { x: snap(drag.start.x + dx), y: snap(drag.start.y + dy) })
      } else {
        updateViewport(drag.id, {
          w: Math.max(0.5, snap(drag.start.w + dx)),
          h: Math.max(0.5, snap(drag.start.h + dy)),
        })
      }
      force((n) => n + 1)
    },
    [onView, zoom],
  )

  const endDrag = useCallback(() => {
    dragRef.current = null
  }, [])

  const selected = useMemo(
    () => composed.placements.find((p) => p.viewport.id === selectedId)?.viewport,
    [composed.placements, selectedId],
  )

  return (
    <div
      ref={hostRef}
      className="relative h-full w-full overflow-hidden bg-muted/40"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={fit}
      style={{ touchAction: 'none', cursor: dragRef.current?.mode === 'pan' ? 'grabbing' : 'default' }}
    >
      <svg
        width={composed.widthIn * zoom}
        height={composed.heightIn * zoom}
        viewBox={`0 0 ${composed.widthIn} ${composed.heightIn}`}
        style={{
          position: 'absolute',
          left: pan.x,
          top: pan.y,
          boxShadow: '0 10px 40px rgba(0,0,0,0.35)',
          background: '#ffffff',
        }}
      >
        <title>{`${composed.sheet.number} ${composed.sheet.title}`}</title>
        <Primitives list={composed.plate} />

        {composed.windows.map((win, i) => {
          // World units per PDF point — IDENTICAL to the pdfkit renderer's
          // `1 / (placement.width / viewport.width)` with placement in points
          // (72 per sheet inch). Annotation geometry (dimension ticks, label
          // text) is sized in points, not metres, so passing this is what
          // makes a 1" = 20' site plan's yard dimensions legible instead of
          // sub-2 pt — and makes the screen an exact preview of the PDF.
          const unitsPerPoint = win.viewport.width / Math.max(1e-6, win.rect.w * 72)
          return (
            <svg
              key={`win-${i}`}
              x={win.rect.x}
              y={win.rect.y}
              width={win.rect.w}
              height={win.rect.h}
              viewBox={`${win.viewport.x} ${win.viewport.y} ${win.viewport.width} ${win.viewport.height}`}
              preserveAspectRatio="xMidYMid meet"
              style={{ overflow: 'hidden' }}
            >
              <g transform={`rotate(${win.rotationDeg})`}>
                {win.model && (
                  <FloorplanGeometryRenderer
                    geometry={win.model}
                    sceneRotationDeg={win.rotationDeg}
                    pointerEventsOverride="none"
                  />
                )}
                {win.annotations && (
                  <FloorplanGeometryRenderer
                    geometry={win.annotations}
                    renderMode="pdf"
                    sceneRotationDeg={win.rotationDeg}
                    annotationUnitsPerPoint={unitsPerPoint}
                    screenUnitsPerPixel={unitsPerPoint}
                    pointerEventsOverride="none"
                  />
                )}
              </g>
            </svg>
          )
        })}

        <Primitives list={composed.overlay} />

        {/* Interaction layer — one hit rect per viewport, plus a resize grip. */}
        {composed.placements.map(({ viewport }) => (
          <ViewportFrame
            key={viewport.id}
            viewport={viewport}
            selected={viewport.id === selectedId}
            unitsPerPixel={1 / zoom}
          />
        ))}
      </svg>

      <div className="pointer-events-none absolute right-3 bottom-3 rounded-md bg-card/90 px-2 py-1 font-mono text-[10px] text-muted-foreground">
        {Math.round(zoom)} px/in · {selected ? `${selected.kind} selected` : 'double-click to fit'}
      </div>
    </div>
  )
}

function ViewportFrame({
  viewport,
  selected,
  unitsPerPixel,
}: {
  viewport: ViewportNode
  selected: boolean
  unitsPerPixel: number
}) {
  const grip = Math.max(0.08, unitsPerPixel * 10)
  return (
    <g>
      <rect
        data-sheet-viewport={viewport.id}
        x={viewport.x}
        y={viewport.y}
        width={viewport.w}
        height={viewport.h}
        fill="transparent"
        stroke={selected ? '#2563eb' : 'transparent'}
        strokeWidth={unitsPerPixel * (selected ? 1.5 : 1)}
        style={{ cursor: viewport.locked ? 'default' : 'move' }}
      />
      {selected && (
        <rect
          data-sheet-handle={viewport.id}
          x={viewport.x + viewport.w - grip}
          y={viewport.y + viewport.h - grip}
          width={grip}
          height={grip}
          fill="#2563eb"
          style={{ cursor: 'nwse-resize' }}
        />
      )}
    </g>
  )
}
