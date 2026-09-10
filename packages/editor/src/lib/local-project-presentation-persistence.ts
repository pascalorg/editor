'use client'

import { type ViewerPresentationContribution, viewerPresentationRegistry } from '@pascal-app/viewer'
import { z } from 'zod'

export const LOCAL_PROJECT_PRESENTATION_STORAGE_KEY_PREFIX = 'pascal:project-presentation:v1:'
const LOCAL_PROJECT_PRESENTATION_VERSION = 1 as const
const DEFAULT_FLUSH_DELAY_MS = 250

type PresentationConfiguration = NonNullable<ViewerPresentationContribution['configuration']>

type PresentationRegistry = {
  getSnapshot: () => readonly ViewerPresentationContribution[]
  subscribe: (onChange: () => void) => () => void
}

type PresentationStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

type PageHideTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>

const LocalProjectPresentationSidecarSchema = z
  .object({
    version: z.literal(LOCAL_PROJECT_PRESENTATION_VERSION),
    projectId: z.string(),
    contributions: z.record(z.string(), z.unknown()),
  })
  .strict()
type LocalProjectPresentationSidecar = z.infer<typeof LocalProjectPresentationSidecarSchema>

type StoredSidecar = {
  contributions: Record<string, unknown>
  malformed: boolean
}

export type LocalProjectPresentationPersistence = {
  switchProject: (projectId: string | null) => void
  flush: () => void
  dispose: () => void
}

export type LocalProjectPresentationPersistenceOptions = {
  registry?: PresentationRegistry
  storage?: PresentationStorage | null
  pageHideTarget?: PageHideTarget | null
  flushDelayMs?: number
}

export function getLocalProjectPresentationStorageKey(projectId: string): string {
  return `${LOCAL_PROJECT_PRESENTATION_STORAGE_KEY_PREFIX}${encodeURIComponent(projectId)}`
}

function emptyContributions(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>
}

function getBrowserStorage(): PresentationStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readSidecar(storage: PresentationStorage | null, projectId: string): StoredSidecar {
  if (!storage) return { contributions: emptyContributions(), malformed: false }

  let raw: string | null
  try {
    raw = storage.getItem(getLocalProjectPresentationStorageKey(projectId))
  } catch {
    return { contributions: emptyContributions(), malformed: false }
  }
  if (raw === null) return { contributions: emptyContributions(), malformed: false }

  try {
    const parsed = LocalProjectPresentationSidecarSchema.safeParse(JSON.parse(raw))
    if (!parsed.success || parsed.data.projectId !== projectId) {
      return { contributions: emptyContributions(), malformed: true }
    }
    return {
      contributions: Object.assign(emptyContributions(), parsed.data.contributions),
      malformed: false,
    }
  } catch {
    return { contributions: emptyContributions(), malformed: true }
  }
}

class LocalProjectPresentationPersistenceImpl implements LocalProjectPresentationPersistence {
  private projectId: string | null = null
  private projectInitialized = false
  private contributions = emptyContributions()
  private readonly configurations = new Map<
    string,
    { configuration: PresentationConfiguration; unsubscribe: () => void }
  >()
  private readonly initializedConfigurationIds = new Set<string>()
  private readonly registry: PresentationRegistry
  private readonly storage: PresentationStorage | null
  private readonly pageHideTarget: PageHideTarget | null
  private readonly flushDelayMs: number
  private readonly unsubscribeRegistry: () => void
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private dirty = false
  private suppressWrites = false
  private disposed = false

  constructor(options: LocalProjectPresentationPersistenceOptions) {
    this.registry = options.registry ?? viewerPresentationRegistry
    this.storage = options.storage === undefined ? getBrowserStorage() : options.storage
    this.pageHideTarget =
      options.pageHideTarget === undefined
        ? typeof window === 'undefined'
          ? null
          : window
        : options.pageHideTarget
    this.flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS
    this.unsubscribeRegistry = this.registry.subscribe(this.reconcileRegistry)
    this.pageHideTarget?.addEventListener('pagehide', this.flushOnPageHide)
    this.reconcileRegistry()
  }

