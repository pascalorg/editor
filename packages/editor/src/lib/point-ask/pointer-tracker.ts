// The pointer's last position on the page, shared by whatever follows it (the label chip), so the
// chip moves on the frame of the pointer event, never after a React render.

type PointerFn = (x: number, y: number) => void

let x = -1
let y = -1
let attached = false
const subscribers = new Set<PointerFn>()

function onMove(event: PointerEvent) {
  x = event.clientX
  y = event.clientY
  for (const fn of subscribers) fn(x, y)
}

export function getPointer(): { x: number; y: number } | null {
  return x < 0 ? null : { x, y }
}

export function subscribePointer(fn: PointerFn): () => void {
  subscribers.add(fn)
  if (!attached && typeof window !== 'undefined') {
    window.addEventListener('pointermove', onMove, { passive: true, capture: true })
    attached = true
  }
  return () => {
    subscribers.delete(fn)
    if (subscribers.size === 0 && attached) {
      window.removeEventListener('pointermove', onMove, { capture: true })
      attached = false
    }
  }
}
