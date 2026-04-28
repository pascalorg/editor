export type HomeAssistantGroundPoint = {
  x: number
  y: number
  z: number
}

export type HomeAssistantPlacementScreenPoint = {
  x: number
  y: number
}

export type HomeAssistantPlacementPreview = {
  groundPosition: HomeAssistantGroundPoint
  groundScreenPosition: HomeAssistantPlacementScreenPoint
  pillScreenPosition: HomeAssistantPlacementScreenPoint
  visible: boolean
}

type HomeAssistantPlacementResolver = (
  clientX: number,
  clientY: number,
) => HomeAssistantPlacementPreview | null

let activePlacementResolver: HomeAssistantPlacementResolver | null = null

export function registerHomeAssistantGroundResolver(resolver: HomeAssistantPlacementResolver) {
  activePlacementResolver = resolver

  return () => {
    if (activePlacementResolver === resolver) {
      activePlacementResolver = null
    }
  }
}

export function resolveHomeAssistantPlacementPreview(clientX: number, clientY: number) {
  return activePlacementResolver?.(clientX, clientY) ?? null
}

export function resolveHomeAssistantGroundPoint(clientX: number, clientY: number) {
  return resolveHomeAssistantPlacementPreview(clientX, clientY)?.groundPosition ?? null
}
