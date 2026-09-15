export type DrawingTool = 'wall' | 'fence' | 'roof' | 'slab' | 'ceiling' | 'zone'
type DrawingView = '2d' | '3d'
type DrawingControls = {
  finish?: () => boolean
  back: () => void
  afterFinish?: () => void
}

const controls = new Map<DrawingTool, Map<DrawingView, DrawingControls>>()

export function isDrawingTool(tool: string | null): tool is DrawingTool {
  return (
    tool === 'wall' ||
    tool === 'fence' ||
    tool === 'roof' ||
    tool === 'slab' ||
    tool === 'ceiling' ||
    tool === 'zone'
  )
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
  return () => {
    if (views.get(view) === handlers) views.delete(view)
    if (views.size === 0 && controls.get(tool) === views) controls.delete(tool)
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
  // Fence and roof use the registry tool even when the floorplan is the only visible view.
  const owner =
    tool === 'zone'
      ? '2d'
      : tool === 'fence' || tool === 'roof'
        ? '3d'
        : view === '2d'
          ? '2d'
          : '3d'
  const primary = views.get(owner)
  const secondary = views.get(owner === '2d' ? '3d' : '2d')
  if (!primary?.finish?.()) return false
  secondary?.afterFinish?.()
  return true
}
