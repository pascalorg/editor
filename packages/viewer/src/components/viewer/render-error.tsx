import type { ReactNode } from 'react'
import { ErrorBoundary } from '../error-boundary'

type RenderErrorHandler = ((cause: unknown) => void) | undefined

/**
 * One handler that notifies every given handler (the immersive session's and
 * the host's), or undefined when there is none. A handler that throws is
 * logged and does not stop the others.
 */
export function composeRenderErrorHandlers(...handlers: RenderErrorHandler[]): RenderErrorHandler {
  const present = handlers.filter((handler) => handler !== undefined)
  if (present.length === 0) return
  return (cause) => {
    for (const handler of present) {
      try {
        handler(cause)
      } catch (error) {
        console.error('[viewer] a render-error handler threw', error)
      }
    }
  }
}

/**
 * The viewer-scene error boundary: a node renderer or system that throws while
 * rendering renders nothing in its place, and every handler hears about it.
 */
export function SceneErrorBoundary({
  handlers,
  children,
}: {
  handlers: RenderErrorHandler[]
  children: ReactNode
}) {
  return (
    <ErrorBoundary
      fallback={null}
      onError={composeRenderErrorHandlers(...handlers)}
      scope="viewer-scene"
    >
      {children}
    </ErrorBoundary>
  )
}
