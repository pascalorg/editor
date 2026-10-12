import type { WallGeometryAdapter } from '@pascal-app/viewer'
import { createWallFeatureBodyModifier } from '../wall-feature/runtime'
import { curtainWallGeometryAdapter } from './curtain-wall-adapter'

export const wallGeometryAdapter: WallGeometryAdapter = {
  ...curtainWallGeometryAdapter,
  bodyModifier: createWallFeatureBodyModifier,
}
