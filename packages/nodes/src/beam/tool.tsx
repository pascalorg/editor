'use client'

import { type AnyNode, emitter, type GridEvent, useScene } from '@pascal-app/core'
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
import { beamDefinition } from './definition'
import { BeamNode } from './schema'

/**
 * Two-click beam placement — the structure draw the wall runs, kept to the
 * beam's one question: where the centreline goes.
 *
 *   - **First click** anchors the start.
 *   - **Second click** commits a beam along the centreline and re-arms.
 *   - The live end follows the snapping mode: `angles` locks it to 15° in XZ
 *     from the start; `grid`/`lines`/`off` leave it free. Shift cycles the
 *     mode, Alt force-places. The ghost shows the beam's own box (width ×
 *     depth at the soffit elevation) so the drawn length is the formed
 *     element, not a line.
 *   - Esc clears an anchored start.
 *
 * The beam's depth and soffit elevation are the defaults until the inspector
 * changes them; the tool places the centreline, which is the one thing a click
 * can say.
 */
const PREVIEW_OPACITY = 0.45
const ANGLE_STEP_RAD = Math.PI / 12

function projectToAngleLock(from: [number, number], raw: [number, number]): [number, number] {
  const dx = raw[0] - from[0]
  const dz = raw[1] - from[1]
  const len = Math.hypot(dx, dz)
  if (len < 1e-4) return from
  const theta = Math.atan2(dz, dx)
  const snapped = Math.round(theta / ANGLE_STEP_RAD) * ANGLE_STEP_RAD
  const proj = dx * Math.cos(snapped) + dz * Math.sin(snapped)
  const d = Math.max(0, proj)
  return [from[0] + Math.cos(snapped) * d, from[1] + Math.sin(snapped) * d]
}

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

const BeamTool = () => {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)
  const [draftStart, setDraftStart] = useState<[number, number] | null>(null)
  const [cursorPos, setCursorPos] = useState<[number, number] | null>(null)

  const startRef = useRef(draftStart)
  startRef.current = draftStart

  useEffect(() => {
    if (!activeLevelId) return

    const resolvePoint = (event: GridEvent, start: [number, number] | null): [number, number] => {
      const raw: [number, number] = [event.localPosition[0], event.localPosition[2]]
      const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      // Alt force-places: the one modifier that bypasses a snap mode.
      if (event.nativeEvent?.altKey === true) {
        return start ? raw : [snap(raw[0], step), snap(raw[1], step)]
      }
      if (start && isAngleSnapActive()) {
        const angled = projectToAngleLock(start, raw)
        // Snap the run LENGTH along the locked ray, not each axis — per-axis
        // rounding would pull the end off the ray as the cursor moves.
        const dx = angled[0] - start[0]
        const dz = angled[1] - start[1]
        const len = Math.hypot(dx, dz)
        if (len < 1e-6) return angled
        const s = snap(len, step) / len
        return [start[0] + dx * s, start[1] + dz * s]
      }
      return [snap(raw[0], step), snap(raw[1], step)]
    }

    const onMove = (event: GridEvent) => {
      setCursorPos(resolvePoint(event, startRef.current))
    }

    const onCancel = () => {
      if (!startRef.current) return
      markToolCancelConsumed()
      setDraftStart(null)
      setCursorPos(null)
    }

    const onClick = (event: GridEvent) => {
      const start = startRef.current
      const point = resolvePoint(event, start)
      if (!start) {
        triggerSFX('sfx:grid-snap')
        setDraftStart(point)
        return
      }
      const length = Math.hypot(point[0] - start[0], point[1] - start[1])
      if (length < 1e-4) return
      const node = BeamNode.parse({
        ...beamDefinition.defaults(),
        name: 'Beam',
        start,
        end: point,
      })
      useScene.getState().applyNodeChanges({
        create: [{ node: node as unknown as AnyNode, parentId: activeLevelId }],
      })
      triggerSFX('sfx:item-place')
      setDraftStart(point)
      setCursorPos(null)
    }

    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    emitter.on('tool:cancel', onCancel)
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
      emitter.off('tool:cancel', onCancel)
    }
  }, [activeLevelId])

  if (!activeLevelId) return null

  const defaults = beamDefinition.defaults()
  const width = (defaults as { width: number }).width
  const depth = (defaults as { depth: number }).depth
  const elevation = (defaults as { elevation: number }).elevation

  const pillParts =
    draftStart && cursorPos
      ? [
          {
            key: 'length',
            prefix: 'L',
            value: Math.hypot(cursorPos[0] - draftStart[0], cursorPos[1] - draftStart[1]),
            signed: true,
          },
          { key: 'width', prefix: 'W', value: width, signed: false },
          { key: 'depth', prefix: 'D', value: depth, signed: false },
        ]
      : null

  return (
    <group>
      {cursorPos && (
        <>
          <CursorSphere position={[cursorPos[0], elevation, cursorPos[1]]} />
          {pillParts && (
            <group position={[cursorPos[0], elevation, cursorPos[1]]}>
              <Html
                center
                position={[0, 1.45, 0]}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
                zIndexRange={[100, 0]}
              >
                <DimensionPill parts={pillParts} unit={unit} />
              </Html>
            </group>
          )}
        </>
      )}
      {draftStart && cursorPos && (
        <BeamGhost
          start={draftStart}
          end={cursorPos}
          width={width}
          depth={depth}
          elevation={elevation}
        />
      )}
      {draftStart && (
        <mesh layers={EDITOR_LAYER} position={[draftStart[0], elevation, draftStart[1]]}>
          <sphereGeometry args={[0.05, 16, 12]} />
          <meshBasicMaterial color="#818cf8" depthTest={false} />
        </mesh>
      )}
    </group>
  )
}

/** The drawn beam's own box, translucent — the element the centreline will form. */
export function BeamGhost({
  start,
  end,
  width,
  depth,
  elevation,
}: {
  start: [number, number]
  end: [number, number]
  width: number
  depth: number
  elevation: number
}) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-4) return null
  const heading = Math.atan2(dz, dx)
  return (
    <mesh
      layers={EDITOR_LAYER}
      position={[(start[0] + end[0]) / 2, elevation + depth / 2, (start[1] + end[1]) / 2]}
      rotation={[0, -heading, 0]}
    >
      <boxGeometry args={[length, depth, width]} />
      <meshBasicMaterial color="#818cf8" depthTest={false} opacity={PREVIEW_OPACITY} transparent />
    </mesh>
  )
}

export default BeamTool
