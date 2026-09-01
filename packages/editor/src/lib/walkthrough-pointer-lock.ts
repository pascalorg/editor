/**
 * Grab pointer lock on the viewer canvas for a walkthrough (walk / drone)
 * entry. Must run synchronously inside a user-gesture task — callers flip the
 * first-person flags in a `flushSync` first so the controls are mounted when
 * the lock lands.
 *
 * `retryWhile`: the browser's re-lock cooldown (~1.25s after any unlock)
 * rejects the request outright, which bites the natural "free the cursor,
 * immediately pick the other camera" flow. When given, one delayed retry
 * fires after the cooldown — only while the predicate still holds.
 */
export function requestWalkthroughPointerLock(options?: { retryWhile?: () => boolean }) {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-pascal-viewer-3d] canvas')
  if (!canvas) return

  if (!canvas.hasAttribute('tabindex')) {
    canvas.tabIndex = -1
  }
  canvas.focus({ preventScroll: true })

  if (document.pointerLockElement === canvas) return

  try {
    // The request can also reject ASYNC (browser cooldown after a recent
    // unlock) — swallow it like the P-resume path; clicking the canvas
    // re-requests once the cooldown passes.
    const result = canvas.requestPointerLock?.() as Promise<void> | undefined
    if (result && typeof result.catch === 'function') {
      result.catch(() => {
        const retryWhile = options?.retryWhile
        if (!retryWhile) return
        window.setTimeout(() => {
          if (!retryWhile()) return
          if (document.pointerLockElement === canvas) return
          try {
            const retried = canvas.requestPointerLock?.() as Promise<void> | undefined
            if (retried && typeof retried.catch === 'function') retried.catch(() => {})
          } catch {
            // Best effort — clicking the canvas still locks.
          }
        }, 1400)
      })
    }
  } catch {
    return
  }
}
