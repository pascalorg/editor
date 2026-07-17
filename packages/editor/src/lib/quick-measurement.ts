import {
  type AnyNode,
  type AnyNodeId,
  type GeometryContext,
  nodeRegistry,
  type QuickMeasurementReport,
} from '@pascal-app/core'

const QUICK_MEASUREMENT_QUERY_INTERVAL_MS = 30
const QUICK_MEASUREMENT_MIN_DISTANCE_SQ = 1

export function createQuickMeasurementPointerScheduler(
  onPointerMove: (event: PointerEvent) => void,
  frameDriver: {
    request: (callback: FrameRequestCallback) => number
    cancel: (frameId: number) => void
  } = {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (frameId) => cancelAnimationFrame(frameId),
  },
): {
  enqueue: (event: PointerEvent) => void
  clear: () => void
} {
  let latestEvent: PointerEvent | null = null
  let frameId: number | null = null
  let lastProcessedAt = Number.NEGATIVE_INFINITY
  let lastClientX = Number.NaN
  let lastClientY = Number.NaN

  const schedule = () => {
    if (frameId === null) frameId = frameDriver.request(flush)
  }
  const flush = (timestamp: number) => {
    frameId = null
    if (!latestEvent) return
    if (timestamp - lastProcessedAt < QUICK_MEASUREMENT_QUERY_INTERVAL_MS) {
      schedule()
      return
    }

    const event = latestEvent
    latestEvent = null
    const deltaX = event.clientX - lastClientX
    const deltaY = event.clientY - lastClientY
    if (
      Number.isFinite(lastClientX) &&
      deltaX * deltaX + deltaY * deltaY < QUICK_MEASUREMENT_MIN_DISTANCE_SQ
    ) {
      return
    }

    lastClientX = event.clientX
    lastClientY = event.clientY
    lastProcessedAt = timestamp
    onPointerMove(event)
    if (latestEvent) schedule()
  }

  return {
    enqueue: (event) => {
      latestEvent = event
      schedule()
    },
    clear: () => {
      if (frameId !== null) frameDriver.cancel(frameId)
      latestEvent = null
      frameId = null
      lastProcessedAt = Number.NEGATIVE_INFINITY
      lastClientX = Number.NaN
      lastClientY = Number.NaN
    },
  }
}

export function quickMeasurementContext(
  node: AnyNode,
  nodes: Record<AnyNodeId, AnyNode>,
): GeometryContext {
  const resolve: GeometryContext['resolve'] = <N = AnyNode>(id: AnyNodeId) =>
    nodes[id] as N | undefined
  const childIds =
    'children' in node && Array.isArray(node.children) ? (node.children as AnyNodeId[]) : []
  const children = childIds
    .map((id) => nodes[id])
    .filter((child): child is AnyNode => child !== undefined)
  const parent = node.parentId ? (nodes[node.parentId as AnyNodeId] ?? null) : null
  const siblings =
    parent && 'children' in parent && Array.isArray(parent.children)
      ? (parent.children as AnyNodeId[])
          .map((id) => nodes[id])
          .filter(
            (sibling): sibling is AnyNode => sibling !== undefined && sibling.type === node.type,
          )
      : []

  return { resolve, children, parent, siblings }
}

export function resolveQuickMeasurementReport(
  nodeId: string | null,
  nodes: Record<AnyNodeId, AnyNode>,
): QuickMeasurementReport | null {
  if (!nodeId) return null
  const node = nodes[nodeId as AnyNodeId]
  if (!node || node.visible === false) return null
  const quickMeasure = nodeRegistry.get(node.type)?.measurement?.quickMeasure
  return quickMeasure ? quickMeasure(node, quickMeasurementContext(node, nodes)) : null
}
