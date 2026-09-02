/**
 * DERIVED RUN ENDPOINTS — the single source of truth for where a
 * `utility-line` actually starts and ends, and how high off the ground it is.
 *
 * THE DEFECT THIS REPLACES. `utility-line.path` used to be the whole story:
 * the draw tool copied the pole's crossarm height and the meter's mount
 * height into the first and last vertices ONCE, at draw time, and nothing
 * updated them afterwards. Two consequences the user hit:
 *
 *  1. Moving the pole or the meter left the run behind. The copy in `path`
 *     was stale the moment either node moved, in 3D and in 2D.
 *  2. A run drawn as `underground` and then flipped to `overhead` — or drawn
 *     while the panel still had the default `underground` routing selected —
 *     kept `y = −0.75` at every vertex. The service drop was therefore
 *     rendered 0.75 m BELOW grade, i.e. "in the floor", as a flat line with
 *     no vertical extent at all. That is the root cause of the reported
 *     "drop electrical is in like the floor and messed up and not 3d".
 *
 * THE RULE NOW. When a line carries `fromRef` / `toRef`, its first / last
 * vertex is DERIVED at read time from the referenced node and the stored
 * vertex is ignored. Only the INTERMEDIATE vertices are stored geometry. Every
 * surface — the 3D renderer, the 2D floor plan, the panel's linear-feet
 * totals and `buildUtilitiesDrawing` — reads the run through this module, so
 * they cannot disagree and no stale copy can survive in `path`.
 *
 * Elevations are resolved against GRADE (`geometry/grade.ts`), never against
 * a building level origin: a stored vertex y is a height above (or a cover
 * below) grade, and the absolute site elevation is `grade + y`.
 */

import { resolveServicePoint } from '../anchor'
import type { Vec3 } from '../geometry/catenary'
import { gradeElevationAt } from '../geometry/grade'
import { isServicePoint, isUtilityPole } from '../kind-guards'
import type { ServicePointNode, UtilityLineNode, UtilityPoleNode } from '../schema'
import { DEFAULT_BURIAL_DEPTH, DEFAULT_POLE_HEIGHT } from '../schema'
import {
  type BuildingFrame,
  type LooseNode,
  type LooseNodes,
  localToSite,
  resolveFrame,
  siteToLocal,
} from '../site-frame'
import { crossarmAxis, crossarmPinOffset, POLE_CROSSARM_DROP } from '../utility-pole/geometry'

export type PlanPoint = [number, number]

/**
 * Minimum height above finished grade for the point of attachment of an
 * overhead service drop, metres. 3.0 m = 10 ft.
 *
 * CITATION: NEC (NFPA 70) 230.24(B)(1) — overhead service conductors must
 * clear 10 ft (3.0 m) at the lowest point of the DRIP LOOP, measured above
 * finished grade, sidewalks, or any platform from which they may be reached,
 * for conductors limited to 150 V to ground. Because the drip loop hangs
 * BELOW the point of attachment, an attachment at exactly 3.0 m is the
 * floor, not a compliant design.
 *
 * MARKED AS A DRAWING DEFAULT, not a compliance check. Nothing here measures
 * the drip loop itself, and 230.24(B) sets higher clearances (12 ft, 15 ft,
 * 18 ft) over residential driveways, roads, and other traffic surfaces that
 * this package does not model. 230.26 additionally sets 3.0 m as the minimum
 * for the point of attachment itself. Use it to keep a drop off the floor,
 * not to certify one.
 */
export const SERVICE_DROP_MIN_HEIGHT = 3.0

/**
 * Attachment height for an overhead run whose end lands on nothing, metres.
 * 5.5 m ≈ 18 ft.
 *
 * UNVERIFIED against a code minimum: NESC (ANSI C2) Rule 232 sets vertical
 * clearance over ground by voltage and by what is under the span. A drawing
 * default only.
 */
export const DEFAULT_OVERHEAD_HEIGHT = 5.5

/**
 * A stored vertex y at or below this is treated as "no elevation data" for an
 * overhead run — the vertex sits at grade or is still carrying a burial
 * depth, and its height must be derived instead of trusted. 50 mm.
 */
export const OVERHEAD_ELEVATION_EPSILON = 0.05

export type EndpointKind = 'pole' | 'service-point' | 'stored'

