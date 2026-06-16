'use client'

import {
  type AnyNode,
  DuctSegmentNode,
  emitter,
  type GridEvent,
  getLevelHeight,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
  DimensionPill,
  EDITOR_LAYER,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import { type Group, Matrix4, Vector3 } from 'three'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import {
  planCrossAtRunBody,
  planElbowAtPort,
  planElbowRealign,
  planTeeAtRunBody,
} from '../shared/auto-fitting'
import { alignDrawPoint, clearDrawAlignment } from '../shared/draw-alignment'
import { LevelOffsetGroup } from '../shared/level-offset-group'
import {
  collectScenePorts,
  DUCT_PORT_SYSTEMS,
  findNearestPortXZ,
  findNearestRunBodyXZ,
  findRunBodyCrossingXZ,
  type RunBodyHit,
  type ScenePort,
} from '../shared/ports'
import { ductSegmentDefinition } from './definition'
import { rectSectionAxes, rollToContinueAcrossElbow } from './geometry'

/**
 * One-segment-at-a-time placement tool for round duct segments.
 *
 * Mouse-driven model:
 *   - **First click** anchors the segment start (port snap joins onto an
 *     existing run / fitting collar).
 *   - **Second click** commits a two-point duct immediately and re-arms
 *     the tool — no polyline accumulation, no finish gesture. Chain runs
 *     by clicking again near the end you just placed (port snap).
 *   - **Auto-elbow**: when either end snapped onto another RUN's open
 *     port at an angle (15–90°, vertical turns included), an elbow
 *     fitting is minted at the joint and the duct pulls back to its
 *     outlet collar — corners get real fittings instead of butt joints.
 *   - **Tee tap**: starting OR ending on the SIDE of an existing run
 *     (centerline snap) splits the trunk, mints a tee at the tap point,
 *     and the branch leaves square from its collar.
 *   - **Cross tap**: drawing a run straight THROUGH the side of an
 *     existing run (interior crossing) splits the trunk, mints a 4-way
 *     cross at the crossing, and the drawn run continues out the far
 *     branch — both fittings inherit the trunk's / branch's profile.
 *   - The in-flight end is angle-locked to the nearest 45° step in XZ
 *     from the start; Y stays at the start's height. Hold **Shift** to
 *     release the lock.
 *   - Hold **Alt** → vertical mode. Cursor XZ locks to the start;
 *     vertical mouse motion drives Y. Click commits the riser segment.
 *   - **[ / ]** step the duct diameter through nominal US sizes; the
 *     ghost preview and the committed node both use it.
 *   - **C** toggles ceiling-level placement: the start point lands at
 *     the level's ceiling height (duct top hugging the ceiling) instead
 *     of the floor. Subsequent points inherit the start's Y as usual.
 *   - Esc clears an anchored start point.
 */
const PREVIEW_OPACITY = 0.55
/**
 * Nominal US round-duct sizes (inches): 4"–10" in 1" steps, 12"+ in 2"
 * steps — matches what flex and rigid round actually ship in.
 */
const DUCT_DIAMETERS_IN = [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20] as const
/** Snap radius (meters) for joining onto an existing duct's start/end. */
const ENDPOINT_SNAP_RADIUS_M = 0.5
/** Snap radius (meters) for tapping the SIDE of an existing run — a tee
 *  is minted there. Tighter than the port radius so run ends keep
 *  priority near their last stretch. */
const BODY_SNAP_RADIUS_M = 0.35
/** Angle step (radians) for the XZ angle lock — 45°. */
const ANGLE_STEP_RAD = Math.PI / 4
/** Mouse pixels → meters mapping for Alt-vertical drag. 100 px ≈ 1 m. */
const ALT_PIXELS_PER_METER = 100
/** Bounds on Alt-driven Y so a wild fling doesn't fly off. */
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

/**
 * Cross-section roll for a new rect run leaving `port` along `newDir`,
 * so its profile stays continuous with whatever it joined: a turn
 * re-derives the roll through the (future) elbow, a straight
 * continuation inherits the source's roll as-is. Sources: a rect run's
 * open end, or a rect fitting's open collar (continuity then comes from
 * the leg on the far side of the junction and the rect run mated
 * there). Null when the port doesn't carry a rect orientation. Shared
 * by the ghost preview and the commit so what you see is what lands.
 */
function continuityRollFrom(port: ScenePort | null, newDir: Vector3): number | null {
  if (!port) return null
  const nodes = useScene.getState().nodes
  const owner = nodes[port.nodeId]
  let srcDir: Vector3 | null = null
  let srcRoll = 0
  if (
    (owner?.type === 'hvac-equipment' || owner?.type === 'duct-terminal') &&
    port.shape &&
    port.shape !== 'round'
  ) {
    // The collar mesh is built at the canonical `rectSectionAxes(dir, 0)`
    // basis, so it reads as a source run pointing out along the port with
    // roll 0 — the new leg rolls to continue that across its turn.
    srcDir = new Vector3(...port.direction)
    srcRoll = 0
  } else if (owner?.type === 'duct-segment' && owner.shape !== 'round') {
    srcDir = new Vector3(...port.direction)
    srcRoll = owner.roll
  } else if (
    owner?.type === 'duct-fitting' &&
    owner.shape !== 'round' &&
    owner.fittingType !== 'reducer' &&
    owner.fittingType !== 'transition'
  ) {
    const source = getDuctFittingPorts(owner).find(
      (p) => p.id !== port.id && p.id !== 'branch' && p.id !== 'branch2',
    )
    if (source) {
      srcDir = new Vector3(...source.direction)
      const tol2 = 0.03 * 0.03
      for (const n of Object.values(nodes)) {
        if (n.type !== 'duct-segment' || n.shape === 'round' || n.path.length < 2) continue
        const ends = [n.path[0]!, n.path[n.path.length - 1]!]
        if (ends.some((e) => dist2(e, source.position) <= tol2)) {
          srcRoll = n.roll
          break
        }
      }
    }
  }
  if (!srcDir) return null
  const cross = new Vector3().crossVectors(srcDir, newDir)
  if (cross.lengthSq() < 1e-8) return srcRoll
  return rollToContinueAcrossElbow(srcDir, srcRoll, srcDir, newDir)
}

/**
 * Nearest typed port — duct run ends, fitting collars, anything whose
 * kind registers `def.ports` — within snap range of `point` on the XZ
 * plane. Y is ignored for the distance check (grid events ride the floor
 * while ports hang at duct height); the snap adopts the port's full 3D
 * position. The full port is returned so the commit knows what it joined
 * (auto-elbow insertion needs the port's direction and owner).
 */
function findNearbyPort(point: [number, number, number]): ScenePort | null {
  return findNearestPortXZ(
    point,
    collectScenePorts({ systems: DUCT_PORT_SYSTEMS }),
    ENDPOINT_SNAP_RADIUS_M,
  )
}

function portPoint(port: ScenePort): [number, number, number] {
  return [port.position[0], port.position[1], port.position[2]]
}

/** Cross-section the tool draws with (and commits onto the node). Oval
 *  never comes from the Q toggle (round ↔ rect) — it enters by joining
 *  an existing oval run / fitting collar and continuing its profile. */
type DraftProfile = {
  shape: 'round' | 'rect' | 'oval'
  diameter: number
  width: number
  height: number
}

/**
 * Profile to inherit when the segment start snaps onto `port` — joining
 * means continuing that thing: a rect trunk end keeps its W×H, a round
 * run / fitting collar keeps its diameter. Equipment and terminal
 * collars are round at the port's advertised size.
 */
function inheritProfile(port: ScenePort): DraftProfile | null {
  const owner = useScene.getState().nodes[port.nodeId]
  if (!owner) return null
  if (owner.type === 'duct-segment' || owner.type === 'duct-fitting') {
    return {
      shape: owner.shape,
      diameter: Math.min(
        48,
        Math.max(2, owner.type === 'duct-segment' ? owner.diameter : port.diameter),
      ),
      width: owner.width,
      height: owner.height,
    }
  }
  if (owner.type === 'hvac-equipment' || owner.type === 'duct-terminal') {
    const defaults = ductSegmentDefinition.defaults() as DraftProfile
    // Adopt the collar's cross-section so the run leaves a rect / oval
    // plenum as rect / oval (rolled to match in `continuityRollFrom`),
    // falling back to round at the advertised diameter.
    if (port.shape && port.shape !== 'round') {
      return {
        shape: port.shape,
        diameter: Math.min(48, Math.max(2, port.diameter)),
        width: port.width ?? defaults.width,
        height: port.height ?? defaults.height,
      }
    }
    return {
      shape: 'round',
      diameter: Math.min(48, Math.max(2, port.diameter)),
      width: defaults.width,
      height: defaults.height,
    }
  }
  return null
}

/**
 * Project `raw` onto the nearest of the eight 45° rays emanating from
 * `from` in the XZ plane. Y is preserved from `from`. The projection
 * keeps the cursor's *distance* along the chosen ray so the user feels
 * the segment grow with their mouse motion rather than snap to a fixed
 * length.
 */
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
  // Distance along the chosen ray = projection of raw onto that direction.
  const proj = dx * Math.cos(snapped) + dz * Math.sin(snapped)
  const d = Math.max(0, proj)
  return [from[0] + Math.cos(snapped) * d, from[1], from[2] + Math.sin(snapped) * d]
}

