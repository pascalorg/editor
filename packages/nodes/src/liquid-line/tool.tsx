'use client'

import {
  type AnyNodeId,
  emitter,
  type GridEvent,
  type LinesetNode,
  LiquidLineNode,
  useScene,
} from '@pascal-app/core'
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
import { offsetPathHorizontal } from '../shared/path-offset'
import { collectScenePorts, findNearestPortXZ, REFRIGERANT_PORT_SYSTEMS } from '../shared/ports'
import { planLiquidLineConnect } from './connect'
import { liquidLineDefinition } from './definition'
import { useLiquidLineToolOptions } from './options'

/**
 * One-segment-at-a-time placement tool for standalone liquid lines — the same
 * draw model as the lineset tool (the line it used to be a rail of):
 *   - **First click** anchors the run start; within range of a refrigerant
 *     service port it snaps onto it so a run mates flush.
 *   - **Second click** commits a two-point line and re-arms; the in-flight end
 *     follows the active snapping mode (`angles` locks it to 45°; Shift cycles
 *     the snapping mode), Alt drags it vertical.
 *
 * **Follow mode** (toggled by the MEP panel's Follow button or the `F` key):
 * instead of free-drawing, hover an existing lineset and click — a liquid line
 * is laid beside it, tracing the lineset's whole path at a fixed offset on the
 * side the cursor is on. This is the "place it exactly next to this" affordance.
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

const IN_TO_M = 0.0254
/** Default liquid OD (~3/8") — the ghost radius and trace-line size. */
const DEFAULT_DIAMETER_IN = 0.375
const GHOST_RADIUS_M = (DEFAULT_DIAMETER_IN * IN_TO_M) / 2
/** Matches the lineset's foam-jacket thickness so the traced line sits just
 *  outside an insulated suction line, exactly where the old paired rail was. */
const INSULATION_THICKNESS_M = 0.01
/** How close (meters, XZ) the cursor must be to a lineset path to trace it. */
const FOLLOW_PICK_RADIUS_M = 0.6
/** Clear-air gap (meters) between the lineset's outer surface and the traced
 *  liquid line, so the new run reads as its own line instead of fusing onto
 *  the lineset (~2"). */
const FOLLOW_GAP_M = 0.05

type Vec3 = [number, number, number]

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

/** Nearest refrigerant port within snap range on the XZ plane, as a position
 * tuple. Y is ignored for the distance check; the snap adopts the port's full
 * 3D position. */
function findNearbyPort(point: Vec3): Vec3 | null {
  const port = findNearestPortXZ(
    point,
    collectScenePorts({ systems: REFRIGERANT_PORT_SYSTEMS }),
    ENDPOINT_SNAP_RADIUS_M,
  )
  return port ? [port.position[0], port.position[1], port.position[2]] : null
}

function projectToAngleLock(from: Vec3, raw: Vec3): Vec3 {
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

/** Distance (XZ) from point `p` to segment `a`→`b`. */
function distToSegmentXZ(p: Vec3, a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0]
  const dz = b[2] - a[2]
  const len2 = dx * dx + dz * dz
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = a[0] + t * dx
  const cz = a[2] + t * dz
  return Math.hypot(p[0] - cx, p[2] - cz)
}

/** Center-to-center offset (meters) that drops the liquid line a small gap
 *  outside the lineset's outer surface, so the two read as separate lines. */
function traceOffsetMeters(lineset: LinesetNode): number {
  const suctionR = (lineset.suctionDiameter * IN_TO_M) / 2
  const jacket = lineset.insulated ? INSULATION_THICKNESS_M : 0
  return suctionR + jacket + FOLLOW_GAP_M + GHOST_RADIUS_M
}

type FollowTarget = { lineset: LinesetNode; sign: number }

/**
 * Nearest lineset whose path passes within `FOLLOW_PICK_RADIUS_M` of the
 * cursor, plus which side of it the cursor is on (`sign`, matching
 * `offsetPathHorizontal`'s side convention). Restricted to the active level.
 */
function findFollowTarget(point: Vec3, levelId: AnyNodeId): FollowTarget | null {
  const scene = useScene.getState()
  let best: FollowTarget | null = null
  let bestD = FOLLOW_PICK_RADIUS_M
  for (const n of Object.values(scene.nodes)) {
    if (!n || n.type !== 'lineset') continue
    if ((n.parentId as AnyNodeId | null) !== levelId) continue
    const ls = n as LinesetNode
    if (ls.path.length < 2) continue
    for (let i = 0; i < ls.path.length - 1; i++) {
      const a = ls.path[i] as Vec3
      const b = ls.path[i + 1] as Vec3
      const d = distToSegmentXZ(point, a, b)
      if (d >= bestD) continue
      bestD = d
      // Side vector = normalize(heading_xz) × UP = (-hz, 0, hx); sign is which
      // side of the segment the cursor sits on.
      const hx = b[0] - a[0]
      const hz = b[2] - a[2]
      const hlen = Math.hypot(hx, hz)
      const sx = hlen > 1e-9 ? -hz / hlen : 0
      const sz = hlen > 1e-9 ? hx / hlen : 0
      const dot = (point[0] - a[0]) * sx + (point[2] - a[2]) * sz
      best = { lineset: ls, sign: dot >= 0 ? 1 : -1 }
    }
  }
  return best
}

