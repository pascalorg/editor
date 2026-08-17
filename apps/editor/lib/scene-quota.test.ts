import { describe, expect, test } from 'bun:test'
import type { SceneMeta } from '@pascal-app/mcp/storage'
import {
  DEFAULT_SCENE_QUOTAS,
  evaluateSceneQuota,
  measureSceneUsage,
  resolveSceneQuotas,
  sceneBytes,
  tierForActor,
} from './scene-quota'

const meta = (overrides: Partial<SceneMeta> = {}): SceneMeta => ({
  id: 'scene_x',
  name: 'x',
  projectId: null,
  thumbnailUrl: null,
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ownerId: null,
  sizeBytes: 1024,
  nodeCount: 1,
  ...overrides,
})

describe('tierForActor', () => {
  test('verified users are free', () => {
    expect(tierForActor({ type: 'user', userId: 'u', isAnonymous: false })).toBe('free')
  })
  test('anonymous accounts and sessions are guests', () => {
    expect(tierForActor({ type: 'user', userId: 'u', isAnonymous: true })).toBe('guest')
    expect(tierForActor({ type: 'anon' })).toBe('guest')
  })
})

describe('measureSceneUsage', () => {
  test('sums sizeBytes and counts scenes', () => {
    expect(measureSceneUsage([meta({ sizeBytes: 100 }), meta({ sizeBytes: 250 })])).toEqual({
      sceneCount: 2,
      totalBytes: 350,
    })
  })
  test('treats a missing size as zero', () => {
    expect(measureSceneUsage([meta({ sizeBytes: undefined as never })]).totalBytes).toBe(0)
  })
})

describe('evaluateSceneQuota', () => {
  const limits = DEFAULT_SCENE_QUOTAS.guest

  test('allows a scene that fits', () => {
    expect(evaluateSceneQuota(limits, { sceneCount: 0, totalBytes: 0 }, 100, true)).toBeNull()
  })

  test('rejects a new scene at the count limit', () => {
    expect(evaluateSceneQuota(limits, { sceneCount: 2, totalBytes: 0 }, 100, true)).toEqual({
      code: 'scene_count',
      limit: 2,
      current: 2,
    })
  })

  test('does not count existing scenes against an update', () => {
    expect(evaluateSceneQuota(limits, { sceneCount: 2, totalBytes: 0 }, 100, false)).toBeNull()
  })

  test('rejects an oversized single scene', () => {
    expect(
      evaluateSceneQuota(limits, { sceneCount: 0, totalBytes: 0 }, 6 * 1024 * 1024, true),
    ).toEqual({ code: 'scene_bytes', limit: 5 * 1024 * 1024, incoming: 6 * 1024 * 1024 })
  })

  test('rejects when the running storage total would exceed the cap', () => {
    const usage = { sceneCount: 0, totalBytes: 19 * 1024 * 1024 }
    expect(evaluateSceneQuota(limits, usage, 2 * 1024 * 1024, true)?.code).toBe('total_bytes')
  })
})

describe('resolveSceneQuotas', () => {
  test('returns defaults with no env', () => {
    expect(resolveSceneQuotas({})).toEqual(DEFAULT_SCENE_QUOTAS)
  })

  test('overrides a limit from env and ignores invalid values', () => {
    const quotas = resolveSceneQuotas({
      PASCAL_QUOTA_GUEST_MAX_SCENES: '5',
      PASCAL_QUOTA_GUEST_MAX_SCENE_BYTES: 'not-a-number',
    })
    expect(quotas.guest.maxScenes).toBe(5)
    expect(quotas.guest.maxSceneBytes).toBe(DEFAULT_SCENE_QUOTAS.guest.maxSceneBytes)
  })
})

describe('sceneBytes', () => {
  test('measures the serialized graph length', () => {
    expect(sceneBytes({ nodes: { a: { type: 'level' } }, rootNodeIds: ['a'] })).toBe(
      Buffer.byteLength(JSON.stringify({ nodes: { a: { type: 'level' } }, rootNodeIds: ['a'] })),
    )
  })
})
