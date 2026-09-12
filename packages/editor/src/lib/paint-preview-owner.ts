export type PaintPreviewCleanup = (() => void) & { commit?: () => void }

type Interaction = {
  key: string
  apply: (() => void) | null
  preview: (() => PaintPreviewCleanup | null) | null
}

export function combinePaintPreviews(previews: PaintPreviewCleanup[]): PaintPreviewCleanup {
  const finish = (committed: boolean) => {
    const pending = previews.splice(0).reverse()
    let failure: unknown
    for (const cleanup of pending) {
      try {
        if (committed) cleanup.commit?.()
        else cleanup()
      } catch (error) {
        failure ??= error
      }
    }
    if (failure) throw failure
  }
  return Object.assign(() => finish(false), { commit: () => finish(true) })
}

export function createPaintPreviewOwner() {
  let active: { key: string; cleanup: PaintPreviewCleanup } | null = null
  const end = (committed = false) => {
    const previous = active
    active = null
    if (committed) previous?.cleanup.commit?.()
    else previous?.cleanup()
  }
  return {
    wrap<T extends Interaction>(interaction: T | null): T | null {
      if (!interaction) return null
      return {
        ...interaction,
        preview: interaction.preview
          ? () => {
              end()
              const cleanup = interaction.preview!()
              if (!cleanup) return null
              const owned = { key: interaction.key, cleanup }
              active = owned
              return () => {
                if (active === owned) end()
              }
            }
          : null,
        apply: interaction.apply
          ? () => {
              if (active && active.key !== interaction.key) end()
              try {
                interaction.apply!()
              } catch (error) {
                // A subscriber can throw after the scene write has already been published.
                try {
                  end(true)
                } catch {
                  // Preserve the apply error even if a hold listener also throws.
                }
                throw error
              }
              end(true)
            }
          : null,
      }
    },
  }
}