/** The offset path a follow-target would trace, or null if degenerate. */
function tracePath(target: FollowTarget): Vec3[] | null {
  const offset = target.sign * traceOffsetMeters(target.lineset)
  const traced = offsetPathHorizontal(target.lineset.path as Vec3[], offset)
  return traced.length >= 2 ? traced : null
}

const LiquidLineTool = () => {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)
  const follow = useLiquidLineToolOptions((s) => s.follow)
  const cursorRef = useRef<Group>(null)
  const [draftPoints, setDraftPoints] = useState<Vec3[]>([])
  const [cursorPos, setCursorPos] = useState<Vec3 | null>(null)
  const [snapTarget, setSnapTarget] = useState<Vec3 | null>(null)
  const [traceGhost, setTraceGhost] = useState<Vec3[] | null>(null)
  const [altActive, setAltActive] = useState(false)
  const draftRef = useRef(draftPoints)
  draftRef.current = draftPoints
  const followTargetRef = useRef<FollowTarget | null>(null)
  const altAnchorRef = useRef<{ clientY: number; baseY: number } | null>(null)
  const lastClientYRef = useRef<number | null>(null)

  // Clear in-flight draft / trace whenever Follow toggles (panel button or F).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `follow` is an intentional re-run trigger; the body clears the in-flight draft when it toggles.
  useEffect(() => {
    setDraftPoints([])
    setTraceGhost(null)
    followTargetRef.current = null
    altAnchorRef.current = null
    setAltActive(false)
  }, [follow])

  // Leaving the tool clears Follow so re-arming it starts in free-draw.
  useEffect(() => () => useLiquidLineToolOptions.getState().setFollow(false), [])

  useEffect(() => {
    if (!activeLevelId) return

    const commitSegment = (start: Vec3, end: Vec3) => {
      const sameSpot =
        Math.abs(start[0] - end[0]) < 1e-4 &&
        Math.abs(start[1] - end[1]) < 1e-4 &&
        Math.abs(start[2] - end[2]) < 1e-4
      if (sameSpot) return

      // Fold into any existing run that shares this segment's endpoint, so two
      // runs meeting at a coordinate become one mitered path instead of
      // overlapping nodes. Only same-level runs are candidates.
      const scene = useScene.getState()
      const existing = Object.values(scene.nodes).filter(
        (n): n is LiquidLineNode =>
          n?.type === 'liquid-line' && (n.parentId as AnyNodeId | null) === activeLevelId,
      )
      const plan = planLiquidLineConnect(existing, start, end)

      if (plan.kind === 'create') {
        const line = LiquidLineNode.parse({
          ...liquidLineDefinition.defaults(),
          name: 'Liquid Line',
          path: plan.path,
        })
        scene.createNode(line, activeLevelId)
      } else if (plan.kind === 'extend') {
        scene.updateNode(plan.id, { path: plan.path })
      } else {
        scene.updateNode(plan.id, { path: plan.path })
        scene.deleteNode(plan.deleteId)
      }
      triggerSFX('sfx:item-place')
      setDraftPoints([])
      setSnapTarget(null)
      altAnchorRef.current = null
      setAltActive(false)
    }

    // Lay a liquid line beside a lineset, tracing its whole path at the offset.
    const commitTrace = (target: FollowTarget) => {
      const traced = tracePath(target)
      if (!traced) return
      const scene = useScene.getState()
      const line = LiquidLineNode.parse({
        ...liquidLineDefinition.defaults(),
        name: 'Liquid Line',
        path: traced,
      })
      scene.createNode(line, activeLevelId)
      triggerSFX('sfx:item-place')
      setTraceGhost(null)
      followTargetRef.current = null
    }

    const resolveSnappedPoint = (event: GridEvent): { point: Vec3; snapped: Vec3 | null } => {
      // Port mating is the run's primary affordance; it stays on in every
      // snapping mode except `off` (the raw-cursor bypass).
      const snapEnabled = isGridSnapActive() || isMagneticSnapActive() || isAngleSnapActive()
      const last = draftRef.current.at(-1)
      if (!last) {
        const raw: Vec3 = [event.localPosition[0], 0, event.localPosition[2]]
        if (event.nativeEvent?.altKey !== true && snapEnabled) {
          const target = findNearbyPort(raw)
          if (target) return { point: target, snapped: target }
        }
        const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
        return { point: [snap(raw[0], step), 0, snap(raw[2], step)], snapped: null }
      }
      const rawXZ: Vec3 = [event.localPosition[0], last[1], event.localPosition[2]]
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

    const resolveAltVerticalPoint = (clientY: number): Vec3 | null => {
      const anchor = altAnchorRef.current
      const last = draftRef.current.at(-1)
      if (!anchor || !last) return null
      const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const dy = (anchor.clientY - clientY) / ALT_PIXELS_PER_METER
      const snappedDy = snap(dy, step)
      const y = Math.min(ALT_Y_MAX_M, Math.max(ALT_Y_MIN_M, anchor.baseY + snappedDy))
      return [last[0], y, last[2]]
    }

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
      // Follow mode: track the lineset under the cursor and preview its trace.
      if (useLiquidLineToolOptions.getState().follow) {
        const raw: Vec3 = [event.localPosition[0], 0, event.localPosition[2]]
        clearDrawAlignment()
        setCursorPos(raw)
        setSnapTarget(null)
        const target = findFollowTarget(raw, activeLevelId as AnyNodeId)
        followTargetRef.current = target
        setTraceGhost(target ? tracePath(target) : null)
        return
      }

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
      // Follow mode: a click commits the trace beside the hovered lineset.
      if (useLiquidLineToolOptions.getState().follow) {
        const target = followTargetRef.current
        if (target) commitTrace(target)
        return
      }

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
      if (useLiquidLineToolOptions.getState().follow) return
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
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        useLiquidLineToolOptions.getState().toggleFollow()
        return
      }
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
      if (draftRef.current.length === 0 && !followTargetRef.current) return
      markToolCancelConsumed()
      setDraftPoints([])
      setCursorPos(null)
      setSnapTarget(null)
      setTraceGhost(null)
      followTargetRef.current = null
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

  const previewSegments: Array<{ a: Vec3; b: Vec3 }> = []
  for (let i = 0; i < draftPoints.length - 1; i++) {
    previewSegments.push({ a: draftPoints[i]!, b: draftPoints[i + 1]! })
  }
  const last = draftPoints.at(-1)
  if (last && cursorPos) {
    previewSegments.push({ a: last, b: cursorPos })
  }

  const traceSegments: Array<{ a: Vec3; b: Vec3 }> = []
  if (traceGhost) {
    for (let i = 0; i < traceGhost.length - 1; i++) {
      traceSegments.push({ a: traceGhost[i]!, b: traceGhost[i + 1]! })
    }
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
      {cursorPos && (
        <>
          <CursorSphere color={PREVIEW_COLOR} position={cursorPos} ref={cursorRef} />
          {follow ? (
            <group position={cursorPos}>
              <Html
                center
                position={[0, 1.45, 0]}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
                zIndexRange={[100, 0]}
              >
                <div
                  style={{
                    background: 'rgba(17,17,20,0.85)',
                    border: '1px solid rgba(176,107,63,0.6)',
                    borderRadius: 6,
                    color: '#f3e7dd',
                    fontSize: 11,
                    padding: '3px 7px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {followTargetRef.current
                    ? 'Click to trace this lineset'
                    : 'Follow: hover a lineset'}
                </div>
              </Html>
            </group>
          ) : (
            pillParts && (
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
            )
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
          <sphereGeometry args={[0.05, 16, 12]} />
          <meshBasicMaterial color={PREVIEW_COLOR} depthTest={false} />
        </mesh>
      ))}
      {previewSegments.map((seg, i) => (
        <PreviewSegment a={seg.a} b={seg.b} key={`seg-${i}`} />
      ))}
      {traceSegments.map((seg, i) => (
        <PreviewSegment a={seg.a} b={seg.b} key={`trace-${i}`} />
      ))}
    </LevelOffsetGroup>
  )
}

function PreviewSegment({ a, b }: { a: Vec3; b: Vec3 }) {
  const start = new Vector3(...a)
  const end = new Vector3(...b)
  const dir = new Vector3().subVectors(end, start)
  const length = dir.length()
  if (length < 1e-4) return null
  dir.normalize()
  const mid = new Vector3().addVectors(start, end).multiplyScalar(0.5)
  return (
    <mesh
      layers={EDITOR_LAYER}
      position={mid.toArray()}
      ref={(m) => {
        if (!m) return
        m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir)
      }}
    >
      <cylinderGeometry args={[GHOST_RADIUS_M, GHOST_RADIUS_M, length, 16, 1, false]} />
      <meshBasicMaterial
        color={PREVIEW_COLOR}
        depthTest={false}
        opacity={PREVIEW_OPACITY}
        transparent
      />
    </mesh>
  )
}

export default LiquidLineTool
