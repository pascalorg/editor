import { afterEach, describe, expect, test } from 'bun:test'
import { sceneRegistry } from '@pascal-app/core'
import { Group, Object3D } from 'three'
import { OVERLAY_LAYER, SCENE_LAYER } from './layers'
import { SCAN_POINT_CLOUD_NAME, temporarilyShowScanPoints } from './scan-points'
import { hideFromScene } from './scene-visibility'

const SCAN_ID = 'scan_points_test'

function overlayObject(name: string): Object3D {
  const object = new Object3D()
  object.name = name
  object.layers.set(OVERLAY_LAYER)
  return object
}

function registerScan(...children: Object3D[]): void {
  const scan = new Group()
  scan.add(...children)
  sceneRegistry.nodes.set(SCAN_ID, scan)
  sceneRegistry.byType.scan?.add(SCAN_ID)
}

afterEach(() => {
  sceneRegistry.nodes.delete(SCAN_ID)
  sceneRegistry.byType.scan?.delete(SCAN_ID)
})

describe("a scan's points in a capture", () => {
  test('the cloud joins the scene layer for the capture, and only the cloud', () => {
    // A capture camera sees the scene layer alone: a cloud left on the overlay is an empty frame.
    const cloud = overlayObject(SCAN_POINT_CLOUD_NAME)
    const pin = overlayObject('capture-photo-pin')
    registerScan(cloud, pin)

    const restore = temporarilyShowScanPoints()
    expect(cloud.layers.isEnabled(SCENE_LAYER)).toBe(true)
    expect(pin.layers.isEnabled(SCENE_LAYER)).toBe(false)

    restore()
    expect(cloud.layers.isEnabled(SCENE_LAYER)).toBe(false)
    expect(cloud.layers.isEnabled(OVERLAY_LAYER)).toBe(true)
  })

  test('a cloud the view holds back stays out', () => {
    const cloud = overlayObject(SCAN_POINT_CLOUD_NAME)
    registerScan(cloud)
    hideFromScene(cloud, 'isolated')
    const held = cloud.layers.mask

    const restore = temporarilyShowScanPoints()
    expect(cloud.layers.mask).toBe(held)
    restore()
    expect(cloud.layers.mask).toBe(held)
  })
})
