import { usePointAsk } from '../../store/use-point-ask'
import { chatWentIdle, closeBubble, lookAtAsk, retryAsk, sendBubble } from './session'

// What a host app (the hosted chat) tells Point and ask about itself, without importing the store.

/** Send the open Point and ask bubble through the session pipeline. */
export function sendPointAskBubble(
  text: string,
  from: { x: number; y: number; width: number; height: number },
): Promise<void> {
  return sendBubble(text, from)
}

/** Dismiss or close the open Point and ask bubble. */
export function closePointAskBubble(kind: 'send' | 'dismiss' = 'dismiss') {
  closeBubble(kind)
}

/** Frame the camera on a planted ask/comment pin. */
export function lookAtPointAsk(askId: string) {
  lookAtAsk(askId)
}

/** The host's "Playful touches" setting: false turns the region flash, the ripples and the sounds off. */
export function setPointAskPlayful(playful: boolean) {
  usePointAsk.getState().setPlayful(playful)
}

/** Pascal is on a turn: the bubble's Send says Queue, and a new ask waits its turn. */
export function setPointAskBusy(busy: boolean) {
  usePointAsk.getState().setBusy(busy)
  if (!busy) chatWentIdle()
}

/**
 * Messages already wait in the chat's queue (or are held there after an error): a new ask goes
 * behind them, and the bubble says Queue, though Pascal is on no turn.
 */
export function setPointAskBehindQueue(behindQueue: boolean) {
  usePointAsk.getState().setBehindQueue(behindQueue)
}

/**
 * The chat's Retry on a message that was a Point and ask: the same ask again, with its own pin. False
 * when the editor no longer has the pin (a reload, a collaborator's ask): the chat sends the words
 * again as a plain message.
 */
export function retryPointAsk(askId: string): Promise<boolean> {
  return retryAsk(askId)
}
