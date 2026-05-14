export {
  type AttachError,
  type AttachResult,
  canAttach,
  clampYToHostTop,
  getSurface,
  getTopSurfaceHeight,
  MAX_HOST_DEPTH,
  pickHost,
  type Vec3,
} from './hosting'
export {
  type AxisLock,
  applyAxisLock,
  isMovable,
  movePlanToward,
  moveToward,
  resolveMovable,
} from './movement'
export {
  DEFAULT_ANGLE_STEP,
  DEFAULT_GRID_STEP,
  type SnapServices,
  snapAngleToList,
  snapPointToAngle,
  snapPointToGrid,
  snapScalar,
  snapServices,
  snapVec3ToGrid,
} from './snap'