  switchProject(projectId: string | null): void {
    const nextProjectId = projectId && projectId.length > 0 ? projectId : null
    if (this.projectInitialized && nextProjectId === this.projectId) return

    this.flush()
    this.projectId = nextProjectId
    this.projectInitialized = true
    this.initializedConfigurationIds.clear()

    const stored = nextProjectId
      ? readSidecar(this.storage, nextProjectId)
      : { contributions: emptyContributions(), malformed: false }
    this.contributions = stored.contributions

    let recoveredInvalidConfiguration = stored.malformed
    for (const [id, entry] of this.configurations) {
      if (!this.restoreConfiguration(id, entry.configuration)) {
        recoveredInvalidConfiguration = true
      }
    }

    if (recoveredInvalidConfiguration) this.markDirty()
  }

  flush = (): void => {
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    const projectId = this.projectId
    if (!this.dirty || !projectId || !this.storage) return

    const contributions = Object.assign(emptyContributions(), this.contributions)
    for (const [id, entry] of this.configurations) {
      if (!this.initializedConfigurationIds.has(id)) continue
      try {
        contributions[id] = entry.configuration.getSnapshot()
      } catch {
        // Retain the last valid snapshot when one contribution cannot export.
      }
    }

    const sidecar: LocalProjectPresentationSidecar = {
      version: LOCAL_PROJECT_PRESENTATION_VERSION,
      projectId,
      contributions,
    }
    try {
      this.storage.setItem(
        getLocalProjectPresentationStorageKey(projectId),
        JSON.stringify(sidecar),
      )
      this.contributions = contributions
      this.dirty = false
    } catch {
      // Storage denial, quota exhaustion, and non-serializable plugin data are non-fatal.
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.flush()
    this.unsubscribeRegistry()
    this.pageHideTarget?.removeEventListener('pagehide', this.flushOnPageHide)
    for (const entry of this.configurations.values()) entry.unsubscribe()
    this.configurations.clear()
    this.initializedConfigurationIds.clear()
  }

  private readonly flushOnPageHide = (): void => {
    this.flush()
  }

  private readonly reconcileRegistry = (): void => {
    if (this.disposed) return

    const current = new Map<string, PresentationConfiguration>()
    for (const contribution of this.registry.getSnapshot()) {
      if (contribution.configuration) {
        current.set(contribution.id, contribution.configuration)
      }
    }

    for (const [id, entry] of this.configurations) {
      if (current.get(id) === entry.configuration) continue
      if (this.initializedConfigurationIds.has(id)) {
        this.captureConfiguration(id, entry.configuration)
      }
      entry.unsubscribe()
      this.configurations.delete(id)
      this.initializedConfigurationIds.delete(id)
    }

    for (const [id, configuration] of current) {
      if (this.configurations.has(id)) continue

      let unsubscribe: () => void = () => undefined
      try {
        unsubscribe = configuration.subscribe(() => {
          if (!this.suppressWrites) this.markDirty()
        })
      } catch {
        // A broken optional adapter must not affect the editor or other contributions.
      }
      this.configurations.set(id, { configuration, unsubscribe })

      if (this.projectInitialized && !this.restoreConfiguration(id, configuration)) {
        this.markDirty()
      }
    }
  }

  private restoreConfiguration(id: string, configuration: PresentationConfiguration): boolean {
    let valid = true
    this.suppressWrites = true
    try {
      if (Object.hasOwn(this.contributions, id)) {
        try {
          configuration.restore(this.contributions[id])
        } catch {
          valid = false
          delete this.contributions[id]
          try {
            configuration.reset()
          } catch {}
        }
      } else {
        try {
          configuration.reset()
        } catch {}
      }
    } finally {
      this.suppressWrites = false
      this.initializedConfigurationIds.add(id)
    }
    return valid
  }

  private captureConfiguration(id: string, configuration: PresentationConfiguration): void {
    try {
      this.contributions[id] = configuration.getSnapshot()
      this.markDirty()
    } catch {
      // Preserve the prior snapshot if the retiring adapter cannot export.
    }
  }

  private markDirty(): void {
    if (!this.projectId || this.suppressWrites || this.disposed) return
    this.dirty = true
    if (this.flushTimer !== undefined) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(this.flush, this.flushDelayMs)
  }
}

export function createLocalProjectPresentationPersistence(
  options: LocalProjectPresentationPersistenceOptions = {},
): LocalProjectPresentationPersistence {
  return new LocalProjectPresentationPersistenceImpl(options)
}
