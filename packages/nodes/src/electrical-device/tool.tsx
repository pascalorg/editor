'use client'

import { ElectricalDeviceNode, emitter, type GridEvent, useScene } from '@pascal-app/core'
import { isGridSnapActive, triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import { LevelOffsetGroup } from '../shared/level-offset-group'
import { electricalDeviceDefinition } from './definition'
import { buildElectricalDeviceGeometry } from './geometry'

const PREVIEW_OPACITY = 0.55
const ROTATE_STEP_RAD = Math.PI / 4

const DEVICE_TYPES: Array<ElectricalDeviceNode['deviceType']> = [
  'outlet',
  'switch',
  'light',
  'junction-box',
  'panel',
]

const DEVICE_LABELS: Record<ElectricalDeviceNode['deviceType'], string> = {
  outlet: 'Outlet',
  switch: 'Switch',
  light: 'Light',
  'junction-box': 'Junction Box',
  panel: 'Panel',
}

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

/**
 * Click-place tool for electrical devices. **D** cycles the device type;
 * **R / T** rotate the device ±45°. Grid snap follows the active snapping mode.
 */
const ElectricalDeviceTool = () => {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const [cursor, setCursor] = useState<[number, number, number] | null>(null)
  const [yaw, setYaw] = useState(0)
  const [deviceType, setDeviceType] = useState<ElectricalDeviceNode['deviceType']>('outlet')

  const yawRef = useRef(0)
  const deviceTypeRef = useRef(deviceType)
  deviceTypeRef.current = deviceType

  const previewNode = useMemo(
    () =>
      ElectricalDeviceNode.parse({
        ...electricalDeviceDefinition.defaults(),
        deviceType,
      }),
    [deviceType],
  )

  const ghost = useMemo(() => {
    const group = buildElectricalDeviceGeometry(previewNode)
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
      return [snap(event.localPosition[0], step), 0, snap(event.localPosition[2], step)] as [
        number,
        number,
        number,
      ]
    }

    const onMove = (event: GridEvent) => {
      setCursor(resolve(event))
    }

    const onClick = (event: GridEvent) => {
      const position = resolve(event)
      const device = ElectricalDeviceNode.parse({
        ...electricalDeviceDefinition.defaults(),
        deviceType: deviceTypeRef.current,
        position,
        rotation: yawRef.current,
      })
      useScene.getState().createNode(device, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [device.id] })
      triggerSFX('sfx:item-place')
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const key = e.key
      if (key === 'r' || key === 'R' || key === 't' || key === 'T') {
        e.preventDefault()
        e.stopPropagation()
        const steps = key === 't' || key === 'T' ? -1 : 1
        yawRef.current += steps * ROTATE_STEP_RAD
        setYaw(yawRef.current)
        triggerSFX('sfx:item-rotate')
      } else if (key === 'd' || key === 'D') {
        e.preventDefault()
        setDeviceType((current) => {
          const idx = DEVICE_TYPES.indexOf(current)
          return DEVICE_TYPES[(idx + 1) % DEVICE_TYPES.length]!
        })
        triggerSFX('sfx:grid-snap')
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
          <span className="font-medium text-foreground">{DEVICE_LABELS[deviceType]}</span>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <span className="text-muted-foreground">D device · R/T rotate</span>
        </div>
      </Html>
    </LevelOffsetGroup>
  )
}

export default ElectricalDeviceTool
