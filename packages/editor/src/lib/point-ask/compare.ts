import type { SceneSnapshot } from '@pascal-app/core'

// Hold a control on a pin or its card to see the scene as it was before that turn (the owner,
// 8 October: "I hold and I see the previous state in 3D"). The core's scene preview does the
// showing and writes nothing; this decides when a hold may start and keeps the person's view of it
// (whose, for the "Before" tag) in step with the preview, which ends on its own when a write is
// about to land.

export type CompareDeps = {
  /** The scene as it was before the ask's turn, from the history Undo would restore; null when unknown. */
  before: (askId: string) => SceneSnapshot | null
  /** A turn is writing the scene: it would swallow the preview's writes or land on the wrong state. */
  turnsWorking: () => boolean
  /** The core's `beginScenePreview`: null when the scene will not take one. */
  begin: (snapshot: SceneSnapshot) => { end: () => void } | null
  /** Whose before is on screen, or null: the tag follows. */
  onChange: (askId: string | null) => void
}

/** Why a hold did not start, so the person is told instead of left holding a button that does nothing. */
export type CompareRefusal = 'turn-working' | 'no-before' | 'history-held'

export type Compare = {
  /** Starts showing that ask's before; false when it may not. Ends a hold already up. */
  start: (askId: string) => boolean
  /** Why the last `start` returned false; null after one that started. */
  refusal: () => CompareRefusal | null
  /** Lets go. Idempotent. */
  end: () => void
  /** The preview ended by itself (a write was about to land): clears the tag. */
  released: () => void
  current: () => string | null
}

export function createCompare(deps: CompareDeps): Compare {
  let held: { askId: string; preview: { end: () => void } } | null = null
  let refused: CompareRefusal | null = null

  const set = (askId: string | null) => deps.onChange(askId)

  return {
    start(askId) {
      const refuse = (reason: CompareRefusal) => {
        refused = reason
        return false
      }
      if (deps.turnsWorking()) return refuse('turn-working')
      const snapshot = deps.before(askId)
      if (!snapshot) return refuse('no-before')
      if (held) this.end()
      const preview = deps.begin(snapshot)
      if (!preview) return refuse('history-held')
      refused = null
      held = { askId, preview }
      set(askId)
      return true
    },
    end() {
      if (!held) return
      const { preview } = held
      held = null
      preview.end()
      set(null)
    },
    released() {
      if (!held) return
      held = null
      set(null)
    },
    refusal: () => refused,
    current: () => held?.askId ?? null,
  }
}
