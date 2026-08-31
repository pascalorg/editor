import { DefaultLoadingManager, Group, LoadingManager } from 'three'
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const ITEM_ASSET_UNAVAILABLE_KEY = 'pascalItemAssetUnavailable'
const DEFAULT_RETRY_DELAYS_MS = [1_000, 3_000] as const
const itemLoadGenerations = new Map<string, number>()

type HttpErrorLike = Error & {
  response?: { status?: number }
}

export type ItemAssetUnavailable = {
  message: string
  url: string
}

export type ItemModelLoadFailureKind = 'retryable' | 'unavailable' | 'unexpected'

export function classifyItemModelLoadFailure(error: unknown): ItemModelLoadFailureKind {
  if (!(error instanceof Error)) return 'unexpected'

  const status = (error as HttpErrorLike).response?.status
  if (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (status !== undefined && status >= 500)
  ) {
    return 'retryable'
  }
  if (status !== undefined && status >= 400 && status < 500) return 'unavailable'
  if (error instanceof TypeError && /failed to fetch/i.test(error.message)) return 'retryable'

  return 'unexpected'
}

export function createUnavailableItemGltf(url: string, error: unknown): GLTF {
  const unavailable: ItemAssetUnavailable = {
    message: error instanceof Error ? error.message : String(error),
    url,
  }
  const scene = new Group()
  scene.userData[ITEM_ASSET_UNAVAILABLE_KEY] = unavailable

  return {
    animations: [],
    asset: { version: '2.0' },
    cameras: [],
    parser: null as never,
    scene,
    scenes: [scene],
    userData: { [ITEM_ASSET_UNAVAILABLE_KEY]: unavailable },
  }
}

export function getUnavailableItemAsset(gltf: GLTF): ItemAssetUnavailable | null {
  const value = gltf.userData?.[ITEM_ASSET_UNAVAILABLE_KEY]
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ItemAssetUnavailable>
  return typeof candidate.url === 'string' && typeof candidate.message === 'string'
    ? { url: candidate.url, message: candidate.message }
    : null
}

export function cancelItemModelLoad(url: string) {
  itemLoadGenerations.set(url, (itemLoadGenerations.get(url) ?? 0) + 1)
}

export class ItemGLTFLoader extends GLTFLoader {
  readonly hostManager: LoadingManager
  readonly retryDelaysMs: readonly number[]

  constructor(manager?: LoadingManager, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS) {
    super(new LoadingManager())
    this.hostManager = manager ?? DefaultLoadingManager
    this.retryDelaysMs = retryDelaysMs
  }

  override load(
    url: string,
    onLoad: (gltf: GLTF) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): void {
    const generation = itemLoadGenerations.get(url) ?? 0
    let retryCount = 0
    let finished = false

    const wasCancelled = () => (itemLoadGenerations.get(url) ?? 0) !== generation

    const cancel = () => {
      if (finished) return
      finished = true
      this.hostManager.itemEnd(url)
    }

    const complete = (gltf: GLTF) => {
      if (finished) return
      if (wasCancelled()) {
        cancel()
        return
      }
      finished = true
      try {
        onLoad(gltf)
      } finally {
        this.hostManager.itemEnd(url)
      }
    }

    const fail = (error: unknown) => {
      if (finished) return
      if (wasCancelled()) {
        cancel()
        return
      }
      finished = true
      try {
        if (onError) onError(error)
        else console.error(error)
      } finally {
        this.hostManager.itemError(url)
        this.hostManager.itemEnd(url)
      }
    }

    const attempt = () => {
      if (wasCancelled()) {
        cancel()
        return
      }
      super.load(url, complete, onProgress, (error) => {
        if (wasCancelled()) {
          cancel()
          return
        }
        const kind = classifyItemModelLoadFailure(error)
        if (kind === 'unexpected') {
          fail(error)
          return
        }
        if (kind === 'unavailable' || retryCount >= this.retryDelaysMs.length) {
          complete(createUnavailableItemGltf(url, error))
          return
        }

        const delay = this.retryDelaysMs[retryCount] ?? 0
        retryCount += 1
        setTimeout(attempt, delay)
      })
    }

    this.hostManager.itemStart(url)
    attempt()
  }
}
