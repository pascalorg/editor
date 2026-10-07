import { sfxEmitter } from '../sfx-bus'

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

export function createMovementSfxTick() {
  let previousKey: string | null = null
  let pending: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = (args: MovementSfxStepKeyArgs, emitInitialStep = false) => {
    const nextKey = movementSfxStepKey(args)
    if (nextKey !== previousKey && (previousKey !== null || emitInitialStep)) {
      sfxEmitter.emit('sfx:grid-snap')
    }
    previousKey = nextKey
  }
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
    pending = null
  }
  const flush = () => {
    const apply = pending
    cancel()
    apply?.()
  }
  return {
    tick,
    schedule(args: MovementSfxStepKeyArgs, shouldPlay: () => boolean, emitInitialStep = false) {
      pending = () => {
        if (shouldPlay()) tick(args, emitInitialStep)
      }
      // Wait for R3F host dispatch after the native grid listener, without delaying the move.
      if (timer === undefined) timer = setTimeout(flush, 0)
    },
    flush,
    cancel,
  }
}
