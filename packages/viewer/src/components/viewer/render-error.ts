type RenderErrorHandler = ((cause: unknown) => void) | undefined

/**
 * One handler for the viewer-scene error boundary that notifies every given
 * handler (the immersive session's and the host's), or undefined when none.
 */
export function composeRenderErrorHandlers(...handlers: RenderErrorHandler[]): RenderErrorHandler {
  const present = handlers.filter((handler) => handler !== undefined)
  if (present.length === 0) return
  return (cause) => {
    for (const handler of present) handler(cause)
  }
}
