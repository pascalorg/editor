import { clearMaterialCache } from './materials'
import { clearRoofMaterialCache, getRoofMaterialCacheSize } from '../systems/roof/roof-materials'
import {
  clearStairMaterialCache,
  getStairMaterialCacheSize,
} from '../systems/stair/stair-materials'
import { clearWallMaterialCache, getWallMaterialCacheSize } from '../systems/wall/wall-materials'

export function getViewerMaterialCacheSize(): number {
  return getWallMaterialCacheSize() + getRoofMaterialCacheSize() + getStairMaterialCacheSize()
}

export function clearViewerMaterialCaches(): void {
  clearWallMaterialCache()
  clearRoofMaterialCache()
  clearStairMaterialCache()
  clearMaterialCache()
}
