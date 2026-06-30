'use client'

import { ElectricalConduitNode, emitter, type GridEvent, useScene } from '@pascal-app/core'
import {
  CursorSphere,
  DimensionPill,
  EDITOR_LAYER,
  isAngleSnapActive,
  isGridSnapActive,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { LevelOffsetGroup } from '../shared/level-offset-group'
import { electricalConduitDefinition } from './definition'

const PREVIEW_OPACITY = 0.55
const SNAP_CURSOR_COLOR = '#22c55e'
const CONDUIT_SIZES_IN = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3] as const
const ANGLE_STEP_RAD = Math.PI / 4

// System-specific preview colors matching the floorplan colors.
const SYSTEM_COLORS = {
  power: '#f59e0b',
  lighting: '#a78bfa',
  data: '#34d399',
} as const

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

function projectToAngleLock(
  from: [number, number, number],
  raw: [number, number, number],
): [number, number, number] {
  const dx = raw[0] - from[0]
  const dz = raw[2] - from[2]
  const len = Math.hypot(dx, dz)
  if (len < 1e-4) return [from[0], from[1], from[2]]
  const theta = Math.atan2(dz, dx)
  const snapped = Math.round(theta / ANGLE_STEP_RAD) * ANGLE_STEP_RAD
  const proj = dx * Math.cos(snapped) + dz * Math.sin(snapped)
  const d = Math.max(0, proj)
  return [from[0] + Math.cos(snapped) * d, from[1], from[2] + Math.sin(snapped) * d]
}

const SYSTEMS: Array<'power' | 'lighting' | 'data'> = ['power', 'lighting', 'data']

/**
 * Two-click placement tool for electrical conduit runs.
 * E cycles power → lighting → data; [ / ] steps the conduit size.
 */
