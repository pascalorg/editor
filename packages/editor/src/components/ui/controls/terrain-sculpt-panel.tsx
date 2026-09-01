'use client'

import {
  type AnyNodeId,
  RAISE_METRES_PER_STROKE,
  type SiteNode,
  type TerrainVerb,
  useScene,
} from '@pascal-app/core'
import { Mountain, Pipette } from 'lucide-react'
import { useTranslations, type Translator } from '../../../lib/i18n'
import { brushRadiusRange, flattenSite, resetSiteTerrain } from '../../../lib/terrain-sculpt'
import useEditor from '../../../store/use-editor'
import { Button } from '../primitives/button'
import { SegmentedControl } from './segmented-control'
import { SliderControl } from './slider-control'

// Verb hints and labels are resolved via i18n at render time so this panel
// stays a presentational client of `useTranslations()`.
const VERB_OPTIONS: Array<{
  value: TerrainVerb
  iconSrc: string
  labelKey: string
  hintKey: string
}> = [
  { value: 'raise', iconSrc: '/icons/terrain-raise.webp', labelKey: 'terrain.verb.raise', hintKey: 'terrain.hint.raise' },
  { value: 'lower', iconSrc: '/icons/terrain-lower.webp', labelKey: 'terrain.verb.lower', hintKey: 'terrain.hint.lower' },
  {
    value: 'flatten',
    iconSrc: '/icons/terrain-flatten.webp',
    labelKey: 'terrain.verb.flatten',
    hintKey: 'terrain.hint.flatten',
  },
  { value: 'smooth', iconSrc: '/icons/terrain-smooth.webp', labelKey: 'terrain.verb.smooth', hintKey: 'terrain.hint.smooth' },
]

function resolveVerbHint(t: Translator, verb: TerrainVerb): string {
  const metres = RAISE_METRES_PER_STROKE
  switch (verb) {
    case 'raise':
      return t('terrain.hint.raise', { metres })
    case 'lower':
      return t('terrain.hint.lower', { metres })
    case 'flatten':
      return t('terrain.hint.flatten')
    case 'smooth':
      return t('terrain.hint.smooth')
    default:
      return ''
  }
}

/**
 * Sculpt controls for terrain mode — verb, brush, and the two lot-wide actions.
 *
 * A panel rather than a floating HUD because the brush settings are the sort of
 * thing a user adjusts between strokes and then leaves alone, and because
 * sculpting already owns the whole viewport pointer: putting controls over the
 * canvas would put them over the surface being sculpted.
 *
 * Embedders mount this wherever their sculpt controls belong (the community
 * editor puts it in the Build sidebar while sculpt mode is active), exactly like
 * `MaterialPaintPanel`.
 */
export function TerrainSculptPanel() {
  const t = useTranslations()
  const verb = useEditor((state) => state.terrainVerb)
  const setTerrainVerb = useEditor((state) => state.setTerrainVerb)
  const brush = useEditor((state) => state.terrainBrush)
  const setTerrainBrush = useEditor((state) => state.setTerrainBrush)
  const flattenTarget = useEditor((state) => state.terrainFlattenTarget)
  const setTerrainFlattenTarget = useEditor((state) => state.setTerrainFlattenTarget)
  const sampling = useEditor((state) => state.terrainSampling)
  const setTerrainSampling = useEditor((state) => state.setTerrainSampling)

  const nodes = useScene((state) => state.nodes)
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const siteId = rootNodeIds[0]
  const siteNode = siteId ? nodes[siteId as AnyNodeId] : undefined
  const site = siteNode?.type === 'site' ? (siteNode as SiteNode) : null
  const [minRadius, maxRadius] = brushRadiusRange(site)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <SegmentedControl
          className="h-14"
          onChange={(next) => setTerrainVerb(next)}
          options={VERB_OPTIONS.map(({ value, iconSrc, labelKey }) => ({
            value,
            label: (
              <span className="flex flex-col items-center gap-0.5">
                <img
                  alt=""
                  aria-hidden
                  className="size-7 object-contain"
                  draggable={false}
                  height={28}
                  src={iconSrc}
                  width={28}
                />
                <span className="text-[9px] leading-none">{t(labelKey)}</span>
              </span>
            ),
          }))}
          value={verb}
        />
        <p className="px-0.5 text-muted-foreground text-xs">{resolveVerbHint(t, verb)}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        {/*
          Range from `brushRadiusRange`, shared with the `[`/`]` keys. The low end
          is not a preference: it tracks the field's sample spacing, and a brush
          under it lands between samples and paints nothing at all.
        */}
        <SliderControl
          label={t('terrain.brush.size')}
          max={maxRadius}
          min={minRadius}
          onChange={(radius) => setTerrainBrush({ radius })}
          precision={1}
          step={0.5}
          unit="m"
          value={brush.radius}
        />
        <SliderControl
          label={t('terrain.brush.strength')}
          max={1}
          min={0.05}
          onChange={(strength) => setTerrainBrush({ strength })}
          precision={2}
          step={0.05}
          value={brush.strength}
        />
        <SliderControl
          label={t('terrain.brush.softness')}
          max={1}
          min={0}
          onChange={(falloff) => setTerrainBrush({ falloff })}
          precision={2}
          step={0.05}
          value={brush.falloff}
        />
        <SegmentedControl
          onChange={(shape) => setTerrainBrush({ shape })}
          options={[
            { value: 'round', label: t('terrain.brush.round') },
            { value: 'square', label: t('terrain.brush.square') },
          ]}
          value={brush.shape}
        />
      </div>

      {verb === 'flatten' && (
        <div className="flex flex-col gap-1.5 border-border/60 border-t pt-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <SliderControl
                label={t('terrain.flatten.target')}
                max={50}
                min={-50}
                onChange={setTerrainFlattenTarget}
                precision={2}
                step={0.1}
                unit="m"
                value={flattenTarget ?? 0}
              />
            </div>
            <Button
              aria-label={t('terrain.flatten.pickTarget')}
              aria-pressed={sampling}
              onClick={() => setTerrainSampling(!sampling)}
              size="icon-sm"
              type="button"
              variant={sampling ? 'default' : 'outline'}
            >
              <Pipette />
            </Button>
          </div>
          <p className="px-0.5 text-muted-foreground text-xs">
            {sampling
              ? t('terrain.flatten.samplingHint')
              : flattenTarget === null
                ? t('terrain.flatten.noTargetHint')
                : t('terrain.flatten.targetHint')}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 border-border/60 border-t pt-3">
        <Button
          className="flex-1"
          disabled={!site}
          onClick={() => site && flattenSite(site, flattenTarget ?? 0)}
          size="sm"
          type="button"
          variant="outline"
        >
          <Mountain />
          {t('terrain.levelLot')}
        </Button>
        <Button
          className="flex-1"
          disabled={!site?.terrain}
          onClick={() => site && resetSiteTerrain(site)}
          size="sm"
          type="button"
          variant="outline"
        >
          {t('terrain.clearTerrain')}
        </Button>
      </div>
    </div>
  )
}
