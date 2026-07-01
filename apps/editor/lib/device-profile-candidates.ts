import fs from 'node:fs/promises'
import path from 'node:path'
import {
  normalizeDeviceProfileInput,
  type DeviceProfileDefinition,
} from '@pascal-app/core/lib/device-profile-registry'
import type { GeneratedGeometryArtifact } from '../../../packages/editor/src/lib/ai-generated-geometry-core'
import { findRepoRoot } from './generated-assets/manifest'

const CANDIDATE_QUALITY_THRESHOLD = 0.72

export type DeviceProfileCandidatePersistResult =
  | { saved: true; file: string; qualityScore: number; profileId: string }
  | { saved: false; reason: string; qualityScore?: number; profileId?: string }

export type DeviceProfileCandidatePersistOptions = {
  enabled?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeFileName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function profileFromArtifact(
  artifact: GeneratedGeometryArtifact,
): DeviceProfileDefinition | undefined {
  const draft = artifact.sourceArgs.deviceProfileDraft
  if (!isRecord(draft)) return undefined
  const profile = normalizeDeviceProfileInput(draft, 'generated_candidate', 'runtime_draft')
  if (profile.status !== 'runtime_draft' && profile.status !== 'draft') return undefined
  if (!profile.id.trim()) return undefined
  return { ...profile, status: 'candidate', source: 'generated_candidate' }
}

async function existingCandidateQuality(file: string): Promise<number | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'))
    if (!isRecord(parsed)) return undefined
    const candidate = isRecord(parsed.candidate) ? parsed.candidate : undefined
    const score = candidate?.qualityScore
    return typeof score === 'number' && Number.isFinite(score) ? score : undefined
  } catch {
    return undefined
  }
}

export async function persistDeviceProfileCandidateFromArtifact(
  prompt: string,
  artifact: GeneratedGeometryArtifact | null | undefined,
  options: DeviceProfileCandidatePersistOptions = {},
): Promise<DeviceProfileCandidatePersistResult> {
  if (options.enabled !== true) return { saved: false, reason: 'disabled' }
  if (!artifact) return { saved: false, reason: 'missing_artifact' }
  const profile = profileFromArtifact(artifact)
  if (!profile) return { saved: false, reason: 'not_runtime_draft' }
  const qualityScore = artifact.profileQuality?.overallScore
  if (typeof qualityScore !== 'number' || !Number.isFinite(qualityScore)) {
    return { saved: false, reason: 'missing_quality_score', profileId: profile.id }
  }
  if (qualityScore < CANDIDATE_QUALITY_THRESHOLD) {
    return { saved: false, reason: 'quality_below_threshold', qualityScore, profileId: profile.id }
  }

  const root = await findRepoRoot()
  const dir = path.join(root, 'apps', 'editor', '.generated', 'device-profile-candidates')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${safeFileName(profile.id || 'device_profile_candidate')}.json`)
  const existingQuality = await existingCandidateQuality(file)
  if (existingQuality != null && existingQuality >= qualityScore) {
    return {
      saved: false,
      reason: 'existing_candidate_is_better',
      qualityScore,
      profileId: profile.id,
    }
  }

  const roles = Array.from(
    new Set(
      artifact.shapes
        .map((shape) => shape.semanticRole)
        .filter((role): role is string => typeof role === 'string' && role.trim().length > 0),
    ),
  ).sort()
  const createdAt = new Date().toISOString()
  const candidateRecord = {
    ...profile,
    candidate: {
      prompt,
      draftProfile: artifact.sourceArgs.deviceProfileDraft,
      family: profile.family,
      primarySemanticRole: profile.primarySemanticRole,
      roles,
      shapeCount: artifact.shapes.length,
      qualityScore,
      createdAt,
    },
  }

  await fs.writeFile(file, `${JSON.stringify(candidateRecord, null, 2)}\n`, 'utf8')
  return { saved: true, file, qualityScore, profileId: profile.id }
}
