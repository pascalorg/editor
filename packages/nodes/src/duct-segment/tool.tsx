'use client'

import {
  type AnyNode,
  type CeilingNode,
  type DuctFittingNode,
  DuctSegmentNode,
  emitter,
  type GridEvent,
  getCeilingAt,
  getCeilingHeightAt,
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
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type BufferGeometry,
  DoubleSide,
  type Group,
  Matrix4,
  Path,
  Shape,
  ShapeGeometry,
  Vector3,
} from 'three'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import {
  planCrossAtRunBody,
  planElbowAtPort,
  planElbowRealign,
  planTeeAtRunBody,
} from '../shared/auto-fitting'
import { alignDrawPoint, clearDrawAlignment } from '../shared/draw-alignment'
import { LevelOffsetGroup } from '../shared/level-offset-group'
import { FittingGhost } from '../shared/mep-ghost'
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
import { ductPortDiameterIn, rectSectionAxes, rollToContinueAcrossElbow } from './geometry'

/**
 * Continuous placement tool for duct segments.
 *
 * Mouse-driven model:
 *   - **First click** anchors the segment start (port snap joins onto an
 *     existing run / fitting collar).
 *   - **Second click** commits a two-point duct immediately and keeps the
 *     segment end anchored, so the next click continues the run like wall
 *     drafting. No polyline accumulation, no finish gesture.
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
 *   - The in-flight end follows the active snapping mode: `angles` locks
 *     it to the nearest 45° step in XZ from the start (Y stays at the
 *     start's height); `grid`/`lines`/`off` leave it free. Shift cycles
 *     the snapping mode.
 *   - Hold **Alt** → vertical mode. Cursor XZ locks to the start;
 *     vertical mouse motion drives Y. Click commits the riser segment.
 *   - **[ / ]** step the duct diameter through nominal US sizes; the
 *     ghost preview and the committed node both use it.
 *   - **C** toggles ceiling-level placement: each point lands just below
 *     the ceiling actually covering it (duct top hugging that ceiling)
 *     instead of the floor, so a run tracks per-room ceiling heights.
 *     Points not under any ceiling fall back to the floor.
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

/** green-500 — the project's bounding-box / placeable accent. The cursor
 *  ring + vertical line recolour to this while the point is snapped onto an
 *  existing run, so the coincidence reads with the familiar snap green. */
const SNAP_CURSOR_COLOR = '#22c55e'

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