export type ResolvedEndpoint = {
  /** Absolute SITE metres `[x, y, z]` of the attachment. */
  site: Vec3
  kind: EndpointKind
  /** The node the endpoint was derived from, or null when it came from `path`. */
  nodeId: string | null
}

export type ResolvedLine = {
  /** The run in absolute SITE metres, endpoints derived, elevations resolved. */
  path: Vec3[]
  from: ResolvedEndpoint | null
  to: ResolvedEndpoint | null
  /**
   * Indices of `path` that are DERIVED from a referenced node. These are not
   * editable in place — the 2D vertex handle is withheld for them, because
   * writing one back into `path` would just be overwritten on the next read.
   */
  derivedIndices: number[]
}

/**
 * What endpoint resolution needs from the caller. Deliberately the same shape
 * as `UtilitiesDrawContext`, so a `def.floorplan` call (which is handed
 * `ctx.resolve`, not the scene) and a plain node map both satisfy it.
 *
 * `frame` is the BUILDING frame used to lift a wall-anchored service point
 * out of wall coordinates into site metres. LIMIT: it is the LINE's frame. A
 * scene with two buildings, where the line is parented to one and the meter
 * to the other, would resolve the meter in the wrong building's frame. Every
 * placement path in this package parents all three kinds to the same
 * building, so it does not arise today; it is stated rather than guarded.
 */
export type EndpointContext = {
  resolve: (id: string) => LooseNode | undefined
  frame: BuildingFrame
}

/** True when at least one stored vertex carries a real above-grade height. */
export function hasOverheadElevation(line: UtilityLineNode): boolean {
  return line.path.some((point) => point[1] > OVERHEAD_ELEVATION_EPSILON)
}

/**
 * A pole's `[x, y, z]` in site metres. Scenes saved before the pole carried a
 * height stored a PLAN pair `[x, z]`; the zod preprocess widens it on parse,
 * but a scene loaded straight into the store never parses, so read it here
 * too — otherwise `position[2]` is undefined and NaN reaches three.js.
 */
export const polePosition3 = (pole: UtilityPoleNode): Vec3 => {
  const p = pole.position as unknown as number[]
  return p.length === 2 ? [p[0] ?? 0, 0, p[1] ?? 0] : [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0]
}

/** Plan `[x, z]` of a pole, in site metres. */
export const polePlan = (pole: UtilityPoleNode): PlanPoint => {
  const p = polePosition3(pole)
  return [p[0], p[2]]
}

/**
 * The crossarm attachment point of a pole, in absolute SITE metres.
 *
 * Height is the pole top minus the crossarm drop, measured from the BUTT
 * elevation (`position[1]`, 0 = at grade). The plan spot is the insulator pin
 * on whichever end of the crossarm faces `toward` — a span leaves the arm on
 * the side the run goes, which is what makes the drop read as a drop rather
 * than as a line teleporting out of the pole's centre. With no `toward` the
 * +arm end is used.
 */
export function poleAttachmentPoint(pole: UtilityPoleNode, toward: PlanPoint | null): Vec3 {
  const plan = polePlan(pole)
  const butt = polePosition3(pole)[1]
  const height = Math.max(0, (pole.height || DEFAULT_POLE_HEIGHT) - POLE_CROSSARM_DROP)
  const axis = crossarmAxis(pole.yaw)
  const offset = crossarmPinOffset()
  let side = 1
  if (toward) {
    const dot = (toward[0] - plan[0]) * axis[0] + (toward[1] - plan[1]) * axis[1]
    side = dot >= 0 ? 1 : -1
  }
  return [plan[0] + axis[0] * offset * side, butt + height, plan[1] + axis[1] * offset * side]
}

/**
 * The 3D anchor of a service point, in absolute SITE metres — the wall face
 * at its mount height for a wall-mounted point, its own position otherwise.
 * `anchor.ts` owns the precedence between the two.
 */
export function servicePointAnchor(ctx: EndpointContext, point: ServicePointNode): Vec3 {
  const wall = point.wallId ? ctx.resolve(point.wallId) : undefined
  const nodes: LooseNodes = wall && point.wallId ? { [point.wallId]: wall } : {}
  const resolved = resolveServicePoint(nodes, point, (position) => siteToLocal(ctx.frame, position))
  return localToSite(ctx.frame, resolved.local)
}

