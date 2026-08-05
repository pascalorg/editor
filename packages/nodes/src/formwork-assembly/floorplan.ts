import {
  type CastableElement,
  type FaceRole,
  outlineOf,
  type Vec2,
} from '@pascal-app/core/formwork'
import type { FloorplanGeometry, FloorplanPoint, GeometryContext } from '@pascal-app/core/registry'
import type { AnyNode } from '@pascal-app/core/schema'
import type { CastableHostNode } from './attach'
import { type FormworkScope, resolveFormworkScope } from './geometry-shared'
import type { FormworkAssemblyNode } from './schema'

/**
 * Formwork in plan: a line standing off each face that is actually formed, and
 * nothing along the faces that aren't.
 *
 * The absence is the information. A face left unformed because the neighbour was
 * cast first is invisible in a 3D shutter — there is simply no panel there, which
 * looks the same as a shutter nobody has built yet. Drawn in plan against the
 * element outline, the missing stretch is what a crew asks about. So the geometry
 * keys off the coverage engine's `formed` flag through the same
 * `resolveFormworkScope` the 3D builders use: plan and model read one classifier,
 * so they cannot disagree about which faces exist.
 *
 * Coordinates are level-local metres, and a castable element's plan outline is
 * already in that space — a slab polygon is stored there and a wall's outline is
 * derived from its level-space endpoints — so nothing here applies a node
 * transform. The `[x, z]` of the 3D builders is the `[x, y]` of the plan.
 */

/** How far the shutter line sits off the concrete face, m — a drawn standoff, not a real thickness. */
const STANDOFF_M = 0.035

/** Shutter line weight, screen px. Non-scaling so it holds its weight when zoomed out. */
const STROKE_PX = 1.7

/** Galvanized-tube orange, matching `scaffoldMaterial` in the 3D builders. */
const STROKE = '#c77b1a'

/**
 * The faces that read as a line along the plan outline, and which outline edge
 * each one is.
 *
 * A wall's outline runs start-b → end-b → end-a → start-a (`outlineOf` offsets by
 * `-halfWidth` first, and `sideEdge` in `coverage/trim.ts` puts side `a` at the
 * `+` offset), so edge 0 is side `b` and edge 2 is side `a`. Getting this
 * backwards is invisible on a symmetric wall and draws the shutter against the
 * wrong room on every other one.
 */
const WALL_EDGE_ROLES: readonly FaceRole[] = ['side-b', 'end-end', 'side-a', 'end-start']

/** A box column's four faces are `footprintEdges` order, which is outline order. */
const COLUMN_EDGE_ROLES: readonly FaceRole[] = [
  'column-face-1',
  'column-face-2',
  'column-face-3',
  'column-face-4',
]

/** Shoelace — the sign says which way the outline winds, which decides which normal points out. */
function signedArea(outline: readonly Vec2[]): number {
  let twice = 0
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i] as Vec2
    const b = outline[(i + 1) % outline.length] as Vec2
    twice += a.x * b.y - b.x * a.y
  }
  return twice / 2
}

/**
 * Which outline edges carry a shutter, by face role.
 *
 * A shaft column publishes one `shaft` role for the whole wrapped surface and a
 * slab one `edge` role for its whole rim, so in both cases every edge is formed or
 * none is. Only a wall and a box column map edge-by-edge.
 */
function formedEdges(element: CastableElement, isFormed: (role: FaceRole) => boolean): boolean[] {
  const outline = outlineOf(element)
  if (element.kind === 'wall') {
    return outline.map((_, i) => isFormed(WALL_EDGE_ROLES[i % WALL_EDGE_ROLES.length] as FaceRole))
  }
  if (element.kind === 'column') {
    if (element.faceLayout === 'shaft') return outline.map(() => isFormed('shaft'))
    return outline.map((_, i) => {
      const role = COLUMN_EDGE_ROLES[i]
      // A column with more than four sides is formed as a shaft by classification,
      // so an unmapped edge here is a footprint the classifier didn't face — draw
      // nothing rather than guessing a role.
      return role ? isFormed(role) : false
    })
  }
  return outline.map(() => isFormed('edge'))
}

/**
 * One shutter line: the outline edge pushed clear of the concrete.
 *
 * `outwardSign` folds in the winding. For a counter-clockwise ring the outward
 * normal of an edge is `(dy, -dx)` — the *right*-hand normal — and taking the
 * left-hand one instead draws every shutter inside the pour it is supposed to be
 * holding back.
 */
