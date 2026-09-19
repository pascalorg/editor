/**
 * Re-export local asset helpers.
 * Physical deletion lives in an explicit multi-scene GC
 * (`sweepLocalAssetsExcept`) — never from a single active graph (#733).
 */
export { collectNodeAssetUrls, collectSceneAssetUrls } from '@pascal-app/core'
