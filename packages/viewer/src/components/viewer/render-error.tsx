import type { ReactNode } from 'react'
import { ErrorBoundary } from '../error-boundary'

type RenderErrorHandler = ((cause: unknown) => void) | undefined

/** Baseline: only the first handler is used. */
export function composeRenderErrorHandlers(
  first: RenderErrorHandler,
  _second?: RenderErrorHandler,
): RenderErrorHandler {
  return first
}

/** Baseline: the viewer-scene boundary with the first handler only. */
export function SceneErrorBoundary({
  handlers,
  children,
}: {
  handlers: RenderErrorHandler[]
  children: ReactNode
}) {
  return (
    <ErrorBoundary fallback={null} onError={handlers[0]} scope="viewer-scene">
      {children}
    </ErrorBoundary>
  )
}
