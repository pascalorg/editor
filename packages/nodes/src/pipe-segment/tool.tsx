'use client'

import { type AnyNode, emitter, type GridEvent, PipeSegmentNode, useScene } from '@pascal-app/core'
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
import { Vector3 } from 'three'
import {
  planPipeBranchTap,
  planPipeCrossAtRunBody,
  planPipeElbowAtPort,
} from '../shared/auto-fitting'
import { alignDrawPoint, clearDrawAlignment } from '../shared/draw-alignment'
import { LevelOffsetGroup } from '../shared/level-offset-group'
import {
  collectScenePorts,
  DWV_PORT_SYSTEMS,
  findNearestPortXZ,
  findNearestRunBodyXZ,
  findRunBodyCrossingXZ,
  type RunBodyHit,
  type ScenePort,
} from '../shared/ports'
import { pipeSegmentDefinition } from './definition'

/**
 * Slope-aware two-click placement tool for DWV pipe runs — the plumbing
 * sibling of the duct tool.
 *
 *   - **First click** anchors the run start (port snap joins onto an
 *     existing pipe end — DWV ports only, duct/refrigerant collars are
 *     invisible to it). The start inherits the snapped port's height.
 *   - **Second click** commits a two-point pipe and re-arms.
 *   - **Slope**: runs draw LEVEL by default. **S** toggles slope mode,
 *     where waste runs fall at ¼" per foot (1:48) of horizontal
 *     distance, the IPC default for residential drains. When sloped, a
 *     freely placed start is RAISED so the run falls onto the grid plane
 *     (nothing clips below); a port/body-snapped start keeps its fixed
 *     height and the end drops instead. Vent runs always stay level.
 *     The pill shows the live drop in the Y part.
 *   - **Q** toggles waste ↔ vent. **[ / ]** steps the pipe size through
 *     nominal DWV diameters.
 *   - Hold **Alt** → vertical mode (stacks): XZ locks to the start,
 *     mouse vertical motion drives Y, click commits the riser.
 *   - The in-flight end follows the active snapping mode: `angles` locks it
 *     to 45° in XZ from the start; `grid`/`lines`/`off` leave it free. Shift
 *     cycles the snapping mode.
 *   - Esc clears an anchored start point.
 */
const PREVIEW_OPACITY = 0.55
/** green-500 — the project's snap accent. The cursor ring + vertical line
 *  recolour to this while the point is snapped onto an existing run / port,
 *  so the coincidence reads with the familiar snap green (matches the duct
 *  tool). */
const SNAP_CURSOR_COLOR = '#22c55e'
/** Nominal residential DWV sizes (inches). */
const PIPE_DIAMETERS_IN = [1.25, 1.5, 2, 3, 4, 6] as const
/** IPC default drain slope — ¼" per foot (1:48). */
const DRAIN_SLOPE = 1 / 48
/** Snap radius (meters, XZ) for joining onto an existing pipe end. */
const PORT_SNAP_RADIUS_M = 0.5
/** Snap radius (meters, XZ) for tapping the side of an existing run. */
const BODY_SNAP_RADIUS_M = 0.3
const ANGLE_STEP_RAD = Math.PI / 4
const ALT_PIXELS_PER_METER = 100
const ALT_Y_MIN_M = -3
const ALT_Y_MAX_M = 10

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

function dist2(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return dx * dx + dy * dy + dz * dz
}

function findNearbyPort(point: [number, number, number]): ScenePort | null {
  return findNearestPortXZ(
    point,
    collectScenePorts({ systems: DWV_PORT_SYSTEMS }),
    PORT_SNAP_RADIUS_M,
  )
}

