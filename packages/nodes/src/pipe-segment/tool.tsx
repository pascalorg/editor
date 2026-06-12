'use client'

import { type AnyNode, emitter, type GridEvent, PipeSegmentNode, useScene } from '@pascal-app/core'
import { DimensionPill, markToolCancelConsumed, triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { planPipeBranchTap, planPipeElbowAtPort } from '../shared/auto-fitting'
import {
  collectScenePorts,
  DWV_PORT_SYSTEMS,
  findNearestPortXZ,
  findNearestRunBodyXZ,
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
 *   - **Slope**: waste runs FALL automatically at ¼" per foot (1:48) of
 *     horizontal distance, the IPC default for residential drains. A
 *     freely placed start is RAISED so the run falls onto the grid plane
 *     (nothing clips below); a port/body-snapped start keeps its fixed
 *     height and the end drops instead. Vent runs stay level. The pill
 *     shows the live drop in the Y part.
 *   - **Q** toggles waste ↔ vent. **[ / ]** steps the pipe size through
 *     nominal DWV diameters.
 *   - Hold **Alt** → vertical mode (stacks): XZ locks to the start,
 *     mouse vertical motion drives Y, click commits the riser.
 *   - 45° XZ angle lock from the start; **Shift** frees the angle and
 *     grid snap.
 *   - Esc clears an anchored start point.
 */
const PREVIEW_OPACITY = 0.55
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

function findNearbyPort(point: [number, number, number]): ScenePort | null {
  return findNearestPortXZ(
    point,
    collectScenePorts({ systems: DWV_PORT_SYSTEMS }),
    PORT_SNAP_RADIUS_M,
  )
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
    ) => {
      // Free waste start: lift it by the drain fall so the run lands ON
      // the grid plane instead of sinking below it. Snapped starts are
      // height-fixed (fixture drain, run end), so their end drops instead.
      let start = rawStart
      if (
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

      let pipeStart = startPlan?.collarPoint ?? tapPlan?.branchCollar ?? start
      let pipeEnd = endPlan?.collarPoint ?? end
      const remaining = Math.hypot(
        pipeEnd[0] - pipeStart[0],
        pipeEnd[1] - pipeStart[1],
        pipeEnd[2] - pipeStart[2],
      )
      let bends = [startPlan, endPlan].filter((p) => p !== null)
      let tap = tapPlan
      if (remaining <= 0.05) {
        bends = []
        tap = null
        pipeStart = start
        pipeEnd = end
      }

      const pipe = PipeSegmentNode.parse({
        ...pipeSegmentDefinition.defaults(),
        name: systemRef.current === 'vent' ? 'Vent' : 'Drain',
        path: [pipeStart, pipeEnd],
        diameter: diameterRef.current,
        system: systemRef.current,
      })
      useScene.getState().applyNodeChanges({
        create: [
          ...bends.map((plan) => ({ node: plan.fitting, parentId: activeLevelId })),
          ...(tap
            ? [
                { node: tap.fitting, parentId: activeLevelId },
                { node: tap.runTail, parentId: activeLevelId },
              ]
            : []),
          { node: pipe, parentId: activeLevelId },
        ],
        update: [
          ...bends.map((plan) => plan.trim),
          ...(tap ? [tap.runUpdate as { id: AnyNode['id']; data: Partial<AnyNode> }] : []),
        ],
      })
      triggerSFX('sfx:item-place')
      setDraftStart(null)
      setSnapTarget(null)
      startPortRef.current = null
      startBodyRef.current = null
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
      if (systemRef.current !== 'waste') return end
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
      const start = startRef.current
      if (!start) {
        const raw: [number, number, number] = [event.localPosition[0], 0, event.localPosition[2]]
        if (event.nativeEvent?.altKey !== true) {
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
          const body = findNearestRunBodyXZ(raw, BODY_SNAP_RADIUS_M, {
            kinds: ['pipe-segment'],
          })
          if (body) return { point: body.point, snapped: body.point, port: null, body }
        }
        const step = useEditor.getState().gridSnapStep
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
      const shift = event.nativeEvent?.shiftKey === true
      const angled = shift ? rawXZ : projectToAngleLock(start, rawXZ)
      if (event.nativeEvent?.altKey !== true && !shift) {
        const port = findNearbyPort(rawXZ)
        if (port) {
          const p: [number, number, number] = [port.position[0], port.position[1], port.position[2]]
          return { point: p, snapped: p, port, body: null }
        }
      }
      const step = useEditor.getState().gridSnapStep
      const snapped: [number, number, number] = [
        snap(angled[0], step),
        angled[1],
        snap(angled[2], step),
      ]
      return { point: applySlope(start, snapped), snapped: null, port: null, body: null }
    }

    const resolveAltVerticalPoint = (clientY: number): [number, number, number] | null => {
      const anchor = altAnchorRef.current
      const start = startRef.current
      if (!anchor || !start) return null
      const dy = (anchor.clientY - clientY) / ALT_PIXELS_PER_METER
      const y = Math.min(ALT_Y_MAX_M, Math.max(ALT_Y_MIN_M, anchor.baseY + dy))
      return [start[0], y, start[2]]
    }

    const onMove = (event: GridEvent) => {
      const clientY = (event.nativeEvent as { clientY?: number } | undefined)?.clientY
      if (typeof clientY === 'number') lastClientYRef.current = clientY
      if (altAnchorRef.current && typeof clientY === 'number') {
        const point = resolveAltVerticalPoint(clientY)
        if (point) {
          setCursorPos(point)
          setSnapTarget(null)
          return
        }
      }
      const { point, snapped } = resolveSnappedPoint(event)
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
      const { point, port, body } = resolveSnappedPoint(event)
      if (!start) {
        // First click: anchor the start, remembering the port / run body
        // it snapped to so the commit can mint a bend / wye.
        triggerSFX('sfx:grid-snap')
        startPortRef.current = port
        startBodyRef.current = port ? null : body
        setDraftStart(point)
        return
      }
      commitSegment(start, point, port)
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
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        e.preventDefault()
        exitAltMode()
      }
    }

    const onCancel = () => {
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
    }
  }, [activeLevelId])

  if (!activeLevelId) return null

  // Free waste start lifts at commit so the run falls ONTO the grid —
  // mirror that here so the preview line / pill match the placed pipe.
  // A snapped end (snapTarget set) keeps the start where it is.
  const displayStart =
    draftStart &&
    cursorPos &&
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
    <group>
      <group position={cursorPos ?? [0, 0, 0]} visible={!!cursorPos}>
        <mesh>
          <sphereGeometry args={[0.06, 16, 12]} />
          <meshBasicMaterial color="#818cf8" depthTest={false} transparent opacity={0.9} />
        </mesh>
        {pillParts && (
          <Html
            center
            position={[0, 0.3, 0]}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
            zIndexRange={[100, 0]}
          >
            <div className="flex flex-col items-center gap-1">
              <DimensionPill parts={pillParts} primary={pillPrimary} unit={unit} />
              <div className="whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-3 py-0.5 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
                {system === 'waste' ? 'Waste · ¼″/ft fall' : 'Vent · level'} · Q to toggle
              </div>
            </div>
          </Html>
        )}
      </group>
      {snapTarget && (
        <mesh position={snapTarget}>
          <sphereGeometry args={[0.1, 24, 16]} />
          <meshBasicMaterial color="#818cf8" depthTest={false} opacity={0.35} transparent />
        </mesh>
      )}
      {displayStart && (
        <mesh position={displayStart}>
          <sphereGeometry args={[0.05, 16, 12]} />
          <meshBasicMaterial color="#818cf8" depthTest={false} />
        </mesh>
      )}
      {displayStart && cursorPos && (
        <PreviewPipe a={displayStart} b={cursorPos} diameterIn={diameter} />
      )}
    </group>
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
