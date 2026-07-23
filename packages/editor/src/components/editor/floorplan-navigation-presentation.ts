export type FloorplanPresentationViewBox = {
  minX: number
  minY: number
  width: number
  height: number
}

export function resolveFloorplanPresentationViewBox(
  reactViewBox: FloorplanPresentationViewBox,
  imperativeViewBox: FloorplanPresentationViewBox | null,
  interactionInProgress: boolean,
): FloorplanPresentationViewBox {
  return interactionInProgress && imperativeViewBox ? imperativeViewBox : reactViewBox
}

export function canZoomFloorplanDuringNavigation(rotationInProgress: boolean): boolean {
  return !rotationInProgress
}

export function canApplyFloorplanNavigationSync(interactionInProgress: boolean): boolean {
  return !interactionInProgress
}

export function finalizeFloorplanNavigation<RotationState>({
  zoomPending,
  panActive,
  rotationState,
  commitZoom,
  commitPan,
  commitRotation,
}: {
  zoomPending: boolean
  panActive: boolean
  rotationState: RotationState | null
  commitZoom: () => void
  commitPan: () => void
  commitRotation: (rotationState: RotationState) => void
}): void {
  if (zoomPending) commitZoom()
  if (panActive) commitPan()
  if (rotationState) commitRotation(rotationState)
}