const DuctSegmentTool = () => {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)
  const cursorRef = useRef<Group>(null)
  // Cross-section profile for the next committed segment. Q toggles
  // round/rect, [ / ] steps the round diameter, and snapping the start
  // onto an existing run / fitting INHERITS that node's profile — so
  // continuing a 14×8 trunk keeps drawing 14×8, and branching off a
  // round collar keeps its diameter. Seeded from `toolDefaults`.
  const [profile, setProfile] = useState<DraftProfile>(() => {
    const defaults = ductSegmentDefinition.defaults() as DraftProfile
    const seeded = useEditor.getState().toolDefaults['duct-segment'] as
      | Partial<DraftProfile>
      | undefined
    return {
      shape: seeded?.shape ?? defaults.shape,
      diameter: seeded?.diameter ?? defaults.diameter,
      width: seeded?.width ?? defaults.width,
      height: seeded?.height ?? defaults.height,
    }
  })
  const [draftPoints, setDraftPoints] = useState<Array<[number, number, number]>>([])
  const [cursorPos, setCursorPos] = useState<[number, number, number] | null>(null)
  // Ceiling mode (toggle with C): the first point lands at the level's
  // ceiling height (duct top hugging the ceiling) instead of the floor.
  const [ceilingMode, setCeilingMode] = useState(false)
  // When the cursor is within snap range of an existing duct's endpoint we
  // surface a brighter indicator and commit at the endpoint's exact coords.
  const [snapTarget, setSnapTarget] = useState<[number, number, number] | null>(null)
  // True while Alt is held with a last point on the draft — drives the
  // vertical-cylinder ghost and the cursor HUD label.
  const [altActive, setAltActive] = useState(false)
  // Mirror into refs so emitter callbacks (closing over the first render's
  // setState) read the latest values without re-subscribing.
  const draftRef = useRef(draftPoints)
  draftRef.current = draftPoints
  const cursorPosRef = useRef(cursorPos)
  cursorPosRef.current = cursorPos
  const profileRef = useRef(profile)
  profileRef.current = profile
  const ceilingModeRef = useRef(ceilingMode)
  ceilingModeRef.current = ceilingMode
  // Port the anchored START point snapped onto (null = free placement).
  // Read at commit so a turn off an existing run mints an elbow there.
  const startPortRef = useRef<ScenePort | null>(null)
  // Centerline hit the anchored START point snapped onto (null = none).
  // Read at commit so a branch off a trunk's side mints a tee there.
  const startBodyRef = useRef<RunBodyHit | null>(null)
  // Anchor captured when Alt is pressed: screen Y at that moment and the
  // base elevation (= last point's Y). Cleared on Alt release.
  const altAnchorRef = useRef<{ clientY: number; baseY: number } | null>(null)
  // Latest mouse clientY from grid:move; used so the Alt anchor knows where
  // the cursor was at key-press time.
  const lastClientYRef = useRef<number | null>(null)

  useEffect(() => {
    if (!activeLevelId) return

    /**
     * Auto-elbow gate: only joints onto another RUN's open end get a
     * fitting minted. Ports on fittings / equipment / terminals are
     * already proper connections — a duct mates straight onto those.
     *
     * The elbow's junction sits ON the drawn corner, so the existing run
     * must trim back one leg to make room (`trim` update). Plans that
     * would trim the run to (or past) nothing are dropped — that corner
     * stays a plain butt joint. Guards against the snapped node having
     * been deleted between clicks.
     */
    const elbowPlanFor = (port: ScenePort | null, awayDir: [number, number, number]) => {
      if (!port) return null
      const owner = useScene.getState().nodes[port.nodeId]
      if (owner?.type !== 'duct-segment') return null
      const plan = planElbowAtPort(port, awayDir, profileRef.current)
      if (!plan) return null

      // Trim the run's snapped endpoint back to the elbow's inlet collar.
      const path = owner.path.map((p) => [...p] as [number, number, number])
      const index = port.id === 'start' ? 0 : path.length - 1
      const neighbor = path[index === 0 ? 1 : index - 1]!
      const remaining = Math.hypot(
        plan.trimmedPortPoint[0] - neighbor[0],
        plan.trimmedPortPoint[1] - neighbor[1],
        plan.trimmedPortPoint[2] - neighbor[2],
      )
      // The trim must leave a real piece of the existing run AND not flip
      // it (trimmed point past the neighbor) — otherwise skip the fitting.
      const original = path[index]!
      const originalLen = Math.hypot(
        original[0] - neighbor[0],
        original[1] - neighbor[1],
        original[2] - neighbor[2],
      )
      if (remaining < 0.08 || remaining >= originalLen) return null
      path[index] = plan.trimmedPortPoint
      return { ...plan, trim: { id: port.nodeId, data: { path } as Partial<AnyNode> } }
    }

    /**
     * Realign gate: the snapped port belongs to an existing ELBOW's open
     * collar — re-aim that elbow (junction + mated collar fixed, free
     * collar swings to the drawn direction). Null when the owner isn't
     * an elbow or the required turn leaves the 15–90° range.
     */
    const realignPlanFor = (port: ScenePort | null, awayDir: [number, number, number]) => {
      if (!port) return null
      const owner = useScene.getState().nodes[port.nodeId]
      if (owner?.type !== 'duct-fitting') return null
      return planElbowRealign(owner, port.id, awayDir)
    }

    // One segment per gesture: first click anchors the start, second
    // click commits a two-point duct immediately. No selection switch —
    // the tool stays armed so the next click starts the next segment
    // (port snap joins it onto the end just committed).
    //
    // When an end of the segment snapped onto another run's open port at
    // an angle, an elbow fitting is minted at that joint and the duct is
    // pulled back to the elbow's outlet collar — corners get real
    // fittings instead of butt joints.
    const commitSegment = (
      start: [number, number, number],
      end: [number, number, number],
      endPort: ScenePort | null = null,
      endBody: RunBodyHit | null = null,
    ) => {
      const length = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2])
      if (length < 1e-4) return
      const dir: [number, number, number] = [
        (end[0] - start[0]) / length,
        (end[1] - start[1]) / length,
        (end[2] - start[2]) / length,
      ]

      const startPlan = elbowPlanFor(startPortRef.current, dir)
      const endPlan = elbowPlanFor(endPort, [-dir[0], -dir[1], -dir[2]])
      // Existing-fitting joints: re-aim the elbow whose collar was hit so
      // it faces the drawn run instead of leaving a mismatched butt joint.
      const startRealign = startPlan ? null : realignPlanFor(startPortRef.current, dir)
      const endRealign = endPlan ? null : realignPlanFor(endPort, [-dir[0], -dir[1], -dir[2]])
      // Tee tap: the start snapped onto a run's BODY (not an end port) —
      // split the trunk and branch from the tee's collar.
      const trunkBody = startPlan ? null : startBodyRef.current
      const trunkOwner = trunkBody ? useScene.getState().nodes[trunkBody.nodeId] : null
      const teePlan =
        trunkBody && trunkOwner?.type === 'duct-segment'
          ? planTeeAtRunBody(trunkOwner, trunkBody, dir, profileRef.current)
          : null
      // End tee tap: the END landed on a run's BODY — split that trunk and
      // the new duct ends at the tee's branch collar. The branch leaves
      // toward the drawn run (back along -dir, since dir points start→end).
      const endTrunkBody = endPlan || endRealign ? null : endBody
      const endTrunkOwner = endTrunkBody ? useScene.getState().nodes[endTrunkBody.nodeId] : null
      const endTeePlan =
        endTrunkBody && endTrunkOwner?.type === 'duct-segment'
          ? planTeeAtRunBody(
              endTrunkOwner,
              endTrunkBody,
              [-dir[0], -dir[1], -dir[2]],
              profileRef.current,
            )
          : null
      let ductStart =
        startPlan?.collarPoint ?? teePlan?.branchCollar ?? startRealign?.collarPoint ?? start
      let ductEnd =
        endPlan?.collarPoint ?? endTeePlan?.branchCollar ?? endRealign?.collarPoint ?? end
      // The collar pull-back must leave a real piece of duct between the
      // fittings; if not, fall back to the plain joint.
      const remaining = Math.hypot(
        ductEnd[0] - ductStart[0],
        ductEnd[1] - ductStart[1],
        ductEnd[2] - ductStart[2],
      )
      let plans = [startPlan, endPlan].filter((p) => p !== null)
      let tee = teePlan
      // Both ends tapping the SAME trunk would split one polyline twice in
      // a single change (conflicting updates + double tail) — drop the end
      // tee in that rare case and let the end butt-join instead.
      let endTee = endTeePlan && endTrunkBody?.nodeId === trunkBody?.nodeId ? null : endTeePlan
      if (!endTee && endTeePlan) ductEnd = endRealign?.collarPoint ?? end
      let realigns = [startRealign, endRealign].filter((p) => p !== null)

      // Cross tap: the drawn run passes straight THROUGH a trunk's body
      // (interior crossing, not an end touch). Split that trunk and the
      // drawn duct into two halves meeting the cross's opposed branch
      // collars. Skip a run already tapped by a start / end tee so one
      // polyline isn't split twice in a single change.
      const crossHit = findRunBodyCrossingXZ(start, end, BODY_SNAP_RADIUS_M)
      const crossOwner = crossHit ? useScene.getState().nodes[crossHit.nodeId] : null
      const crossTappedElsewhere =
        crossHit?.nodeId === trunkBody?.nodeId || crossHit?.nodeId === endTrunkBody?.nodeId
      let cross =
        crossHit && !crossTappedElsewhere && crossOwner?.type === 'duct-segment'
          ? planCrossAtRunBody(crossOwner, crossHit, dir, profileRef.current)
          : null

      if (remaining <= 0.08) {
        plans = []
        tee = null
        endTee = null
        realigns = []
        cross = null
        ductStart = start
        ductEnd = end
      }

      // Rect / oval continuity: roll the new run's cross-section so its
      // profile stays continuous with whatever either end joined — run
      // end or fitting collar, turn or straight continuation (see
      // `continuityRollFrom`). The start joint wins if both ends join.
      let roll = 0
      if (profileRef.current.shape !== 'round') {
        const newDir = new Vector3(...dir)
        roll =
          continuityRollFrom(startPortRef.current, newDir) ??
          continuityRollFrom(endPort, newDir) ??
          0
      }

      const defaults = ductSegmentDefinition.defaults()
      const toolDefaults = useEditor.getState().toolDefaults['duct-segment'] ?? {}
      const makeDuct = (from: [number, number, number], to: [number, number, number]) =>
        DuctSegmentNode.parse({
          ...defaults,
          ...toolDefaults,
          name: profileRef.current.shape === 'rect' ? 'Trunk' : 'Duct run',
          path: [from, to],
          shape: profileRef.current.shape,
          diameter: profileRef.current.diameter,
          width: profileRef.current.width,
          height: profileRef.current.height,
          roll,
        })
      // A cross splits the drawn run into two halves that meet its opposed
      // branch collars; otherwise it's one duct end-to-end. Degenerate
      // halves (the crossing too near an end) are dropped.
      const ducts = cross
        ? [
            dist2(ductStart, cross.branchCollarNear) > 0.08 * 0.08
              ? makeDuct(ductStart, cross.branchCollarNear)
              : null,
            dist2(cross.branchCollarFar, ductEnd) > 0.08 * 0.08
              ? makeDuct(cross.branchCollarFar, ductEnd)
              : null,
          ].filter((d) => d !== null)
        : [makeDuct(ductStart, ductEnd)]
      // One atomic change: trim / split the joined runs, create the
      // fittings + the new duct. Single undo step.
      useScene.getState().applyNodeChanges({
        create: [
          ...plans.map((plan) => ({ node: plan.fitting, parentId: activeLevelId })),
          ...(tee
            ? [
                { node: tee.fitting, parentId: activeLevelId },
                { node: tee.trunkTail, parentId: activeLevelId },
              ]
            : []),
          ...(endTee
            ? [
                { node: endTee.fitting, parentId: activeLevelId },
                { node: endTee.trunkTail, parentId: activeLevelId },
              ]
            : []),
          ...(cross
            ? [
                { node: cross.fitting, parentId: activeLevelId },
                { node: cross.trunkTail, parentId: activeLevelId },
              ]
            : []),
          ...ducts.map((node) => ({ node, parentId: activeLevelId })),
        ],
        update: [
          ...plans.map((plan) => plan.trim),
          ...(tee ? [tee.trunkUpdate as { id: AnyNode['id']; data: Partial<AnyNode> }] : []),
          ...(endTee ? [endTee.trunkUpdate as { id: AnyNode['id']; data: Partial<AnyNode> }] : []),
          ...(cross ? [cross.trunkUpdate as { id: AnyNode['id']; data: Partial<AnyNode> }] : []),
          ...realigns.map((plan) => plan.update as { id: AnyNode['id']; data: Partial<AnyNode> }),
        ],
      })
      triggerSFX('sfx:item-place')
      setDraftPoints([])
      setSnapTarget(null)
      startPortRef.current = null
      startBodyRef.current = null
      altAnchorRef.current = null
      setAltActive(false)
    }

    // Base Y for a fresh run's first point: floor (0) by default, or just
    // below the level's ceiling in ceiling mode so the duct's top hugs the
    // ceiling (centerline = ceiling height − radius).
    const resolveBaseY = (): number => {
      if (!ceilingModeRef.current) return 0
      const ceiling = getLevelHeight(
        activeLevelId,
        useScene.getState().nodes,
        (wallId) => sceneRegistry.nodes.get(wallId)?.position.y,
      )
      const p = profileRef.current
      const verticalIn = p.shape === 'round' ? p.diameter : p.height
      return Math.max(0, ceiling - (verticalIn * 0.0254) / 2)
    }

    const resolveSnappedPoint = (
      event: GridEvent,
    ): {
      point: [number, number, number]
      snapped: [number, number, number] | null
      port: ScenePort | null
      body: RunBodyHit | null
    } => {
      const last = draftRef.current.at(-1)
      // First point of the run: grid-snapped placement at the base Y (floor,
      // or ceiling height in ceiling mode). Endpoint snap can still join an
      // existing run.
      if (!last) {
        const baseY = resolveBaseY()
        const raw: [number, number, number] = [
          event.localPosition[0],
          baseY,
          event.localPosition[2],
        ]
        const step = useEditor.getState().gridSnapStep
        const shift = event.nativeEvent?.shiftKey === true
        if (event.nativeEvent?.altKey !== true) {
          const target = findNearbyPort(raw)
          if (target)
            return {
              point: portPoint(target),
              snapped: portPoint(target),
              port: target,
              body: null,
            }
          // No open end nearby — try the side of a run (tee tap). Probe
          // with a grid-snapped cursor so the tap steps along the duct
          // like every other placement; Shift frees it to ride smoothly.
          const probe: [number, number, number] = shift
            ? raw
            : [snap(raw[0], step), baseY, snap(raw[2], step)]
          const body = findNearestRunBodyXZ(probe, BODY_SNAP_RADIUS_M)
          if (body) return { point: body.point, snapped: body.point, port: null, body }
        }
        return {
          point: [snap(raw[0], step), baseY, snap(raw[2], step)],
          snapped: null,
          port: null,
          body: null,
        }
      }
      // Subsequent points: angle-locked to 45° from `last` (Shift releases).
      // Y stays at `last[1]` — depth changes come from Shift+click risers.
      const rawXZ: [number, number, number] = [
        event.localPosition[0],
        last[1],
        event.localPosition[2],
      ]
      const shift = event.nativeEvent?.shiftKey === true
      const angled = shift ? rawXZ : projectToAngleLock(last, rawXZ)
      const step = useEditor.getState().gridSnapStep
      // Port snap (Alt bypass) — checked against the RAW cursor, not the
      // angle-locked projection, so a port slightly off the 45° ray can
      // still capture the cursor. Joining beats the lock.
      if (event.nativeEvent?.altKey !== true && !shift) {
        const target = findNearbyPort(rawXZ)
        if (target)
          return { point: portPoint(target), snapped: portPoint(target), port: target, body: null }
        // No open end nearby — landing on the side of a run taps a tee
        // there (mirror of the first-point tee tap). Probe with a
        // grid-snapped cursor so the tap steps along the duct instead of
        // sliding smoothly (Shift above frees it). Checked against the
        // cursor, not the 45° projection, so a slightly-off trunk captures.
        const probe: [number, number, number] = [
          snap(rawXZ[0], step),
          rawXZ[1],
          snap(rawXZ[2], step),
        ]
        const body = findNearestRunBodyXZ(probe, BODY_SNAP_RADIUS_M)
        if (body) return { point: body.point, snapped: body.point, port: null, body }
      }
      return {
        point: [snap(angled[0], step), angled[1], snap(angled[2], step)],
        snapped: null,
        port: null,
        body: null,
      }
    }

    /**
     * Compute the Alt-mode cursor position: XZ locked to the last point,
     * Y driven by how far the mouse has moved vertically on screen since
     * Alt was pressed. Returns null if there's no anchor (Alt not active).
     */
    const resolveAltVerticalPoint = (clientY: number): [number, number, number] | null => {
      const anchor = altAnchorRef.current
      const last = draftRef.current.at(-1)
      if (!anchor || !last) return null
      const step = useEditor.getState().gridSnapStep
      // Screen +Y points down, so subtract to map "drag up = raise Y".
      const dy = (anchor.clientY - clientY) / ALT_PIXELS_PER_METER
      const snappedDy = snap(dy, step)
      const y = Math.min(ALT_Y_MAX_M, Math.max(ALT_Y_MIN_M, anchor.baseY + snappedDy))
      return [last[0], y, last[2]]
    }

    // Resolve the cursor point (port / body / grid / angle snap) and then
    // layer Figma-style alignment on top so a run lines up with other runs,
    // fittings, and items as it's drawn. Snap is applied for a free point
    // (first vertex, or Shift free-angle); an angle-locked continuation shows
    // the guide passively without leaving its 45° ray. A port / body snap or
    // Alt bypasses alignment entirely.
    const resolveAlignedPoint = (event: GridEvent) => {
      const r = resolveSnappedPoint(event)
      const hasStart = draftRef.current.length > 0
      const shift = event.nativeEvent?.shiftKey === true
      const alt = event.nativeEvent?.altKey === true
      const point = alignDrawPoint(r.point, {
        applySnap: !hasStart || shift,
        bypass: alt || r.snapped !== null,
      })
      return { ...r, point }
    }

    const onMove = (event: GridEvent) => {
      const clientY = (event.nativeEvent as { clientY?: number } | undefined)?.clientY
      if (typeof clientY === 'number') lastClientYRef.current = clientY
      // Alt vertical mode wins over the XZ logic.
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
      // Vertical mode with a start anchored: the click commits the riser
      // segment right there. Never falls through to the XZ logic — a
      // no-op Alt click (height unchanged) must not place anything.
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
      const { point, port, body } = resolveAlignedPoint(event)
      if (!start) {
        // First click: anchor the segment start, remembering the port or
        // run body it snapped to so the commit can mint an elbow / tee.
        // Joining a port INHERITS the source's cross-section — continuing
        // a rect trunk keeps drawing rect at its W×H, a round collar its
        // diameter. Body taps (tee branches) keep the tool's own profile.
        triggerSFX('sfx:grid-snap')
        startPortRef.current = port
        startBodyRef.current = port ? null : body
        if (port) {
          const inherited = inheritProfile(port)
          if (inherited) setProfile(inherited)
        }
        setDraftPoints([point])
        return
      }
      // Second click: commit the segment and re-arm. A body hit on the end
      // (no end port) taps a tee into that run's side.
      commitSegment(start, point, port, port ? null : body)
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

    const stepDiameter = (step: 1 | -1) => {
      const sizes = DUCT_DIAMETERS_IN
      const current = profileRef.current.diameter
      // Nearest catalogue index, then step — handles seeded off-catalogue
      // values (e.g. a preset's 7.5") gracefully.
      let nearest = 0
      for (let i = 1; i < sizes.length; i++) {
        if (Math.abs(sizes[i]! - current) < Math.abs(sizes[nearest]! - current)) nearest = i
      }
      const next = sizes[Math.min(sizes.length - 1, Math.max(0, nearest + step))]!
      if (next === current) return
      setProfile((p) => ({ ...p, diameter: next }))
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
        setProfile((p) => ({ ...p, shape: p.shape === 'round' ? 'rect' : 'round' }))
        triggerSFX('sfx:grid-snap')
      } else if (e.key === 'c' || e.key === 'C') {
        // Toggle ceiling mode. Only the first point reads the base Y, so
        // toggling mid-run is a no-op until the next fresh segment — flip
        // it only while unanchored to keep the behaviour predictable.
        if (draftRef.current.length > 0) return
        e.preventDefault()
        setCeilingMode((m) => !m)
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
      if (draftRef.current.length === 0) return
      markToolCancelConsumed()
      setDraftPoints([])
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

  const previewSegments: Array<{ a: [number, number, number]; b: [number, number, number] }> = []
  for (let i = 0; i < draftPoints.length - 1; i++) {
    previewSegments.push({ a: draftPoints[i]!, b: draftPoints[i + 1]! })
  }
  const last = draftPoints.at(-1)
  if (last && cursorPos) {
    previewSegments.push({ a: last, b: cursorPos })
  }

  // Wall-style dimension pill above the cursor: absolute world coords before
  // the first point, signed per-axis deltas from the last placed point while
  // a segment is in flight. The actively-driven axis is emphasised — Y in
  // Alt-vertical mode, otherwise whichever horizontal axis dominates. A
  // trailing Ø readout shows the diameter the next click commits ([ / ]).
  const pillParts = cursorPos
    ? [
        ...(['x', 'y', 'z'] as const).map((axis, i) => ({
          key: axis,
          prefix: axis.toUpperCase(),
          value: last ? cursorPos[i]! - last[i]! : cursorPos[i]!,
          signed: !!last,
        })),
        ...(profile.shape === 'round'
          ? [{ key: 'diameter', prefix: 'Ø', value: profile.diameter * 0.0254, signed: false }]
          : [
              { key: 'trunk-w', prefix: 'W', value: profile.width * 0.0254, signed: false },
              { key: 'trunk-h', prefix: 'H', value: profile.height * 0.0254, signed: false },
            ]),
      ]
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
          badge walls and items show while drawing (icon resolved from the
          active `duct-segment` structure-tools entry). The dimension pill
          rides just above the cursor. */}
      {cursorPos && (
        <>
          <CursorSphere position={cursorPos} ref={cursorRef} />
          {pillParts && (
            <group position={cursorPos}>
              <Html
                center
                position={[0, 0.35, 0]}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
                zIndexRange={[100, 0]}
              >
                <div className="flex flex-col items-center gap-1">
                  <DimensionPill parts={pillParts} primary={pillPrimary} unit={unit} />
                  {ceilingMode && !last && (
                    <div className="whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-3 py-0.5 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
                      Ceiling · C to toggle
                    </div>
                  )}
                </div>
              </Html>
            </group>
          )}
        </>
      )}
      {/* Endpoint-snap halo — brighter ring around the target endpoint
          while the cursor is within snap range, so the user sees that the
          next click will join an existing duct rather than freeform-place. */}
      {snapTarget && (
        <mesh layers={EDITOR_LAYER} position={snapTarget}>
          <sphereGeometry args={[0.12, 24, 16]} />
          <meshBasicMaterial color="#818cf8" depthTest={false} opacity={0.35} transparent />
        </mesh>
      )}
      {/* Committed point pips */}
      {draftPoints.map((p, i) => (
        <mesh key={`pt-${i}`} layers={EDITOR_LAYER} position={p}>
          <sphereGeometry args={[0.07, 16, 12]} />
          <meshBasicMaterial color="#818cf8" depthTest={false} />
        </mesh>
      ))}
      {/* Preview sections */}
      {previewSegments.map((seg, i) => (
        <PreviewSegment
          a={seg.a}
          b={seg.b}
          key={`seg-${i}`}
          profile={profile}
          startPort={startPortRef.current}
        />
      ))}
    </LevelOffsetGroup>
  )
}

