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

export type SemanticLiveDataBindingPlan = {
  nodeId: string
  label: string
  target: SemanticLiveDataBindingTarget
  path: string
  patch: Partial<AnyNode>
  reason: string
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

  targets.push({
    id: 'alarm-pulse',
    label: 'Alarm pulse',
    type: 'scale',
    semanticType: 'generic',
    preferredPaths: ['alarm.count', 'machine.status'],
    description: 'Pulse the selected equipment when an alarm/status field is active.',
    binding: {
      condition: 'greaterThan',
      value: 0,
      scaleEffect: 'alarmPulse',
      outputRange: [1, 1.18],
      speedRange: [0, 8],
    },
  })

  return targets
}

export function defaultSemanticLiveDataPath(
  target: SemanticLiveDataBindingTarget,
  paths: readonly LiveDataPath[],
) {
  return preferredPath(paths, target.preferredPaths)
}

export function formatSemanticLiveDataBindingTargets(input: {
  profiles: readonly ObjectCapabilityProfile[]
  paths: readonly LiveDataPath[]
}) {
  const lines = input.profiles.flatMap((profile) =>
    semanticLiveDataBindingTargets(profile).map((target) => {
      const path = defaultSemanticLiveDataPath(target, input.paths)
      const available = path ? `defaultPath=${path}` : 'defaultPath=none'
      return `- ${profile.label ?? profile.nodeId} id=${profile.nodeId}: ${target.id} (${target.label}, type=${target.type}, ${available})`
    }),
  )
  if (!lines.length) return 'No semantic live data binding targets for current selection.'
  return [
    'Semantic live data binding targets:',
    ...lines,
    'Use these targets when the user asks to bind fixed/demo/live data to selected equipment.',
  ].join('\n')
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

function lowerPrompt(prompt: string) {
  return prompt.toLocaleLowerCase()
}

function textIncludesAny(text: string, words: readonly string[]) {
  return words.some((word) => text.includes(word))
}

function scoreTarget(prompt: string, target: SemanticLiveDataBindingTarget) {
  const text = lowerPrompt(prompt)
  let score = 0
  if (textIncludesAny(text, [target.id.toLocaleLowerCase(), target.label.toLocaleLowerCase()])) {
    score += 6
  }
  if (
    target.type === 'level' &&
    textIncludesAny(text, ['level', 'liquid', 'fill', '液位', '水位', '料位', '罐'])
  ) {
    score += 5
  }
  if (target.type === 'flow' && textIncludesAny(text, ['flow', '流量', '流动', '管线', '管道'])) {
    score += 5
  }
  if (
    target.type === 'running' &&
    textIncludesAny(text, ['running', 'status', 'run', '运行', '状态', '启停'])
  ) {
    score += 5
  }
  if (target.type === 'speed' && textIncludesAny(text, ['speed', 'rpm', '转速', '速度'])) {
    score += 5
  }
  if (
    target.type === 'color' &&
    textIncludesAny(text, ['color', 'temperature', 'temp', '颜色', '变色', '温度'])
  ) {
    score += 5
  }
  if (
    target.id === 'alarm-pulse' &&
    textIncludesAny(text, ['alarm', 'alert', 'warning', 'pulse', '报警', '告警', '闪烁', '脉冲'])
  ) {
    score += 7
  }
  if (
    textIncludesAny(
      text,
      target.preferredPaths.map((path) => path.toLocaleLowerCase()),
    )
  ) {
    score += 4
  }
  return score
}

function scorePath(prompt: string, path: string, target: SemanticLiveDataBindingTarget) {
  const text = lowerPrompt(prompt)
  const preferredIndex = target.preferredPaths.indexOf(path)
  let score = preferredIndex >= 0 ? Math.max(1, 6 - preferredIndex) : 0
  if (text.includes(path.toLocaleLowerCase())) score += 8
  for (const segment of path.toLocaleLowerCase().split('.')) {
    if (segment && text.includes(segment)) score += 1
  }
  if (target.type === 'level' && /level|液位|水位|料位/.test(path)) score += 2
  if (target.type === 'flow' && /flow|流量/.test(path)) score += 2
  if (target.type === 'speed' && /speed|速度|转速/.test(path)) score += 2
  if (target.type === 'color' && /temperature|temp|温度/.test(path)) score += 2
  if (target.id === 'alarm-pulse' && /alarm|status|报警|告警/.test(path)) score += 4
  return score
}

function bestPathForPrompt(
  prompt: string,
  target: SemanticLiveDataBindingTarget,
  paths: readonly LiveDataPath[],
) {
  if (!paths.length) return ''
  const ranked = paths
    .map((path) => ({ path: path.path, score: scorePath(prompt, path.path, target) }))
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]
  if (best && best.score > 0) return best.path
  return defaultSemanticLiveDataPath(target, paths)
}

export function planSemanticLiveDataBinding(input: {
  prompt: string
  profiles: readonly ObjectCapabilityProfile[]
  nodes: Record<string, AnyNode | undefined>
  paths: readonly LiveDataPath[]
}): SemanticLiveDataBindingPlan | null {
  const candidates = input.profiles.flatMap((profile, profileIndex) =>
    semanticLiveDataBindingTargets(profile).map((target, targetIndex) => ({
      profile,
      target,
      score: scoreTarget(input.prompt, target),
      order: profileIndex * 100 + targetIndex,
    })),
  )
  if (!candidates.length) return null
  candidates.sort((a, b) => b.score - a.score || a.order - b.order)
  const selected = candidates[0]!
  const path = bestPathForPrompt(input.prompt, selected.target, input.paths)
  const node = input.nodes[selected.profile.nodeId]
  if (!(node && path)) return null
  return {
    nodeId: selected.profile.nodeId,
    label: selected.profile.label ?? selected.profile.nodeId,
    target: selected.target,
    path,
    patch: upsertSemanticLiveDataBinding({
      node,
      profile: selected.profile,
      target: selected.target,
      path,
    }),
    reason:
      selected.score > 0
        ? `Matched request to ${selected.target.label}.`
        : `Used default binding target ${selected.target.label}.`,
  }
}

export function planSemanticLiveDataBindingForPath(input: {
  path: string
  profile: ObjectCapabilityProfile
  node: AnyNode | undefined
}): SemanticLiveDataBindingPlan | null {
  const path = input.path.trim()
  if (!(path && input.node)) return null
  const targets = semanticLiveDataBindingTargets(input.profile)
  if (!targets.length) return null
  const ranked = targets
    .map((target, index) => ({
      target,
      score: scorePath(path, path, target),
      index,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
  const selected = ranked[0]
  if (!selected) return null
  return {
    nodeId: input.profile.nodeId,
    label: input.profile.label ?? input.profile.nodeId,
    target: selected.target,
    path,
    patch: upsertSemanticLiveDataBinding({
      node: input.node,
      profile: input.profile,
      target: selected.target,
      path,
    }),
    reason: `Dropped ${path} onto ${input.profile.label ?? input.profile.nodeId}.`,
  }
}
