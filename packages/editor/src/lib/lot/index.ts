export {
  type CleanRingResult,
  cleanLotRing,
  describeRingCleanup,
  dropDuplicateVertices,
  mergeCollinearVertices,
  squareCornerArcs,
} from './clean-ring'
export { type DropInOptions, dropInLot, findSiteNode, type LotDropInResult } from './drop-in'
export {
  DEFAULT_SETBACKS_FT,
  DEFAULT_SETBACKS_M,
  DEFAULT_SETBACKS_SOURCE,
  type DropInInput,
  describeFrontEdge,
  describeLotSummary,
  type LotRoad,
  type LotSummary,
  type ParcelResolveData,
  STREET_CLASSES,
  sitePatchFromParcel,
} from './lot-patch'
export {
  coarseHeightAt,
  DEFAULT_GRID_N,
  describeTerrainSample,
  fieldFromSamples,
  gridOver,
  localMetresToLngLat,
  MIN_RELIEF_M,
  type SampleGrid,
  type SampleOptions,
  sampleLotTerrain,
  type TerrainSampleResult,
  type TerrainSampleSummary,
} from './terrain'
