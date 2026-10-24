import type { PointAskSubmit } from '@pascal-app/core'
import type { PinRecord } from '../../store/use-point-ask'
import { createPin } from './pin-machine'

/**
 * What retrying an ask puts in the world: the same words, context and crop under a new ask id, planted
 * where the old pin was. An errored ask is replaced (the pin's own "Try again"); any other is kept, so
 * a retry from the chat of a finished ask does not take away that result's compare and Undo.
 * Null when the pin kept no submit to send again.
 */
export function planRetry(
  old: PinRecord,
  nextAskId: string,
  now: number,
): { pin: PinRecord; submit: PointAskSubmit; keepOld: boolean } | null {
  if (!old.submit) return null
  const submit: PointAskSubmit = {
    ...old.submit,
    askId: nextAskId,
    context: { ...old.submit.context, askId: nextAskId },
  }
  return {
    pin: {
      ...old,
      model: createPin({
        askId: nextAskId,
        text: old.model.text,
        targetIds: old.model.targetIds,
      }),
      submit,
      retireAt: null,
      createdAt: now,
    },
    submit,
    keepOld: old.model.state !== 'error',
  }
}
