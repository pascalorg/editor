'use client'

import { useState, useRef, useCallback, useLayoutEffect } from 'react'
import { GripHorizontal } from 'lucide-react'
import { useViewer } from '@pascal-app/viewer'
import { motion } from 'motion/react'
import { TooltipProvider } from './../../../components/ui/primitives/tooltip'
import { useIsMobile } from './../../../hooks/use-mobile'
import { useReducedMotion } from './../../../hooks/use-reduced-motion'
import { cn } from './../../../lib/utils'
import useEditor from './../../../store/use-editor'
import { CameraActions } from './camera-actions'
import { ControlModes } from './control-modes'
import { SecondaryToggles } from './view-toggles'

// Mobile bottom offset matches the viewer's overlap behind the sheet's
// rounded corners (SHEET_OVERLAP_PX in editor-layout-mobile) so the menu sits
// just above that strip instead of inside it.
const MOBILE_BOTTOM_OFFSET = 24
const DRAG_MARGIN = 8

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function getDragBounds(el: HTMLElement | null): {
  left: number
  top: number
  right: number
  bottom: number
} {
  const region = el?.closest('[data-viewer-bounds]')
  const rect = region?.getBoundingClientRect()
  if (!rect) {
    return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  }
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

export function ActionMenu({ className }: { className?: string }) {
  const isMobile = useIsMobile()
  const hasSelectionOnMobile = useViewer((s) => isMobile && s.selection.selectedIds.length > 0)
  const hasReferenceOnMobile = useEditor((s) => isMobile && Boolean(s.selectedReferenceId))
  const CONTEXTUAL_TABS = new Set(['ai', 'items', 'studio'])
  const isContextualPanelOnMobile = useEditor(
    (s) => isMobile && CONTEXTUAL_TABS.has(s.activeSidebarPanel),
  )
  const reducedMotion = useReducedMotion()

  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isSnappedToTop, setIsSnappedToTop] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const isSnappedToBottomCenterRef = useRef(false)
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{
    startX: number
    startY: number
    baseX: number
    baseY: number
    rectLeft: number
    rectTop: number
    width: number
    height: number
    minTop: number
  } | null>(null)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isMobile) return
      // Ignore clicks on buttons, links, etc. so they remain clickable
      if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('a')) return
      const rect = menuRef.current?.getBoundingClientRect()
      if (!rect) return
      const bounds = getDragBounds(menuRef.current)
      const base = offset ?? { x: 0, y: 0 }
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        baseX: base.x,
        baseY: base.y,
        rectLeft: rect.left,
        rectTop: rect.top,
        width: rect.width,
        height: rect.height,
        minTop: bounds.top + DRAG_MARGIN,
      }
      dragOffsetRef.current = base
      setIsDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [offset, isMobile],
  )

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    
    // Snapping logic relative to the top of the viewer area (bounds.top + 12px)
    const bounds = getDragBounds(menuRef.current)
    const SNAP_TOP_Y = bounds.top + 12
    const SNAP_THRESHOLD = 32

    const rawTop = drag.rectTop + dy
    const snapped = rawTop <= SNAP_TOP_Y + SNAP_THRESHOLD
    
    // The rail resizes when it snaps (h-8 compact vs the full bar), and the
    // offset below has to compensate for that. Measure what is on screen rather
    // than naming a width: a hardcoded number stops matching the moment a button
    // is added to or removed from the menu, and the rail then jumps on every drag.
    const liveRect = menuRef.current?.getBoundingClientRect()
    const currentWidth = liveRect?.width ?? drag.width
    const currentHeight = liveRect?.height ?? drag.height

    const targetLeft = drag.rectLeft + dx
    const minLeft = bounds.left + DRAG_MARGIN
    const maxLeft = bounds.right - currentWidth - DRAG_MARGIN

    const SNAP_CENTER_X = bounds.left + (bounds.right - bounds.left - currentWidth) / 2
    const SNAP_BOTTOM_Y = bounds.bottom - currentHeight - 24

    const snappedToBottomCenter = !snapped &&
      Math.abs(targetLeft - SNAP_CENTER_X) <= SNAP_THRESHOLD &&
      Math.abs(rawTop - SNAP_BOTTOM_Y) <= SNAP_THRESHOLD

    isSnappedToBottomCenterRef.current = snappedToBottomCenter

    const maxTop = bounds.bottom - currentHeight - DRAG_MARGIN

    const left = snappedToBottomCenter ? SNAP_CENTER_X : clamp(targetLeft, minLeft, maxLeft)
    let top = snappedToBottomCenter ? SNAP_BOTTOM_Y : clamp(rawTop, drag.minTop, maxTop)

    if (snapped) {
      top = SNAP_TOP_Y
    }

    const heightDiff = drag.height - currentHeight
    const widthDiff = (drag.width - currentWidth) / 2

    setIsSnappedToTop((prev) => {
      if (prev !== snapped) return snapped
      return prev
    })

    const nextOffset = {
      x: drag.baseX + (left - drag.rectLeft) - widthDiff,
      y: drag.baseY + (top - drag.rectTop) - heightDiff,
    }
    dragOffsetRef.current = nextOffset

    if (menuRef.current) {
      menuRef.current.style.transform = `translate(calc(-50% + ${nextOffset.x}px), ${nextOffset.y}px)`
    }
  }, [])

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // A press that landed on a button never captured the pointer, and releasing
    // a capture that was never taken throws — so every click inside the menu
    // raised a NotFoundError before this guard.
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    if (!dragRef.current) return
    if (isSnappedToBottomCenterRef.current) {
      setOffset(null)
      dragOffsetRef.current = null
    } else if (dragOffsetRef.current) {
      setOffset(dragOffsetRef.current)
    }
    dragRef.current = null
    setIsDragging(false)
  }, [])

  // Re-clamp the rail inside the viewer whenever the bounds can have moved. A
  // window resize or a sidebar opening changes them with no pointer event of
  // any kind, and a rail left outside the region cannot be dragged back.
  const clampIntoBounds = useCallback(() => {
    if (isMobile) return
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const bounds = getDragBounds(el)

    const SNAP_TOP_Y = bounds.top + 12
    const isCurrentlySnapped = Math.abs(rect.top - SNAP_TOP_Y) < 5

    const left = clamp(
      rect.left,
      bounds.left + DRAG_MARGIN,
      bounds.right - rect.width - DRAG_MARGIN,
    )
    const top = isCurrentlySnapped
      ? SNAP_TOP_Y
      : clamp(rect.top, bounds.top + DRAG_MARGIN, bounds.bottom - rect.height - DRAG_MARGIN)
    setIsSnappedToTop(isCurrentlySnapped)

    const dx = left - rect.left
    const dy = top - rect.top
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      setOffset((prev) => ({ x: (prev?.x ?? 0) + dx, y: (prev?.y ?? 0) + dy }))
    }
  }, [isMobile])

  useLayoutEffect(() => {
    clampIntoBounds()
    if (isMobile) return
    const region = menuRef.current?.closest('[data-viewer-bounds]')
    window.addEventListener('resize', clampIntoBounds)
    const observer = region ? new ResizeObserver(clampIntoBounds) : null
    if (region && observer) observer.observe(region)
    return () => {
      window.removeEventListener('resize', clampIntoBounds)
      observer?.disconnect()
    }
  }, [clampIntoBounds, isMobile])

  // On mobile, defer the bottom rail to the selection bar when something
  // is selected — the contextual actions take priority over mode controls.
  // Also hide on Chat / Items / Studio tabs; those are contextual workflows
  // (composing / picking furniture / generating renders) where the build
  // menu is irrelevant.
  if (hasSelectionOnMobile || hasReferenceOnMobile || isContextualPanelOnMobile) return null

  const activeTransition = isDragging || reducedMotion
    ? { duration: 0 }
    : { type: 'spring' as const, bounce: 0.2, duration: 0.4 }

  const currentOffset = isDragging ? (dragOffsetRef.current ?? offset) : offset

  return (
    <TooltipProvider>
      <motion.div
        className={cn(
          'left-1/2 -translate-x-1/2 z-50 select-none transition-colors duration-200 ease-out',
          isMobile ? 'absolute origin-bottom scale-90' : 'fixed bottom-6',
          !isMobile && (isDragging ? 'cursor-grabbing' : 'cursor-grab'),
          isSnappedToTop
            ? cn('h-8 overflow-hidden rounded-xl border border-border bg-background/90 shadow-2xl', !isDragging && 'backdrop-blur-md')
            : cn('rounded-2xl border border-border bg-background/90 shadow-2xl', !isDragging && 'backdrop-blur-md'),
          className,
        )}
        layout={currentOffset ? false : 'position'}
        ref={menuRef}
        style={{
          bottom: isMobile ? MOBILE_BOTTOM_OFFSET : undefined,
          transform: !isMobile && currentOffset
            ? `translate(calc(-50% + ${currentOffset.x}px), ${currentOffset.y}px)`
            : undefined,
        }}
        transition={activeTransition}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {isMobile ? (
          <div className="flex flex-col items-stretch gap-0.5 px-2 py-1.5">
            {/* Row 1: control modes only */}
            <div className="flex items-center justify-center gap-1">
              <ControlModes />
            </div>
            {/* Row 2: secondary toggles (orbit + top view hidden) */}
            <div className="flex items-center justify-center gap-1 border-border/50 border-t pt-1">
              <SecondaryToggles />
            </div>
          </div>
        ) : (
          <div className={cn(
            'flex items-center justify-center',
            isSnappedToTop ? 'gap-0 px-1.5 py-0 h-full' : 'gap-1 px-2 py-1.5'
          )}>
            {/* Drag Handle */}
            <div
              className={cn(
                'flex items-center justify-center text-muted-foreground/30 hover:text-muted-foreground/80 transition-colors select-none',
                isSnappedToTop ? 'h-full w-5' : 'h-5 w-4'
              )}
              title="Drag to reposition toolbar"
            >
              <GripHorizontal className="h-4 w-4 rotate-90" />
            </div>
            <div className={cn('w-px bg-border', isSnappedToTop ? 'my-1.5 h-5' : 'mr-1 h-5')} />

            <ControlModes compact={isSnappedToTop} />
            <div className={cn('w-px bg-border', isSnappedToTop ? 'mx-1 my-1.5 h-5' : 'mx-1 h-5')} />
            <SecondaryToggles compact={isSnappedToTop} />
            <div className={cn('w-px bg-border', isSnappedToTop ? 'mx-1 my-1.5 h-5' : 'mx-1 h-5')} />
            <CameraActions compact={isSnappedToTop} />
          </div>
        )}
      </motion.div>
    </TooltipProvider>
  )
}
