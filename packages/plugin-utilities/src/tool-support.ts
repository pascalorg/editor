import type { AnyNodeId, SceneApi } from '@pascal-app/core'
import { isGridSnapActive, useDrawingView, useEditor } from '@pascal-app/editor'
import { isServicePoint, isUtilityPole } from './kind-guards'
import type { UtilityLineNode } from './schema'
import { DEFAULT_POLE_HEIGHT } from './schema'
import {
  type BuildingFrame,
  buildingFrameOf,
  findAnyBuilding,
  findBuildingAncestor,
  IDENTITY_FRAME,
  type LooseNode,
  localToSitePlan,
  siteToLocalPlan,
} from './site-frame'
import { serviceAttachmentHeight, servicePointAnchor } from './utility-line/endpoints'
import { POLE_CROSSARM_DROP } from './utility-pole/geometry'

export type PlanPoint = [number, number]

/**
 * Re-exported so tool code keeps one import site. Both constants now live
 * beside the geometry that consumes them — the attachment heights in
 * `utility-line/endpoints.ts`, the pole hardware in
 * `utility-pole/geometry.ts` — instead of being a second copy here that could
 * drift from the renderer, which is how a drop ends up attached to nothing.
 */
export {
  DEFAULT_OVERHEAD_HEIGHT,
  SERVICE_DROP_MIN_HEIGHT,
} from './utility-line/endpoints'
export { POLE_CROSSARM_DROP } from './utility-pole/geometry'

/** SVG client point → the floor plan's own coordinate frame. */
export function clientToPlanPoint(
  group: SVGGElement,
  clientX: number,
  clientY: number,
): PlanPoint | null {
  const matrix = group.getScreenCTM()
  if (!matrix) return null
  const local = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
  return [local.x, local.y]
}

/** Grid snap, honouring Alt as the escape hatch (host convention). */
export function snapPlanPoint(point: PlanPoint, altKey: boolean, gridSnapStep: number): PlanPoint {
  const step = altKey || !isGridSnapActive() ? 0 : gridSnapStep
  return step > 0 ? [Math.round(point[0] / step) * step, Math.round(point[1] / step) * step] : point
}

/** Silence an event the host would otherwise route to selection. */
export function consumeEvent(event: Event): void {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

export type ToolFrame = {
  /** The building these nodes parent to, or null when the scene has none. */
  buildingId: AnyNodeId | null
  /** The building's own frame — what `def.floorplan` / the renderers use. */
  frame: BuildingFrame
  /**
   * The frame that converts the ACTIVE 2D view's plan coordinates to site
   * metres. `FloorplanRegistryLayer` draws in building-local metres, so in
   * floor-plan view this is the building frame; `FloorplanSitePlanLayer`
   * draws in SITE metres, so in site-plan view it is the identity. Tools
   * must use this one, not `frame`, or every click lands offset by the
   * building's position (see site-frame.ts).
   */
  planFrame: BuildingFrame
}

/**
 * The building a new utility node should be parented to, and its frame.
 *
 * Preference order: the active level's building (the storey the user is
 * looking at), then any building in the scene. With no building at all the
 * node is created unparented and the identity frame applies — site metres
 * are then world metres, which is the correct degenerate behaviour.
 */
export function resolveToolFrame(sceneApi: SceneApi, activeLevelId: AnyNodeId | null): ToolFrame {
  const nodes = sceneApi.nodes() as unknown as Record<string, Record<string, unknown>>
  const building =
    (activeLevelId ? findBuildingAncestor(nodes, activeLevelId) : null) ?? findAnyBuilding(nodes)
  const frame = buildingFrameOf(nodes, building)
  const sitePlanView = useDrawingView.getState().drawingType === 'site-plan'
  return {
    buildingId: (building?.id as AnyNodeId | undefined) ?? null,
    frame,
    planFrame: sitePlanView ? IDENTITY_FRAME : frame,
  }
}

export type SnapTarget = {
  id: string
  /** SITE plan position of the target. */
  site: PlanPoint
  /** Attachment elevation for an overhead run, metres above grade. */
  overheadHeight: number
  kind: 'pole' | 'service-point'
}

/**
 * Poles and service points a run's endpoint can snap to, in SITE metres.
 *
 * A pole's attachment is its crossarm, not its top; a service point's is its
 * own mount height. Getting that right is what makes an overhead drop land
 * on the weatherhead instead of floating.
 */
export function collectSnapTargets(sceneApi: SceneApi, frame: BuildingFrame): SnapTarget[] {
  const out: SnapTarget[] = []
  for (const node of Object.values(sceneApi.nodes()) as unknown[]) {
    if (isUtilityPole(node)) {
      // The click snaps to the pole CENTRE (that is the symbol the user aims
      // at); which end of the crossarm the span actually leaves from is
      // derived later, once the run's direction is known
      // (`resolveLineEndpoints`).
      out.push({
        id: node.id,
        site: [node.position[0], node.position[2]],
        overheadHeight:
          node.position[1] + Math.max(0, (node.height || DEFAULT_POLE_HEIGHT) - POLE_CROSSARM_DROP),
        kind: 'pole',
      })
    } else if (isServicePoint(node)) {
      // Through the SAME anchor resolution the renderer and
      // `resolveLineEndpoints` use, so the snap target sits exactly where the
      // run will attach — including the standoff off the wall face.
      const anchor = servicePointAnchor(
        {
          resolve: (id) => sceneApi.get(id as AnyNodeId) as unknown as LooseNode | undefined,
          frame,
        },
        node,
      )
      const site: PlanPoint = [anchor[0], anchor[2]]
      out.push({
        id: node.id,
        site,
        // An overhead drop attaches at the weatherhead, not on the meter can
        // — NEC 230.24(B)(1)'s 10 ft drip-loop clearance. See
        // `serviceAttachmentHeight`.
        overheadHeight: serviceAttachmentHeight(node.height, 0),
        kind: 'service-point',
      })
    }
  }
  return out
}

/** Nearest snap target to a SITE plan point, within `radius` metres. */
export function nearestSnapTarget(
  targets: readonly SnapTarget[],
  site: PlanPoint,
  radius = 2,
): SnapTarget | null {
  let best: SnapTarget | null = null
  let bestDistance = radius
  for (const target of targets) {
    const distance = Math.hypot(target.site[0] - site[0], target.site[1] - site[1])
    if (distance <= bestDistance) {
      best = target
      bestDistance = distance
    }
  }
  return best
}

/** Plan point (tool frame) → SITE plan point. */
export const planToSite = (frame: BuildingFrame, point: PlanPoint): PlanPoint =>
  localToSitePlan(frame, point)

/** SITE plan point → plan point (tool frame), for previews. */
export const siteToPlan = (frame: BuildingFrame, point: PlanPoint): PlanPoint =>
  siteToLocalPlan(frame, point)

/** The system / routing the toolbar chose for the next run. */
export function readLineDefaults(defaults: Readonly<Record<string, unknown>> | null): {
  system: UtilityLineNode['system']
  routing: UtilityLineNode['routing']
} {
  const system = defaults?.system
  const routing = defaults?.routing
  return {
    system: typeof system === 'string' ? (system as UtilityLineNode['system']) : 'power',
    routing: routing === 'overhead' ? 'overhead' : 'underground',
  }
}

/** Seed the next run's system / routing from the Utilities panel. */
export function setLineToolDefaults(
  system: UtilityLineNode['system'],
  routing: UtilityLineNode['routing'],
): void {
  useEditor.getState().setToolDefaults('utility-line', { system, routing })
}
