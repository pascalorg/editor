const EMPTY_LAYER_VISIBILITY: Readonly<Record<string, boolean>> = {}

export function isCaptureLayerVisible(
  layers: Readonly<Record<string, boolean>>,
  layerKey: string,
  defaultLayerVisibility: Readonly<Record<string, boolean>> = EMPTY_LAYER_VISIBILITY,
): boolean {
  return layers[layerKey] ?? defaultLayerVisibility[layerKey] ?? true
}
