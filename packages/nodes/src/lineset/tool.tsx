'use client'

import { emitter, type GridEvent, LinesetNode, useScene } from '@pascal-app/core'
import {
  CursorSphere,
  DimensionPill,
  EDITOR_LAYER,
  isAngleSnapActive,
  isGridSnapActive,
  isMagneticSnapActive,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import { type Group, Vector3 } from 'three'
import { alignDrawPoint, clearDrawAlignment } from '../shared/draw-alignment'
import { LevelOffsetGroup } from '../shared/level-offset-group'
import { collectScenePorts, findNearestPortXZ, REFRIGERANT_PORT_SYSTEMS } from '../shared/ports'
import { linesetDefinition } from './definition'

/**
 * Continuous placement tool for refrigerant linesets — the refrigerant-loop
 * sibling of the duct-segment tool.
 *
 * Mouse-driven model:
 *   - **First click** anchors the run start. Within range of a refrigerant
 *     service port (a condenser / coil valve, or another lineset's end) it
 *     snaps onto the port so a run mates flush.
 *   - **Second click** commits a two-point lineset and keeps its far end
 *     anchored, so the next click continues the run like wall / duct drafting.
 *   - The in-flight end follows the active snapping mode: `angles` locks it to
 *     the nearest 45° step in XZ from the start (Y stays at the start's
 *     height); `grid`/`lines`/`off` leave it free. Shift cycles the mode.
 *   - Hold **Alt** → vertical mode. XZ locks to the start; vertical mouse
 *     motion drives Y. Click commits the riser segment. (Drafting has no
 *     validity gate, so Alt is the riser modifier here, not force-place.)
 *   - Esc clears an anchored start point.
 *
 * Snapping is restricted to refrigerant ports, so a lineset never grabs a
 * supply/return duct collar.
 */
const PREVIEW_OPACITY = 0.6
const PREVIEW_COLOR = '#b06b3f'
/** Snap radius (meters) for joining onto a refrigerant port. */
const ENDPOINT_SNAP_RADIUS_M = 0.5
/** Angle step (radians) for the XZ angle lock — 45°. */
const ANGLE_STEP_RAD = Math.PI / 4
/** Mouse pixels → meters mapping for Alt-vertical drag. 100 px ≈ 1 m. */
const ALT_PIXELS_PER_METER = 100
const ALT_Y_MIN_M = -3
const ALT_Y_MAX_M = 10

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

/** Nearest refrigerant port within snap range on the XZ plane, as a
 * position tuple. Y is ignored for the distance check; the snap adopts the
 * port's full 3D position. */
function findNearbyPort(point: [number, number, number]): [number, number, number] | null {
  const port = findNearestPortXZ(
    point,
    collectScenePorts({ systems: REFRIGERANT_PORT_SYSTEMS }),
    ENDPOINT_SNAP_RADIUS_M,
  )
  return port ? [port.position[0], port.position[1], port.position[2]] : null
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

const LinesetTool = () => {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)
  const cursorRef = useRef<Group>(null)
  const [draftPoints, setDraftPoints] = useState<Array<[number, number, number]>>([])
  const [cursorPos, setCursorPos] = useState<[number, number, number] | null>(null)
  const [snapTarget, setSnapTarget] = useState<[number, number, number] | null>(null)
  const [altActive, setAltActive] = useState(false)
  const draftRef = useRef(draftPoints)
  draftRef.current = draftPoints
  const altAnchorRef = useRef<{ clientY: number; baseY: number } | null>(null)
  const lastClientYRef = useRef<number | null>(null)

  useEffect(() => {
    if (!activeLevelId) return

    const commitSegment = (start: [number, number, number], end: [number, number, number]) => {
      const sameSpot =
        Math.abs(start[0] - end[0]) < 1e-4 &&
        Math.abs(start[1] - end[1]) < 1e-4 &&
        Math.abs(start[2] - end[2]) < 1e-4
      if (sameSpot) return

      // Each drawn segment is its own standalone two-point lineset node — the
      // refrigerant-loop sibling of duct-segment. Independent nodes mean each
      // segment selects and deletes on its own, rather than folding into one
      // mitered polyline run.
      const lineset = LinesetNode.parse({
        ...linesetDefinition.defaults(),
        name: 'Lineset',
        path: [start, end],
      })
      useScene.getState().createNode(lineset, activeLevelId)
      triggerSFX('sfx:item-place')
      setDraftPoints([end])
      setSnapTarget(null)
      altAnchorRef.current = null
      setAltActive(false)
    }

    const resolveSnappedPoint = (
      event: GridEvent,
    ): { point: [number, number, number]; snapped: [number, number, number] | null } => {
      // Port mating is the run's primary affordance; it stays on in every
      // snapping mode except `off` (the raw-cursor bypass).
      const snapEnabled = isGridSnapActive() || isMagneticSnapActive() || isAngleSnapActive()
      const last = draftRef.current.at(-1)
      if (!last) {
        const raw: [number, number, number] = [event.localPosition[0], 0, event.localPosition[2]]
        if (event.nativeEvent?.altKey !== true && snapEnabled) {
          const target = findNearbyPort(raw)
          if (target) return { point: target, snapped: target }
        }
        const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
        return { point: [snap(raw[0], step), 0, snap(raw[2], step)], snapped: null }
      }
      const rawXZ: [number, number, number] = [
        event.localPosition[0],
        last[1],
        event.localPosition[2],
      ]
      // The 45° lock is now the `angles` snapping mode (Shift cycles to it),
      // not a held key.
      const angled = isAngleSnapActive() ? projectToAngleLock(last, rawXZ) : rawXZ
      if (event.nativeEvent?.altKey !== true && snapEnabled) {
        const target = findNearbyPort(rawXZ)
        if (target) return { point: target, snapped: target }
      }
      const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      return { point: [snap(angled[0], step), angled[1], snap(angled[2], step)], snapped: null }
    }

    const resolveAltVerticalPoint = (clientY: number): [number, number, number] | null => {
      const anchor = altAnchorRef.current
      const last = draftRef.current.at(-1)
      if (!anchor || !last) return null
      const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const dy = (anchor.clientY - clientY) / ALT_PIXELS_PER_METER
      const snappedDy = snap(dy, step)
      const y = Math.min(ALT_Y_MAX_M, Math.max(ALT_Y_MIN_M, anchor.baseY + snappedDy))
      return [last[0], y, last[2]]
    }

    // Resolve the cursor point (port / grid / angle snap) then layer
    // Figma-style alignment so a lineset lines up with other runs, equipment,
    // and items as it's drawn. A free point (first vertex, or no angle lock)
    // snaps; an angle-locked continuation shows the guide passively so it
    // doesn't fight the angle ray. Alignment follows the `lines` mode; a port
    // snap or Alt-vertical bypasses it.
    const resolveAlignedPoint = (event: GridEvent) => {
      const r = resolveSnappedPoint(event)
      const hasStart = draftRef.current.length > 0
      const alt = event.nativeEvent?.altKey === true
      const point = alignDrawPoint(r.point, {
        applySnap: !hasStart || !isAngleSnapActive(),
        bypass: !isMagneticSnapActive() || alt || r.snapped !== null,
      })
      return { ...r, point }
    }

    const onMove = (event: GridEvent) => {
      const clientY = (event.nativeEvent as { clientY?: number } | undefined)?.clientY
      if (typeof clientY === 'number') lastClientYRef.current = clientY
      if (altAnchorRef.current && typeof clientY === 'number') {
        const point = resolveAltVerticalPoint(clientY)
        if (point) {
          clearDrawAlignment()
          setCursorPos(point)
          setSnapTarget(null)
          return
        }
      }
      const { point, snapped } = resolveAlignedPoint(event)
      setCursorPos(point)
      setSnapTarget(snapped)
    }

    const onClick = (event: GridEvent) => {
      const start = draftRef.current.at(-1)
      if (altAnchorRef.current && start) {
        const clientY =
          (event.nativeEvent as { clientY?: number } | undefined)?.clientY ?? lastClientYRef.current
        if (typeof clientY === 'number') {
          const point = resolveAltVerticalPoint(clientY)
          if (point && Math.abs(point[1] - start[1]) >= 1e-4) {
            commitSegment(start, point)
          }
        }
        return
      }
      const { point } = resolveAlignedPoint(event)
      if (!start) {
        triggerSFX('sfx:grid-snap')
        setDraftPoints([point])
        return
      }
      commitSegment(start, point)
    }

    const enterAltMode = () => {
      const last = draftRef.current.at(-1)
      if (!last || lastClientYRef.current === null) return
      if (altAnchorRef.current) return
      altAnchorRef.current = { clientY: lastClientYRef.current, baseY: last[1] }
      setAltActive(true)
    }

    const exitAltMode = () => {
      if (!altAnchorRef.current) return
      altAnchorRef.current = null
      setAltActive(false)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'Alt') {
        e.preventDefault()
        enterAltMode()
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        e.preventDefault()
        exitAltMode()
      }
    }

    const onCancel = () => {
      clearDrawAlignment()
      if (draftRef.current.length === 0) return
      markToolCancelConsumed()
      setDraftPoints([])
      setCursorPos(null)
      setSnapTarget(null)
    }

    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      altAnchorRef.current = null
      clearDrawAlignment()
    }
  }, [activeLevelId])

  if (!activeLevelId) return null

  const previewSegments: Array<{ a: [number, number, number]; b: [number, number, number] }> = []
  for (let i = 0; i < draftPoints.length - 1; i++) {
    previewSegments.push({ a: draftPoints[i]!, b: draftPoints[i + 1]! })
  }
  const last = draftPoints.at(-1)
  if (last && cursorPos) {
    previewSegments.push({ a: last, b: cursorPos })
  }

  const pillParts = cursorPos
    ? (['x', 'y', 'z'] as const).map((axis, i) => ({
        key: axis,
        prefix: axis.toUpperCase(),
        value: last ? cursorPos[i]! - last[i]! : cursorPos[i]!,
        signed: !!last,
      }))
    : null
  const pillPrimary =
    last && cursorPos
      ? altActive
        ? 'y'
        : Math.abs(cursorPos[0] - last[0]) >= Math.abs(cursorPos[2] - last[2])
          ? 'x'
          : 'z'
      : undefined

  return (
    <LevelOffsetGroup>
      {/* Cursor marker — the same ground ring + vertical line + tool-icon
          badge the duct draw tool shows in 3D (icon resolved from the active
          `lineset` structure-tools entry). In 2D the floorplan overlay draws
          this for every tool; in 3D each tool renders its own. The dimension
          pill rides just above the cursor. */}
      {cursorPos && (
        <>
          <CursorSphere color={PREVIEW_COLOR} position={cursorPos} ref={cursorRef} />
          {pillParts && (
            <group position={cursorPos}>
              <Html
                center
                position={[0, 1.45, 0]}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
                zIndexRange={[100, 0]}
              >
                <DimensionPill parts={pillParts} primary={pillPrimary} unit={unit} />
              </Html>
            </group>
          )}
        </>
      )}
      {snapTarget && (
        <mesh layers={EDITOR_LAYER} position={snapTarget}>
          <sphereGeometry args={[0.1, 24, 16]} />
          <meshBasicMaterial color={PREVIEW_COLOR} depthTest={false} opacity={0.35} transparent />
        </mesh>
      )}
      {draftPoints.map((p, i) => (
        <mesh key={`pt-${i}`} layers={EDITOR_LAYER} position={p}>
          <sphereGeometry args={[0.06, 16, 12]} />
          <meshBasicMaterial color={PREVIEW_COLOR} depthTest={false} />
        </mesh>
      ))}
      {previewSegments.map((seg, i) => (
        <PreviewSegment a={seg.a} b={seg.b} key={`seg-${i}`} />
      ))}
    </LevelOffsetGroup>
  )
}

function PreviewSegment({ a, b }: { a: [number, number, number]; b: [number, number, number] }) {
  const start = new Vector3(...a)
  const end = new Vector3(...b)
  const dir = new Vector3().subVectors(end, start)
  const length = dir.length()
  if (length < 1e-4) return null
  dir.normalize()
  const mid = new Vector3().addVectors(start, end).multiplyScalar(0.5)
  // Default suction OD (~7/8") for the ghost.
  const radius = (0.875 * 0.0254) / 2
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
      <meshBasicMaterial
        color={PREVIEW_COLOR}
        depthTest={false}
        opacity={PREVIEW_OPACITY}
        transparent
      />
    </mesh>
  )
}

export default LinesetTool
