'use client'

import { animate, motion, useMotionValue } from 'motion/react'
import {
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'

export type BottomSheetHandle = {
  snapTo: (heightPx: number) => void
  getHeight: () => number
}

interface BottomSheetProps {
  initialHeightPx: number
  snapPointsPx: number[]
  onCommit: (heightPx: number) => void
  children: ReactNode
}

const DRAG_THRESHOLD_PX = 6

export const BottomSheet = forwardRef<BottomSheetHandle, BottomSheetProps>(function BottomSheet(
  { initialHeightPx, snapPointsPx, onCommit, children },
  ref,
) {
  const height = useMotionValue(initialHeightPx)
  const dragStartY = useRef<number | null>(null)
  const dragStartHeight = useRef(0)
  const hasDragged = useRef(false)
  const animationRef = useRef<ReturnType<typeof animate> | null>(null)

  const clamp = useCallback(
    (px: number) => {
      const min = Math.min(...snapPointsPx)
      const max = Math.max(...snapPointsPx)
      return Math.max(min, Math.min(max, px))
    },
    [snapPointsPx],
  )

  const nearestSnap = useCallback(
    (px: number) => {
      let best = snapPointsPx[0] ?? 0
      let bestDist = Number.POSITIVE_INFINITY
      for (const p of snapPointsPx) {
        const d = Math.abs(p - px)
        if (d < bestDist) {
          bestDist = d
          best = p
        }
      }
      return best
    },
    [snapPointsPx],
  )

  const animateTo = useCallback(
    (targetPx: number) => {
      animationRef.current?.stop()
      const controls = animate(height, targetPx, {
        type: 'spring',
        stiffness: 320,
        damping: 32,
        mass: 0.8,
        onComplete: () => {
          onCommit(targetPx)
        },
      })
      animationRef.current = controls
    },
    [height, onCommit],
  )

  useImperativeHandle(
    ref,
    () => ({
      snapTo: (px: number) => animateTo(clamp(px)),
      getHeight: () => height.get(),
    }),
    [animateTo, clamp, height],
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      e.currentTarget.setPointerCapture(e.pointerId)
      animationRef.current?.stop()
      dragStartY.current = e.clientY
      dragStartHeight.current = height.get()
      hasDragged.current = false
    },
    [height],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragStartY.current === null) return
      const dy = e.clientY - dragStartY.current
      if (!hasDragged.current && Math.abs(dy) < DRAG_THRESHOLD_PX) return
      hasDragged.current = true
      const next = clamp(dragStartHeight.current - dy)
      height.set(next)
    },
    [clamp, height],
  )

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      if (dragStartY.current === null) return
      dragStartY.current = null
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      if (!hasDragged.current) return
      const target = nearestSnap(height.get())
      animateTo(target)
    },
    [animateTo, height, nearestSnap],
  )

  useEffect(() => {
    return () => {
      animationRef.current?.stop()
    }
  }, [])

  return (
    <motion.div
      className="absolute right-0 bottom-0 left-0 z-40 flex flex-col overflow-hidden rounded-t-2xl bg-sidebar text-sidebar-foreground shadow-[0_-4px_16px_rgba(0,0,0,0.12)]"
      style={{ height }}
    >
      <div
        className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
        onPointerCancel={endDrag}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
      >
        <div className="h-1 w-10 rounded-full bg-muted-foreground/40" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </motion.div>
  )
})
