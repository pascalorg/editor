export type FloorplanPresentationViewBox = {
  minX: number
  minY: number
  width: number
  height: number
}

export function setFloorplanCompassRotation(
  compass: { style: { transform: string } } | null,
  rotationDeg: number,
): void {
  if (compass) {
    compass.style.transform = `rotate(${rotationDeg}deg)`
  }
}

type FloorplanRotationPresentation = {
  svg: {
    style: {
      transform: string
      transformOrigin: string
      willChange: string
    }
  }
  svgStyle: {
    transform: string
    transformOrigin: string
    willChange: string
  }
}

export function queueFloorplanRotationPresentationRestore<
  Presentation extends FloorplanRotationPresentation,
>(pending: { current: Presentation | null }, presentation: Presentation): void {
  pending.current = presentation
}

export function flushFloorplanRotationPresentationRestore<
  Presentation extends FloorplanRotationPresentation,
>(pending: { current: Presentation | null }): void {
  const presentation = pending.current
  if (!presentation) return

  presentation.svg.style.transform = presentation.svgStyle.transform
  presentation.svg.style.transformOrigin = presentation.svgStyle.transformOrigin
  presentation.svg.style.willChange = presentation.svgStyle.willChange
  pending.current = null
}

export function getFloorplanRotationOverscanViewBox(
  viewBox: FloorplanPresentationViewBox,
): FloorplanPresentationViewBox {
  const size = Math.hypot(viewBox.width, viewBox.height)
  const centerX = viewBox.minX + viewBox.width / 2
  const centerY = viewBox.minY + viewBox.height / 2

  return {
    minX: centerX - size / 2,
    minY: centerY - size / 2,
    width: size,
    height: size,
  }
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

export type FloorplanNavigationSyncScheduler<Pose> = {
  update: (pose: Pose) => void
  flush: () => void
  discard: () => void
}

export function createFloorplanNavigationSyncScheduler<Pose>({
  applyPresentation,
  commit,
  settleMs = 120,
  schedule = globalThis.setTimeout,
  cancel = globalThis.clearTimeout,
}: {
  applyPresentation: (pose: Pose) => void
  commit: (pose: Pose) => void
  settleMs?: number
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof globalThis.setTimeout>
  cancel?: (timer: ReturnType<typeof globalThis.setTimeout>) => void
}): FloorplanNavigationSyncScheduler<Pose> {
  let latestPose: Pose | null = null
  let settleTimer: ReturnType<typeof globalThis.setTimeout> | null = null

  const clearSettleTimer = () => {
    if (settleTimer === null) return
    cancel(settleTimer)
    settleTimer = null
  }

  const flush = () => {
    clearSettleTimer()
    if (latestPose === null) return
    const pose = latestPose
    latestPose = null
    commit(pose)
  }

  const update = (pose: Pose) => {
    latestPose = pose
    applyPresentation(pose)
    clearSettleTimer()
    settleTimer = schedule(() => {
      settleTimer = null
      if (latestPose === null) return
      const settledPose = latestPose
      latestPose = null
      commit(settledPose)
    }, settleMs)
  }

  const discard = () => {
    clearSettleTimer()
    latestPose = null
  }

  return { update, flush, discard }
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
