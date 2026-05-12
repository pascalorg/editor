'use client'

import { emitter } from '@pascal-app/core'
import { Camera, Check, Crop, Loader2, Maximize2, Monitor, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../hooks/use-mobile'
import { triggerSFX } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'

type CaptureMode = 'standard' | 'viewport' | 'area'
type CaptureState = 'idle' | 'capturing' | 'saved'

interface DragPoint {
  x: number
  y: number
}

interface Drag {
  start: DragPoint
  end: DragPoint
}

function getResolution(
  mode: CaptureMode,
  overlayEl: HTMLDivElement | null,
  drag: Drag | null,
): { w: number; h: number } | null {
  if (mode === 'standard') return { w: 1920, h: 1080 }

  if (!overlayEl) return null
  const rect = overlayEl.getBoundingClientRect()
  const dpr = Math.min(window.devicePixelRatio, 1.5)

  if (mode === 'viewport') {
    return { w: Math.round(rect.width * dpr), h: Math.round(rect.height * dpr) }
  }

  if (mode === 'area' && drag) {
    const w = Math.abs(drag.end.x - drag.start.x)
    const h = Math.abs(drag.end.y - drag.start.y)
    if (w < 4 || h < 4) return null
    return { w: Math.round(w * dpr), h: Math.round(h * dpr) }
  }

  return null
}

export function SnapshotCaptureOverlay({ projectId }: { projectId: string }) {
  const isCaptureMode = useEditor((s) => s.isCaptureMode)
  const setCaptureMode = useEditor((s) => s.setCaptureMode)
  const isMobile = useIsMobile()

  const [mode, setMode] = useState<CaptureMode>('standard')
  const [drag, setDrag] = useState<Drag | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [captureState, setCaptureState] = useState<CaptureState>('idle')
  const overlayRef = useRef<HTMLDivElement>(null)

  // Dismiss on Esc
  useEffect(() => {
    if (!isCaptureMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCaptureMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isCaptureMode, setCaptureMode])

  // Reset local state when entering capture mode
  useEffect(() => {
    if (isCaptureMode) {
      setMode('standard')
      setDrag(null)
      setIsDragging(false)
      setCaptureState('idle')
    }
  }, [isCaptureMode])

  // Listen for snapshot saved to show feedback then exit
  useEffect(() => {
    const handler = () => {
      setCaptureState('saved')
      setTimeout(() => {
        setCaptureMode(false)
        setCaptureState('idle')
      }, 1500)
    }
    emitter.on('snapshot:saved', handler)
    return () => emitter.off('snapshot:saved', handler)
  }, [setCaptureMode])

  const dismiss = useCallback(() => setCaptureMode(false), [setCaptureMode])

  // Tracks whether the active drag is a "move entire rect" gesture
  const moveStartRef = useRef<{ pt: DragPoint; drag: Drag } | null>(null)

  // Area drag handlers — relative to the overlay container
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (mode !== 'area' || captureState !== 'idle') return
      e.preventDefault()
      const rect = overlayRef.current!.getBoundingClientRect()
      const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top }

      // If clicking inside an existing selection → move mode
      if (drag) {
        const x0 = Math.min(drag.start.x, drag.end.x)
        const y0 = Math.min(drag.start.y, drag.end.y)
        const x1 = Math.max(drag.start.x, drag.end.x)
        const y1 = Math.max(drag.start.y, drag.end.y)
        if (pt.x >= x0 && pt.x <= x1 && pt.y >= y0 && pt.y <= y1) {
          moveStartRef.current = { pt, drag }
          setIsDragging(true)
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          return
        }
      }

      // Outside / no selection → start new drag
      moveStartRef.current = null
      setDrag({ start: pt, end: pt })
      setIsDragging(true)
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [mode, captureState, drag],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return
      const rect = overlayRef.current!.getBoundingClientRect()
      const pt = {
        x: Math.max(0, Math.min(e.clientX - rect.left, rect.width)),
        y: Math.max(0, Math.min(e.clientY - rect.top, rect.height)),
      }
      if (moveStartRef.current) {
        // Move mode: translate the whole rect by the delta
        const { pt: origin, drag: snapshot } = moveStartRef.current
        const dx = pt.x - origin.x
        const dy = pt.y - origin.y
        setDrag({
          start: { x: snapshot.start.x + dx, y: snapshot.start.y + dy },
          end: { x: snapshot.end.x + dx, y: snapshot.end.y + dy },
        })
      } else {
        setDrag((d) => (d ? { start: d.start, end: pt } : null))
      }
    },
    [isDragging],
  )

  const onPointerUp = useCallback(() => {
    const wasMoving = moveStartRef.current !== null
    setIsDragging(false)
    moveStartRef.current = null
    // Clear the rect if the user just clicked without drawing (not a move gesture)
    if (!wasMoving) {
      setDrag((d) => {
        if (!d) return null
        const w = Math.abs(d.end.x - d.start.x)
        const h = Math.abs(d.end.y - d.start.y)
        return w < 4 && h < 4 ? null : d
      })
    }
  }, [])

  // Corner-handle resize: re-anchor to the opposite corner then reuse the same drag machinery
  const onCornerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, cornerIndex: number) => {
      if (captureState !== 'idle' || !drag) return
      e.stopPropagation()
      e.preventDefault()
      moveStartRef.current = null
      const x0 = Math.min(drag.start.x, drag.end.x)
      const y0 = Math.min(drag.start.y, drag.end.y)
      const x1 = Math.max(drag.start.x, drag.end.x)
      const y1 = Math.max(drag.start.y, drag.end.y)
      // anchor = opposite corner; dragged = current corner
      const corners: [DragPoint, DragPoint][] = [
        [
          { x: x1, y: y1 },
          { x: x0, y: y0 },
        ], // TL → anchor BR
        [
          { x: x0, y: y1 },
          { x: x1, y: y0 },
        ], // TR → anchor BL
        [
          { x: x1, y: y0 },
          { x: x0, y: y1 },
        ], // BL → anchor TR
        [
          { x: x0, y: y0 },
          { x: x1, y: y1 },
        ], // BR → anchor TL
      ]
      const [anchor, current] = corners[cornerIndex]!
      setDrag({ start: anchor, end: current })
      setIsDragging(true)
    },
    [captureState, drag],
  )

  const handleCapture = useCallback(() => {
    if (captureState !== 'idle') return

    let cropRegion: { x: number; y: number; width: number; height: number } | undefined
    if (mode === 'area' && drag && overlayRef.current) {
      const rect = overlayRef.current.getBoundingClientRect()
      const x0 = Math.min(drag.start.x, drag.end.x)
      const y0 = Math.min(drag.start.y, drag.end.y)
      const w = Math.abs(drag.end.x - drag.start.x)
      const h = Math.abs(drag.end.y - drag.start.y)
      cropRegion = {
        x: x0 / rect.width,
        y: y0 / rect.height,
        width: w / rect.width,
        height: h / rect.height,
      }
    }

    setCaptureState('capturing')
    triggerSFX('sfx:snapshot-capture')
    emitter.emit('camera-controls:generate-thumbnail', {
      projectId,
      captureMode: mode,
      cropRegion,
    })
  }, [captureState, mode, drag, projectId])

  if (!isCaptureMode) return null

  const resolution = getResolution(mode, overlayRef.current, drag)

  // Area selection rect (CSS px, relative to overlay)
  const selectionStyle =
    mode === 'area' && drag
      ? {
          left: Math.min(drag.start.x, drag.end.x),
          top: Math.min(drag.start.y, drag.end.y),
          width: Math.abs(drag.end.x - drag.start.x),
          height: Math.abs(drag.end.y - drag.start.y),
        }
      : null

  const hasSelection =
    selectionStyle != null && selectionStyle.width > 3 && selectionStyle.height > 3

  const captureDisabled = captureState !== 'idle' || (mode === 'area' && !hasSelection)

  return (
    <div className="pointer-events-none absolute inset-0 z-40" ref={overlayRef}>
      {/* Area mode: dim layer + crosshair cursor + drag-to-select */}
      {mode === 'area' && (
        <div
          className="pointer-events-auto absolute inset-0 bg-black/30"
          onPointerDown={onPointerDown}
          onPointerMove={(e) => {
            onPointerMove(e)
            // Update cursor: 'move' when hovering inside an existing selection
            if (!isDragging && drag && overlayRef.current) {
              const rect = overlayRef.current.getBoundingClientRect()
              const px = e.clientX - rect.left
              const py = e.clientY - rect.top
              const x0 = Math.min(drag.start.x, drag.end.x)
              const y0 = Math.min(drag.start.y, drag.end.y)
              const x1 = Math.max(drag.start.x, drag.end.x)
              const y1 = Math.max(drag.start.y, drag.end.y)
              e.currentTarget.style.cursor =
                px >= x0 && px <= x1 && py >= y0 && py <= y1 ? 'move' : 'crosshair'
            }
          }}
          onPointerUp={onPointerUp}
          style={{ cursor: 'crosshair' }}
        >
          {/* "No selection" hint */}
          {!selectionStyle && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="rounded-full bg-black/40 px-4 py-2 text-sm text-white backdrop-blur-sm">
                Drag the area you want to capture
              </span>
            </div>
          )}

          {/* Selection rect */}
          {selectionStyle && (
            <div
              style={{
                position: 'absolute',
                left: selectionStyle.left,
                top: selectionStyle.top,
                width: selectionStyle.width,
                height: selectionStyle.height,
                pointerEvents: 'none',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
                border: '2px dashed rgba(255,255,255,0.85)',
                background: 'rgba(255,255,255,0.04)',
              }}
            >
              {/* Corner handles */}
              {(
                [
                  { pos: { top: -5, left: -5 }, cursor: 'nwse-resize' },
                  { pos: { top: -5, right: -5 }, cursor: 'nesw-resize' },
                  { pos: { bottom: -5, left: -5 }, cursor: 'nesw-resize' },
                  { pos: { bottom: -5, right: -5 }, cursor: 'nwse-resize' },
                ] as const
              ).map(({ pos, cursor }, i) => (
                <div
                  key={i}
                  onPointerDown={(e) => onCornerPointerDown(e, i)}
                  style={{
                    position: 'absolute',
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: 'white',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
                    pointerEvents: 'auto',
                    cursor,
                    ...pos,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Top-right dismiss button (icon-only on mobile) */}
      <div className="pointer-events-auto absolute top-4 right-4">
        <button
          aria-label="Close capture mode"
          className="flex items-center gap-1.5 rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-white/80 text-xs backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white"
          onClick={dismiss}
          type="button"
        >
          <X className="h-3 w-3" />
          {!isMobile && 'Esc to cancel'}
        </button>
      </div>

      {/* Bottom-center mode toolbar */}
      <div className="pointer-events-auto absolute bottom-6 left-1/2 -translate-x-1/2">
        {(() => {
          const modeButtons = (
            <>
              <ModeButton
                active={mode === 'standard'}
                badge="16:9"
                icon={<Monitor className="h-3.5 w-3.5" />}
                label="Standard"
                onClick={() => {
                  setMode('standard')
                  setDrag(null)
                }}
              />
              <ModeButton
                active={mode === 'viewport'}
                icon={<Maximize2 className="h-3.5 w-3.5" />}
                label="Viewport"
                onClick={() => {
                  setMode('viewport')
                  setDrag(null)
                }}
              />
              <ModeButton
                active={mode === 'area'}
                icon={<Crop className="h-3.5 w-3.5" />}
                label="Area"
                onClick={() => setMode('area')}
              />
            </>
          )

          const resolutionDisplay = (
            <span className="min-w-[80px] text-center text-white/50 text-xs tabular-nums">
              {resolution ? `${resolution.w} × ${resolution.h}` : '—'}
            </span>
          )

          const captureButton = (
            <button
              className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 font-medium text-primary-foreground text-xs transition-opacity disabled:opacity-50"
              disabled={captureDisabled}
              onClick={handleCapture}
              type="button"
            >
              {captureState === 'capturing' ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Capturing
                </>
              ) : captureState === 'saved' ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Saved
                </>
              ) : (
                <>
                  <Camera className="h-3.5 w-3.5" />
                  Capture
                </>
              )}
            </button>
          )

          if (isMobile) {
            return (
              <div className="flex flex-col items-stretch gap-2 rounded-2xl border border-white/10 bg-neutral-900/95 px-2 py-2 shadow-xl backdrop-blur-md">
                <div className="flex items-center justify-center gap-1">{modeButtons}</div>
                <div className="flex items-center justify-center gap-2 border-white/10 border-t pt-2">
                  {resolutionDisplay}
                  {captureButton}
                </div>
              </div>
            )
          }

          return (
            <div className="flex items-center gap-1 rounded-full border border-white/10 bg-neutral-900/95 px-2 py-2 shadow-xl backdrop-blur-md">
              {modeButtons}
              <div className="mx-1 h-4 w-px bg-white/10" />
              {resolutionDisplay}
              <div className="mx-1 h-4 w-px bg-white/10" />
              {captureButton}
            </div>
          )
        })()}
      </div>
    </div>
  )
}

function ModeButton({
  active,
  icon,
  label,
  badge,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  badge?: string
  onClick: () => void
}) {
  return (
    <button
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors ${
        active ? 'bg-white/15 text-white ring-1 ring-white/20' : 'text-white/50 hover:text-white/90'
      }`}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
      {badge && (
        <span className="rounded-sm bg-white/10 px-1 py-0.5 font-medium text-[10px] text-white/40 leading-none">
          {badge}
        </span>
      )}
    </button>
  )
}
