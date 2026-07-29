'use client'

import type { SiteNode } from '@pascal-app/core'
import { Html } from '@react-three/drei'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { brushRadiusRange } from '../../../lib/terrain-sculpt'
import useEditor from '../../../store/use-editor'
import { SegmentedControl } from '../../ui/controls/segmented-control'
import { SliderControl } from '../../ui/controls/slider-control'

const MENU_WIDTH = 288
const MENU_HEIGHT = 292
const MENU_MARGIN = 8
const CONTEXT_CLICK_SLOP = 5

type MenuPosition = { x: number; y: number }

export function TerrainBrushContextMenu({
  canvas,
  onAnchorChange,
  site,
}: {
  canvas: HTMLCanvasElement
  onAnchorChange: (anchor: { clientX: number; clientY: number } | null) => void
  site: SiteNode
}) {
  const brush = useEditor((state) => state.terrainBrush)
  const setTerrainBrush = useEditor((state) => state.setTerrainBrush)
  const [minRadius, maxRadius] = brushRadiusRange(site)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<MenuPosition>({ x: MENU_MARGIN, y: MENU_MARGIN })
  const menuRef = useRef<HTMLDivElement>(null)
  const rightPointerRef = useRef<{
    pointerId: number
    x: number
    y: number
    moved: boolean
  } | null>(null)

  const closeMenu = useCallback(() => {
    setOpen(false)
    onAnchorChange(null)
  }, [onAnchorChange])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 2) return
      rightPointerRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      }
    }
    const onPointerMove = (event: PointerEvent) => {
      const start = rightPointerRef.current
      if (!start || start.pointerId !== event.pointerId) return
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CONTEXT_CLICK_SLOP) {
        start.moved = true
      }
    }
    const onPointerCancel = (event: PointerEvent) => {
      if (rightPointerRef.current?.pointerId === event.pointerId) {
        rightPointerRef.current = null
      }
    }
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      const gesture = rightPointerRef.current
      rightPointerRef.current = null
      if (gesture?.moved || (event.buttons & 1) !== 0) return

      const rect = canvas.getBoundingClientRect()
      const maxX = Math.max(MENU_MARGIN, rect.width - MENU_WIDTH - MENU_MARGIN)
      const maxY = Math.max(MENU_MARGIN, rect.height - MENU_HEIGHT - MENU_MARGIN)
      setPosition({
        x: Math.min(Math.max(event.clientX - rect.left, MENU_MARGIN), maxX),
        y: Math.min(Math.max(event.clientY - rect.top, MENU_MARGIN), maxY),
      })
      setOpen(true)
      onAnchorChange({ clientX: event.clientX, clientY: event.clientY })
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointercancel', onPointerCancel)
    canvas.addEventListener('contextmenu', onContextMenu, true)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('contextmenu', onContextMenu, true)
    }
  }, [canvas, onAnchorChange])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      closeMenu()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }

    window.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('blur', closeMenu)
    window.addEventListener('resize', closeMenu)
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('blur', closeMenu)
      window.removeEventListener('resize', closeMenu)
    }
  }, [closeMenu, open])

  const calculatePosition = useCallback(
    () => [position.x, position.y] as [number, number],
    [position.x, position.y],
  )

  return (
    <Html
      calculatePosition={calculatePosition}
      position={[0, 0, 0]}
      style={{ pointerEvents: 'none' }}
      zIndexRange={[40, 0]}
    >
      <AnimatePresence>
        {open && (
          <motion.div
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="w-72 rounded-xl border border-border/70 bg-background/95 p-3 text-foreground shadow-2xl backdrop-blur-xl"
            exit={{ opacity: 0, scale: 0.96, y: 4 }}
            initial={{ opacity: 0, scale: 0.94, y: 6 }}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => event.stopPropagation()}
            ref={menuRef}
            style={{ pointerEvents: 'auto', transformOrigin: 'top left' }}
            transition={{ type: 'spring', stiffness: 460, damping: 34, mass: 0.7 }}
          >
            <div className="mb-2.5">
              <p className="font-medium text-sm">Brush settings</p>
              <p className="text-muted-foreground text-xs">Adjust without leaving the terrain.</p>
            </div>
            <div className="flex flex-col gap-2">
              <SliderControl
                label="Size"
                max={maxRadius}
                min={minRadius}
                onChange={(radius) => setTerrainBrush({ radius })}
                precision={1}
                step={0.5}
                unit="m"
                value={brush.radius}
              />
              <SliderControl
                label="Strength"
                max={1}
                min={0.05}
                onChange={(strength) => setTerrainBrush({ strength })}
                precision={2}
                step={0.05}
                value={brush.strength}
              />
              <SliderControl
                label="Softness"
                max={1}
                min={0}
                onChange={(falloff) => setTerrainBrush({ falloff })}
                precision={2}
                step={0.05}
                value={brush.falloff}
              />
              <SegmentedControl
                className="h-8"
                onChange={(shape) => setTerrainBrush({ shape })}
                options={[
                  { value: 'round', label: 'Round' },
                  { value: 'square', label: 'Square' },
                ]}
                value={brush.shape}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Html>
  )
}
