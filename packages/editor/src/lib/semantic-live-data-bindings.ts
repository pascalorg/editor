import type { AnyNode, DynamicBinding, DynamicType, LiveDataPath } from '@pascal-app/core'
import type { ObjectCapabilityProfile } from './object-capabilities'

export type SemanticLiveDataBindingTarget = {
  id: string
  label: string
  type: DynamicType
  semanticType: string
  preferredPaths: string[]
  description: string
  binding: Omit<DynamicBinding, 'id' | 'path' | 'type'>
}

function hasPath(paths: readonly LiveDataPath[], path: string) {
  return paths.some((entry) => entry.path === path)
}

function preferredPath(paths: readonly LiveDataPath[], preferredPaths: readonly string[]) {
  return preferredPaths.find((path) => hasPath(paths, path)) ?? paths[0]?.path ?? ''
}

function targetId(profile: ObjectCapabilityProfile, target: SemanticLiveDataBindingTarget) {
  return `semantic_live_${profile.nodeId}_${target.id}`.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function isTankProfile(profile: ObjectCapabilityProfile) {
  return (
    profile.nodeType === 'tank' ||
    profile.equipmentFamily === 'tank' ||
    profile.recipeId === 'factory:storage-tank' ||
    /tank|storage/i.test(`${profile.label ?? ''} ${profile.profileId ?? ''}`)
  )
}

function isPumpProfile(profile: ObjectCapabilityProfile) {
  return (
    profile.equipmentFamily === 'pump' ||
    /pump/i.test(`${profile.label ?? ''} ${profile.profileId ?? ''} ${profile.recipeId ?? ''}`)
  )
}

function isPipeProfile(profile: ObjectCapabilityProfile) {
  return profile.nodeType === 'pipe' || /pipe|pipeline/i.test(`${profile.label ?? ''}`)
}

function isFanProfile(profile: ObjectCapabilityProfile) {
  return profile.equipmentFamily === 'fan' || /fan|blower/i.test(`${profile.label ?? ''}`)
}

function isColumnProfile(profile: ObjectCapabilityProfile) {
  return (
    profile.equipmentFamily === 'column' ||
    /column|distillation/i.test(`${profile.label ?? ''} ${profile.profileId ?? ''}`)
  )
}

export function semanticLiveDataBindingTargets(
  profile: ObjectCapabilityProfile,
): SemanticLiveDataBindingTarget[] {
  const targets: SemanticLiveDataBindingTarget[] = []

  if (isTankProfile(profile)) {
    targets.push({
      id: 'tank-level',
      label: 'Tank liquid level',
      type: 'level',
      semanticType: 'tank',
      preferredPaths: ['refinery.tank.level', 'factory.tank.level', 'machine.temperature'],
      description: 'Drive the visible liquid fill from a 0-100 level field.',
      binding: {
        inputRange: [0, 100],
        outputRange: [0, 1],
        color: '#38bdf8',
      },
    })
  }

  if (isPumpProfile(profile)) {
    targets.push({
      id: 'pump-running',
      label: 'Running status',
      type: 'running',
      semanticType: 'pump',
      preferredPaths: ['machine.status', 'factory.machine.temperature'],
      description: 'Use a truthy status field to animate the equipment as running.',
      binding: {
        axis: 'y',
        speedRange: [0, 6],
      },
    })
    targets.push({
      id: 'pump-flow',
      label: 'Process flow',
      type: 'flow',
      semanticType: 'pump',
      preferredPaths: ['refinery.crude.flowRate', 'factory.pipe.flow'],
      description: 'Use flow data to show active material movement.',
      binding: {
        inputRange: [0, 1500],
        speedRange: [0, 1.2],
        color: '#35c8ff',
        arrowColor: '#7dd3fc',
        direction: 'forward',
        flowMedium: 'liquid',
      },
    })
  }

  if (isPipeProfile(profile)) {
    targets.push({
      id: 'pipe-flow',
      label: 'Pipe flow',
      type: 'flow',
      semanticType: 'pipe',
      preferredPaths: ['factory.pipe.flow', 'refinery.crude.flowRate'],
      description: 'Render directional flow arrows and liquid core in preview.',
      binding: {
        inputRange: [0, 1500],
        speedRange: [0, 1.2],
        color: '#35c8ff',
        arrowColor: '#7dd3fc',
        direction: 'forward',
        flowMedium: 'liquid',
      },
    })
  }

  if (isFanProfile(profile)) {
    targets.push({
      id: 'fan-speed',
      label: 'Fan speed',
      type: 'speed',
      semanticType: 'fan',
      preferredPaths: ['fan.speed', 'factory.fan.speed'],
      description: 'Map a speed percentage to Y-axis rotation.',
      binding: {
        axis: 'y',
        inputRange: [0, 100],
        speedRange: [0, 6],
      },
    })
  }

  if (isColumnProfile(profile)) {
    targets.push({
      id: 'temperature-color',
      label: 'Temperature color',
      type: 'color',
      semanticType: 'generic',
      preferredPaths: ['machine.temperature', 'factory.machine.temperature'],
      description: 'Map temperature to a blue-to-red material gradient.',
      binding: {
        colorMode: 'gradient',
        inputRange: [0, 100],
        color: '#35c8ff',
        endColor: '#ff3b30',
      },
    })
  }

  if (targets.length === 0) {
    targets.push({
      id: 'status-color',
      label: 'Status color',
      type: 'color',
      semanticType: 'generic',
      preferredPaths: ['machine.status', 'alarm.count'],
      description: 'Apply a simple status color to the selected object.',
      binding: {
        colorMode: 'condition',
        condition: 'truthy',
        color: '#22c55e',
      },
    })
  }

  return targets
}

export function defaultSemanticLiveDataPath(
  target: SemanticLiveDataBindingTarget,
  paths: readonly LiveDataPath[],
) {
  return preferredPath(paths, target.preferredPaths)
}

export function buildSemanticLiveDataBinding(input: {
  profile: ObjectCapabilityProfile
  target: SemanticLiveDataBindingTarget
  path: string
}): DynamicBinding {
  return {
    id: targetId(input.profile, input.target),
    type: input.target.type,
    path: input.path,
    ...input.target.binding,
  }
}

export function upsertSemanticLiveDataBinding(input: {
  node: AnyNode
  profile: ObjectCapabilityProfile
  target: SemanticLiveDataBindingTarget
  path: string
}) {
  const metadata =
    input.node.metadata &&
    typeof input.node.metadata === 'object' &&
    !Array.isArray(input.node.metadata)
      ? (input.node.metadata as Record<string, unknown>)
      : {}
  const binding = buildSemanticLiveDataBinding(input)
  const current = Array.isArray(metadata.dynamicBindings)
    ? metadata.dynamicBindings.filter((item): item is DynamicBinding => {
        if (!(item && typeof item === 'object')) return false
        const record = item as Record<string, unknown>
        return (
          typeof record.id === 'string' &&
          typeof record.type === 'string' &&
          typeof record.path === 'string'
        )
      })
    : []
  const next = current.filter((item) => item.id !== binding.id)
  next.push(binding)
  return {
    metadata: {
      ...metadata,
      semanticType:
        typeof metadata.semanticType === 'string' && metadata.semanticType.trim()
          ? metadata.semanticType
          : input.target.semanticType,
      dynamicBindings: next,
      liveDataBindingSource: 'fixed-factory-demo',
    },
  } as Partial<AnyNode>
}
