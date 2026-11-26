'use client'

import {
  type AnyNodeId,
  MAX_TERRAIN_SLOPE_PITCH,
  normalizeTerrainSlopeDirection,
  RAISE_METRES_PER_STROKE,
  type SiteNode,
  type TerrainSlopeAnchor,
  type TerrainVerb,
  terrainSlopeElevationRange,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Button } from '@pascal-app/viewer/ui'
import { ArrowLeftRight, Mountain, Pipette, RotateCw, TrendingUp, X } from 'lucide-react'
import {
  brushRadiusRange,
  flattenSite,
  resetSiteTerrain,
  slopeSite,
} from '../../../lib/terrain-sculpt'
import useEditor, { selectActiveTerrainVerb } from '../../../store/use-editor'
import { formatMeasurement } from '../../editor/measurement-pill'
import { SegmentedControl } from './segmented-control'
import { SliderControl } from './slider-control'

const VERB_OPTIONS: Array<{ value: TerrainVerb; iconSrc?: string; hint?: string }> = [
  { value: 'raise', iconSrc: '/icons/terrain-raise.webp', hint: 'Raise' },
  { value: 'lower', iconSrc: '/icons/terrain-lower.webp', hint: 'Lower' },
  { value: 'flatten', iconSrc: '/icons/terrain-flatten.webp', hint: 'Flatten' },
  { value: 'smooth', iconSrc: '/icons/terrain-smooth.webp', hint: 'Smooth' },
  { value: 'slope' },
]

const VERB_HINTS: Record<Exclude<TerrainVerb, 'slope'>, string> = {
  raise: `Drag to raise the ground. One pass moves it up to ${RAISE_METRES_PER_STROKE} m — release and drag again to go further.`,
  lower: `Drag to lower the ground. One pass moves it down to ${RAISE_METRES_PER_STROKE} m.`,
  flatten: 'Drag to level the ground toward the target height. It never overshoots.',
  smooth: 'Drag to soften slopes and remove ridges. Flat ground stays flat.',
}

const SLOPE_PRESETS: Array<{ id: string; pitch: number; rawLabel?: string }> = [
  { id: 'flat', pitch: 0 },
  { id: '2pct', pitch: Math.round(Math.atan(0.02) * (180 / Math.PI) * 10) / 10, rawLabel: '2%' },
  { id: '5pct', pitch: Math.round(Math.atan(0.05) * (180 / Math.PI) * 10) / 10, rawLabel: '5%' },
  {
    id: '1to12',
    pitch: Math.round(Math.atan(1 / 12) * (180 / Math.PI) * 10) / 10,
    rawLabel: '1:12',
  },
  { id: '12pct', pitch: Math.round(Math.atan(0.12) * (180 / Math.PI) * 10) / 10, rawLabel: '12%' },
]