function shutterLine(a: Vec2, b: Vec2, outwardSign: number): FloorplanGeometry | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-9) return null
  const nx = (dy / length) * STANDOFF_M * outwardSign
  const ny = (-dx / length) * STANDOFF_M * outwardSign
  return {
    kind: 'line',
    x1: a.x + nx,
    y1: a.y + ny,
    x2: b.x + nx,
    y2: b.y + ny,
    stroke: STROKE,
    strokeWidth: STROKE_PX,
    strokeLinecap: 'round',
    vectorEffect: 'non-scaling-stroke',
    // The host element under this line owns selection in plan. A shutter is
    // generated from it and is not the thing a user reaches for by clicking the
    // floor, so it never eats a pointer.
    pointerEvents: 'none',
  }
}

/** Every formed edge of a closed ring, offset outward. */
function ringLines(
  ring: readonly Vec2[],
  formed: readonly boolean[],
  invert = false,
): FloorplanGeometry[] {
  if (ring.length < 3) return []
  // A hole's shutter faces the concrete *around* it, which is the opposite side of
  // its ring from a rim's.
  const outwardSign = (signedArea(ring) >= 0 ? 1 : -1) * (invert ? -1 : 1)
  const out: FloorplanGeometry[] = []
  for (let i = 0; i < ring.length; i++) {
    if (!formed[i]) continue
    const line = shutterLine(ring[i] as Vec2, ring[(i + 1) % ring.length] as Vec2, outwardSign)
    if (line) out.push(line)
  }
  return out
}

/**
 * A decked soffit, as a light wash over the slab.
 *
 * A deck is an area rather than a line, and the thing worth seeing in plan is
 * simply *which* slabs are propped — the joist and prop grids are the falsework
 * drawing's job, and at plan scale a few hundred prop dots is noise that hides the
 * shutter lines this layer exists to show. So the deck reads as one translucent
 * polygon, holes taken out, and the member spacings stay on the schedule where a
 * number can be read off them.
 */
function deckWash(element: CastableElement): FloorplanGeometry | null {
  const plan = element.plan
  if (!plan || plan.outline.length < 3) return null
  const ring = (points: readonly Vec2[]): FloorplanPoint[] =>
    points.map((p) => [p.x, p.y] as FloorplanPoint)
  const path = [
    `M ${ring(plan.outline)
      .map(([x, y]) => `${x} ${y}`)
      .join(' L ')} Z`,
    ...plan.holes
      .filter((hole) => hole.length >= 3)
      .map(
        (hole) =>
          `M ${ring(hole)
            .map(([x, y]) => `${x} ${y}`)
            .join(' L ')} Z`,
      ),
  ].join(' ')
  return {
    kind: 'path',
    d: path,
    fill: STROKE,
    fillOpacity: 0.1,
    stroke: STROKE,
    strokeWidth: 0.9,
    strokeOpacity: 0.4,
    strokeDasharray: '0.18 0.12',
    vectorEffect: 'non-scaling-stroke',
    pointerEvents: 'none',
  }
}

function shutterGeometry(scope: FormworkScope): FloorplanGeometry[] {
  const { element, isFormed } = scope
  const outline = outlineOf(element)
  if (outline.length < 3) return []

  const children: FloorplanGeometry[] = []
  // Area first, so the shutter lines paint over it rather than under.
  if (isFormed('soffit')) {
    const wash = deckWash(element)
    if (wash) children.push(wash)
  }
  children.push(...ringLines(outline, formedEdges(element, isFormed)))

  // A void through a slab takes edge forms around it exactly as the rim does, and
  // that perimeter is a line an estimator counts.
  if (isFormed('edge')) {
    for (const hole of element.plan?.holes ?? []) {
      if (hole.length < 3) continue
      children.push(
        ...ringLines(
          hole,
          hole.map(() => true),
          true,
        ),
      )
    }
  }
  return children
}

/**
 * Plan symbol for one formwork assembly.
 *
 * Returns `null` — drawing nothing — when the host is not castable or its
 * shuttering is off, rather than falling back to the element outline: an outline
 * with no shutter is what the host already draws, and doubling it would say a
 * shutter exists where none does.
 */
export function buildFormworkAssemblyFloorplan(
  node: FormworkAssemblyNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const host = ctx.parent as AnyNode | null
  if (!host) return null
  if (host.type !== 'wall' && host.type !== 'column' && host.type !== 'slab') return null

  const castable = host as CastableHostNode
  if (!castable.formworkType || castable.formworkType === 'none') return null

  const scope = resolveFormworkScope(castable, node, ctx)
  if (!scope) return null

  // A wall split into lifts stacks several assemblies on one plan footprint, and
  // every one of them would draw the same lines. Only the bottom lift draws, so a
  // three-lift wall reads as one shutter rather than three coincident ones.
  if (scope.unit && scope.unit.liftIndex > 0) return null

  const children = shutterGeometry(scope)
  if (children.length === 0) return null
  return { kind: 'group', children }
}