function PreviewSegment({
  a,
  b,
  profile,
  startPort,
}: {
  a: [number, number, number]
  b: [number, number, number]
  profile: DraftProfile
  startPort: ScenePort | null
}) {
  const start = new Vector3(...a)
  const end = new Vector3(...b)
  const dir = new Vector3().subVectors(end, start)
  const length = dir.length()
  if (length < 1e-4) return null
  dir.normalize()
  const mid = new Vector3().addVectors(start, end).multiplyScalar(0.5)

  // Rect AND oval ghost as a box — close enough for a translucent guide.
  if (profile.shape !== 'round') {
    const w = profile.width * 0.0254
    const h = profile.height * 0.0254
    return (
      <mesh
        layers={EDITOR_LAYER}
        position={mid.toArray()}
        ref={(m) => {
          if (!m) return
          // Same basis AND roll as the commit will use, so the ghost
          // shows the orientation that actually lands.
          const roll = continuityRollFrom(startPort, dir) ?? 0
          const { width: x, height: z } = rectSectionAxes(dir, roll)
          m.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, dir, z))
        }}
      >
        <boxGeometry args={[w, length, h]} />
        <meshBasicMaterial
          color="#818cf8"
          depthTest={false}
          opacity={PREVIEW_OPACITY}
          transparent
        />
      </mesh>
    )
  }

  const radius = (profile.diameter * 0.0254) / 2
  return (
    <mesh
      layers={EDITOR_LAYER}
      position={mid.toArray()}
      ref={(m) => {
        if (!m) return
        m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir)
      }}
    >
      <cylinderGeometry args={[radius, radius, length, 24, 1, false]} />
      <meshBasicMaterial color="#818cf8" depthTest={false} opacity={PREVIEW_OPACITY} transparent />
    </mesh>
  )
}

export default DuctSegmentTool
