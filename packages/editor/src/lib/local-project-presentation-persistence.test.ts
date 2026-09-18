import { describe, expect, test } from 'bun:test'
import type {
  ViewerPresentationConfiguration,
  ViewerPresentationContribution,
} from '@pascal-app/viewer'
import {
  createLocalProjectPresentationPersistence,
  getLocalProjectPresentationStorageKey,
} from './local-project-presentation-persistence'

const CONTRIBUTION_ID = 'test:environment:presentation'

type TestSnapshot = {
  version: 1
  value: string
}

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

class TestConfiguration implements ViewerPresentationConfiguration {
  private readonly listeners = new Set<() => void>()
  value = 'default'

  getSnapshot = (): TestSnapshot => ({ version: 1, value: this.value })

  restore = (snapshot: unknown): void => {
    if (
      typeof snapshot !== 'object' ||
      snapshot === null ||
      !('version' in snapshot) ||
      snapshot.version !== 1 ||
      !('value' in snapshot) ||
      typeof snapshot.value !== 'string'
    ) {
      throw new Error('Invalid test presentation snapshot')
    }
    this.value = snapshot.value
  }

  reset = (): void => {
    this.value = 'default'
  }

  subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange)
    return () => this.listeners.delete(onChange)
  }

  setValue(value: string): void {
    this.value = value
    for (const listener of this.listeners) listener()
  }
}

class TestRegistry {
  private readonly listeners = new Set<() => void>()
  private contributions: ViewerPresentationContribution[] = []

  getSnapshot = (): readonly ViewerPresentationContribution[] => this.contributions

  subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange)
    return () => this.listeners.delete(onChange)
  }

  register(configuration: ViewerPresentationConfiguration): void {
    this.contributions = [
      {
        id: CONTRIBUTION_ID,
        component: async () => ({ default: () => null }),
        configuration,
      },
    ]
    for (const listener of this.listeners) listener()
  }

  uninstall(): void {
    this.contributions = []
    for (const listener of this.listeners) listener()
  }
}

function readStoredValue(storage: MemoryStorage, projectId: string): string {
  const raw = storage.getItem(getLocalProjectPresentationStorageKey(projectId))
  if (!raw) throw new Error(`Missing presentation sidecar for ${projectId}`)
  const sidecar = JSON.parse(raw) as {
    contributions: Record<string, TestSnapshot>
  }
  const snapshot = sidecar.contributions[CONTRIBUTION_ID]
  if (!snapshot) throw new Error(`Missing ${CONTRIBUTION_ID} snapshot`)
  return snapshot.value
}

