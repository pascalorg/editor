'use client'

import type { MaterialSchema, RoadNode } from '@pascal-app/core'
import { SegmentedControl } from '@pascal-app/editor'

type RoadSurfaceKind = NonNullable<RoadNode['surfaceKind']>

type SurfaceKindOption = {
  value: RoadSurfaceKind
  label: string
  color: string
  roughness: number
  metalness: number
  opacity: number
  transparent: boolean
  laneCount: number
  showLaneMarkings: boolean
  markingColor: string
}

const SURFACE_KIND_OPTIONS: SurfaceKindOption[] = [
  {
    value: 'road',
    label: '\u9053\u8def',
    color: '#2f3338',
    roughness: 0.88,
    metalness: 0.02,
    opacity: 1,
    transparent: false,
    laneCount: 2,
    showLaneMarkings: true,
    markingColor: '#f8fafc',
  },
  {
    value: 'river',
    label: '\u6cb3\u6d41',
    color: '#2563eb',
    roughness: 0.18,
    metalness: 0,
    opacity: 0.72,
    transparent: true,
    laneCount: 1,
    showLaneMarkings: false,
    markingColor: '#bfdbfe',
  },
  {
    value: 'walkway',
    label: '\u6b65\u9053',
    color: '#9ca3af',
    roughness: 0.82,
    metalness: 0,
    opacity: 1,
    transparent: false,
    laneCount: 1,
    showLaneMarkings: false,
    markingColor: '#f8fafc',
  },
  {
    value: 'greenbelt',
    label: '\u7eff\u5316\u5e26',
    color: '#22c55e',
    roughness: 0.9,
    metalness: 0,
    opacity: 1,
    transparent: false,
    laneCount: 1,
    showLaneMarkings: false,
    markingColor: '#dcfce7',
  },
]

function buildSurfaceMaterial(option: SurfaceKindOption): MaterialSchema {
  return {
    preset: 'custom',
    properties: {
      color: option.color,
      roughness: option.roughness,
      metalness: option.metalness,
      opacity: option.opacity,
      transparent: option.transparent,
      side: 'front',
    },
  }
}

export function RoadSurfaceKindField({
  node,
  onUpdate,
}: {
  node: RoadNode
  onUpdate: (patch: Partial<RoadNode>) => void
}) {
  const value = node.surfaceKind ?? 'road'

  return (
    <SegmentedControl
      onChange={(next) => {
        const option = SURFACE_KIND_OPTIONS.find((item) => item.value === next)
        if (!option) return
        onUpdate({
          surfaceKind: option.value,
          material: buildSurfaceMaterial(option),
          materialPreset: undefined,
          asphaltColor: option.color,
          laneCount: option.laneCount,
          showLaneMarkings: option.showLaneMarkings,
          markingColor: option.markingColor,
        })
      }}
      options={SURFACE_KIND_OPTIONS.map((option) => ({
        label: option.label,
        value: option.value,
      }))}
      value={value}
    />
  )
}
