'use client'

import { emitter, type GridEvent, PlumbingFixtureNode, useScene } from '@pascal-app/core'
import { triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import { plumbingFixtureDefinition } from './definition'
import { buildPlumbingFixtureGeometry } from './geometry'
import type { PlumbingFixtureNode as Fixture } from './schema'
import { FIXTURE_SPECS } from './spec'

const PREVIEW_OPACITY = 0.55
const ROTATE_STEP_RAD = Math.PI / 4
const TYPE_CYCLE: Fixture['fixtureType'][] = ['toilet', 'lavatory', 'kitchen-sink', 'tub', 'washer']

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

/**
 * Click-place tool for plumbing fixtures. Ghost follows the cursor on
 * the floor with grid snap (Shift = smooth); **Q** cycles the fixture
 * type, **R / T** rotate ±45°. The placed fixture's drain rough-in is a
 * waste port, so the DWV pipe tool starts runs straight off it.
 */
const PlumbingFixtureTool = () => {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const [cursor, setCursor] = useState<[number, number, number] | null>(null)
  const [yaw, setYaw] = useState(0)
  const [fixtureType, setFixtureType] = useState<Fixture['fixtureType']>('toilet')
  const yawRef = useRef(0)
  const typeRef = useRef(fixtureType)
  typeRef.current = fixtureType

  const previewNode = useMemo(
    () =>
      PlumbingFixtureNode.parse({
        ...plumbingFixtureDefinition.defaults(),
        name: FIXTURE_SPECS[fixtureType].label,
        fixtureType,
      }),
    [fixtureType],
  )
  const ghost = useMemo(() => {
    const group = buildPlumbingFixtureGeometry(previewNode)
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
      const fixture = PlumbingFixtureNode.parse({
        ...plumbingFixtureDefinition.defaults(),
        name: FIXTURE_SPECS[typeRef.current].label,
        fixtureType: typeRef.current,
        position,
        rotation: yawRef.current,
      })
      useScene.getState().createNode(fixture, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [fixture.id] })
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
      } else if (key === 'q' || key === 'Q') {
        e.preventDefault()
        const index = TYPE_CYCLE.indexOf(typeRef.current)
        setFixtureType(TYPE_CYCLE[(index + 1) % TYPE_CYCLE.length]!)
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

  const spec = FIXTURE_SPECS[fixtureType]
  return (
    <group>
      <group position={cursor} rotation={[0, yaw, 0]}>
        <primitive object={ghost} />
      </group>
      <Html
        center
        position={[cursor[0], cursor[1] + spec.size[1] + 0.4, cursor[2]]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[100, 0]}
      >
        <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs tabular-nums shadow-sm backdrop-blur">
          <span className="font-medium text-foreground">{spec.label}</span>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <span className="text-muted-foreground">{spec.dfu} DFU</span>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <span className="text-muted-foreground">Q type · R/T rotate</span>
        </div>
      </Html>
    </group>
  )
}

export default PlumbingFixtureTool
