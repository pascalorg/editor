export type LoopCutInteractionStage = 'choosing-ring' | 'sliding'

export type LoopCutPointerAction = 'begin-slide' | 'commit-current' | 'commit-centered' | 'cancel'

export function resolveLoopCutPointerAction(
  stage: LoopCutInteractionStage,
  button: number,
): LoopCutPointerAction | null {
  if (stage === 'choosing-ring') {
    if (button === 0) return 'begin-slide'
    return button === 2 ? 'cancel' : null
  }
  if (button === 0) return 'commit-current'
  return button === 2 ? 'commit-centered' : null
}

export function resolveLoopCutSlideFactor(cuts: number, requestedFactor: number): number {
  return cuts === 1 ? requestedFactor : 0.5
}
