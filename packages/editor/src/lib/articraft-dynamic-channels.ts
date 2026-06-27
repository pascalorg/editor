import type {
  AnyNode,
  DynamicAxis,
  DynamicJointChannel,
  DynamicJointMotionKind,
} from '@pascal-app/core'
import {
  type ArticraftJointMetadata,
  getArticraftJointMetadata,
  getNodeMetadata,
  isRecord,
  jointRange,
} from './articraft-joints'

const JOINT_TERM_LABELS: Record<string, string> = {
  arm: '\u81c2',
  base: '\u57fa\u5ea7',
  bearing: '\u8f74\u627f',
  boom: '\u81c2\u67b6',
  bridge: '\u6865\u67b6',
  carriage: '\u5c0f\u8f66',
  cab: '\u9a7e\u9a76\u5ba4',
  cabin: '\u9a7e\u9a76\u5ba4',
  counterweight: '\u914d\u91cd',
  crane: '\u5854\u540a',
  extension: '\u4f38\u7f29',
  head: '\u5934',
  hook: '\u540a\u94a9',
  hoist: '\u8d77\u5347',
  jib: '\u540a\u81c2',
  lamp: '\u706f',
  lift: '\u5347\u964d',
  lower: '\u4e0b',
  mast: '\u5854\u8eab',
  pitch: '\u4fef\u4ef0',
  rail: '\u8f68\u9053',
  rotate: '\u65cb\u8f6c',
  rotation: '\u65cb\u8f6c',
  slew: '\u56de\u8f6c',
  slewing: '\u56de\u8f6c',
  slide: '\u6ed1\u79fb',
  swing: '\u6446\u52a8',
  telescope: '\u4f38\u7f29',
  telescopic: '\u4f38\u7f29',
  to: '\u5230',
  tower: '\u5854\u8eab',
  travel: '\u884c\u8d70',
  trolley: '\u5c0f\u8f66',
  turntable: '\u8f6c\u53f0',
  unit: '\u5355\u5143',
  upper: '\u4e0a',
  upperworks: '\u4e0a\u8f66',
  winch: '\u5377\u626c',
  yaw: '\u56de\u8f6c',
}

function normalizeToken(value: string) {
  return value.trim().toLowerCase()
}

function splitName(value: string | undefined | null): string[] {
  if (!value) return []
  return value
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .split(/[_\-\s./]+/)
    .map(normalizeToken)
    .filter(Boolean)
}

export function translateArticraftJointName(value: string | undefined | null): string {
  if (!value) return ''
  const tokens = splitName(value)
  if (tokens.length === 0) return value
  const translated = tokens.map((token) => JOINT_TERM_LABELS[token] ?? token)
  if (translated.every((token, index) => token === tokens[index])) return value
  return translated.join('')
}

function recordIdOf(node: AnyNode | undefined): string | null {
  if (!node) return null
  const articraft = getNodeMetadata(node).articraft
  if (!isRecord(articraft)) return null
  const recordId = articraft.recordId
  return typeof recordId === 'string' && recordId.trim() ? recordId : null
}

function axisFromJoint(joint: ArticraftJointMetadata): DynamicAxis {
  const axis = joint.axis ?? [0, 0, 1]
  const abs = axis.map((value) => Math.abs(value))
  if (abs[0]! >= abs[1]! && abs[0]! >= abs[2]!) return 'x'
  if (abs[1]! >= abs[0]! && abs[1]! >= abs[2]!) return 'y'
  return 'z'
}

function motionFromJoint(joint: ArticraftJointMetadata): DynamicJointMotionKind {
  return joint.jointType === 'prismatic' ? 'translation' : 'rotation'
}

function channelLabel(joint: ArticraftJointMetadata): string {
  const jointLabel = translateArticraftJointName(joint.jointName)
  if (splitName(joint.jointName).includes('to')) return jointLabel || joint.jointName

  const childLabel = translateArticraftJointName(joint.childLink)
  if (childLabel && childLabel !== jointLabel) return `${childLabel} · ${jointLabel}`
  return jointLabel || joint.jointName
}

function channelId(recordId: string, nodeId: string, jointName: string) {
  return `articraft:${recordId}:${nodeId}:${jointName}`
}

export function buildArticraftJointChannel(
  node: AnyNode,
  recordId: string,
  joint: ArticraftJointMetadata,
): DynamicJointChannel | null {
  if (!joint.jointName || joint.jointType === 'fixed') return null
  const [min, max] = jointRange(joint)
  const motion = motionFromJoint(joint)
  return {
    id: channelId(recordId, String(node.id), joint.jointName),
    label: channelLabel(joint),
    targetNodeId: String(node.id),
    axis: axisFromJoint(joint),
    motion,
    outputRange: [min, max],
    inputRange: motion === 'rotation' ? [0, 100] : [0, 100],
    unit: joint.jointType === 'prismatic' ? 'm' : 'rad',
    source: joint.jointName,
  }
}

export function getArticraftRecordIdForSelection(
  selectedNode: AnyNode | undefined,
  nodes: Record<string, AnyNode>,
): string | null {
  const direct = recordIdOf(selectedNode)
  if (direct) return direct

  const selectedParentId = (selectedNode as { parentId?: unknown } | undefined)?.parentId
  if (typeof selectedParentId === 'string') {
    return recordIdOf(nodes[selectedParentId])
  }
  return null
}

export function getArticraftJointChannelsForSelection(
  selectedNode: AnyNode | undefined,
  nodes: Record<string, AnyNode>,
): DynamicJointChannel[] {
  const recordId = getArticraftRecordIdForSelection(selectedNode, nodes)
  if (!recordId) return []

  const channels = Object.values(nodes).flatMap((node) => {
    if (recordIdOf(node) !== recordId) return []
    const joint = getArticraftJointMetadata(node)
    if (!joint) return []
    const channel = buildArticraftJointChannel(node, recordId, joint)
    return channel ? [channel] : []
  })

  channels.sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
  return channels
}