function continuityRollForRun(
  startPort: ScenePort | null,
  endPort: ScenePort | null,
  dir: Vector3,
): number {
  return continuityRollFrom(startPort, dir) ?? continuityRollFrom(endPort, dir) ?? 0
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

/** The full set of nodes a drawn segment produces. The drawn `ducts`
 *  (and any trunk `tails` from a tee / cross split) are previewed by the
 *  duct ghost already; `fittings` are the auto-inserted elbow / tee /
 *  cross nodes the ghost preview draws so the user sees them before the
 *  commit. Shared by `commitSegment` and the live preview so what you see
 *  is exactly what lands. */
type DuctDrawPlan = {
  fittings: DuctFittingNode[]
  ducts: DuctSegmentNode[]
  tails: DuctSegmentNode[]
  updates: { id: AnyNode['id']; data: Partial<AnyNode> }[]
}

const elbowPlanFor = (
  port: ScenePort | null,
  awayDir: [number, number, number],
  profile: DraftProfile,
) => {
  if (!port) return null
  const owner = useScene.getState().nodes[port.nodeId]
  if (owner?.type !== 'duct-segment') return null
  const plan = planElbowAtPort(port, awayDir, profile)
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
  // The trim must leave a real piece of the existing run AND not flip it.
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

const realignPlanFor = (port: ScenePort | null, awayDir: [number, number, number]) => {
  if (!port) return null
  const owner = useScene.getState().nodes[port.nodeId]
  if (owner?.type !== 'duct-fitting') return null
  return planElbowRealign(owner, port.id, awayDir)
}

/**
 * Pure planner for a drawn duct segment: given its endpoints and what
 * each end snapped onto (an open port, or a run body for a tee / cross
 * tap), decide every node the commit creates / updates — auto-inserted
 * elbows / tees / crosses, the drawn run (split in two when it crosses a
 * trunk), trunk tails, and trim / realign updates. Reads the live scene
 * graph but mutates nothing, so the live preview can call it each frame
 * to ghost the fittings before the commit applies the identical plan.
 */
function planDuctDraw(
  start: [number, number, number],
  end: [number, number, number],
  startPort: ScenePort | null,
  startBody: RunBodyHit | null,
  endPort: ScenePort | null,
  endBody: RunBodyHit | null,
  profile: DraftProfile,
): DuctDrawPlan | null {
  const length = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2])
  if (length < 1e-4) return null
  const dir: [number, number, number] = [
    (end[0] - start[0]) / length,
    (end[1] - start[1]) / length,
    (end[2] - start[2]) / length,
  ]

  const startPlan = elbowPlanFor(startPort, dir, profile)
  const endPlan = elbowPlanFor(endPort, [-dir[0], -dir[1], -dir[2]], profile)
  const startRealign = startPlan ? null : realignPlanFor(startPort, dir)
  const endRealign = endPlan ? null : realignPlanFor(endPort, [-dir[0], -dir[1], -dir[2]])
  const trunkBody = startPlan ? null : startBody
  const trunkOwner = trunkBody ? useScene.getState().nodes[trunkBody.nodeId] : null
  const teePlan =
    trunkBody && trunkOwner?.type === 'duct-segment'
      ? planTeeAtRunBody(trunkOwner, trunkBody, dir, profile)
      : null
  const endTrunkBody = endPlan || endRealign ? null : endBody
  const endTrunkOwner = endTrunkBody ? useScene.getState().nodes[endTrunkBody.nodeId] : null
  const endTeePlan =
    endTrunkBody && endTrunkOwner?.type === 'duct-segment'
      ? planTeeAtRunBody(endTrunkOwner, endTrunkBody, [-dir[0], -dir[1], -dir[2]], profile)
      : null
  let ductStart =
    startPlan?.collarPoint ?? teePlan?.branchCollar ?? startRealign?.collarPoint ?? start
  let ductEnd = endPlan?.collarPoint ?? endTeePlan?.branchCollar ?? endRealign?.collarPoint ?? end
  const remaining = Math.hypot(
    ductEnd[0] - ductStart[0],
    ductEnd[1] - ductStart[1],
    ductEnd[2] - ductStart[2],
  )
  let plans = [startPlan, endPlan].filter((p) => p !== null)
  let tee = teePlan
  let endTee = endTeePlan && endTrunkBody?.nodeId === trunkBody?.nodeId ? null : endTeePlan
  if (!endTee && endTeePlan) ductEnd = endRealign?.collarPoint ?? end
  let realigns = [startRealign, endRealign].filter((p) => p !== null)

  const crossHit = findRunBodyCrossingXZ(start, end, BODY_SNAP_RADIUS_M)
  const crossOwner = crossHit ? useScene.getState().nodes[crossHit.nodeId] : null
  const crossTappedElsewhere =
    crossHit?.nodeId === trunkBody?.nodeId || crossHit?.nodeId === endTrunkBody?.nodeId
  let cross =
    crossHit && !crossTappedElsewhere && crossOwner?.type === 'duct-segment'
      ? planCrossAtRunBody(crossOwner, crossHit, dir, profile)
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
  // profile stays continuous with whatever either end joined.
  let roll = 0
  if (profile.shape !== 'round') {
    const newDir = new Vector3(...dir)
    roll = continuityRollForRun(startPort, endPort, newDir)
  }

  const defaults = ductSegmentDefinition.defaults()
  const toolDefaults = useEditor.getState().toolDefaults['duct-segment'] ?? {}
  const makeDuct = (from: [number, number, number], to: [number, number, number]) =>
    DuctSegmentNode.parse({
      ...defaults,
      ...toolDefaults,
      name: profile.shape === 'rect' ? 'Trunk' : 'Duct run',
      path: [from, to],
      shape: profile.shape,
      diameter: profile.diameter,
      width: profile.width,
      height: profile.height,
      roll,
    })
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

  const fittings: DuctFittingNode[] = [
    ...plans.map((p) => p.fitting),
    ...(tee ? [tee.fitting] : []),
    ...(endTee ? [endTee.fitting] : []),
    ...(cross ? [cross.fitting] : []),
  ]
  const tails: DuctSegmentNode[] = [
    ...(tee ? [tee.trunkTail] : []),
    ...(endTee ? [endTee.trunkTail] : []),
    ...(cross ? [cross.trunkTail] : []),
  ]
  const updates: { id: AnyNode['id']; data: Partial<AnyNode> }[] = [
    ...plans.map((p) => p.trim),
    ...(tee ? [tee.trunkUpdate as { id: AnyNode['id']; data: Partial<AnyNode> }] : []),
    ...(endTee ? [endTee.trunkUpdate as { id: AnyNode['id']; data: Partial<AnyNode> }] : []),
    ...(cross ? [cross.trunkUpdate as { id: AnyNode['id']; data: Partial<AnyNode> }] : []),
    ...realigns.map((p) => p.update as { id: AnyNode['id']; data: Partial<AnyNode> }),
  ]

  return { fittings, ducts, tails, updates }
}

