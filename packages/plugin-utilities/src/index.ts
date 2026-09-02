/**
 * @pascal-app/plugin-utilities — SITE UTILITIES as real Pascal nodes.
 *
 * Three kinds, each with 3D geometry and a 2D plan symbol built from the
 * node itself — no imported symbols, no remote engine:
 *
 *   utility-line   a run: power / sewer / water / gas / comm / storm,
 *                  overhead (catenary-sagged cable) or underground (dashed
 *                  tube at burial depth + a faint surface trench line),
 *                  drawn in the APWA colour for its system;
 *   utility-pole   a tapered wood pole with a crossarm, optional
 *                  transformer can and optional down-guy;
 *   service-point  the meter / panel / cleanout / entry where a run meets
 *                  the building, wall-anchored the way `bones:service` is.
 *
 * Coordinates are SITE metres (x east, z south, y elevation) throughout the
 * schema. `site-frame.ts` explains the conversion to the building-local
 * frame both the 3D scene and the 2D floor plan actually draw in, and
 * `drawing.ts` explains what is and is not wired into the SITE-PLAN view
 * today.
 */
import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import type { EditorHostPanel } from '@pascal-app/editor'
import { servicePointDefinition } from './service-point/definition'
import { utilityLineDefinition } from './utility-line/definition'
import { utilityPoleDefinition } from './utility-pole/definition'

const UTILITIES_ICON = {
  kind: 'url',
  // A pole with two spans — inline so the package needs no asset pipeline.
  src:
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 10v44M18 18h28" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><path d="M4 12c10 12 14 12 14 6M60 12c-10 12-14 12-14 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M6 54h52" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="6 5" stroke-linecap="round"/></svg>`,
    ),
} as const

export const utilitiesPlugin = {
  id: 'pascal:utilities',
  apiVersion: 1,
  nodes: [
    utilityLineDefinition as unknown as AnyNodeDefinition,
    utilityPoleDefinition as unknown as AnyNodeDefinition,
    servicePointDefinition as unknown as AnyNodeDefinition,
  ],
} satisfies Plugin

export const utilitiesHostPanel = {
  id: 'pascal:utilities:panel',
  label: 'Utilities',
  icon: UTILITIES_ICON,
  component: () => import('./panel'),
  pluginId: utilitiesPlugin.id,
  description:
    'Site utilities — overhead and underground runs, poles and service points, in APWA colours with linear-feet totals.',
  creator: { name: 'Pascal' },
  defaultInstalled: true,
} satisfies EditorHostPanel

export {
  isSentinelPosition,
  nearestWall,
  projectOntoWall,
  resolveServicePoint,
  SENTINEL_POSITION_EPSILON,
  type WallProjection,
  wallGeom,
  wallNormal,
  wallPointAt,
} from './anchor'
export {
  floorplanDrawContext,
  IDENTITY_DRAW_CONTEXT,
  siteDrawContext,
  type UtilitiesDrawContext,
} from './draw-context'
export {
  buildUtilitiesDrawing,
  type DrawingBounds,
  type UtilitiesDrawing,
} from './drawing'
export {
  catenaryParameterForSag,
  catenarySag,
  polylineLength,
  runLength,
  sampleCatenarySpan,
  sampleOverheadPath,
  type Vec3,
} from './geometry/catenary'
export { type DashInterval, dashIntervals, pointAtDistance3 } from './geometry/dash'
export { gradeElevationAt, TRENCH_HEIGHT_ABOVE_GRADE } from './geometry/grade'
export {
  type LabelSite,
  longestSegmentMidpoint,
  planLength,
  pointAtDistance,
  spacedLabelPoints,
} from './geometry/labels'
export {
  linearFeet,
  lineLength,
  METRES_PER_FOOT,
  measuredPath,
  metresToFeet,
  type SystemTotal,
  totalMetres,
  totalsBySystem,
} from './geometry/totals'
export { siteParentFrame } from './host-frame'
export { isServicePoint, isUtilityLine, isUtilityPole } from './kind-guards'
export { isUtilitiesGeometry, UTILITIES_LAYER_KEY, UTILITIES_LAYER_VALUE } from './layer'
export {
  DEFAULT_BURIAL_DEPTH,
  DEFAULT_POLE_HEIGHT,
  DEFAULT_SAG_RATIO,
  SERVICE_POINT_ABBR,
  SERVICE_POINT_KINDS,
  SERVICE_POINT_LABEL,
  SERVICE_POINT_SYSTEM,
  ServicePointKind,
  ServicePointNode,
  SYSTEM_COLOR,
  SYSTEM_LABEL,
  SYSTEM_LETTER,
  SYSTEM_MATERIALS,
  UTILITY_ROUTINGS,
  UTILITY_SYSTEMS,
  UtilityLineNode,
  UtilityPoleNode,
  UtilityRouting,
  UtilitySystem,
} from './schema'
export {
  type AutoMeterPlan,
  EXISTING_METER_TOLERANCE,
  METER_SNAP_RADIUS,
  planAutoMeter,
} from './service-point/auto-meter'
export { servicePointDefinition } from './service-point/definition'
export { drawServicePoint } from './service-point/floorplan'
export {
  resolveServicePointDrop,
  type ServicePointDrop,
  servicePointDropPatch,
  servicePointFloorplanMove,
  servicePointMoveCommit,
  WALL_REHOST_RADIUS,
} from './service-point/floorplan-move'
export {
  type BuildingFrame,
  buildingFrameOf,
  IDENTITY_FRAME,
  localToSite,
  localToSitePlan,
  resolveFrame,
  siteToLocal,
  siteToLocalPlan,
} from './site-frame'
export { utilityLineDefinition } from './utility-line/definition'
export {
  DEFAULT_OVERHEAD_HEIGHT,
  type EndpointContext,
  type EndpointKind,
  hasOverheadElevation,
  OVERHEAD_ELEVATION_EPSILON,
  poleAttachmentPoint,
  type ResolvedEndpoint,
  type ResolvedLine,
  resolvedLinePath,
  resolveLineEndpoints,
  resolveLineEndpointsVia,
  SERVICE_DROP_MIN_HEIGHT,
  serviceAttachmentHeight,
  servicePointAnchor,
} from './utility-line/endpoints'
export {
  burialDepth,
  burialDepthOf,
  calloutText,
  calloutTextFor,
  drawUtilityLine,
  formatInches,
} from './utility-line/floorplan'
export { utilityPoleDefinition } from './utility-pole/definition'
export { drawUtilityPole, guyVector } from './utility-pole/floorplan'
export { utilityPoleFloorplanMove } from './utility-pole/floorplan-move'
export {
  crossarmAxis,
  crossarmPinOffset,
  POLE_CROSSARM_DROP,
  POLE_CROSSARM_LENGTH,
  POLE_INSULATOR_INSET,
} from './utility-pole/geometry'