describe('local project presentation persistence', () => {
  test('persists anonymous settings when assigning a new first project id', () => {
    const storage = new MemoryStorage()
    const registry = new TestRegistry()
    const configuration = new TestConfiguration()
    registry.register(configuration)
    const persistence = createLocalProjectPresentationPersistence({
      registry,
      storage,
      pageHideTarget: null,
      flushDelayMs: 60_000,
    })

    persistence.switchProject(null)
    configuration.setValue('anonymous atmosphere')
    persistence.switchProject('first-project')

    expect(configuration.value).toBe('anonymous atmosphere')
    persistence.flush()
    expect(readStoredValue(storage, 'first-project')).toBe('anonymous atmosphere')
    persistence.dispose()

    const reloadedRegistry = new TestRegistry()
    const reloadedConfiguration = new TestConfiguration()
    reloadedRegistry.register(reloadedConfiguration)
    const reloadedPersistence = createLocalProjectPresentationPersistence({
      registry: reloadedRegistry,
      storage,
      pageHideTarget: null,
    })
    reloadedPersistence.switchProject('first-project')

    expect(reloadedConfiguration.value).toBe('anonymous atmosphere')
    reloadedPersistence.dispose()
  })

  test('restores a stored project instead of overwriting it with anonymous settings', () => {
    const storage = new MemoryStorage()
    const storedRegistry = new TestRegistry()
    const storedConfiguration = new TestConfiguration()
    storedRegistry.register(storedConfiguration)
    const storedPersistence = createLocalProjectPresentationPersistence({
      registry: storedRegistry,
      storage,
      pageHideTarget: null,
      flushDelayMs: 60_000,
    })
    storedPersistence.switchProject('existing-project')
    storedConfiguration.setValue('stored atmosphere')
    storedPersistence.flush()
    storedPersistence.dispose()

    const registry = new TestRegistry()
    const configuration = new TestConfiguration()
    registry.register(configuration)
    const persistence = createLocalProjectPresentationPersistence({
      registry,
      storage,
      pageHideTarget: null,
      flushDelayMs: 60_000,
    })
    persistence.switchProject(null)
    configuration.setValue('anonymous atmosphere')
    persistence.switchProject('existing-project')

    expect(configuration.value).toBe('stored atmosphere')
    persistence.flush()
    expect(readStoredValue(storage, 'existing-project')).toBe('stored atmosphere')
    persistence.dispose()
  })

  test('flushes the old project before restoring defaults or the next project', () => {
    const storage = new MemoryStorage()
    const registry = new TestRegistry()
    const configuration = new TestConfiguration()
    registry.register(configuration)
    const persistence = createLocalProjectPresentationPersistence({
      registry,
      storage,
      pageHideTarget: null,
      flushDelayMs: 60_000,
    })

    persistence.switchProject('project-a')
    configuration.setValue('project A atmosphere')
    persistence.switchProject('project-b')

    expect(readStoredValue(storage, 'project-a')).toBe('project A atmosphere')
    expect(configuration.value).toBe('default')

    configuration.setValue('project B atmosphere')
    persistence.switchProject('project-a')

    expect(readStoredValue(storage, 'project-b')).toBe('project B atmosphere')
    expect(configuration.value).toBe('project A atmosphere')
    persistence.dispose()
  })

  test('restores a project after reload and flushes pending changes on dispose', () => {
    const storage = new MemoryStorage()
    const firstRegistry = new TestRegistry()
    const firstConfiguration = new TestConfiguration()
    firstRegistry.register(firstConfiguration)
    const firstPersistence = createLocalProjectPresentationPersistence({
      registry: firstRegistry,
      storage,
      pageHideTarget: null,
      flushDelayMs: 60_000,
    })

    firstPersistence.switchProject('reloadable')
    firstConfiguration.setValue('saved sky')
    firstPersistence.dispose()

    const reloadedRegistry = new TestRegistry()
    const reloadedConfiguration = new TestConfiguration()
    reloadedRegistry.register(reloadedConfiguration)
    const reloadedPersistence = createLocalProjectPresentationPersistence({
      registry: reloadedRegistry,
      storage,
      pageHideTarget: null,
    })
    reloadedPersistence.switchProject('reloadable')

    expect(reloadedConfiguration.value).toBe('saved sky')
    reloadedPersistence.dispose()
  })

  test('recovers corrupted presentation data without touching scene storage', () => {
    const storage = new MemoryStorage()
    const sceneStorageKey = 'pascal-editor-scene'
    const sceneData = '{"nodes":{"site":{"type":"site"}}}'
    storage.setItem(sceneStorageKey, sceneData)
    storage.setItem(getLocalProjectPresentationStorageKey('corrupted'), '{not-json')

    const registry = new TestRegistry()
    const configuration = new TestConfiguration()
    configuration.value = 'leaked from another project'
    registry.register(configuration)
    const persistence = createLocalProjectPresentationPersistence({
      registry,
      storage,
      pageHideTarget: null,
      flushDelayMs: 60_000,
    })

    persistence.switchProject('corrupted')
    expect(configuration.value).toBe('default')
    persistence.flush()

    expect(readStoredValue(storage, 'corrupted')).toBe('default')
    expect(storage.getItem(sceneStorageKey)).toBe(sceneData)
    persistence.dispose()
  })

  test('retains configuration while a contribution is unregistered and registered again', () => {
    const storage = new MemoryStorage()
    const registry = new TestRegistry()
    const firstConfiguration = new TestConfiguration()
    registry.register(firstConfiguration)
    const persistence = createLocalProjectPresentationPersistence({
      registry,
      storage,
      pageHideTarget: null,
      flushDelayMs: 60_000,
    })

    persistence.switchProject('plugin-cycle')
    firstConfiguration.setValue('retained atmosphere')
    registry.uninstall()

    const reinstalledConfiguration = new TestConfiguration()
    registry.register(reinstalledConfiguration)

    expect(reinstalledConfiguration.value).toBe('retained atmosphere')
    persistence.dispose()
  })

  test('flushes pending changes on pagehide', () => {
    const storage = new MemoryStorage()
    const registry = new TestRegistry()
    const configuration = new TestConfiguration()
    const pageHideTarget = new EventTarget()
    registry.register(configuration)
    const persistence = createLocalProjectPresentationPersistence({
      registry,
      storage,
      pageHideTarget,
      flushDelayMs: 60_000,
    })

    persistence.switchProject('pagehide')
    configuration.setValue('last slider value')
    pageHideTarget.dispatchEvent(new Event('pagehide'))

    expect(readStoredValue(storage, 'pagehide')).toBe('last slider value')
    persistence.dispose()
  })
})
