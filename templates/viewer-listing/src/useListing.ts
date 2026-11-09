import { useCallback, useEffect, useState } from 'react'
import { fetchGlb, getScene, PascalError, type SceneResponse } from './pascal'

export type ListingState =
  | { kind: 'loading' }
  | { kind: 'error'; error: PascalError }
  /** The project is readable but its 3D file is not ready (`bake.status` other than ready). */
  | { kind: 'no-file'; scene: SceneResponse }
  | { kind: 'downloading'; scene: SceneResponse; progress: number | null }
  | { kind: 'ready'; scene: SceneResponse; bytes: ArrayBuffer }

/** While a 3D file is being prepared, look again this often. */
const BAKING_POLL_MS = 30_000

function asPascalError(error: unknown): PascalError {
  return error instanceof PascalError ? error : new PascalError('http', String(error))
}

/** Reads the project, then downloads its best 3D file. `reload` starts over. */
export function useListing(baseUrl: string, projectId: string) {
  const [state, setState] = useState<ListingState>({ kind: 'loading' })
  // A quiet attempt (the baking poll) keeps the current screen instead of flashing a loader.
  const [attempt, setAttempt] = useState({ quiet: false })
  const reload = useCallback(() => setAttempt({ quiet: false }), [])

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    let poll: ReturnType<typeof setTimeout> | undefined
    if (!attempt.quiet) setState({ kind: 'loading' })

    const run = async () => {
      const scene = await getScene(baseUrl, projectId, { signal })
      if (scene.bake.status !== 'ready' || scene.bake.lods.length === 0) {
        setState({ kind: 'no-file', scene })
        if (scene.bake.status === 'baking') {
          poll = setTimeout(() => setAttempt({ quiet: true }), BAKING_POLL_MS)
        }
        return
      }
      setState({ kind: 'downloading', scene, progress: null })
      const glb = await fetchGlb(baseUrl, projectId, scene, {
        signal,
        onProgress: (loaded, total) =>
          setState({
            kind: 'downloading',
            scene,
            progress: total ? Math.min(1, loaded / total) : null,
          }),
      })
      setState({ kind: 'ready', scene: glb.scene, bytes: glb.bytes })
    }

    run().catch((error) => {
      if (!signal.aborted) setState({ kind: 'error', error: asPascalError(error) })
    })
    return () => {
      controller.abort()
      clearTimeout(poll)
    }
  }, [baseUrl, projectId, attempt])

  return { state, reload }
}