function ductEndPort(duct: DuctSegmentNode, id: 'start' | 'end'): ScenePort | null {
  if (duct.path.length < 2) return null
  const index = id === 'start' ? 0 : duct.path.length - 1
  const neighborIndex = id === 'start' ? 1 : duct.path.length - 2
  const position = duct.path[index]!
  const neighbor = duct.path[neighborIndex]!
  const dx = position[0] - neighbor[0]
  const dy = position[1] - neighbor[1]
  const dz = position[2] - neighbor[2]
  const len = Math.hypot(dx, dy, dz)
  const direction: [number, number, number] =
    len < 1e-9 ? [1, 0, 0] : [dx / len, dy / len, dz / len]
  return {
    id,
    nodeId: duct.id,
    position,
    direction,
    diameter: ductPortDiameterIn(duct),
    system: duct.system,
  }
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
  // The shared coordinate when the cursor is within snap range of an existing
  // duct (null = free placement). Drives the green cursor highlight so the
  // user sees the next click will join an existing run, not freeform-place.
  const [snapTarget, setSnapTarget] = useState<[number, number, number] | null>(null)
  // In ceiling mode, the ceiling the cursor is currently under — rendered as
  // a translucent overlay so the duct reads as hung against a real surface
  // rather than a dot floating in space. Null when off-ceiling.
  const [hoverCeiling, setHoverCeiling] = useState<CeilingNode | null>(null)
  // True while Alt is held with a last point on the draft — drives the
  // vertical-cylinder ghost and the cursor HUD label.
  const [altActive, setAltActive] = useState(false)
  // What the in-flight cursor end currently snaps onto (port end, or a
  // run body for a tee / cross tap). Drives the auto-fitting GHOST so the
  // user sees the elbow / tee / cross the next click will mint.
  const [endSnap, setEndSnap] = useState<{ port: ScenePort | null; body: RunBodyHit | null }>({
    port: null,
    body: null,
  })
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

    // Continuous chain: first click anchors the start, each following
    // click commits one two-point duct and uses that duct's far end as
    // the next anchor. No selection switch or finish gesture.
    //
    // All the auto-fitting decisions (elbow / tee / cross) live in the
    // shared `planDuctDraw` so the live ghost previews exactly what this
    // commit applies.
    const commitSegment = (
      start: [number, number, number],
      end: [number, number, number],
      endPort: ScenePort | null = null,
      endBody: RunBodyHit | null = null,
    ) => {
      const plan = planDuctDraw(
        start,
        end,
        startPortRef.current,
        startBodyRef.current,
        endPort,
        endBody,
        profileRef.current,
      )
      if (!plan) return
      // One atomic change: trim / split the joined runs, create the
      // fittings + the new duct. Single undo step.
      useScene.getState().applyNodeChanges({
        create: [
          ...plan.fittings.map((node) => ({ node, parentId: activeLevelId })),
          ...plan.tails.map((node) => ({ node, parentId: activeLevelId })),
          ...plan.ducts.map((node) => ({ node, parentId: activeLevelId })),
        ],
        update: plan.updates,
      })
      const nextDuct = plan.ducts.at(-1)
      const nextStart = nextDuct ? nextDuct.path[nextDuct.path.length - 1]! : end
      const nextPort = nextDuct ? ductEndPort(nextDuct, 'end') : endPort
      triggerSFX('sfx:item-place')
      setDraftPoints([nextStart])
      setSnapTarget(null)
      setEndSnap({ port: null, body: null })
      startPortRef.current = nextPort
      startBodyRef.current = nextPort ? null : endBody
      altAnchorRef.current = null
      setAltActive(false)
    }

    // Y for a point at level-local `[x, z]`. Floor (0) when ceiling mode is
    // off. In ceiling mode, query the ceiling actually covering that point
    // and hang the duct just below it (centerline = ceiling underside −
    // half the duct's vertical dimension) so its top hugs the ceiling. Each
    // point follows its own ceiling, so a run stepping into a room with a
    // different ceiling height tracks that change. Points not under any
    // ceiling fall back to the floor.
    const resolveCeilingY = (x: number, z: number): number => {
      if (!ceilingModeRef.current) return 0
      const ceiling = getCeilingHeightAt(activeLevelId, useScene.getState().nodes, x, z)
      if (ceiling === null) return 0
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
      // Port / body mating is the run's primary affordance; it stays on in
      // every snapping mode except `off` (the raw-cursor bypass).
      const snapEnabled = isGridSnapActive() || isMagneticSnapActive() || isAngleSnapActive()
      const last = draftRef.current.at(-1)
      // First point of the run: grid-snapped placement. Y follows the
      // ceiling under the cursor in ceiling mode (floor otherwise).
      // Endpoint snap can still join an existing run.
      if (!last) {
        const baseY = resolveCeilingY(event.localPosition[0], event.localPosition[2])
        const raw: [number, number, number] = [
          event.localPosition[0],
          baseY,
          event.localPosition[2],
        ]
        const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
        if (event.nativeEvent?.altKey !== true && snapEnabled) {
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
          // like every other placement; `off` mode (step 0) rides smoothly.
          const probe: [number, number, number] = [snap(raw[0], step), baseY, snap(raw[2], step)]
          const body = findNearestRunBodyXZ(probe, BODY_SNAP_RADIUS_M)
          if (body) return { point: body.point, snapped: body.point, port: null, body }
        }
        const sx = snap(raw[0], step)
        const sz = snap(raw[2], step)
        return {
          point: [sx, resolveCeilingY(sx, sz), sz],
          snapped: null,
          port: null,
          body: null,
        }
      }
      // Subsequent points: angle-locked to 45° from `last` in `angles` mode.
      // Y inherits `last[1]` for the angle/probe math; the free placement below
      // re-resolves it from the ceiling under the point in ceiling mode, so a run
      // stepping into a room with a different ceiling height tracks that change.
      // Depth changes otherwise come from Alt-vertical risers.
      const rawXZ: [number, number, number] = [
        event.localPosition[0],
        last[1],
        event.localPosition[2],
      ]
      // The 45° lock is now the `angles` snapping mode (Shift cycles to it),
      // not a held key.
      const angled = isAngleSnapActive() ? projectToAngleLock(last, rawXZ) : rawXZ
      const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      // Port snap (Alt bypass) — checked against the RAW cursor, not the
      // angle-locked projection, so a port slightly off the 45° ray can
      // still capture the cursor. Joining beats the lock.
      if (event.nativeEvent?.altKey !== true && snapEnabled) {
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
      const fx = snap(angled[0], step)
      const fz = snap(angled[2], step)
      const fy = ceilingModeRef.current ? resolveCeilingY(fx, fz) : angled[1]
      return {
        point: [fx, fy, fz],
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
      const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      // Screen +Y points down, so subtract to map "drag up = raise Y".
      const dy = (anchor.clientY - clientY) / ALT_PIXELS_PER_METER
      const snappedDy = snap(dy, step)
      const y = Math.min(ALT_Y_MAX_M, Math.max(ALT_Y_MIN_M, anchor.baseY + snappedDy))
      return [last[0], y, last[2]]
    }

    // Resolve the cursor point (port / body / grid / angle snap) and then
    // layer Figma-style alignment on top so a run lines up with other runs,
    // fittings, and items as it's drawn. A free point (first vertex, or no
    // angle lock) snaps; an angle-locked continuation shows the guide passively
    // without leaving its 45° ray. Alignment follows the `lines` mode; a
    // port / body snap or Alt-vertical bypasses it.
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

    // The ceiling the cursor is under (ceiling mode only) — drives the
    // translucent surface overlay so the in-flight point reads as hung
    // against a real ceiling. Cleared when off-ceiling or out of mode.
    const updateHoverCeiling = (x: number, z: number) => {
      if (!ceilingModeRef.current) {
        setHoverCeiling(null)
        return
      }
      setHoverCeiling(getCeilingAt(activeLevelId, useScene.getState().nodes, x, z))
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
          setEndSnap({ port: null, body: null })
          updateHoverCeiling(point[0], point[2])
          return
        }
      }
      const { point, snapped, port, body } = resolveAlignedPoint(event)
      setCursorPos(point)
      setSnapTarget(snapped)
      setEndSnap({ port, body: port ? null : body })
      updateHoverCeiling(point[0], point[2])
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
        // Toggle ceiling mode: points hang from the ceiling above them
        // (duct top hugging the ceiling) instead of sitting on the floor.
        // Only flip while unanchored — already-placed points keep their Y,
        // so a mid-run toggle would split a run across two height regimes.
        if (draftRef.current.length > 0) return
        e.preventDefault()
        setCeilingMode((m) => !m)
        setHoverCeiling(null)
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
      setEndSnap({ port: null, body: null })
      setHoverCeiling(null)
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

  // Ghost the auto-inserted fittings (elbow / tee / cross) the next click
  // will mint, by running the SAME planner the commit uses against the
  // in-flight endpoints. Skipped in Alt-vertical mode (no XZ tap there).
  const ghostFittings =
    last && cursorPos && !altActive
      ? (planDuctDraw(
          last,
          cursorPos,
          startPortRef.current,
          startBodyRef.current,
          endSnap.port,
          endSnap.body,
          profile,
        )?.fittings ?? [])
      : []

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

  // When the in-flight point hangs above the floor (ceiling mode, or an
  // Alt riser), the cursor marker itself rides AT the point (where the
  // mouse is aiming and the next click commits), and a plumb line drops
  // straight down to a faint ground ring on the floor below — so the plan
  // position stays legible from any angle. A floor-level point keeps the
  // standard fixed-height cursor look.
  const cursorElevation = cursorPos ? cursorPos[1] : 0
  const isElevated = cursorElevation > 0.001
  const cursorGround: [number, number, number] | null = cursorPos
    ? [cursorPos[0], 0, cursorPos[2]]
    : null

  return (
    <LevelOffsetGroup>
      {/* Ceiling-mode surface highlight — the ceiling the cursor is under,
          tinted at its own elevation so the duct reads as hung against a
          real surface instead of a point floating in space. */}
      {ceilingMode && hoverCeiling && <CeilingHighlight ceiling={hoverCeiling} />}
      {/* Cursor marker — the same ground ring + vertical line + tool-icon
          badge walls and items show while drawing (icon resolved from the
          active `duct-segment` structure-tools entry). The dimension pill
          rides just above the cursor. */}
      {cursorPos && cursorGround && (
        <>
          {/* In ceiling mode (or any elevated point) the ground ring sits on
              the floor below the cursor and the line rises to the placement
              point, with the bright dot + tool badge at its tip — exactly
              where the next click commits. At floor level it's the standard
              fixed-height cursor. */}
          {isElevated ? (
            <CursorSphere
              color={snapTarget ? SNAP_CURSOR_COLOR : undefined}
              dotAtTip
              height={cursorElevation}
              position={cursorGround}
              ref={cursorRef}
            />
          ) : (
            <CursorSphere
              color={snapTarget ? SNAP_CURSOR_COLOR : undefined}
              position={cursorPos}
              ref={cursorRef}
            />
          )}
          {pillParts && (
            <group position={cursorPos}>
              <Html
                center
                position={[0, 1.45, 0]}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
                zIndexRange={[100, 0]}
              >
                <div className="flex flex-col items-center gap-2">
                  {ceilingMode && !last && (
                    <div className="whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-3 py-0.5 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
                      Ceiling · C to toggle
                    </div>
                  )}
                  <DimensionPill parts={pillParts} primary={pillPrimary} unit={unit} />
                </div>
              </Html>
            </group>
          )}
        </>
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
          endPort={endSnap.port}
          key={`seg-${i}`}
          profile={profile}
          startPort={startPortRef.current}
        />
      ))}
      {/* Auto-fitting ghosts — the elbow / tee / cross the next click mints. */}
      {ghostFittings.map((fitting) => (
        <FittingGhost fitting={fitting} key={fitting.id} />
      ))}
    </LevelOffsetGroup>
  )
}

