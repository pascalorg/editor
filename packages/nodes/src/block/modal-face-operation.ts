import type { BlockCommand } from './commands'
import { type BlockModalFeedbackMode, blockModalFeedbackLabel } from './modal-transform'

export type BlockModalFaceOperation = 'extrude' | 'inset'

export function blockFaceOperationValueFromPointer(
  operation: BlockModalFaceOperation,
  deltaX: number,
  deltaY: number,
  topologyExtent: number,
): number {
  const pointerTravel = deltaX - deltaY
  if (operation === 'extrude') return pointerTravel * 0.01
  return Math.min(0.95, Math.max(0, pointerTravel / (Math.max(0.5, topologyExtent) * 100)))
}

export function blockFaceOperationCommand(
  operation: BlockModalFaceOperation,
  faceIds: string[],
  value: number,
): BlockCommand {
  return operation === 'extrude'
    ? { type: 'extrude-faces', faceIds, distance: value }
    : { type: 'inset-faces', faceIds, amount: value, depth: 0 }
}

export function blockModalFaceOperationStatus(
  operation: BlockModalFaceOperation,
  value: string,
  feedbackMode: BlockModalFeedbackMode = 'free',
): string {
  const label = operation === 'extrude' ? 'Extrude' : 'Inset'
  const unit = operation === 'extrude' ? 'm' : 'ratio'
  return `${label} · ${value} ${unit} · ${blockModalFeedbackLabel(feedbackMode)} · type value · click applies · Esc cancels`
}
