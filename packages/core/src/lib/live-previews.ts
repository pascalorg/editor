let hidden = 0

/**
 * Whether the editor's live previews (field overrides, drag transforms, an in-flight terrain
 * stroke) are part of what is being read. They are not inside `withoutLivePreviews`: a detached
 * scene, and the document reconciliation, compute from saved state only, since a preview is
 * neither a dependency anyone can check nor a value that will necessarily be committed.
 */
export function livePreviewsVisible(): boolean {
  return hidden === 0
}

export function withoutLivePreviews<T>(run: () => T): T {
  hidden += 1
  try {
    return run()
  } finally {
    hidden -= 1
  }
}
