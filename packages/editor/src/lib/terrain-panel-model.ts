'use client'

import { type SiteNode, type TerrainVerb, useScene } from '@pascal-app/core'
import useEditor, { selectActiveTerrainVerb } from '../store/use-editor'
import type { PanelRow } from './panel-rows'
import { brushRadiusRange, flattenSite, resetSiteTerrain, slopeSite } from './terrain-sculpt'

const TERRAIN_VERBS: TerrainVerb[] = ['raise', 'lower', 'flatten', 'smooth', 'slope']

export function useTerrainPanelRows(): PanelRow[] {
  const verb = useEditor(selectActiveTerrainVerb)
  const setVerb = useEditor((state) => state.setActiveTerrainVerb)
  const brush = useEditor((state) => state.terrainBrush)
  const setBrush = useEditor((state) => state.setTerrainBrush)
  const flattenTarget = useEditor((state) => state.terrainFlattenTarget)
  const setFlattenTarget = useEditor((state) => state.setTerrainFlattenTarget)
  const sampling = useEditor((state) => state.terrainSampling)
  const setSampling = useEditor((state) => state.setTerrainSampling)
  const slope = useEditor((state) => state.terrainSlope)
  const setSlope = useEditor((state) => state.setTerrainSlope)
  const site = useScene((state) => {
    const root = state.rootNodeIds[0]
    const node = root ? state.nodes[root] : undefined
    return node?.type === 'site' ? (node as SiteNode) : null
  })
  const [minRadius, maxRadius] = brushRadiusRange(site)
  const verbIndex = TERRAIN_VERBS.indexOf(verb)
  const cycleVerb = (direction: -1 | 1) => {
    const next =
      TERRAIN_VERBS[(verbIndex + direction + TERRAIN_VERBS.length) % TERRAIN_VERBS.length]
    if (next) setVerb(next)
  }

  const rows: PanelRow[] = [
    {
      id: 'terrain-verb',
      kind: 'cycle',
      label: 'Brush',
      next: () => cycleVerb(1),
      previous: () => cycleVerb(-1),
      value: verb.charAt(0).toUpperCase() + verb.slice(1),
    },
    {
      id: 'terrain-radius',
      kind: 'stepper',
      label: 'Size',
      max: maxRadius,
      min: minRadius,
      onChange: (radius) => setBrush({ radius }),
      step: 0.5,
      unit: 'm',
      value: Math.max(minRadius, Math.min(maxRadius, brush.radius)),
    },
    {
      id: 'terrain-strength',
      kind: 'stepper',
      label: 'Strength',
      max: 1,
      min: 0.05,
      onChange: (strength) => setBrush({ strength }),
      step: 0.05,
      value: brush.strength,
    },
    {
      id: 'terrain-softness',
      kind: 'stepper',
      label: 'Softness',
      max: 1,
      min: 0,
      onChange: (falloff) => setBrush({ falloff }),
      step: 0.05,
      value: brush.falloff,
    },
    {
      id: 'terrain-shape',
      kind: 'choice',
      label: 'Shape',
      onSelect: () => setBrush({ shape: brush.shape === 'round' ? 'square' : 'round' }),
      value: brush.shape === 'round' ? 'Round' : 'Square',
    },
    ...(verb === 'flatten'
      ? ([
          {
            id: 'terrain-target',
            kind: 'stepper',
            label: 'Target',
            max: 50,
            min: -50,
            onChange: setFlattenTarget,
            step: 0.1,
            unit: 'm',
            value: flattenTarget ?? 0,
          },
          {
            id: 'terrain-sampling',
            kind: 'choice',
            label: 'Pick height',
            onSelect: () => setSampling(!sampling),
            value: sampling ? 'Armed' : 'Off',
          },
        ] satisfies PanelRow[])
      : []),
    ...(verb === 'slope'
      ? ([
          {
            id: 'terrain-slope-pitch',
            kind: 'stepper',
            label: 'Pitch',
            max: 45,
            min: 0,
            onChange: (pitch) => setSlope({ pitch }),
            step: 0.5,
            unit: '°',
            value: slope.pitch,
          },
          {
            id: 'terrain-slope-direction',
            kind: 'stepper',
            label: 'Direction',
            max: 360,
            min: 0,
            onChange: (direction) => setSlope({ direction }),
            step: 5,
            unit: '°',
            value: slope.direction,
          },
          {
            id: 'terrain-slope-elevation',
            kind: 'stepper',
            label: 'Base height',
            max: 50,
            min: -50,
            onChange: (baseElevation) => setSlope({ baseElevation }),
            step: 0.1,
            unit: 'm',
            value: slope.baseElevation,
          },
          {
            id: 'terrain-slope-lot',
            kind: 'choice',
            label: 'Whole lot',
            onSelect: site ? () => slopeSite(site, slope) : undefined,
            value: 'Slope',
          },
        ] satisfies PanelRow[])
      : []),
    {
      id: 'terrain-level-lot',
      kind: 'choice',
      label: 'Whole lot',
      onSelect: site ? () => flattenSite(site, flattenTarget ?? 0) : undefined,
      value: 'Level',
    },
    {
      id: 'terrain-clear',
      kind: 'choice',
      label: 'Terrain',
      onSelect: site?.terrain ? () => resetSiteTerrain(site) : undefined,
      value: site?.terrain ? 'Clear' : 'Empty',
    },
  ]
  return rows
}
