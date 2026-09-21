export type DrawingTool = string
type DrawingView = '2d' | '3d'
export type DrawingControls = {
  finish?: () => boolean
  back: () => void
  afterFinish?: () => void
}

const controls = new Map<DrawingTool, Map<DrawingView, DrawingControls>>()
const subscribers = new Set<() => void>()
let revision = 0

function notifySubscribers() {
  revision += 1
  for (const subscriber of subscribers) subscriber()
}

export function subscribeDrawingControls(subscriber: () => void) {
  subscribers.add(subscriber)
  return () => subscribers.delete(subscriber)
}

export function getDrawingControlsRevision() {
  return revision
}

export function hasDrawingControls(tool: string | null): tool is DrawingTool {
  return tool !== null && controls.has(tool)
}

export function registerDrawingControls(
  tool: DrawingTool,
  view: DrawingView,
  handlers: DrawingControls,
) {
  let views = controls.get(tool)
  if (!views) {
    views = new Map()
    controls.set(tool, views)
  }
  views.set(view, handlers)
  notifySubscribers()
  return () => {
    if (views.get(view) !== handlers) return
    views.delete(view)
    if (views.size === 0 && controls.get(tool) === views) controls.delete(tool)
    notifySubscribers()
  }
}

export function runDrawingControl(
  tool: DrawingTool,
  action: 'finish' | 'back',
  view: DrawingView | 'split',
): boolean {
  const views = controls.get(tool)
  if (!views) return false
  if (action === 'back') {
    for (const handlers of views.values()) handlers.back()
    return true
  }
  const preferred: DrawingView = view === '2d' ? '2d' : '3d'
  const fallback: DrawingView = preferred === '2d' ? '3d' : '2d'
  const owner = views.get(preferred)?.finish ? preferred : fallback
  const primary = views.get(owner)
  const secondary = views.get(owner === '2d' ? '3d' : '2d')
  if (!primary?.finish?.()) return false
  secondary?.afterFinish?.()
  return true
}
