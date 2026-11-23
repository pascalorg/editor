export function setFloorplanCompassRotation(
  compass: { style: { transform: string } } | null,
  rotationDeg: number,
): void {
  if (compass) {
    compass.style.transform = `rotate(${rotationDeg}deg)`
  }
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
