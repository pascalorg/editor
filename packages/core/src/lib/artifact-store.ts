/**
 * Content-addressed geometry artifacts. Nodes reference an artifact as
 * `artifact://<sha256>` and never by URL, so where the bytes live is the
 * host's choice: the hosted app stores them per project behind an access
 * check; the default keeps them in memory for the session.
 */

export const ARTIFACT_URL_PREFIX = 'artifact://'

export type ArtifactStore = {
  /** A loadable URL for a stored artifact, or null when this store does not have it. */
  url: (sha256: string) => string | null
  /** Stores the bytes under their hash; resolves once `url` returns a URL for it. */
  put: (sha256: string, bytes: ArrayBuffer | Uint8Array, mimeType: string) => Promise<void>
  /** A stored text artifact (an authored object's script), or null when it is missing or unreadable here. */
  text: (sha256: string) => Promise<string | null>
  /**
   * Brings artifacts another project holds into this store's project (a paste
   * from that project), under the reader's access there. Resolves to the
   * hashes it could not bring. Absent where artifacts are not kept per project.
   */
  copyFrom?: (projectId: string, sha256s: string[]) => Promise<string[]>
}

const memory = new Map<string, { url: string; bytes: ArrayBuffer | Uint8Array }>()

const memoryStore: ArtifactStore = {
  url: (sha256) => memory.get(sha256)?.url ?? null,
  put: async (sha256, bytes, mimeType) => {
    if (memory.has(sha256)) return
    memory.set(sha256, {
      url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType })),
      bytes,
    })
  },
  text: async (sha256) => {
    const stored = memory.get(sha256)
    return stored ? new TextDecoder().decode(stored.bytes) : null
  },
}

let store: ArtifactStore = memoryStore

export function configureArtifactStore(next: ArtifactStore | null): void {
  store = next ?? memoryStore
}

export function getArtifactStore(): ArtifactStore {
  return store
}

export const artifactUrl = (sha256: string) => `${ARTIFACT_URL_PREFIX}${sha256}`

export function artifactHash(url: string): string | null {
  if (!url.startsWith(ARTIFACT_URL_PREFIX)) return null
  const sha = url.slice(ARTIFACT_URL_PREFIX.length)
  return /^[0-9a-f]{64}$/.test(sha) ? sha : null
}

export function resolveArtifactUrl(url: string): string | null {
  const sha = artifactHash(url)
  return sha ? store.url(sha) : null
}
