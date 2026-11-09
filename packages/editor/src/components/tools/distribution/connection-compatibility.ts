import type { NodePort } from '@pascal-app/core'

export type ConnectionProfile = Pick<NodePort, 'system' | 'diameter' | 'shape' | 'width' | 'height'>
export type ConnectionCompatibility = {
  status: 'match' | 'adapter' | 'incompatible' | 'unknown'
  label: string
}

export function connectionCompatibility(
  source: ConnectionProfile,
  target: ConnectionProfile,
): ConnectionCompatibility {
  if (source.system && target.system && source.system !== target.system) {
    return {
      status: 'incompatible',
      label: `Different systems: ${source.system} / ${target.system}`,
    }
  }
  const sourceShape = source.shape ?? 'round'
  const targetShape = target.shape ?? 'round'
  if (sourceShape !== targetShape) {
    return { status: 'adapter', label: `Transition needed: ${sourceShape} / ${targetShape}` }
  }
  const sourceSize = sourceShape === 'round' ? [source.diameter] : [source.width, source.height]
  const targetSize = targetShape === 'round' ? [target.diameter] : [target.width, target.height]
  if (
    [...sourceSize, ...targetSize].some(
      (value) => value === undefined || !Number.isFinite(value) || value <= 0,
    )
  ) {
    return { status: 'unknown', label: 'Connection size unavailable' }
  }
  if (sourceSize.some((value, index) => Math.abs(value! - targetSize[index]!) > 0.001)) {
    return {
      status: 'adapter',
      label: `Reducer needed: ${sourceSize.join(' × ')}″ / ${targetSize.join(' × ')}″`,
    }
  }
  if (!source.system || !target.system) {
    return { status: 'unknown', label: 'Size matches; system unspecified' }
  }
  return { status: 'match', label: `Matching system and size: ${target.system}` }
}
