import { type AnyNodeId, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import type { LandscapeStairSnap } from '@pascal-app/editor'

export function publishStairMovePreview(
  stairId: AnyNodeId,
  flightId: AnyNodeId | undefined,
  position: [number, number, number],
  rotation: number,
  snap: LandscapeStairSnap | null,
) {
  const overrides = useLiveNodeOverrides.getState()
  if (snap) {
    overrides.setMany([
      [stairId, { position, rotation, totalRise: snap.totalRise,
        stepCount: snap.stepCount, landscapeSurfaceId: snap.surfaceId, railingMode: 'none' }],
      ...(flightId ? [[flightId, { height: snap.totalRise, length: snap.length,
        stepCount: snap.stepCount }] as const] : []),
    ])
    useScene.getState().markDirty(stairId)
    if (flightId) useScene.getState().markDirty(flightId)
    return
  }

  const hadSnap = overrides.get(stairId)?.totalRise !== undefined ||
    (flightId !== undefined && overrides.get(flightId) !== undefined)
  overrides.clearFields(stairId, ['totalRise', 'stepCount', 'railingMode'])
  if (flightId && overrides.get(flightId)) overrides.clear(flightId)
  overrides.set(stairId, { position, rotation, landscapeSurfaceId: undefined })
  if (hadSnap) {
    useScene.getState().markDirty(stairId)
    if (flightId) useScene.getState().markDirty(flightId)
  }
}

export function clearStairMovePreview(stairId: AnyNodeId, flightId: AnyNodeId | undefined) {
  const overrides = useLiveNodeOverrides.getState()
  if (!overrides.get(stairId) && (!flightId || !overrides.get(flightId))) return
  overrides.clear(stairId)
  if (flightId) overrides.clear(flightId)
  useScene.getState().markDirty(stairId)
  if (flightId) useScene.getState().markDirty(flightId)
}
