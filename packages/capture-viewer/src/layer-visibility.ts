import type { CaptureStreamDescriptor } from '@pascal-app/capture-protocol'
import { captureLayerKey } from '@pascal-app/capture-protocol'

const EMPTY_LAYER_VISIBILITY: Readonly<Record<string, boolean>> = {}

export function isCaptureLayerVisible(
  layers: Readonly<Record<string, boolean>>,
  layerKey: string,
  defaultLayerVisibility: Readonly<Record<string, boolean>> = EMPTY_LAYER_VISIBILITY,
): boolean {
  return layers[layerKey] ?? defaultLayerVisibility[layerKey] ?? true
}

export function isCaptureStreamVisible(
  stream: CaptureStreamDescriptor,
  layers: Readonly<Record<string, boolean>>,
  defaultLayerVisibility: Readonly<Record<string, boolean>> = EMPTY_LAYER_VISIBILITY,
): boolean {
  return isCaptureLayerVisible(layers, captureLayerKey(stream), defaultLayerVisibility)
}

export function isCaptureSessionVisible(showScans: boolean, scanVisible: boolean): boolean {
  return showScans && scanVisible
}
