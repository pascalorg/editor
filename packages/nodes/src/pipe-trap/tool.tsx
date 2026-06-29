'use client'

import { emitter, type GridEvent, PipeTrapNode, useScene } from '@pascal-app/core'
import { isGridSnapActive, triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import { LevelOffsetGroup } from '../shared/level-offset-group'
import { pipeTrapDefinition } from './definition'
import { buildPipeTrapGeometry } from './geometry'

const PREVIEW_OPACITY = 0.55
const ROTATE_STEP_RAD = Math.PI / 4

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

/**
 * Click-place tool for P-traps. The ghost follows the cursor on the
 * floor. **R / T** rotate the arm ±45°; grid snap follows the active
 * snapping mode (the contextual HUD chip — Shift cycles it). The pipe
 * tool then draws the trap arm off the outlet toward the vent.
 */
const PipeTrapTool = () => {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const [cursor, setCursor] = useState<[number, number, number] | null>(null)
  const [yaw, setYaw] = useState(0)
  const [diameter] = useState(pipeTrapDefinition.defaults().diameter)
  const yawRef = useRef(0)
  const diameterRef = useRef(diameter)
  diameterRef.current = diameter

  const previewNode = useMemo(
    () =>
      PipeTrapNode.parse({
        ...pipeTrapDefinition.defaults(),
        diameter,
      }),
    [diameter],
  )
  const ghost = useMemo(() => {
    const group = buildPipeTrapGeometry(previewNode)
    group.traverse((child) => {
      const mesh = child as { material?: { transparent: boolean; opacity: number } }
      if (mesh.material) {
        mesh.material.transparent = true
        mesh.material.opacity = PREVIEW_OPACITY
      }
    })
    return group
  }, [previewNode])

  useEffect(() => {
    if (!activeLevelId) return

    const resolve = (event: GridEvent) => {
      const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      return {
        position: [snap(event.localPosition[0], step), 0, snap(event.localPosition[2], step)] as [
          number,
          number,
          number,
        ],
        diameter: diameterRef.current,
      }
    }

    const onMove = (event: GridEvent) => {
      setCursor(resolve(event).position)
    }

    const onClick = (event: GridEvent) => {
      const r = resolve(event)
      const trap = PipeTrapNode.parse({
        ...pipeTrapDefinition.defaults(),
        diameter: r.diameter,
        position: r.position,
        rotation: yawRef.current,
      })
      useScene.getState().createNode(trap, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [trap.id] })
      triggerSFX('sfx:item-place')
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const key = e.key
      if (key === 'r' || key === 'R' || key === 't' || key === 'T') {
        e.preventDefault()
        e.stopPropagation()
        const steps = key === 't' || key === 'T' || e.shiftKey ? -1 : 1
        yawRef.current += steps * ROTATE_STEP_RAD
        setYaw(yawRef.current)
        triggerSFX('sfx:item-rotate')
      }
    }

    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [activeLevelId])

  if (!activeLevelId || !cursor) return null

  return (
    <LevelOffsetGroup>
      <group position={cursor} rotation={[0, yaw, 0]}>
        <primitive object={ghost} />
      </group>
      <Html
        center
        position={[cursor[0], cursor[1] + 0.5, cursor[2]]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[100, 0]}
      >
        <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs tabular-nums shadow-sm backdrop-blur">
          <span className="font-medium text-foreground">{diameter}" Trap</span>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <span className="text-muted-foreground">R/T rotate</span>
        </div>
      </Html>
    </LevelOffsetGroup>
  )
}

export default PipeTrapTool
