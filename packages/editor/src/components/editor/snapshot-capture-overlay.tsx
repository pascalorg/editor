'use client'

import { emitter } from '@pascal-app/core'
import { Check, Crop, Loader2, Maximize2, Monitor, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../hooks/use-mobile'
import { triggerSFX } from '../../lib/sfx-bus'
import useEditor, {
  type SnapshotCropMode,
  type SnapshotStandardAspect,
} from '../../store/use-editor'

// Local alias — distinct from `useEditor.captureMode` (which describes *why*
// a capture is happening, e.g. `preset`). This one says HOW the captured
// pixels are cropped: full-frame 16:9 (`standard`), raw canvas viewport, or
// user-dragged area. Hosts can preselect it via `captureMode.crop`.
type CropMode = SnapshotCropMode
type CaptureState = 'idle' | 'capturing' | 'saved'

interface DragPoint {
  x: number
  y: number
}

interface Drag {
  start: DragPoint
  end: DragPoint
}

// Output presets for `standard` captures — long edge stays near 1920.
const STANDARD_SIZES: Record<SnapshotStandardAspect, { w: number; h: number }> = {
  '16:9': { w: 1920, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
  '4:3': { w: 1920, h: 1440 },
  '3:4': { w: 1440, h: 1920 },
  '1:1': { w: 1440, h: 1440 },
}
type StandardAspect = SnapshotStandardAspect

function getResolution(
  mode: CropMode,
  overlayEl: HTMLDivElement | null,
  drag: Drag | null,
  standardAspect: StandardAspect,
): { w: number; h: number } | null {
  if (mode === 'standard') return STANDARD_SIZES[standardAspect]

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

/** Rule-of-thirds guide rendered inside a framing surface. */
function ThirdsGrid() {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        background: `
          linear-gradient(to right, transparent calc(33.33% - 0.5px), rgba(255,255,255,0.16) 33.33%, transparent calc(33.33% + 0.5px)),
          linear-gradient(to right, transparent calc(66.66% - 0.5px), rgba(255,255,255,0.16) 66.66%, transparent calc(66.66% + 0.5px)),
          linear-gradient(to bottom, transparent calc(33.33% - 0.5px), rgba(255,255,255,0.16) 33.33%, transparent calc(33.33% + 0.5px)),
          linear-gradient(to bottom, transparent calc(66.66% - 0.5px), rgba(255,255,255,0.16) 66.66%, transparent calc(66.66% + 0.5px))`,
      }}
    />
  )
}

/** Accented corner brackets on the framing rect. */
function CornerAccents() {
  return (
    <>
      <span className="pointer-events-none absolute -top-0.5 -left-0.5 h-5 w-5 rounded-tl-md border-primary border-t-[2.5px] border-l-[2.5px]" />
      <span className="pointer-events-none absolute -right-0.5 -bottom-0.5 h-5 w-5 rounded-br-md border-primary border-r-[2.5px] border-b-[2.5px]" />
    </>
  )
}

const HUD_CHIP_CLASS =
  'flex flex-col gap-px rounded-lg border border-white/10 bg-neutral-950/85 px-3 py-1.5 backdrop-blur-md'

const CROP_LABELS: Record<CropMode, string> = {
  standard: 'Standard',
  viewport: 'Viewport',
  area: 'Area',
}

