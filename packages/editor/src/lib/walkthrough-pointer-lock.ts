/**
 * Grab pointer lock on the viewer canvas for a walkthrough (walk / drone)
 * entry. Must run synchronously inside a user-gesture task — callers flip the
 * first-person flags in a `flushSync` first so the controls are mounted when
 * the lock lands.
 */
export function requestWalkthroughPointerLock() {
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
    if (result && typeof result.catch === 'function') result.catch(() => {})
  } catch {
    return
  }
}