function pipeEndPort(pipe: PipeSegmentNode, id: 'start' | 'end'): ScenePort | null {
  if (pipe.path.length < 2) return null
  const index = id === 'start' ? 0 : pipe.path.length - 1
  const neighborIndex = id === 'start' ? 1 : pipe.path.length - 2
  const position = pipe.path[index]!
  const neighbor = pipe.path[neighborIndex]!
  const dx = position[0] - neighbor[0]
  const dy = position[1] - neighbor[1]
  const dz = position[2] - neighbor[2]
  const len = Math.hypot(dx, dy, dz)
  const direction: [number, number, number] =
    len < 1e-9 ? [1, 0, 0] : [dx / len, dy / len, dz / len]
  return {
    id,
    nodeId: pipe.id,
    position,
    direction,
    diameter: pipe.diameter,
    system: pipe.system,
  }
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

const PipeSegmentTool = () => {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)
  const [system, setSystem] = useState<'waste' | 'vent'>('waste')
  const [sloped, setSloped] = useState(false)
  const [diameter, setDiameter] = useState<number>(
    (pipeSegmentDefinition.defaults() as { diameter: number }).diameter,
  )
  const [draftStart, setDraftStart] = useState<[number, number, number] | null>(null)
  const [cursorPos, setCursorPos] = useState<[number, number, number] | null>(null)
  const [snapTarget, setSnapTarget] = useState<[number, number, number] | null>(null)
  const [altActive, setAltActive] = useState(false)

  const startRef = useRef(draftStart)
  startRef.current = draftStart
  const systemRef = useRef(system)
  systemRef.current = system
  const slopedRef = useRef(sloped)
  slopedRef.current = sloped
  const diameterRef = useRef(diameter)
  diameterRef.current = diameter
  // Port / run-body the anchored start snapped onto — read at commit so
  // joints mint bends (corner) or wyes / sanitary tees (body tap).
  const startPortRef = useRef<ScenePort | null>(null)
  const startBodyRef = useRef<RunBodyHit | null>(null)
  const altAnchorRef = useRef<{ clientY: number; baseY: number } | null>(null)
  const lastClientYRef = useRef<number | null>(null)

  useEffect(() => {
    if (!activeLevelId) return

    /** Corner-bend gate: joints onto another PIPE run's open end. */
    const bendPlanFor = (port: ScenePort | null, awayDir: [number, number, number]) => {
      if (!port) return null
      const owner = useScene.getState().nodes[port.nodeId]
      if (owner?.type !== 'pipe-segment') return null
      const plan = planPipeElbowAtPort(port, awayDir, diameterRef.current, owner.pipeMaterial)
      if (!plan) return null
      // Trim the run's snapped endpoint back to the bend's inlet collar.
      const path = owner.path.map((p) => [...p] as [number, number, number])
      const index = port.id === 'start' ? 0 : path.length - 1
      const neighbor = path[index === 0 ? 1 : index - 1]!
      const remaining = Math.hypot(
        plan.trimmedPortPoint[0] - neighbor[0],
        plan.trimmedPortPoint[1] - neighbor[1],
        plan.trimmedPortPoint[2] - neighbor[2],
      )
      const original = path[index]!
      const originalLen = Math.hypot(
        original[0] - neighbor[0],
        original[1] - neighbor[1],
        original[2] - neighbor[2],
      )
      if (remaining < 0.05 || remaining >= originalLen) return null
      path[index] = plan.trimmedPortPoint
      return { ...plan, trim: { id: port.nodeId, data: { path } as Partial<AnyNode> } }
    }

    const commitSegment = (
      rawStart: [number, number, number],
      end: [number, number, number],
      endPort: ScenePort | null = null,
      endBody: RunBodyHit | null = null,
    ) => {
      // Free waste start: lift it by the drain fall so the run lands ON
      // the grid plane instead of sinking below it. Snapped starts are
      // height-fixed (fixture drain, run end), so their end drops instead.
      let start = rawStart
      if (
        slopedRef.current &&
        systemRef.current === 'waste' &&
        !startPortRef.current &&
        !startBodyRef.current &&
        !endPort
      ) {
        const run = Math.hypot(end[0] - rawStart[0], end[2] - rawStart[2])
        start = [rawStart[0], rawStart[1] + run * DRAIN_SLOPE, rawStart[2]]
      }
      const length = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2])
      if (length < 1e-4) return
      const dir: [number, number, number] = [
        (end[0] - start[0]) / length,
        (end[1] - start[1]) / length,
        (end[2] - start[2]) / length,
      ]

      const startPlan = bendPlanFor(startPortRef.current, dir)
      const endPlan = bendPlanFor(endPort, [-dir[0], -dir[1], -dir[2]])
      // Body tap (wye / sanitary tee) when the start landed on a run's side.
      const body = startPlan ? null : startBodyRef.current
      const bodyOwner = body ? useScene.getState().nodes[body.nodeId] : null
      const tapPlan =
        body && bodyOwner?.type === 'pipe-segment'
          ? planPipeBranchTap(bodyOwner, body, dir, diameterRef.current)
          : null
      // End body tap: the END landed on a run's side — split that trunk and
      // the new run ends at the branch collar, the branch leaving back
      // toward the drawn run (along -dir, since dir points start→end).
      const endTapBody = endPlan ? null : endBody
      const endTapOwner = endTapBody ? useScene.getState().nodes[endTapBody.nodeId] : null
      const endTapPlan =
        endTapBody && endTapOwner?.type === 'pipe-segment'
          ? planPipeBranchTap(
              endTapOwner,
              endTapBody,
              [-dir[0], -dir[1], -dir[2]],
              diameterRef.current,
            )
          : null
      // Both ends tapping the SAME run would split one polyline twice in a
      // single change — drop the end tap and let the end butt-join instead.
      const endTap = endTapPlan && endTapBody?.nodeId === body?.nodeId ? null : endTapPlan

      let pipeStart = startPlan?.collarPoint ?? tapPlan?.branchCollar ?? start
      let pipeEnd = endPlan?.collarPoint ?? endTap?.branchCollar ?? end
      const remaining = Math.hypot(
        pipeEnd[0] - pipeStart[0],
        pipeEnd[1] - pipeStart[1],
        pipeEnd[2] - pipeStart[2],
      )
      let bends = [startPlan, endPlan].filter((p) => p !== null)
      let tap = tapPlan
      let endTapFinal = endTap

      // Cross tap: the drawn run passes straight THROUGH a run's body
      // (interior crossing, not an end touch). Split that run and the drawn
      // pipe into two halves meeting the cross's opposed branch collars.
      // Skip a run already tapped by a start / end tee so one polyline isn't
      // split twice in a single change.
      const crossHit = findRunBodyCrossingXZ(start, end, BODY_SNAP_RADIUS_M, {
        kinds: ['pipe-segment'],
      })
      const crossOwner = crossHit ? useScene.getState().nodes[crossHit.nodeId] : null
      const crossTappedElsewhere =
        crossHit?.nodeId === body?.nodeId || crossHit?.nodeId === endTapBody?.nodeId
      let cross =
        crossHit && !crossTappedElsewhere && crossOwner?.type === 'pipe-segment'
          ? planPipeCrossAtRunBody(crossOwner, crossHit, dir, diameterRef.current)
          : null

      if (remaining <= 0.05) {
        bends = []
        tap = null
        endTapFinal = null
        cross = null
        pipeStart = start
        pipeEnd = end
      }

      const makePipe = (from: [number, number, number], to: [number, number, number]) =>
        PipeSegmentNode.parse({
          ...pipeSegmentDefinition.defaults(),
          name: systemRef.current === 'vent' ? 'Vent' : 'Drain',
          path: [from, to],
          diameter: diameterRef.current,
          system: systemRef.current,
        })
      // A cross splits the drawn run into two halves that meet its opposed
      // branch collars; otherwise it's one pipe end-to-end. Degenerate
      // halves (the crossing too near an end) are dropped.
      const pipes = cross
        ? [
            dist2(pipeStart, cross.branchCollarNear) > 0.05 * 0.05
              ? makePipe(pipeStart, cross.branchCollarNear)
              : null,
            dist2(cross.branchCollarFar, pipeEnd) > 0.05 * 0.05
              ? makePipe(cross.branchCollarFar, pipeEnd)
              : null,
          ].filter((p) => p !== null)
        : [makePipe(pipeStart, pipeEnd)]
      useScene.getState().applyNodeChanges({
        create: [
          ...bends.map((plan) => ({ node: plan.fitting, parentId: activeLevelId })),
          ...(tap
            ? [
                { node: tap.fitting, parentId: activeLevelId },
                { node: tap.runTail, parentId: activeLevelId },
              ]
            : []),
          ...(endTapFinal
            ? [
                { node: endTapFinal.fitting, parentId: activeLevelId },
                { node: endTapFinal.runTail, parentId: activeLevelId },
              ]
            : []),
          ...(cross
            ? [
                { node: cross.fitting, parentId: activeLevelId },
                { node: cross.runTail, parentId: activeLevelId },
              ]
            : []),
          ...pipes.map((node) => ({ node, parentId: activeLevelId })),
        ],
        update: [
          ...bends.map((plan) => plan.trim),
          ...(tap ? [tap.runUpdate as { id: AnyNode['id']; data: Partial<AnyNode> }] : []),
          ...(endTapFinal
            ? [endTapFinal.runUpdate as { id: AnyNode['id']; data: Partial<AnyNode> }]
            : []),
          ...(cross ? [cross.runUpdate as { id: AnyNode['id']; data: Partial<AnyNode> }] : []),
        ],
      })
      const nextPipe = pipes.at(-1)
      const nextStart = nextPipe ? nextPipe.path[nextPipe.path.length - 1]! : end
      const nextPort = nextPipe ? pipeEndPort(nextPipe, 'end') : endPort
      triggerSFX('sfx:item-place')
      setDraftStart(nextStart)
      setSnapTarget(null)
      startPortRef.current = nextPort
      startBodyRef.current = nextPort ? null : endBody
      altAnchorRef.current = null
      setAltActive(false)
    }

    /** Apply the drain fall to an XZ-resolved end point. Only snapped
     *  starts (fixture drain, run end/body) drop the end — they're
     *  height-fixed. A free start keeps the end on the grid plane and
     *  gets LIFTED at commit instead, so the run never sinks below it. */
    const applySlope = (
      start: [number, number, number],
      end: [number, number, number],
    ): [number, number, number] => {
      if (!slopedRef.current || systemRef.current !== 'waste') return end
      if (!startPortRef.current && !startBodyRef.current) return end
      const run = Math.hypot(end[0] - start[0], end[2] - start[2])
      return [end[0], start[1] - run * DRAIN_SLOPE, end[2]]
    }

    const resolveSnappedPoint = (
      event: GridEvent,
    ): {
      point: [number, number, number]
      snapped: [number, number, number] | null
      port: ScenePort | null
      body: RunBodyHit | null
    } => {
      // Port / body mating is the run's primary affordance; it stays on in
      // every snapping mode except `off` (the raw-cursor bypass).
      const snapEnabled = isGridSnapActive() || isMagneticSnapActive() || isAngleSnapActive()
      const start = startRef.current
      if (!start) {
        const raw: [number, number, number] = [event.localPosition[0], 0, event.localPosition[2]]
        const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
        if (event.nativeEvent?.altKey !== true && snapEnabled) {
          const port = findNearbyPort(raw)
          if (port) {
            const p: [number, number, number] = [
              port.position[0],
              port.position[1],
              port.position[2],
            ]
            return { point: p, snapped: p, port, body: null }
          }
          // No open end nearby — try the side of a run (wye / santee tap).
          // Probe with a grid-snapped cursor so the tap steps along the run
          // like every other placement; `off` mode (step 0) rides smoothly.
          const probe: [number, number, number] = [snap(raw[0], step), 0, snap(raw[2], step)]
          const body = findNearestRunBodyXZ(probe, BODY_SNAP_RADIUS_M, {
            kinds: ['pipe-segment'],
          })
          if (body) return { point: body.point, snapped: body.point, port: null, body }
        }
        return {
          point: [snap(raw[0], step), 0, snap(raw[2], step)],
          snapped: null,
          port: null,
          body: null,
        }
      }
      const rawXZ: [number, number, number] = [
        event.localPosition[0],
        start[1],
        event.localPosition[2],
      ]
      // The 45° lock is now the `angles` snapping mode (Shift cycles to it),
      // not a held key.
      const angleLocked = isAngleSnapActive()
      const angled = angleLocked ? projectToAngleLock(start, rawXZ) : rawXZ
      const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      if (event.nativeEvent?.altKey !== true && snapEnabled) {
        const port = findNearbyPort(rawXZ)
        if (port) {
          const p: [number, number, number] = [port.position[0], port.position[1], port.position[2]]
          return { point: p, snapped: p, port, body: null }
        }
        // No open end nearby — landing on the side of a run taps a wye /
        // sanitary tee there (mirror of the first-point tap). Probe with a
        // grid-snapped cursor so the tap steps along the run; checked against
        // the cursor, not the 45° projection, so a slightly-off trunk captures.
        const probe: [number, number, number] = [
          snap(rawXZ[0], step),
          rawXZ[1],
          snap(rawXZ[2], step),
        ]
        const body = findNearestRunBodyXZ(probe, BODY_SNAP_RADIUS_M, { kinds: ['pipe-segment'] })
        if (body) return { point: body.point, snapped: body.point, port: null, body }
      }
      let end: [number, number, number]
      if (!angleLocked) {
        end = [snap(angled[0], step), angled[1], snap(angled[2], step)]
      } else {
        // Snap the run LENGTH along the locked ray, not each axis — an
        // off-grid start (port / body snap) plus per-axis rounding pulls
        // the end off the 45° ray, bending the run as the cursor moves.
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
      return { point: applySlope(start, end), snapped: null, port: null, body: null }
    }

    const resolveAltVerticalPoint = (clientY: number): [number, number, number] | null => {
      const anchor = altAnchorRef.current
      const start = startRef.current
      if (!anchor || !start) return null
      const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const dy = (anchor.clientY - clientY) / ALT_PIXELS_PER_METER
      const snappedDy = snap(dy, step)
      const y = Math.min(ALT_Y_MAX_M, Math.max(ALT_Y_MIN_M, anchor.baseY + snappedDy))
      return [start[0], y, start[2]]
    }

    // Resolve the cursor point (port / body / grid / angle snap) then layer
    // Figma-style alignment so a run lines up with other runs, fittings, and
    // items as it's drawn. A free point (first vertex, or no angle lock) snaps;
    // an angle-locked continuation shows the guide passively. Alignment follows
    // the `lines` mode; a port / body snap or Alt-vertical bypasses it.
    const resolveAlignedPoint = (event: GridEvent) => {
      const r = resolveSnappedPoint(event)
      const hasStart = !!startRef.current
      const alt = event.nativeEvent?.altKey === true
      const point = alignDrawPoint(r.point, {
        applySnap: isMagneticSnapActive() && (!hasStart || !isAngleSnapActive()),
        bypass: alt || r.snapped !== null,
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
      const start = startRef.current
      if (altAnchorRef.current && start) {
        const clientY =
          (event.nativeEvent as { clientY?: number } | undefined)?.clientY ?? lastClientYRef.current
        if (typeof clientY === 'number') {
          const point = resolveAltVerticalPoint(clientY)
          if (point && Math.abs(point[1] - start[1]) >= 1e-4) commitSegment(start, point)
        }
        return
      }
      const { point, port, body } = resolveAlignedPoint(event)
      if (!start) {
        // First click: anchor the start, remembering the port / run body
        // it snapped to so the commit can mint a bend / wye.
        triggerSFX('sfx:grid-snap')
        startPortRef.current = port
        startBodyRef.current = port ? null : body
        // Continue an existing run at its true size: adopt the snapped
        // pipe's diameter so the new segment carries on at the same gauge
        // instead of whatever size the tool last drew.
        const ownerId = port?.nodeId ?? (port ? null : body?.nodeId)
        const owner = ownerId ? useScene.getState().nodes[ownerId] : null
        if (owner?.type === 'pipe-segment' && owner.diameter !== diameterRef.current) {
          setDiameter(owner.diameter)
        }
        setDraftStart(point)
        return
      }
      commitSegment(start, point, port, port ? null : body)
    }

    const enterAltMode = () => {
      const start = startRef.current
      if (!start || lastClientYRef.current === null) return
      if (altAnchorRef.current) return
      altAnchorRef.current = { clientY: lastClientYRef.current, baseY: start[1] }
      setAltActive(true)
    }

    const exitAltMode = () => {
      if (!altAnchorRef.current) return
      altAnchorRef.current = null
      setAltActive(false)
    }

    const stepDiameter = (step: 1 | -1) => {
      const sizes = PIPE_DIAMETERS_IN
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
      if (e.key === 'Alt') {
        e.preventDefault()
        enterAltMode()
      } else if (e.key === '[') {
        e.preventDefault()
        stepDiameter(-1)
      } else if (e.key === ']') {
        e.preventDefault()
        stepDiameter(1)
      } else if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault()
        setSystem((s) => (s === 'waste' ? 'vent' : 'waste'))
        triggerSFX('sfx:grid-snap')
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        setSloped((s) => !s)
        triggerSFX('sfx:grid-snap')
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
      if (!startRef.current) return
      markToolCancelConsumed()
      setDraftStart(null)
      setCursorPos(null)
      setSnapTarget(null)
      startPortRef.current = null
      startBodyRef.current = null
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

  // Free waste start lifts at commit so the run falls ONTO the grid —
  // mirror that here so the preview line / pill match the placed pipe.
  // A snapped end (snapTarget set) keeps the start where it is.
  const displayStart =
    draftStart &&
    cursorPos &&
    sloped &&
    system === 'waste' &&
    !startPortRef.current &&
    !startBodyRef.current &&
    !snapTarget &&
    !altActive
      ? ([
          draftStart[0],
          draftStart[1] +
            Math.hypot(cursorPos[0] - draftStart[0], cursorPos[2] - draftStart[2]) * DRAIN_SLOPE,
          draftStart[2],
        ] as [number, number, number])
      : draftStart

  const pillParts = cursorPos
    ? [
        ...(['x', 'y', 'z'] as const).map((axis, i) => ({
          key: axis,
          prefix: axis.toUpperCase(),
          value: displayStart ? cursorPos[i]! - displayStart[i]! : cursorPos[i]!,
          signed: !!displayStart,
        })),
        { key: 'diameter', prefix: 'Ø', value: diameter * 0.0254, signed: false },
      ]
    : null
  const pillPrimary = draftStart && cursorPos ? (altActive ? 'y' : 'y') : undefined

  return (
    <LevelOffsetGroup>
      {/* Cursor marker — the same ground ring + vertical line + tool-icon
          badge the duct draw tool shows in 3D (icon resolved from the active
          `pipe-segment` structure-tools entry). In 2D the floorplan overlay
          draws this for every tool; in 3D each tool renders its own. The
          dimension pill rides just above the cursor. */}
      {cursorPos && (
        <>
          <CursorSphere color={snapTarget ? SNAP_CURSOR_COLOR : undefined} position={cursorPos} />
          {pillParts && (
            <group position={cursorPos}>
              <Html
                center
                position={[0, 1.45, 0]}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
                zIndexRange={[100, 0]}
              >
                <div className="flex flex-col items-center gap-1">
                  <DimensionPill parts={pillParts} primary={pillPrimary} unit={unit} />
                  <div className="whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-3 py-0.5 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
                    {system === 'waste'
                      ? sloped
                        ? 'Waste · ¼″/ft fall'
                        : 'Waste · level'
                      : 'Vent · level'}{' '}
                    · Q system{system === 'waste' ? ' · S slope' : ''}
                  </div>
                </div>
              </Html>
            </group>
          )}
        </>
      )}
      {snapTarget && (
        <mesh layers={EDITOR_LAYER} position={snapTarget}>
          <sphereGeometry args={[0.1, 24, 16]} />
          <meshBasicMaterial color="#818cf8" depthTest={false} opacity={0.35} transparent />
        </mesh>
      )}
      {displayStart && (
        <mesh layers={EDITOR_LAYER} position={displayStart}>
          <sphereGeometry args={[0.05, 16, 12]} />
          <meshBasicMaterial color="#818cf8" depthTest={false} />
        </mesh>
      )}
      {displayStart && cursorPos && (
        <PreviewPipe a={displayStart} b={cursorPos} diameterIn={diameter} />
      )}
    </LevelOffsetGroup>
  )
}

function PreviewPipe({
  a,
  b,
  diameterIn,
}: {
  a: [number, number, number]
  b: [number, number, number]
  diameterIn: number
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
      <cylinderGeometry args={[radius, radius, length, 20, 1, false]} />
      <meshBasicMaterial color="#818cf8" depthTest={false} opacity={PREVIEW_OPACITY} transparent />
    </mesh>
  )
}

export default PipeSegmentTool
