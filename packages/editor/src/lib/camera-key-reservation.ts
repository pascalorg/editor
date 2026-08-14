/**
 * Keys a tool claims for itself while it is active, so the orbit camera's
 * WASDQE movement stands down instead of firing alongside the tool's own
 * shortcut.
 *
 * The camera's keydown listener sits on `document` and the tools' on `window`,
 * so the camera sees the event first and its `stopPropagation` would swallow
 * the tool's binding outright — the tool cannot defend the key from its own
 * handler. Reserving is refcounted because React StrictMode mounts an effect
 * twice, and because two tools may be mounted across a switch.
 */
const reservedKeys = new Map<string, number>()

export function reserveCameraKeys(...codes: string[]): () => void {
  for (const code of codes) {
    reservedKeys.set(code, (reservedKeys.get(code) ?? 0) + 1)
  }

  let released = false
  return () => {
    if (released) return
    released = true
    for (const code of codes) {
      const next = (reservedKeys.get(code) ?? 1) - 1
      if (next > 0) reservedKeys.set(code, next)
      else reservedKeys.delete(code)
    }
  }
}

export function isCameraKeyReserved(code: string): boolean {
  return reservedKeys.has(code)
}