export function SnapshotCaptureOverlay({ projectId }: { projectId: string }) {
  const isCaptureMode = useEditor((s) => s.isCaptureMode)
  const captureMode = useEditor((s) => s.captureMode)
  const setCaptureMode = useEditor((s) => s.setCaptureMode)
  const isMobile = useIsMobile()
  // `preset` capture mode locks the overlay to a square area crop with
  // a transparent background — the user picks framing but not the
  // crop shape. Matches the unified preset-thumbnail capture flow.
  const isPreset = captureMode.mode === 'preset'
  const requestedCrop = captureMode.mode === 'standard' ? captureMode.crop : undefined
  const requestedAspect = captureMode.mode === 'standard' ? captureMode.standardAspect : undefined

  const [mode, setMode] = useState<CropMode>('standard')
  const [standardAspect, setStandardAspect] = useState<StandardAspect>('16:9')
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [captureState, setCaptureState] = useState<CaptureState>('idle')
  const overlayRef = useRef<HTMLDivElement>(null)
  // Overlay size drives the computed standard-frame rect + resolution HUD.
  const [overlaySize, setOverlaySize] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    if (!isCaptureMode) return
    const el = overlayRef.current
    if (!el) return
    const update = () => setOverlaySize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [isCaptureMode])

  // Dismiss on Esc
  useEffect(() => {
    if (!isCaptureMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCaptureMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isCaptureMode, setCaptureMode])

  // Reset local state when entering capture mode. Preset mode also
  // auto-stages a centered square crop sized to ~75% of the shorter
  // viewport dimension so the user can capture immediately — the
  // overlay's pan/move/resize handles still apply if they want to
  // tweak the framing, but they don't have to draw the rect first.
  useEffect(() => {
    if (!isCaptureMode) return
    setMode(isPreset ? 'area' : (requestedCrop ?? 'standard'))
    setStandardAspect(requestedAspect ?? '16:9')
    setAspectMenuOpen(false)
    setIsDragging(false)
    setCaptureState('idle')
    if (isPreset && overlayRef.current) {
      const rect = overlayRef.current.getBoundingClientRect()
      const side = Math.min(rect.width, rect.height) * 0.75
      const cx = rect.width / 2
      const cy = rect.height / 2
      setDrag({
        start: { x: cx - side / 2, y: cy - side / 2 },
        end: { x: cx + side / 2, y: cy + side / 2 },
      })
    } else {
      setDrag(null)
    }
  }, [isCaptureMode, isPreset, requestedCrop, requestedAspect])

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
      } else if (isPreset) {
        // Preset mode locks the rect to a square — use the smaller
        // axis to keep the drag predictable, sign-correct so the user
        // can still drag in any quadrant.
        setDrag((d) => {
          if (!d) return null
          const dx = pt.x - d.start.x
          const dy = pt.y - d.start.y
          const side = Math.min(Math.abs(dx), Math.abs(dy))
          return {
            start: d.start,
            end: {
              x: d.start.x + Math.sign(dx || 1) * side,
              y: d.start.y + Math.sign(dy || 1) * side,
            },
          }
        })
      } else {
        setDrag((d) => (d ? { start: d.start, end: pt } : null))
      }
    },
    [isDragging, isPreset],
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
      standardSize: mode === 'standard' ? STANDARD_SIZES[standardAspect] : undefined,
      // In preset mode, the ThumbnailGenerator should keep the alpha
      // channel transparent so the saved preset thumbnail composes
      // cleanly onto any palette background.
      transparent: isPreset,
    })
  }, [captureState, mode, drag, projectId, isPreset, standardAspect])

  if (!isCaptureMode) return null

  const resolution = getResolution(mode, overlayRef.current, drag, standardAspect)

  // Standard mode framing: the output is a center-crop of the canvas to the
  // chosen aspect (see ThumbnailGenerator) — show exactly that region as a
  // letterboxed frame.
  const standardFrame =
    mode === 'standard' && overlaySize
      ? (() => {
          const size = STANDARD_SIZES[standardAspect]
          const targetRatio = size.w / size.h
          const w = Math.min(overlaySize.w, overlaySize.h * targetRatio)
          const h = w / targetRatio
          return {
            left: (overlaySize.w - w) / 2,
            top: (overlaySize.h - h) / 2,
            width: w,
            height: h,
          }
        })()
      : null

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
      {/* Standard mode: letterboxed 16:9 frame with thirds + corner accents */}
      {standardFrame && (
        <div
          className="pointer-events-none absolute rounded-md border-[1.5px] border-white/85"
          style={{
            ...standardFrame,
            boxShadow: '0 0 0 9999px rgba(10,10,14,0.4)',
          }}
        >
          <ThirdsGrid />
          <CornerAccents />
        </div>
      )}

      {/* Viewport mode: the whole canvas is the frame — thirds only */}
      {mode === 'viewport' && <ThirdsGrid />}

      {/* Area mode: dim layer + crosshair cursor + drag-to-select.
       *
       * Preset mode reuses the same DOM but stays click-through: the
       * crop frame is auto-staged and locked, so the user adjusts the
       * camera (orbit / pan / zoom) instead of dragging the rect. The
       * dim letterbox + dashed border still render via the inline
       * `box-shadow` on the selection rect — they're cosmetic. */}
      {mode === 'area' && (
        <div
          className={
            isPreset
              ? 'pointer-events-none absolute inset-0'
              : 'pointer-events-auto absolute inset-0 bg-black/30'
          }
          onPointerDown={isPreset ? undefined : onPointerDown}
          onPointerMove={
            isPreset
              ? undefined
              : (e) => {
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
                }
          }
          onPointerUp={isPreset ? undefined : onPointerUp}
          style={isPreset ? undefined : { cursor: 'crosshair' }}
        >
          {/* "No selection" hint — only when the user has to draw the
              area themselves (`standard` capture). Preset mode always
              has a pre-staged square, so we never show it there. */}
          {!selectionStyle && !isPreset && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="rounded-full border border-white/10 bg-neutral-950/80 px-4 py-2 text-sm text-white backdrop-blur-md">
                Drag the area you want to capture
              </span>
            </div>
          )}

          {/* Selection rect */}
          {selectionStyle && (
            <div
              className="rounded-sm border-[1.5px] border-white/85"
              style={{
                position: 'absolute',
                left: selectionStyle.left,
                top: selectionStyle.top,
                width: selectionStyle.width,
                height: selectionStyle.height,
                pointerEvents: 'none',
                boxShadow: '0 0 0 9999px rgba(10,10,14,0.4)',
                background: 'rgba(255,255,255,0.03)',
              }}
            >
              {hasSelection && <ThirdsGrid />}
              <CornerAccents />
              {/* Corner handles — preset mode locks the frame to the
                  auto-staged centered square; the user adjusts the
                  camera instead. */}
              {!isPreset &&
                (
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

      {/* Top-center HUD — what the shot will be. Preset captures are a fixed
          square and carry their own "Frame your item" banner up there. */}
      {!isMobile && !isPreset && (
        <div className="pointer-events-none absolute top-4 left-1/2 flex -translate-x-1/2 gap-2">
          <div className={HUD_CHIP_CLASS}>
            <span className="font-mono text-[8.5px] text-white/50 uppercase tracking-[0.14em]">
              Crop
            </span>
            <span className="font-semibold text-white text-xs">
              {isPreset ? 'Preset · square' : CROP_LABELS[mode]}
            </span>
          </div>
          <div className={HUD_CHIP_CLASS}>
            <span className="font-mono text-[8.5px] text-white/50 uppercase tracking-[0.14em]">
              Format
            </span>
            <span className="font-semibold text-white text-xs tabular-nums">
              {resolution ? `${resolution.w} × ${resolution.h}` : '—'}
            </span>
          </div>
        </div>
      )}

      {/* Top-right dismiss button (icon-only on mobile) */}
      <div className="pointer-events-auto absolute top-4 right-4">
        <button
          aria-label="Close capture mode"
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-neutral-950/85 px-3 py-1.5 text-white/80 text-xs backdrop-blur-md transition-colors hover:bg-neutral-950 hover:text-white"
          onClick={dismiss}
          type="button"
        >
          <X className="h-3 w-3" />
          {!isMobile && 'Esc to cancel'}
        </button>
      </div>

      {/* Subtle scrim so the bottom controls stay readable on bright scenes */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-black/45 via-black/15 to-transparent" />

      {/* Bottom-center: crop switcher, caption + shutter */}
      <div className="pointer-events-none absolute right-0 bottom-5 left-0 flex flex-col items-center gap-2.5">
        {!isPreset && (
          <div className="pointer-events-auto relative flex items-center gap-1 rounded-full border border-white/10 bg-neutral-950/85 px-1.5 py-1.5 shadow-xl backdrop-blur-md">
            {/* Clicking Standard while it's active opens the aspect picker */}
            <ModeButton
              active={mode === 'standard'}
              badge={standardAspect}
              icon={<Monitor className="h-3.5 w-3.5" />}
              label={isMobile ? undefined : 'Standard'}
              onClick={() => {
                if (mode === 'standard') setAspectMenuOpen((v) => !v)
                else setAspectMenuOpen(false)
                setMode('standard')
                setDrag(null)
              }}
            />
            {aspectMenuOpen && mode === 'standard' && (
              <div className="absolute bottom-[calc(100%+8px)] left-0 flex gap-1 rounded-full border border-white/10 bg-neutral-950/90 p-1.5 shadow-xl backdrop-blur-md">
                {(Object.keys(STANDARD_SIZES) as StandardAspect[]).map((aspect) => (
                  <button
                    className={`rounded-full px-2.5 py-1 font-mono text-[11px] transition-colors ${
                      aspect === standardAspect
                        ? 'bg-white/15 text-white ring-1 ring-white/20'
                        : 'text-white/55 hover:text-white/90'
                    }`}
                    key={aspect}
                    onClick={() => {
                      setStandardAspect(aspect)
                      setAspectMenuOpen(false)
                    }}
                    type="button"
                  >
                    {aspect}
                  </button>
                ))}
              </div>
            )}
            <ModeButton
              active={mode === 'viewport'}
              icon={<Maximize2 className="h-3.5 w-3.5" />}
              label={isMobile ? undefined : 'Viewport'}
              onClick={() => {
                setMode('viewport')
                setDrag(null)
                setAspectMenuOpen(false)
              }}
            />
            <ModeButton
              active={mode === 'area'}
              icon={<Crop className="h-3.5 w-3.5" />}
              label={isMobile ? undefined : 'Area'}
              onClick={() => {
                setMode('area')
                setAspectMenuOpen(false)
              }}
            />
            {isMobile && (
              <span className="px-2 text-white/50 text-xs tabular-nums">
                {resolution ? `${resolution.w} × ${resolution.h}` : '—'}
              </span>
            )}
          </div>
        )}

        {/* Preset captures carry their own "Frame your item" banner — the
            snapshot pitch only applies to the studio/reference flow. */}
        {!isMobile && !isPreset && (
          <span className="pointer-events-none max-w-90 rounded-lg border border-white/10 bg-neutral-950/85 px-3.5 py-1.5 text-center text-[11.5px] text-white/85 leading-relaxed backdrop-blur-md">
            A <b className="font-semibold text-white">snapshot</b>
            {' freezes this exact camera angle as a reusable reference for renders & videos.'}
          </span>
        )}

        <button
          aria-label={isPreset ? 'Capture' : 'Take snapshot'}
          className="group pointer-events-auto relative grid h-14 w-14 place-items-center rounded-full disabled:opacity-50"
          disabled={captureDisabled}
          onClick={handleCapture}
          type="button"
        >
          <span className="absolute inset-0 rounded-full border-[3px] border-white shadow-lg" />
          <span
            className={`h-10 w-10 rounded-full transition-transform duration-100 ${
              captureState === 'capturing'
                ? 'scale-[0.55] bg-primary'
                : 'bg-white group-hover:scale-90 group-active:scale-75'
            }`}
          />
          {captureState === 'capturing' && (
            <Loader2 className="absolute h-4 w-4 animate-spin text-white" />
          )}
          {captureState === 'saved' && (
            <Check className="absolute h-5 w-5 stroke-3 text-neutral-900" />
          )}
        </button>
        <span className="pointer-events-none font-mono text-[10.5px] text-white uppercase tracking-[0.12em] drop-shadow">
          {captureState === 'capturing'
            ? 'Capturing…'
            : captureState === 'saved'
              ? 'Saved'
              : isPreset
                ? 'Capture'
                : 'Take snapshot'}
        </span>
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
  label?: string
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