/**
 * Sculpt controls for terrain mode — verb, brush, and lot-wide actions.
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
  const i18n = usePascalI18n()
  const verb = useEditor(selectActiveTerrainVerb)
  const setTerrainVerb = useEditor((state) => state.setActiveTerrainVerb)
  const brush = useEditor((state) => state.terrainBrush)
  const setTerrainBrush = useEditor((state) => state.setTerrainBrush)
  const flattenTarget = useEditor((state) => state.terrainFlattenTarget)
  const setTerrainFlattenTarget = useEditor((state) => state.setTerrainFlattenTarget)
  const sampling = useEditor((state) => state.terrainSampling)
  const setTerrainSampling = useEditor((state) => state.setTerrainSampling)
  const slope = useEditor((state) => state.terrainSlope)
  const setTerrainSlope = useEditor((state) => state.setTerrainSlope)
  const slopeAnchor = useEditor((state) => state.terrainSlopeAnchor)
  const setTerrainSlopeAnchor = useEditor((state) => state.setTerrainSlopeAnchor)
  const slopePickStart = useEditor((state) => state.terrainSlopePickStart)

  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)

  const nodes = useScene((state) => state.nodes)
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const siteId = rootNodeIds[0]
  const siteNode = siteId ? nodes[siteId as AnyNodeId] : undefined
  const site = siteNode?.type === 'site' ? (siteNode as SiteNode) : null
  const [minRadius, maxRadius] = brushRadiusRange(site)

  const slopeRange =
    verb === 'slope' ? terrainSlopeElevationRange(site?.polygon?.points ?? [], slope) : null

  const verbHintText =
    verb === 'slope'
      ? i18n._({
          id: 'editor.controls.terrainSculptPanel.slopeHint',
          message:
            'Drag to grade the ground along an inclined plane, pick A → B to match two points, or apply the slope to the whole lot.',
        })
      : VERB_HINTS[verb]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <SegmentedControl
          className="h-14"
          onChange={(next) => setTerrainVerb(next)}
          options={VERB_OPTIONS.map(({ value, iconSrc, hint }) => ({
            value,
            label: (
              <span className="flex flex-col items-center gap-0.5">
                {iconSrc ? (
                  <img
                    alt=""
                    aria-hidden
                    className="size-7 object-contain"
                    draggable={false}
                    height={28}
                    src={iconSrc}
                    width={28}
                  />
                ) : (
                  <span className="flex size-7 items-center justify-center">
                    <TrendingUp aria-hidden className="size-5" />
                  </span>
                )}
                <span className="text-[9px] leading-none">
                  {value === 'slope'
                    ? i18n._({
                        id: 'editor.controls.terrainSculptPanel.slope',
                        message: 'Slope',
                      })
                    : hint}
                </span>
              </span>
            ),
          }))}
          value={verb}
        />
        <p className="px-0.5 text-muted-foreground text-xs">{verbHintText}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        {/*
          Range from `brushRadiusRange`, shared with the `[`/`]` keys. The low end
          is not a preference: it tracks the field's sample spacing, and a brush
          under it lands between samples and paints nothing at all.
        */}
        <SliderControl
          label="Size"
          max={maxRadius}
          min={minRadius}
          onChange={(radius) => setTerrainBrush({ radius })}
          precision={1}
          step={0.5}
          unit="m"
          value={brush.radius}
        />
        <SliderControl
          label="Strength"
          max={1}
          min={0.05}
          onChange={(strength) => setTerrainBrush({ strength })}
          precision={2}
          step={0.05}
          value={brush.strength}
        />
        <SliderControl
          label="Softness"
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
            { value: 'round', label: 'Round' },
            { value: 'square', label: 'Square' },
          ]}
          value={brush.shape}
        />
      </div>

      {verb === 'flatten' && (
        <div className="flex flex-col gap-1.5 border-border/60 border-t pt-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <SliderControl
                label="Target"
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
              aria-label="Pick target height from the ground"
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
              ? 'Click the ground to pick its height as the target.'
              : flattenTarget === null
                ? 'No target yet — the first click samples the ground under it.'
                : 'Every flatten stroke levels toward this height.'}
          </p>
        </div>
      )}

      {verb === 'slope' && (
        <div className="flex flex-col gap-2 border-border/60 border-t pt-3">
          <div className="grid grid-cols-5 gap-1">
            {SLOPE_PRESETS.map((preset) => {
              const active = Math.abs(slope.pitch - preset.pitch) < 0.05
              const label =
                preset.rawLabel ??
                i18n._({
                  id: 'editor.controls.terrainSculptPanel.presetFlat',
                  message: 'Flat',
                })
              return (
                <Button
                  className="h-7 px-1 text-[11px]"
                  key={preset.id}
                  onClick={() => setTerrainSlope({ pitch: preset.pitch })}
                  size="sm"
                  type="button"
                  variant={active ? 'default' : 'outline'}
                >
                  {label}
                </Button>
              )
            })}
          </div>

          <SliderControl
            label={i18n._({
              id: 'editor.controls.terrainSculptPanel.pitch',
              message: 'Pitch',
            })}
            max={MAX_TERRAIN_SLOPE_PITCH}
            min={0}
            onChange={(pitch) => setTerrainSlope({ pitch })}
            precision={1}
            step={0.5}
            unit="°"
            value={slope.pitch}
          />

          <div className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <SliderControl
                label={i18n._({
                  id: 'editor.controls.terrainSculptPanel.direction',
                  message: 'Direction',
                })}
                onChange={(direction) =>
                  setTerrainSlope({ direction: normalizeTerrainSlopeDirection(direction) })
                }
                precision={0}
                step={5}
                unit="°"
                value={slope.direction}
              />
            </div>
            <Button
              aria-label={i18n._({
                id: 'editor.controls.terrainSculptPanel.rotateSlope90Aria',
                message: 'Rotate slope direction 90 degrees',
              })}
              onClick={() =>
                setTerrainSlope({ direction: normalizeTerrainSlopeDirection(slope.direction + 90) })
              }
              size="icon-sm"
              title={i18n._({
                id: 'editor.controls.terrainSculptPanel.rotate90',
                message: 'Rotate 90°',
              })}
              type="button"
              variant="outline"
            >
              <RotateCw className="size-3.5" />
            </Button>
            <Button
              aria-label={i18n._({
                id: 'editor.controls.terrainSculptPanel.flipSlope180Aria',
                message: 'Flip slope direction 180 degrees',
              })}
              onClick={() =>
                setTerrainSlope({
                  direction: normalizeTerrainSlopeDirection(slope.direction + 180),
                })
              }
              size="icon-sm"
              title={i18n._({
                id: 'editor.controls.terrainSculptPanel.flip180',
                message: 'Flip 180°',
              })}
              type="button"
              variant="outline"
            >
              <ArrowLeftRight className="size-3.5" />
            </Button>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <SliderControl
                label={i18n._({
                  id: 'editor.controls.terrainSculptPanel.elevation',
                  message: 'Elevation',
                })}
                max={50}
                min={-50}
                onChange={(baseElevation) => {
                  setTerrainSlopeAnchor(null)
                  setTerrainSlope({ baseElevation })
                }}
                precision={2}
                step={0.1}
                unit="m"
                value={slope.baseElevation}
              />
            </div>
            <Button
              aria-label={i18n._({
                id: 'editor.controls.terrainSculptPanel.pickSlopePointsAria',
                message: 'Pick two points on the ground to match slope',
              })}
              aria-pressed={sampling}
              onClick={() => setTerrainSampling(!sampling)}
              size="icon-sm"
              title={i18n._({
                id: 'editor.controls.terrainSculptPanel.pickSlopeTitle',
                message: 'Pick A → B slope',
              })}
              type="button"
              variant={sampling ? 'default' : 'outline'}
            >
              <Pipette />
            </Button>
          </div>

          <SegmentedControl
            onChange={(anchor: TerrainSlopeAnchor) => {
              setTerrainSlopeAnchor(null)
              setTerrainSlope({ anchor })
            }}
            options={[
              {
                value: 'center',
                label: i18n._({
                  id: 'editor.controls.terrainSculptPanel.anchorCenter',
                  message: 'Anchor: Center',
                }),
              },
              {
                value: 'low-edge',
                label: i18n._({
                  id: 'editor.controls.terrainSculptPanel.anchorLowEdge',
                  message: 'Low edge',
                }),
              },
            ]}
            value={slope.anchor ?? 'center'}
          />

          {slopeRange && (
            <div className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1 text-muted-foreground text-xs">
              <span>
                {i18n._({
                  id: 'editor.controls.terrainSculptPanel.gradeReadout',
                  message: 'Grade {percent}%',
                  values: { percent: slopeRange.gradePercent.toFixed(1) },
                })}
              </span>
              <span className="font-mono">
                {formatMeasurement(slopeRange.min, unit, metricNotation)} →{' '}
                {formatMeasurement(slopeRange.max, unit, metricNotation)}
              </span>
            </div>
          )}

          {slopeAnchor && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1 text-xs">
              <span className="truncate text-muted-foreground">
                {i18n._({
                  id: 'editor.controls.terrainSculptPanel.anchoredAt',
                  message: 'Anchored at {elevation}',
                  values: { elevation: formatMeasurement(slopeAnchor[2], unit, metricNotation) },
                })}
              </span>
              <Button
                aria-label={i18n._({
                  id: 'editor.controls.terrainSculptPanel.clearSlopeAnchorAria',
                  message: 'Clear picked slope anchor',
                })}
                className="h-5 px-1.5 text-[11px]"
                onClick={() => setTerrainSlopeAnchor(null)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <X className="size-3" />
                {i18n._({
                  id: 'editor.controls.terrainSculptPanel.clearAnchor',
                  message: 'Clear',
                })}
              </Button>
            </div>
          )}

          <p className="px-0.5 text-muted-foreground text-xs">
            {sampling
              ? slopePickStart
                ? i18n._({
                    id: 'editor.controls.terrainSculptPanel.pickEndHint',
                    message:
                      'Click a second point on the ground to match its slope and direction.',
                  })
                : i18n._({
                    id: 'editor.controls.terrainSculptPanel.pickStartHint',
                    message: 'Click a start point on the ground for the slope.',
                  })
              : slopeAnchor
                ? i18n._({
                    id: 'editor.controls.terrainSculptPanel.anchoredBrushHint',
                    message:
                      'Brush strokes grade onto the picked A → B plane. Clear anchor to grade from click height.',
                  })
                : i18n._({
                    id: 'editor.controls.terrainSculptPanel.freeBrushHint',
                    message:
                      'Brush strokes start from the height where you click, or apply this grade across the whole lot.',
                  })}
          </p>

          <Button
            className="w-full"
            disabled={!site}
            onClick={() => {
              if (!site) return
              setTerrainSlopeAnchor(null)
              slopeSite(site, slope)
            }}
            size="sm"
            type="button"
            variant="secondary"
          >
            <TrendingUp />
            {i18n._({
              id: 'editor.controls.terrainSculptPanel.slopeLot',
              message: 'Slope lot',
            })}
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2 border-border/60 border-t pt-3">
        <Button
          className="flex-1"
          disabled={!site}
          onClick={() => {
            if (!site) return
            setTerrainSlopeAnchor(null)
            flattenSite(site, flattenTarget ?? 0)
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          <Mountain />
          Level lot
        </Button>
        <Button
          className="flex-1"
          disabled={!site?.terrain}
          onClick={() => {
            if (!site) return
            setTerrainSlopeAnchor(null)
            resetSiteTerrain(site)
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          Clear terrain
        </Button>
      </div>
    </div>
  )
}
