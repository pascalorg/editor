const DEFAULT_FREE_MOVEMENT_SFX_STEP_M = 0.1

type MovementSfxStepKeyArgs = {
  coords: readonly number[]
  gridSnapActive: boolean
  gridStep: number
  freeStep?: number
}

export function movementSfxStepKey({
  coords,
  gridSnapActive,
  gridStep,
  freeStep = DEFAULT_FREE_MOVEMENT_SFX_STEP_M,
}: MovementSfxStepKeyArgs): string {
  const step = gridSnapActive && gridStep > 0 ? gridStep : freeStep
  return coords.map((coord) => Math.round(coord / step)).join(',')
}