const ElectricalConduitTool = () => {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)
  const [system, setSystem] = useState<'power' | 'lighting' | 'data'>('power')
  const [diameter, setDiameter] = useState<number>(
    (electricalConduitDefinition.defaults() as { diameter: number }).diameter,
  )
  const [draftStart, setDraftStart] = useState<[number, number, number] | null>(null)
  const [cursorPos, setCursorPos] = useState<[number, number, number] | null>(null)
  const [snapTarget, setSnapTarget] = useState<[number, number, number] | null>(null)

  const startRef = useRef(draftStart)
  startRef.current = draftStart
  const systemRef = useRef(system)
  systemRef.current = system
  const diameterRef = useRef(diameter)
  diameterRef.current = diameter

  useEffect(() => {
    if (!activeLevelId) return

    const resolve = (event: GridEvent) => {
      const start = startRef.current
      const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const rawXZ: [number, number, number] = [event.localPosition[0], 0, event.localPosition[2]]

      if (!start) {
        return {
          point: [snap(rawXZ[0], step), 0, snap(rawXZ[2], step)] as [number, number, number],
          snapped: null,
        }
      }

      const angleLocked = isAngleSnapActive()
      const angled = angleLocked ? projectToAngleLock(start, rawXZ) : rawXZ
      let end: [number, number, number]
      if (!angleLocked) {
        end = [snap(angled[0], step), angled[1], snap(angled[2], step)]
      } else {
        const dx = angled[0] - start[0]
        const dz = angled[2] - start[2]
        const len = Math.hypot(dx, dz)
        if (len < 1e-6) {
          end = angled
        } else {
          const s = snap(len, step) / len
          end = [start[0] + dx * s, angled[1], start[2] + dz * s]
        }
      }
      return { point: end, snapped: null }
    }

    const commitSegment = (start: [number, number, number], end: [number, number, number]) => {
      const length = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2])
      if (length < 1e-4) return
      const node = ElectricalConduitNode.parse({
        ...electricalConduitDefinition.defaults(),
        path: [start, end],
        diameter: diameterRef.current,
        system: systemRef.current,
      })
      useScene.getState().createNode(node, activeLevelId)
      triggerSFX('sfx:item-place')
      setDraftStart(end)
      setSnapTarget(null)
    }

    const onMove = (event: GridEvent) => {
      const { point, snapped } = resolve(event)
      setCursorPos(point)
      setSnapTarget(snapped)
    }

    const onClick = (event: GridEvent) => {
      const { point } = resolve(event)
      const start = startRef.current
      if (!start) {
        triggerSFX('sfx:grid-snap')
        setDraftStart(point)
        return
      }
      commitSegment(start, point)
    }

    const stepDiameter = (step: 1 | -1) => {
      const sizes = CONDUIT_SIZES_IN
      const current = diameterRef.current
      let nearest = 0
      for (let i = 1; i < sizes.length; i++) {
        if (Math.abs(sizes[i]! - current) < Math.abs(sizes[nearest]! - current)) nearest = i
      }
      const next = sizes[Math.min(sizes.length - 1, Math.max(0, nearest + step))]!
      if (next === current) return
      setDiameter(next)
      triggerSFX('sfx:grid-snap')
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === '[') {
        e.preventDefault()
        stepDiameter(-1)
      } else if (e.key === ']') {
        e.preventDefault()
        stepDiameter(1)
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault()
        setSystem((s) => {
          const idx = SYSTEMS.indexOf(s)
          return SYSTEMS[(idx + 1) % SYSTEMS.length]!
        })
        triggerSFX('sfx:grid-snap')
      }
    }

    const onCancel = () => {
      if (!startRef.current) return
      markToolCancelConsumed()
      setDraftStart(null)
      setCursorPos(null)
      setSnapTarget(null)
    }

    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [activeLevelId])

  if (!activeLevelId) return null

  const pillParts = cursorPos
    ? [
        ...(['x', 'y', 'z'] as const).map((axis, i) => ({
          key: axis,
          prefix: axis.toUpperCase(),
          value: draftStart ? cursorPos[i]! - draftStart[i]! : cursorPos[i]!,
          signed: !!draftStart,
        })),
        { key: 'diameter', prefix: 'Ø', value: diameter * 0.0254, signed: false },
      ]
    : null

  const lineColor = SYSTEM_COLORS[system]

  return (
    <LevelOffsetGroup>
      {cursorPos && (
        <>
          <CursorSphere color={snapTarget ? SNAP_CURSOR_COLOR : lineColor} position={cursorPos} />
          {pillParts && (
            <group position={cursorPos}>
              <Html
                center
                position={[0, 1.45, 0]}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
                zIndexRange={[100, 0]}
              >
                <div className="flex flex-col items-center gap-1">
                  <DimensionPill parts={pillParts} unit={unit} />
                  <div className="whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-3 py-0.5 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
                    {system.charAt(0).toUpperCase() + system.slice(1)} · E system
                  </div>
                </div>
              </Html>
            </group>
          )}
        </>
      )}
      {draftStart && (
        <mesh layers={EDITOR_LAYER} position={draftStart}>
          <sphereGeometry args={[0.05, 16, 12]} />
          <meshBasicMaterial color={lineColor} depthTest={false} />
        </mesh>
      )}
      {draftStart && cursorPos && (
        <PreviewConduit a={draftStart} b={cursorPos} diameterIn={diameter} color={lineColor} />
      )}
    </LevelOffsetGroup>
  )
}

function PreviewConduit({
  a,
  b,
  diameterIn,
  color,
}: {
  a: [number, number, number]
  b: [number, number, number]
  diameterIn: number
  color: string
}) {
  const start = new Vector3(...a)
  const end = new Vector3(...b)
  const dir = new Vector3().subVectors(end, start)
  const length = dir.length()
  if (length < 1e-4) return null
  dir.normalize()
  const mid = new Vector3().addVectors(start, end).multiplyScalar(0.5)
  const radius = (diameterIn * 0.0254) / 2
  return (
    <mesh
      layers={EDITOR_LAYER}
      position={mid.toArray()}
      ref={(m) => {
        if (!m) return
        m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir)
      }}
    >
      <cylinderGeometry args={[radius, radius, length, 16, 1, false]} />
      <meshBasicMaterial color={color} depthTest={false} opacity={PREVIEW_OPACITY} transparent />
    </mesh>
  )
}

export default ElectricalConduitTool
