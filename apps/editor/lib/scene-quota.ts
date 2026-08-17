import type { SceneMeta } from '@pascal-app/mcp/storage'
import type { Actor } from './scene-api-security'

/**
 * Per-tier resource limits for the scene write path. The limits are
 * env-configurable so an operator can retune them without a code change; the
 * values here are only the defaults.
 *
 * Guests are anonymous sessions and unverified accounts; "free" is a verified
 * account. There is no paid tier yet — the table is written so adding one is a
 * new key plus its env override, not a code change.
 */
export interface SceneQuotaLimits {
  /** Maximum number of scenes the actor may own. */
  maxScenes: number
  /** Maximum total stored bytes across the actor's scenes. */
  maxTotalBytes: number
  /** Maximum size of a single scene, in bytes. */
  maxSceneBytes: number
}

export type SceneQuotaTier = 'guest' | 'free'

export type SceneQuotaTable = Record<SceneQuotaTier, SceneQuotaLimits>

const MB = 1024 * 1024

export const DEFAULT_SCENE_QUOTAS: SceneQuotaTable = {
  guest: { maxScenes: 2, maxTotalBytes: 20 * MB, maxSceneBytes: 5 * MB },
  free: { maxScenes: 25, maxTotalBytes: 500 * MB, maxSceneBytes: 10 * MB },
}

const ENV_KEYS: Record<SceneQuotaTier, Record<keyof SceneQuotaLimits, string>> = {
  guest: {
    maxScenes: 'PASCAL_QUOTA_GUEST_MAX_SCENES',
    maxTotalBytes: 'PASCAL_QUOTA_GUEST_MAX_TOTAL_BYTES',
    maxSceneBytes: 'PASCAL_QUOTA_GUEST_MAX_SCENE_BYTES',
  },
  free: {
    maxScenes: 'PASCAL_QUOTA_FREE_MAX_SCENES',
    maxTotalBytes: 'PASCAL_QUOTA_FREE_MAX_TOTAL_BYTES',
    maxSceneBytes: 'PASCAL_QUOTA_FREE_MAX_SCENE_BYTES',
  },
}

function positiveInt(env: NodeJS.ProcessEnv | undefined, key: string): number | undefined {
  const raw = env?.[key]
  if (raw === undefined || raw.trim() === '') return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function resolveSceneQuotas(env: NodeJS.ProcessEnv = process.env): SceneQuotaTable {
  const limits = (tier: SceneQuotaTier): SceneQuotaLimits => ({
    maxScenes: positiveInt(env, ENV_KEYS[tier].maxScenes) ?? DEFAULT_SCENE_QUOTAS[tier].maxScenes,
    maxTotalBytes:
      positiveInt(env, ENV_KEYS[tier].maxTotalBytes) ?? DEFAULT_SCENE_QUOTAS[tier].maxTotalBytes,
    maxSceneBytes:
      positiveInt(env, ENV_KEYS[tier].maxSceneBytes) ?? DEFAULT_SCENE_QUOTAS[tier].maxSceneBytes,
  })
  return { guest: limits('guest'), free: limits('free') }
}

/** A verified account is "free"; everything else is a guest. */
export function tierForActor(actor: Actor): SceneQuotaTier {
  return actor.type === 'user' && !actor.isAnonymous ? 'free' : 'guest'
}

export interface SceneUsage {
  sceneCount: number
  totalBytes: number
}

export function measureSceneUsage(scenes: readonly SceneMeta[]): SceneUsage {
  return {
    sceneCount: scenes.length,
    totalBytes: scenes.reduce((sum, scene) => sum + (scene.sizeBytes ?? 0), 0),
  }
}

/** The byte count the store records for a graph: its serialized length. */
export function sceneBytes(graph: unknown): number {
  return Buffer.byteLength(JSON.stringify(graph), 'utf8')
}

export type QuotaViolation =
  | { code: 'scene_count'; limit: number; current: number }
  | { code: 'total_bytes'; limit: number; current: number; incoming: number }
  | { code: 'scene_bytes'; limit: number; incoming: number }

/**
 * The first limit an incoming write would breach, or `null` if it fits. Pure so
 * the boundary conditions are testable without a store.
 *
 * `isNewScene` gates the count check: an update to an existing scene does not
 * create a new one. Total storage is checked as a running sum against the
 * incoming size, which over-counts on update (the old body is still included in
 * `usage`) — acceptable, since a quota is a soft ceiling and the conservative
 * reading only rejects earlier.
 */
export function evaluateSceneQuota(
  limits: SceneQuotaLimits,
  usage: SceneUsage,
  incomingBytes: number,
  isNewScene: boolean,
): QuotaViolation | null {
  if (isNewScene && usage.sceneCount >= limits.maxScenes) {
    return { code: 'scene_count', limit: limits.maxScenes, current: usage.sceneCount }
  }
  if (incomingBytes > limits.maxSceneBytes) {
    return { code: 'scene_bytes', limit: limits.maxSceneBytes, incoming: incomingBytes }
  }
  if (usage.totalBytes + incomingBytes > limits.maxTotalBytes) {
    return {
      code: 'total_bytes',
      limit: limits.maxTotalBytes,
      current: usage.totalBytes,
      incoming: incomingBytes,
    }
  }
  return null
}

/** Human-readable reason for the `quota_exceeded` API response. */
export function quotaViolationMessage(violation: QuotaViolation): string {
  switch (violation.code) {
    case 'scene_count':
      return `Scene limit reached (${violation.current}/${violation.limit}). Delete a scene or upgrade to create more.`
    case 'total_bytes':
      return `Storage limit reached (${violation.limit} bytes). Delete a scene or upgrade to store more.`
    case 'scene_bytes':
      return `Scene too large (${violation.incoming} bytes, limit ${violation.limit}).`
  }
}
