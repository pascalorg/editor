'use client'

import { DuctTerminalNode, emitter, type GridEvent, useScene } from '@pascal-app/core'
import { triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ductTerminalDefinition } from './definition'
import { buildDuctTerminalGeometry } from './geometry'

const PREVIEW_OPACITY = 0.55
/** R/T yaw step — 45°. */
const ROTATE_STEP_RAD = Math.PI / 4

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

/**
 * Click-place tool for duct terminals (registers / diffusers / grilles).
 * Ghost follows the cursor on the floor with grid snap (Shift = smooth);
 * **R / T** rotate ±45°. Terminal type, mount surface, and face size are
 * edited in the inspector after placement — switching mount to ceiling
 * or wall reorients the face and collar, then adjust Y in Placement.
 */
const DuctTerminalTool = () => {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const [cursor, setCursor] = useState<[number, number, number] | null>(null)
  const [yaw, setYaw] = useState(0)
  const yawRef = useRef(0)

  const previewNode = useMemo(
    () => DuctTerminalNode.parse({ ...ductTerminalDefinition.defaults(), name: 'Register' }),
    [],
  )
  const ghost = useMemo(() => {
    const group = buildDuctTerminalGeometry(previewNode)
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

    const resolve = (event: GridEvent): [number, number, number] => {
      const step = event.nativeEvent?.shiftKey === true ? 0 : useEditor.getState().gridSnapStep
      return [snap(event.localPosition[0], step), 0, snap(event.localPosition[2], step)]
    }

    const onMove = (event: GridEvent) => setCursor(resolve(event))

    const onClick = (event: GridEvent) => {
      const position = resolve(event)
      const terminal = DuctTerminalNode.parse({
        ...ductTerminalDefinition.defaults(),
        name: 'Register',
        position,
        rotation: yawRef.current,
      })
      useScene.getState().createNode(terminal, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [terminal.id] })
      triggerSFX('sfx:item-place')
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const key = e.key
      if (key !== 'r' && key !== 'R' && key !== 't' && key !== 'T') return
      e.preventDefault()
      e.stopPropagation()
      const steps = key === 't' || key === 'T' || e.shiftKey ? -1 : 1
      yawRef.current += steps * ROTATE_STEP_RAD
      setYaw(yawRef.current)
      triggerSFX('sfx:item-rotate')
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
    <group>
      <group position={cursor} rotation={[0, yaw, 0]}>
        <primitive object={ghost} />
      </group>
      <Html
        center
        position={[cursor[0], cursor[1] + 0.45, cursor[2]]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[100, 0]}
      >
        <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs tabular-nums shadow-sm backdrop-blur">
          <span className="font-medium text-foreground">R/T rotate</span>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <span className="text-muted-foreground">⇧ smooth</span>
        </div>
      </Html>
    </group>
  )
}

export default DuctTerminalTool
