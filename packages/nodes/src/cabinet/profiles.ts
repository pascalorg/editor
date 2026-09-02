import type { CabinetNode } from '@pascal-app/core'
import { CABINET_METRIC_DEFAULTS } from '@pascal-app/core'

export type CabinetDimensionProfileId = 'metric-base' | 'us-base'

export type CabinetDimensionProfile = {
  id: CabinetDimensionProfileId
  label: string
  depth: number
  carcassHeight: number
  plinthHeight: number
  countertopThickness: number
}

export const CABINET_DIMENSION_PROFILES: CabinetDimensionProfile[] = [
  {
    id: 'metric-base',
    label: 'Metric · 600 mm',
    depth: CABINET_METRIC_DEFAULTS.depth,
    carcassHeight: CABINET_METRIC_DEFAULTS.carcassHeight,
    plinthHeight: CABINET_METRIC_DEFAULTS.plinthHeight,
    countertopThickness: CABINET_METRIC_DEFAULTS.countertopThickness,
  },
  {
    id: 'us-base',
    label: 'US · 24 in',
    depth: 0.6096,
    carcassHeight: 0.762,
    plinthHeight: 0.1016,
    countertopThickness: 0.0381,
  },
]

const PROFILE_MATCH_TOLERANCE = 1e-4

export function cabinetDimensionProfileId(
  node: Pick<CabinetNode, 'depth' | 'carcassHeight' | 'plinthHeight' | 'countertopThickness'>,
): CabinetDimensionProfileId | 'custom' {
  const profile = CABINET_DIMENSION_PROFILES.find(
    (candidate) =>
      Math.abs(candidate.depth - node.depth) <= PROFILE_MATCH_TOLERANCE &&
      Math.abs(candidate.carcassHeight - node.carcassHeight) <= PROFILE_MATCH_TOLERANCE &&
      Math.abs(candidate.plinthHeight - node.plinthHeight) <= PROFILE_MATCH_TOLERANCE &&
      Math.abs(candidate.countertopThickness - node.countertopThickness) <= PROFILE_MATCH_TOLERANCE,
  )
  return profile?.id ?? 'custom'
}

export function cabinetDimensionProfileById(id: CabinetDimensionProfileId) {
  return CABINET_DIMENSION_PROFILES.find((profile) => profile.id === id)!
}
