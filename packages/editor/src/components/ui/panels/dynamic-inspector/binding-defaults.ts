'use client'

import type { DynamicAxis, DynamicBinding, DynamicType } from '@pascal-app/core'

export const AXIS_OPTIONS: DynamicAxis[] = ['x', 'y', 'z']

export const PREVIEW_RUNTIME_TYPES = new Set<DynamicType>([
  'visible',
  'move',
  'blink',
  'fill',
  'color',
  'scale',
  'rotate',
  'speed',
  'flow',
  'conveyorFlow',
  'level',
  'openClose',
  'running',
  'brightness',
  'valueDisplay',
])

export function isConveyorSemanticType(semanticType: string) {
  return semanticType === 'conveyor'
}

export function createBinding(type: DynamicType, path: string): DynamicBinding {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `dyn_${Date.now()}_${Math.random().toString(16).slice(2)}`
  const base: DynamicBinding = { id, type, path }
  if (type === 'visible' || type === 'blink') {
    return { ...base, condition: 'truthy', color: type === 'visible' ? undefined : '#35c8ff' }
  }
  if (type === 'color') {
    return { ...base, colorMode: 'condition', condition: 'truthy', color: '#ff3b30' }
  }
  if (type === 'rotate' || type === 'speed') {
    return { ...base, axis: 'y', inputRange: [0, 100], speedRange: [0, 6] }
  }
  if (type === 'running') return { ...base, axis: 'y', speedRange: [0, 6] }
  if (type === 'openClose') {
    return { ...base, axis: 'y', inputRange: [0, 1], outputRange: [0, Math.PI / 2] }
  }
  if (type === 'move') {
    return {
      ...base,
      axis: 'y',
      inputRange: [0, 100],
      outputRange: [0, 1],
      motionMode: 'follow',
      moveStyle: 'translate',
    }
  }
  if (type === 'scale') return { ...base, condition: 'truthy', outputRange: [1, 1.2], scaleEffect: 'fixed' }
  if (type === 'level') return { ...base, inputRange: [0, 100], outputRange: [0, 1] }
  if (type === 'flow') {
    return {
      ...base,
      inputRange: [0, 100],
      speedRange: [0, 1.2],
      color: '#35c8ff',
      arrowColor: '#7dd3fc',
      direction: 'forward',
      flowMedium: 'liquid',
    }
  }
  if (type === 'brightness') {
    return { ...base, inputRange: [0, 100], color: '#35c8ff' }
  }
  if (type === 'conveyorFlow') {
    return {
      ...base,
      direction: 'x',
      inputRange: [0, 2],
      distance: 6,
      spacing: 1.2,
      cadenceSeconds: 1.5,
      maxItems: 6,
      endpointBehavior: 'loop',
      speedRange: [0, 2],
      loop: true,
    }
  }
  return base
}
