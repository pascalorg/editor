import { sceneRegistry } from '@pascal-app/core'
import type { Object3D } from 'three'
import { SCENE_LAYER } from './layers'
import { heldReasons } from './scene-visibility'

/** The name a scan's point cloud is drawn under. */
export const SCAN_POINT_CLOUD_NAME = 'capture-point-cloud'

/**
 * A scan's point cloud draws over the image (OVERLAY_LAYER), where no capture
 * camera looks, so a picture of a project that holds only a cloud was an empty
 * frame. For one capture the clouds join the scene layer; the returned function
 * puts them back. A cloud whose scan is hidden stays out with it, and so does
 * one the view holds back (isolation).
 */
export function temporarilyShowScanPoints(): () => void {
  const shown: Object3D[] = []
  for (const id of sceneRegistry.byType.scan ?? []) {
    sceneRegistry.nodes.get(id)?.traverse((object) => {
      if (object.name !== SCAN_POINT_CLOUD_NAME) return
      if (heldReasons(object)?.size || object.layers.isEnabled(SCENE_LAYER)) return
      object.layers.enable(SCENE_LAYER)
      shown.push(object)
    })
  }
  return () => {
    for (const object of shown) object.layers.disable(SCENE_LAYER)
  }
}