/**
 * Attachment height for an OVERHEAD run landing on a service point.
 *
 * The conductors do not terminate on the meter can — they terminate at the
 * weatherhead / service point of attachment above it, and NEC 230.24(B)(1)
 * puts the drip loop's lowest point 3.0 m (10 ft) above grade. So an overhead
 * drop attaches at `max(meter height, grade + 3.0 m)`, in the meter's plan
 * spot. A meter at the usual 1.5 m therefore feeds a drop that lands at
 * 3.0 m and runs down the wall to the can — instead of the cable diving to
 * 1.5 m, or (before this change) to the floor.
 */
export function serviceAttachmentHeight(anchorY: number, grade: number): number {
  return Math.max(anchorY, grade + SERVICE_DROP_MIN_HEIGHT)
}

type Attachment = { plan: PlanPoint; endpoint: ResolvedEndpoint | null }

function planOfNode(ctx: EndpointContext, node: LooseNode | undefined): PlanPoint | null {
  if (isUtilityPole(node)) return polePlan(node)
  if (isServicePoint(node)) {
    const anchor = servicePointAnchor(ctx, node)
    return [anchor[0], anchor[2]]
  }
  return null
}

/**
 * Resolve one end of a run.
 *
 * `toward` steers the pole's crossarm side. It is resolved BEFORE the poles
 * are, from (in order) the neighbouring stored vertex, the other end's node,
 * or the far stored vertex — so a pole-to-pole span still picks sensible
 * sides even though neither end is known yet.
 */
function resolveEnd(
  ctx: EndpointContext,
  ref: string | null,
  toward: PlanPoint | null,
  overhead: boolean,
): Attachment | null {
  if (!ref) return null
  const node = ctx.resolve(ref)
  if (isUtilityPole(node)) {
    const site = poleAttachmentPoint(node, toward)
    return { plan: [site[0], site[2]], endpoint: { site, kind: 'pole', nodeId: ref } }
  }
  if (isServicePoint(node)) {
    const anchor = servicePointAnchor(ctx, node)
    const grade = gradeElevationAt(null, [anchor[0], anchor[2]])
    const site: Vec3 = overhead
      ? [anchor[0], serviceAttachmentHeight(anchor[1], grade), anchor[2]]
      : anchor
    return { plan: [site[0], site[2]], endpoint: { site, kind: 'service-point', nodeId: ref } }
  }
  // A dangling ref (the pole was deleted) falls back to the stored vertex
  // rather than dropping the run.
  return null
}

