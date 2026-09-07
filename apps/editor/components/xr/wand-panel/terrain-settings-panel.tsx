'use client'

import { type SiteNode, type TerrainVerb, useScene } from '@pascal-app/core'
import { brushRadiusRange, flattenSite, resetSiteTerrain, useEditor } from '@pascal-app/editor'
import { useXRWandPanelSettings } from '@/lib/xr/wand-panel-settings'
import { getPage } from './panel-layout'
import {
  PageArrows,
  PanelHeader,
  SettingChoice,
  SettingCycle,
  SettingStepper,
} from './spatial-controls'

const TERRAIN_VERBS: TerrainVerb[] = ['raise', 'lower', 'flatten', 'smooth']
const ROWS_PER_PAGE = 5

export function XRTerrainSettingsPanel() {
  const page = useXRWandPanelSettings((state) => state.terrainPage)
  const setPage = useXRWandPanelSettings((state) => state.setTerrainPage)
  const verb = useEditor((state) => state.terrainVerb)
  const setVerb = useEditor((state) => state.setTerrainVerb)
  const brush = useEditor((state) => state.terrainBrush)
  const setBrush = useEditor((state) => state.setTerrainBrush)
  const flattenTarget = useEditor((state) => state.terrainFlattenTarget)
  const setFlattenTarget = useEditor((state) => state.setTerrainFlattenTarget)
  const sampling = useEditor((state) => state.terrainSampling)
  const setSampling = useEditor((state) => state.setTerrainSampling)
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

  const rows = [
    <SettingCycle
      key="verb"
      label="Brush"
      name="xr-terrain-verb"
      next={() => cycleVerb(1)}
      previous={() => cycleVerb(-1)}
      value={verb.charAt(0).toUpperCase() + verb.slice(1)}
    />,
    <SettingStepper
      key="radius"
      label="Size"
      max={maxRadius}
      min={minRadius}
      name="xr-terrain-radius"
      onChange={(radius) => setBrush({ radius })}
      step={0.5}
      unit="m"
      value={Math.max(minRadius, Math.min(maxRadius, brush.radius))}
    />,
    <SettingStepper
      key="strength"
      label="Strength"
      max={1}
      min={0.05}
      name="xr-terrain-strength"
      onChange={(strength) => setBrush({ strength })}
      step={0.05}
      value={brush.strength}
    />,
    <SettingStepper
      key="softness"
      label="Softness"
      max={1}
      min={0}
      name="xr-terrain-softness"
      onChange={(falloff) => setBrush({ falloff })}
      step={0.05}
      value={brush.falloff}
    />,
    <SettingChoice
      key="shape"
      label="Shape"
      name="xr-terrain-shape"
      onClick={() => setBrush({ shape: brush.shape === 'round' ? 'square' : 'round' })}
      value={brush.shape === 'round' ? 'Round' : 'Square'}
    />,
    ...(verb === 'flatten'
      ? [
          <SettingStepper
            key="target"
            label="Target"
            max={50}
            min={-50}
            name="xr-terrain-target"
            onChange={setFlattenTarget}
            step={0.1}
            unit="m"
            value={flattenTarget ?? 0}
          />,
          <SettingChoice
            key="sampling"
            label="Pick height"
            name="xr-terrain-sampling"
            onClick={() => setSampling(!sampling)}
            value={sampling ? 'Armed' : 'Off'}
          />,
        ]
      : []),
    <SettingChoice
      key="level"
      label="Whole lot"
      name="xr-terrain-level-lot"
      onClick={site ? () => flattenSite(site, flattenTarget ?? 0) : undefined}
      value="Level"
    />,
    <SettingChoice
      key="clear"
      label="Terrain"
      name="xr-terrain-clear"
      onClick={site?.terrain ? () => resetSiteTerrain(site) : undefined}
      value={site?.terrain ? 'Clear' : 'Empty'}
    />,
  ]
  const current = getPage(rows, page, ROWS_PER_PAGE)

  return (
    <group name="xr-wand-settings-panel">
      <PanelHeader mark={`${rows.length} controls`} title="Terrain" />
      {current.items.map((row, index) => (
        <group key={row.key ?? index} position={[0, 0.29 - index * 0.125, 0]}>
          {row}
        </group>
      ))}
      {current.pageCount > 1 && (
        <PageArrows
          name="xr-terrain-settings"
          onChange={setPage}
          page={current.currentPage}
          pageCount={current.pageCount}
        />
      )}
    </group>
  )
}
