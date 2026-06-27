import type { AnyNode } from '../schema/types'
import type {
  DynamicAxis,
  DynamicBinding,
  DynamicJointBinding,
  DynamicJointChannel,
  DynamicMetadata,
} from './types'

const AXES = new Set<DynamicAxis>(['x', 'y', 'z'])

export function readDynamicMetadata(node: AnyNode | null | undefined): DynamicMetadata {
  const metadata =
    node?.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>)
      : {}

  const dynamicBindings = Array.isArray(metadata.dynamicBindings)
    ? metadata.dynamicBindings.filter(isDynamicBinding)
    : []
  const jointChannels = Array.isArray(metadata.jointChannels)
    ? metadata.jointChannels.filter(isDynamicJointChannel)
    : []
  const jointBindings = Array.isArray(metadata.jointBindings)
    ? metadata.jointBindings.filter(isDynamicJointBinding)
    : []
  const semanticType =
    typeof metadata.semanticType === 'string' ? metadata.semanticType.trim() : undefined

  return {
    semanticType: semanticType || undefined,
    dynamicBindings,
    jointChannels,
    jointBindings,
  }
}

export function isDynamicBinding(value: unknown): value is DynamicBinding {
  if (!(value && typeof value === 'object')) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.type === 'string' &&
    typeof record.path === 'string'
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isFinitePair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    isFiniteNumber(value[0]) &&
    isFiniteNumber(value[1])
  )
}

function isFiniteVec3(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    isFiniteNumber(value[0]) &&
    isFiniteNumber(value[1]) &&
    isFiniteNumber(value[2])
  )
}

export function isDynamicJointChannel(value: unknown): value is DynamicJointChannel {
  if (!(value && typeof value === 'object')) return false
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id.trim()) return false
  if (typeof record.label !== 'string' || !record.label.trim()) return false
  if (typeof record.targetNodeId !== 'string' || !record.targetNodeId.trim()) return false
  if (typeof record.axis !== 'string' || !AXES.has(record.axis as DynamicAxis)) return false
  if (record.motion !== 'rotation' && record.motion !== 'translation') return false
  if (record.pivot != null && !isFiniteVec3(record.pivot)) return false
  if (record.inputRange != null && !isFinitePair(record.inputRange)) return false
  if (record.outputRange != null && !isFinitePair(record.outputRange)) return false
  return true
}

export function isDynamicJointBinding(value: unknown): value is DynamicJointBinding {
  if (!(value && typeof value === 'object')) return false
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id.trim()) return false
  if (typeof record.channelId !== 'string' || !record.channelId.trim()) return false
  if (typeof record.path !== 'string') return false
  if (record.inputRange != null && !isFinitePair(record.inputRange)) return false
  if (record.outputRange != null && !isFinitePair(record.outputRange)) return false
  if (record.enabled != null && typeof record.enabled !== 'boolean') return false
  return true
}

export function writeDynamicMetadataPatch(
  node: AnyNode,
  patch: DynamicMetadata,
): Pick<AnyNode, 'metadata'> {
  const metadata =
    node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>)
      : {}

  return {
    metadata: {
      ...metadata,
      ...patch,
    },
  } as Pick<AnyNode, 'metadata'>
}
