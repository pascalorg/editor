type RenderErrorHandler = ((cause: unknown) => void) | undefined

/** Baseline: only the first handler is used. */
export function composeRenderErrorHandlers(
  first: RenderErrorHandler,
  _second: RenderErrorHandler,
): RenderErrorHandler {
  return first
}
