export { FloorplanDrawingTypeSwitch } from './drawing-type-switch'
export {
  buildingRecentreOffset,
  buildSitePlanDrawing,
  describeSiteEdges,
  levelFootprintLoops,
  type SitePlanDrawing,
  type SitePlanEdge,
} from './build-site-plan-drawing'
export {
  type Bounds,
  boundsInsidePolygon,
  castYardDimensions,
  castYardDimensionsOriented,
  classifyEdges,
  compassLabel,
  edgeHeadingDeg,
  edgeLength,
  formatFeetInches,
  METRES_PER_FOOT,
  mostNorthFacingEdge,
  outwardNormal,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  type Pt,
  rayToPolygon,
  resolveFrontEdge,
  setbackEnvelope,
  setbackForRole,
  type SetbackInputs,
  type YardDimension,
  type YardSide,
} from './geometry'
export {
  detectFrontEdgeFromRoads,
  FRONT_EDGE_PARALLEL_DEG,
  type FrontEdgeMatch,
  type RoadCenterline,
  streetCore,
} from './front-edge'
export { FloorplanSitePlanLayer } from './site-plan-layer'
export { registerSitePlanContributor, sitePlanContributions, type SitePlanContributor } from './contributors'
