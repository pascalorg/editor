import type { AnyNode } from '@pascal-app/core'

export type Vec3 = [number, number, number]

export type ArticraftJointMetadata = {
  jointName: string
  jointType?: string
  parentLink?: string
  childLink?: string
  axis?: Vec3
  origin?: {
    xyz?: Vec3
    rpy?: Vec3
  }
  limits?: {
    lower?: number
    upper?: number
    velocity?: number
    effort?: number
  }
  currentValue?: number
  savedValue?: number
  restRotation?: Vec3
  restPosition?: Vec3
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asVec3(value: unknown, fallback: Vec3): Vec3 {
  if (Array.isArray(value) && value.length >= 3) {
    const next = value.slice(0, 3).map((item) => Number(item))
    if (next.every(Number.isFinite)) return [next[0]!, next[1]!, next[2]!]
  }
  return fallback
}

export function normalizeVec3(value: unknown, fallback: Vec3): Vec3 {
  const vec = asVec3(value, fallback)
  const length = Math.hypot(vec[0], vec[1], vec[2])
  if (!Number.isFinite(length) || length <= 1e-6) return fallback
  return [vec[0] / length, vec[1] / length, vec[2] / length]
}

export function getNodeMetadata(node: AnyNode): Record<string, unknown> {
  return isRecord(node.metadata) ? node.metadata : {}
}

export function getArticraftJointMetadata(
  node: AnyNode | undefined,
): ArticraftJointMetadata | null {
  if (!node) return null
  const joint = getNodeMetadata(node).articraftJoint
  if (!isRecord(joint) || typeof joint.jointName !== 'string') return null
  return {
    ...joint,
    axis: joint.axis ? normalizeVec3(joint.axis, [0, 0, 1]) : undefined,
    restRotation: joint.restRotation ? asVec3(joint.restRotation, [0, 0, 0]) : undefined,
    restPosition: joint.restPosition ? asVec3(joint.restPosition, [0, 0, 0]) : undefined,
  } as ArticraftJointMetadata
}

export function jointRange(joint: ArticraftJointMetadata): [number, number] {
  const lower = joint.limits?.lower
  const upper = joint.limits?.upper
  if (Number.isFinite(lower) && Number.isFinite(upper) && lower! < upper!) {
    return [lower!, upper!]
  }
  if (joint.jointType === 'continuous') return [-Math.PI, Math.PI]
  if (joint.jointType === 'prismatic') return [-1, 1]
  return [-Math.PI / 2, Math.PI / 2]
}

export function clampJointValue(joint: ArticraftJointMetadata, value: number): number {
  if (joint.jointType === 'fixed') return 0
  if (!Number.isFinite(value))
    return typeof joint.currentValue === 'number' ? joint.currentValue : 0
  const [min, max] = jointRange(joint)
  return Math.max(min, Math.min(max, value))
}

export function formatJointUnit(joint: ArticraftJointMetadata): string {
  return joint.jointType === 'prismatic' ? 'm' : 'rad'
}

function extractPosePayload(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed).searchParams.get('pose') ?? trimmed
  } catch {
    try {
      const query = trimmed.startsWith('?') ? trimmed.slice(1) : trimmed
      return new URLSearchParams(query).get('pose') ?? trimmed
    } catch {
      return trimmed
    }
  }
}

function parseNestedJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    try {
      return JSON.parse(decodeURIComponent(value))
    } catch {
      return null
    }
  }
}

function collectPoseEntries(value: unknown): Array<[string, number]> {
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([jointName, jointValue]) =>
      typeof jointValue === 'number' && Number.isFinite(jointValue)
        ? [[jointName, jointValue]]
        : [],
    )
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (!isRecord(entry)) return []
      const jointName =
        typeof entry.jointName === 'string'
          ? entry.jointName
          : typeof entry.name === 'string'
            ? entry.name
            : null
      const jointValue =
        typeof entry.value === 'number'
          ? entry.value
          : typeof entry.currentValue === 'number'
            ? entry.currentValue
            : null
      return jointName && jointValue != null && Number.isFinite(jointValue)
        ? [[jointName, jointValue]]
        : []
    })
  }
  return []
}

export function parseArticraftPose(rawValue: string | null, recordId: string): Map<string, number> {
  const raw = rawValue ? extractPosePayload(rawValue) : null
  if (!raw) return new Map()
  const parsed = parseNestedJson(raw)
  if (!isRecord(parsed) && !Array.isArray(parsed)) return new Map()
  if (isRecord(parsed) && typeof parsed.recordId === 'string' && parsed.recordId !== recordId) {
    return new Map()
  }

  const values =
    isRecord(parsed) && parsed.values != null
      ? parsed.values
      : isRecord(parsed) && parsed.joints != null
        ? parsed.joints
        : isRecord(parsed) && parsed.pose != null
          ? parsed.pose
          : parsed

  return new Map(collectPoseEntries(values))
}

export function buildArticraftJointPatch(
  node: AnyNode,
  current: ArticraftJointMetadata,
  patch: Partial<ArticraftJointMetadata>,
): Partial<AnyNode> {
  const metadata = getNodeMetadata(node)
  const restRotation =
    current.restRotation ?? asVec3((node as { rotation?: unknown }).rotation, [0, 0, 0])
  const restPosition =
    current.restPosition ?? asVec3((node as { position?: unknown }).position, [0, 0, 0])
  const nextJoint: ArticraftJointMetadata = {
    ...current,
    restRotation,
    restPosition,
    ...patch,
  }
  nextJoint.axis = normalizeVec3(nextJoint.axis, [0, 0, 1])
  if (typeof nextJoint.currentValue === 'number') {
    nextJoint.currentValue = clampJointValue(nextJoint, nextJoint.currentValue)
  }

  const next: Partial<AnyNode> = {
    metadata: {
      ...metadata,
      articraftJoint: nextJoint,
    },
  } as Partial<AnyNode>

  const value = typeof nextJoint.currentValue === 'number' ? nextJoint.currentValue : null
  if (value == null) return next

  if (nextJoint.jointType === 'prismatic') {
    ;(next as { position?: Vec3 }).position = [
      restPosition[0] + nextJoint.axis[0] * value,
      restPosition[1] + nextJoint.axis[1] * value,
      restPosition[2] + nextJoint.axis[2] * value,
    ]
  } else if (nextJoint.jointType !== 'fixed') {
    ;(next as { rotation?: Vec3 }).rotation = [
      restRotation[0] + nextJoint.axis[0] * value,
      restRotation[1] + nextJoint.axis[1] * value,
      restRotation[2] + nextJoint.axis[2] * value,
    ]
  }
  return next
}

export function applyArticraftJointValue(
  node: AnyNode,
  current: ArticraftJointMetadata,
  value: number,
): Partial<AnyNode> {
  return buildArticraftJointPatch(node, current, { currentValue: value })
}
