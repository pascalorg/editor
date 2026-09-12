/**
 * Re-export local asset lifecycle helpers.
 * Implementation lives in `@pascal-app/core` so every delete path
 * (keyboard, MCP, panels, groups) shares one cleanup hook (#733).
 */
export {
  bumpLocalAssetSceneEpoch,
  cancelLocalAssetDelete,
  clearPendingLocalAssetDeletes,
  collectNodeAssetUrls,
  collectSceneAssetUrls,
  scheduleLocalAssetCleanupForRemovedNodes,
  scheduleLocalAssetDelete,
} from '@pascal-app/core'