/** Cumulative plan distance along a polyline, normalised to 0..1. */
function planFractions(plan: readonly PlanPoint[]): number[] {
  const cumulative: number[] = [0]
  for (let i = 1; i < plan.length; i++) {
    const a = plan[i - 1] as PlanPoint
    const b = plan[i] as PlanPoint
    cumulative.push((cumulative[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  const total = cumulative[cumulative.length - 1] as number
  if (!(total > 0)) return cumulative.map((_, i) => (plan.length > 1 ? i / (plan.length - 1) : 0))
  return cumulative.map((d) => d / total)
}

/**
 * The run as it should be drawn and measured: endpoints derived from
 * `fromRef` / `toRef`, elevations resolved against grade.
 *
 * `resolve` is used for the referenced nodes only; nothing else about the
 * scene is read, so this stays a pure function of its arguments.
 */
export function resolveLineEndpointsVia(ctx: EndpointContext, line: UtilityLineNode): ResolvedLine {
  const stored = line.path.map((point) => [point[0], point[1], point[2]] as Vec3)
  const overhead = line.routing === 'overhead'

  // Plan hints for the crossarm side, resolved before any pole is.
  const storedPlan = stored.map((p) => [p[0], p[2]] as PlanPoint)
  const fromNode = line.fromRef ? ctx.resolve(line.fromRef) : undefined
  const toNode = line.toRef ? ctx.resolve(line.toRef) : undefined
  const towardFrom =
    storedPlan[1] ?? planOfNode(ctx, toNode) ?? storedPlan[storedPlan.length - 1] ?? null
  const towardTo =
    storedPlan[storedPlan.length - 2] ?? planOfNode(ctx, fromNode) ?? storedPlan[0] ?? null

  const from = resolveEnd(ctx, line.fromRef, towardFrom, overhead)
  const to = resolveEnd(ctx, line.toRef, towardTo, overhead)

  // ── Assemble the plan run: derived ends, stored middle ──────────────
  const path: Vec3[] = []
  const derivedIndices: number[] = []
  const head = from?.endpoint ?? null
  const tail = to?.endpoint ?? null

  if (head) {
    derivedIndices.push(0)
    path.push([...head.site] as Vec3)
  } else if (stored.length > 0) {
    path.push([...(stored[0] as Vec3)] as Vec3)
  }
  // Stored INTERIOR vertices only. `stored[0]` and `stored[last]` are the
  // run's ends: replaced by the derived attachment when a ref resolves, and
  // already pushed above when it does not.
  const lastInterior = stored.length - 1
  for (let i = 1; i < lastInterior; i++) {
    path.push([...(stored[i] as Vec3)] as Vec3)
  }
  if (tail) {
    derivedIndices.push(path.length)
    path.push([...tail.site] as Vec3)
  } else if (stored.length > 1) {
    path.push([...(stored[lastInterior] as Vec3)] as Vec3)
  }

  if (path.length < 2) {
    return { path, from: head, to: tail, derivedIndices }
  }

  // ── Elevations ─────────────────────────────────────────────────────
  const plan = path.map((p) => [p[0], p[2]] as PlanPoint)
  const grades = plan.map((p) => gradeElevationAt(null, p))
  const isDerived = (i: number) => derivedIndices.includes(i)

  if (!overhead) {
    // Underground: a stored y is a COVER below grade, so the absolute
    // elevation is grade + y at THAT vertex — not grade at the origin, and
    // certainly not the building level origin. A derived end keeps the run
    // buried at the neighbouring vertex's cover: the riser up to a meter is
    // not modelled here.
    // Two passes: stored covers first, so a derived end can borrow one.
    const covers: (number | null)[] = path.map((vertex, i) => {
      if (isDerived(i)) return null
      return vertex[1] < 0 ? vertex[1] : DEFAULT_BURIAL_DEPTH
    })
    const donor = covers.find((cover): cover is number => typeof cover === 'number')
    for (let i = 0; i < covers.length; i++) {
      if (covers[i] === null) covers[i] = donor ?? DEFAULT_BURIAL_DEPTH
    }
    for (let i = 0; i < path.length; i++) {
      ;(path[i] as Vec3)[1] = (grades[i] as number) + (covers[i] as number)
    }
    return { path, from: head, to: tail, derivedIndices }
  }

  // Overhead. A derived end is already an absolute attachment elevation. An
  // unlinked end keeps a real stored height (grade + y) and otherwise falls
  // back to the drawing default.
  const endHeight = (i: number): number => {
    if (isDerived(i)) return (path[i] as Vec3)[1]
    const y = (path[i] as Vec3)[1]
    return y > OVERHEAD_ELEVATION_EPSILON
      ? (grades[i] as number) + y
      : (grades[i] as number) + DEFAULT_OVERHEAD_HEIGHT
  }
  const startY = endHeight(0)
  const endY = endHeight(path.length - 1)

  // "No elevation data" — the run was drawn or flipped without heights, so
  // every intermediate vertex is interpolated between the two attachments
  // instead of being left at grade or at a leftover burial depth. This is the
  // fix for the drop that rendered in the floor.
  const interpolate = !hasOverheadElevation(line)
  const fractions = planFractions(plan)
  for (let i = 0; i < path.length; i++) {
    const vertex = path[i] as Vec3
    if (i === 0) vertex[1] = startY
    else if (i === path.length - 1) vertex[1] = endY
    else if (interpolate) vertex[1] = startY + (endY - startY) * (fractions[i] as number)
    else vertex[1] = (grades[i] as number) + vertex[1]
  }

  return { path, from: head, to: tail, derivedIndices }
}

/**
 * `resolveLineEndpoints(nodes, line)` — the pure function every surface uses.
 * Same as `resolveLineEndpointsVia` with the scene's node map as the resolver
 * and the line's own building frame.
 */
export function resolveLineEndpoints(nodes: LooseNodes, line: UtilityLineNode): ResolvedLine {
  const frame = resolveFrame(nodes, line as unknown as LooseNode)
  return resolveLineEndpointsVia({ resolve: (id) => nodes[id], frame }, line)
}

/** Just the resolved SITE path — the common case. */
export function resolvedLinePath(nodes: LooseNodes, line: UtilityLineNode): Vec3[] {
  return resolveLineEndpoints(nodes, line).path
}