/**
 * Build a horizontal `ShapeGeometry` for a ceiling polygon (with holes) in
 * level-local XZ, laid flat in the XZ plane. Mirrors the ceiling renderer /
 * move-tool convention (Z negated, then rotated onto the floor plane).
 */
function buildCeilingShape(
  polygon: Array<[number, number]>,
  holes: Array<Array<[number, number]>>,
): BufferGeometry | null {
  if (polygon.length < 3) return null
  const shape = new Shape()
  const first = polygon[0]!
  shape.moveTo(first[0], -first[1])
  for (let i = 1; i < polygon.length; i++) {
    const pt = polygon[i]!
    shape.lineTo(pt[0], -pt[1])
  }
  shape.closePath()
  for (const holePolygon of holes) {
    if (holePolygon.length < 3) continue
    const hole = new Path()
    const hf = holePolygon[0]!
    hole.moveTo(hf[0], -hf[1])
    for (let i = 1; i < holePolygon.length; i++) {
      const pt = holePolygon[i]!
      hole.lineTo(pt[0], -pt[1])
    }
    hole.closePath()
    shape.holes.push(hole)
  }
  const geometry = new ShapeGeometry(shape)
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

/**
 * Translucent overlay of the ceiling the cursor is under, drawn at the
 * ceiling's own height. Gives the in-flight duct point a real surface to
 * read against, so "hung against the ceiling" is visible from any angle
 * instead of being a dot floating in space.
 */
function CeilingHighlight({ ceiling }: { ceiling: CeilingNode }) {
  const geometry = useMemo(
    () => buildCeilingShape(ceiling.polygon, ceiling.holes),
    [ceiling.polygon, ceiling.holes],
  )
  const outline = useMemo(() => {
    if (ceiling.polygon.length < 2) return null
    const pts = ceiling.polygon.map(([x, z]) => new Vector3(x, 0, z))
    const f = ceiling.polygon[0]!
    pts.push(new Vector3(f[0], 0, f[1]))
    return pts
  }, [ceiling.polygon])
  if (!geometry) return null
  const y = ceiling.height ?? 2.5
  return (
    <group position={[0, y, 0]}>
      <mesh geometry={geometry} layers={EDITOR_LAYER} renderOrder={1}>
        <meshBasicMaterial
          color="#818cf8"
          depthWrite={false}
          opacity={0.15}
          side={DoubleSide}
          transparent
        />
      </mesh>
      {outline && (
        <line>
          <bufferGeometry
            ref={(g) => {
              if (g) g.setFromPoints(outline)
            }}
          />
          <lineBasicMaterial color="#818cf8" opacity={0.6} transparent />
        </line>
      )}
    </group>
  )
}

function PreviewSegment({
  a,
  b,
  profile,
  startPort,
  endPort,
}: {
  a: [number, number, number]
  b: [number, number, number]
  profile: DraftProfile
  startPort: ScenePort | null
  endPort: ScenePort | null
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
          const roll = continuityRollForRun(startPort, endPort, dir)
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
