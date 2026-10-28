'use client'

import {
  type AnyNode,
  type AnyNodeId,
  DEFAULT_FLOOR_BUILD_UP,
  defaultI18n,
  FLOOR_BUILD_UP_PRESETS,
  type FloorBuildUp,
  type FloorFoundationPatch,
  floorBuildUpMatches,
  floorBuildUpOf,
  floorBuildUpThickness,
  floorFootprintSupportClass,
  formatList,
  upperFloorHeightControl,
  getLevelElevations,
  getStoredLevelHeight,
  type LevelNode,
  MIN_GROUND_FLOOR_THICKNESS,
  MIN_SLAB_THICKNESS,
  type PascalI18n,
  type SlabNode,
  useLocale,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { localizedFloorFootprintName } from '../../../i18n/floor-footprint-name'
import { localizedLevelName } from '../../../i18n/level-name'
import { useRef, useState } from 'react'
import {
  applyFloorBuildUp,
  applyFloorFoundation,
  beginFootprintHeightPreview,
  beginFootprintThicknessPreview,
  type FootprintPreset,
  footprintHeightMinimum,
  footprintHeightPatch,
  footprintHeightValue,
  footprintPreset,
  footprintsToMoveTogether,
  floorTopAboveGround,
  presetPatch,
  THICK_FLOOR_HINT,
  thickFloorAdvice,
} from '../../../lib/floor-footprints'
import { buildingOfPlate, floorHeldByDesignedFoundation } from '../../../lib/building-foundation'
import { formatLinearMeasurement } from '../../../lib/measurements'
import { formatLayerDepth } from '../../../lib/layer-thickness'
import { FinishSwatch } from '../controls/finish-swatch'
import { MetricControl } from '../controls/metric-control'
import { SegmentedControl } from '../controls/segmented-control'
import { Button } from '../primitives/button'
import {
  BuildingFoundationSection,
  calloutName,
  FloorBuildUpFields,
  floorSectionLayers,
  SECTION_LAYER_FILL,
  type SectionLayer,
  stackLabels,
} from './building-foundation-section'
import { PanelWrapper } from './panel-wrapper'

/** Unpainted finishes, as the plate renders them (nodes' slab slot defaults). */
const EDGE_DEFAULT = '#cccccc'
const FOUNDATION_DEFAULT = 'library:concrete-raw'

/**
 * A side section through the footprint's edge, top to bottom in the order it
 * is built. On the ground: the floor top, the slab, the foundation when the
 * footprint is raised on one, the ground — the slab always sits on the
 * foundation (or the ground), so the top is their sum. Upstairs: the floor
 * plate resting on the walls of the storey below, drawn as its layers when it
 * has them (flooring, sheathing, joists, ceiling; a layer that is off is not
 * drawn). Drawn to a readable scale, not to size.
 */
export function FloorSection({
  supported,
  raised,
  lift = 0,
  liftLabel = '',
  foundationHeight = 0,
  foundationLabel = '',
  topLabel,
  thickness,
  thicknessLabel,
  layers,
}: {
  /** Upstairs (or over a basement): it rests on the walls below, never on a foundation. */
  supported: boolean
  /** On a foundation (ground-bearing footprints only). */
  raised: boolean
  /** Upstairs: meters the top sits above resting on the walls below. */
  lift?: number
  liftLabel?: string
  /** On the ground: the foundation's height, meters. */
  foundationHeight?: number
  foundationLabel?: string
  /** On the ground: the floor top above the ground (foundation + slab). */
  topLabel?: string
  thickness: number
  thicknessLabel: string
  /** Upstairs: the plate's layers, top down (`floorSectionLayers`), drawn in place of one band. */
  layers?: readonly SectionLayer[]
}) {
  const i18n = usePascalI18n()
  const locale = useLocale()
  const base = 100
  const foundation = !supported && raised ? Math.min(40, 14 + foundationHeight * 30) : 0
  // Not to scale: a thin layer still reads, and the joists take most of the plate.
  const drawn = supported ? (layers ?? []).filter((layer) => layer.thickness > 0) : []
  const layerHeight = (layer: SectionLayer) => Math.max(3, Math.min(20, layer.thickness * 70))
  const band =
    drawn.length > 0
      ? drawn.reduce((sum, layer) => sum + layerHeight(layer), 0)
      : Math.max(7, Math.min(16, thickness * 60))
  // Upstairs a lift moves the plate off its default position (on the walls below).
  const upstairsLift =
    supported && Math.abs(lift) > 0.005
      ? lift > 0
        ? Math.min(18, 6 + lift * 30)
        : -Math.min(10, 4 + -lift * 30)
      : 0
  const bandBottom = base - foundation - upstairsLift
  const bandTop = bandBottom - band
  // Upstairs the lift is measured from resting on the walls below; on the
  // ground the top is measured from the ground.
  const measureFrom = supported ? base - band : base
  const measured = supported ? Math.abs(lift) > 0.005 : true
  const measureLabel = supported ? liftLabel : (topLabel ?? '')
  const left = 64
  // The layers' names need more room beside the plate than one band's.
  const right = drawn.length > 0 ? 136 : 164
  const bands: { layer: SectionLayer; y: number; height: number }[] = []
  for (const layer of drawn) {
    const last = bands[bands.length - 1]
    bands.push({ layer, y: last ? last.y + last.height : bandTop, height: layerHeight(layer) })
  }
  const labels: { y: number; text: string; key: string }[] = [
    {
      key: 'top',
      y: bandTop - 9,
      text: i18n._({ id: 'editor.panels.floorFoundationPanel.section.floorTop', message: 'Floor top' }),
    },
    ...(bands.length > 0
      ? bands.map(({ layer, y, height }) => ({
          key: `layer-${layer.key}`,
          y: y + height / 2,
          text: i18n._({
            id: 'editor.panels.floorFoundationPanel.section.layer',
            message: '{layer} · {size}',
            values: { layer: calloutName(layer.name), size: layer.size },
          }),
        }))
      : [
          {
            key: 'plate',
            y: bandTop + band / 2,
            text: supported
              ? i18n._({
                  id: 'editor.panels.floorFoundationPanel.section.floorPlate',
                  message: 'Floor plate · {thickness}',
                  values: { thickness: thicknessLabel },
                })
              : i18n._({
                  id: 'editor.panels.floorFoundationPanel.section.slab',
                  message: 'Slab · {thickness}',
                  values: { thickness: thicknessLabel },
                }),
          },
        ]),
    ...(foundation
      ? [
          {
            key: 'foundation',
            y: bandBottom + foundation / 2,
            text: foundationLabel
              ? i18n._({
                  id: 'editor.panels.floorFoundationPanel.section.foundationKind',
                  message: 'Foundation · {foundation}',
                  values: { foundation: foundationLabel },
                })
              : i18n._({ id: 'editor.panels.floorFoundationPanel.section.foundation', message: 'Foundation' }),
          },
        ]
      : []),
    {
      key: 'base',
      y: base + 9,
      text: supported
        ? i18n._({ id: 'editor.panels.floorFoundationPanel.section.wallsBelow', message: 'Walls below' })
        : i18n._({ id: 'editor.panels.floorFoundationPanel.section.ground', message: 'Ground' }),
    },
  ]
  // Thin layers' names fan out round them, each led back to its layer.
  const placed = stackLabels(
    labels.map((label) => label.y),
    11,
    6,
    113,
  )
  return (
    <figure className="flex flex-col gap-1" data-floor-section>
      <svg
        aria-label={
          supported
            ? drawn.length > 0
              ? i18n._({
                  id: 'editor.panels.floorFoundationPanel.sectionLayers',
                  message: 'Floor plate {thickness} thick: {layers}; resting on the walls below',
                  values: {
                    thickness: thicknessLabel,
                    layers: formatList(
                      drawn.map((layer) =>
                        i18n._({
                          id: 'editor.panels.floorFoundationPanel.sectionLayerSize',
                          message: '{layer} {size}',
                          values: { layer: layer.name, size: layer.size },
                        }),
                      ),
                      locale,
                    ),
                  },
                })
              : i18n._({ id: 'editor.panels.floorFoundationPanel.floorPlateThicknesslabelThickRestingOn', message: 'Floor plate {thicknessLabel} thick, resting on the walls below', values: { thicknessLabel } })
            : raised
              ? i18n._({
                  id: 'editor.panels.floorFoundationPanel.sectionRaised',
                  message:
                    'Slab {thickness} thick on a {foundation} foundation, floor top {top} above the ground',
                  values: { thickness: thicknessLabel, foundation: foundationLabel, top: topLabel ?? '' },
                })
              : i18n._({
                  id: 'editor.panels.floorFoundationPanel.sectionOnGround',
                  message: 'Slab {thickness} thick on the ground, floor top {top} above the ground',
                  values: { thickness: thicknessLabel, top: topLabel ?? '' },
                })
        }
        className="h-auto w-full text-muted-foreground"
        role="img"
        viewBox="0 0 280 118"
      >
        {supported ? (
          // The walls of the storey below, under the plate's edge.
          <g data-section-walls-below>
            <rect
              className="fill-muted"
              height={118 - bandBottom}
              stroke="currentColor"
              strokeOpacity="0.4"
              width="14"
              x={left + 6}
              y={bandBottom}
            />
            <line
              opacity="0.6"
              stroke="currentColor"
              strokeDasharray="3 3"
              x1="8"
              x2={right}
              y1={base}
              y2={base}
            />
          </g>
        ) : (
          <g data-section-ground>
            <line stroke="currentColor" strokeWidth="1" x1="8" x2="272" y1={base} y2={base} />
            {Array.from({ length: 22 }, (_, i) => (
              <line
                key={i}
                opacity="0.35"
                stroke="currentColor"
                strokeWidth="1"
                x1={12 + i * 12}
                x2={6 + i * 12}
                y1={base + 1}
                y2={base + 7}
              />
            ))}
          </g>
        )}
        {/* A wall standing on the floor. */}
        <rect
          className="fill-muted"
          height={Math.min(26, bandTop - 12)}
          stroke="currentColor"
          strokeOpacity="0.4"
          width="14"
          x={left + 6}
          y={bandTop - Math.min(26, bandTop - 12)}
        />
        {foundation > 0 && (
          <rect
            data-section-foundation
            fill="#8a8a8a"
            height={foundation}
            stroke="currentColor"
            strokeOpacity="0.5"
            width={right - left - 8}
            x={left + 4}
            y={bandBottom}
          />
        )}
        {bands.length > 0 ? (
          <g data-section-band>
            {bands.map(({ layer, y, height }) => (
              <rect
                className={SECTION_LAYER_FILL[layer.key] ?? 'fill-foreground'}
                data-section-layer={layer.key}
                height={height}
                key={layer.key}
                stroke="currentColor"
                strokeOpacity="0.5"
                strokeWidth="0.75"
                width={right - left}
                x={left}
                y={y}
              />
            ))}
          </g>
        ) : (
          <rect
            className="fill-foreground"
            data-section-band
            height={band}
            width={right - left}
            x={left}
            y={bandTop}
          />
        )}
        {/* The floor top. */}
        <line
          className="text-foreground"
          stroke="currentColor"
          strokeWidth="1.5"
          x1={left - 4}
          x2={right + 4}
          y1={bandTop}
          y2={bandTop}
        />
        {measured && measureLabel && (
          <g className="text-foreground" data-section-height>
            <line stroke="currentColor" strokeWidth="1" x1="50" x2="50" y1={bandTop} y2={measureFrom} />
            <line stroke="currentColor" strokeWidth="1" x1="45" x2="55" y1={bandTop} y2={bandTop} />
            <line stroke="currentColor" strokeWidth="1" x1="45" x2="55" y1={measureFrom} y2={measureFrom} />
            {supported && (
              <line
                opacity="0.6"
                stroke="currentColor"
                strokeDasharray="2 3"
                x1="55"
                x2={left}
                y1={measureFrom}
                y2={measureFrom}
              />
            )}
            <text
              className="fill-foreground font-mono"
              dominantBaseline="middle"
              fontSize="10"
              textAnchor="end"
              x="42"
              y={(bandTop + measureFrom) / 2}
            >
              {measureLabel}
            </text>
          </g>
        )}
        {labels.map((label, index) => (
          <g key={label.key}>
            <polyline
              fill="none"
              opacity="0.6"
              points={`${right + 4},${label.y} ${right + 8},${placed[index]} ${right + 12},${placed[index]}`}
              stroke="currentColor"
            />
            <text
              className="fill-foreground"
              dominantBaseline="middle"
              fontSize="10"
              x={right + 16}
              y={placed[index]}
            >
              {label.text}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="text-right text-[10px] text-muted-foreground/70">
        {i18n._({ id: 'editor.panels.floorFoundationPanel.notToScale', message: 'Not to scale' })}
      </figcaption>
    </figure>
  )
}

/** Upstairs: "Floor top +9'2"", the sign written only over the ground (a length prints its own minus). */
export function upperFloorTopLabel(
  top: number,
  length: (meters: number) => string,
  i18n: PascalI18n = defaultI18n,
): string {
  return top > 0
    ? i18n._({
        id: 'editor.panels.floorFoundationPanel.floorTopAbove',
        message: 'Floor top +{height}',
        values: { height: length(top) },
      })
    : i18n._({
        id: 'editor.panels.floorFoundationPanel.floorTopValue',
        message: 'Floor top {height}',
        values: { height: length(top) },
      })
}

type Notice = {
  message: string
  /**
   * The footprints to move together, and the change, when that would be accepted; with the floor
   * layers that asked for it, written to this plate as it moves.
   */
  together: {
    ids: string[]
    patch: FloorFoundationPatch
    lower: boolean
    buildUp?: FloorBuildUp
  } | null
}

export function moveTogetherLabel(count: number, lower: boolean, i18n: PascalI18n) {
  const values = { count, number: String(count) }
  return lower
    ? i18n._({
        id: 'editor.panels.floorFoundationPanel.lowerTogether',
        message: '{count, plural, =2 {Lower both} other {Lower all {number}}}',
        values,
      })
    : i18n._({
        id: 'editor.panels.floorFoundationPanel.raiseTogether',
        message: '{count, plural, =2 {Raise both} other {Raise all {number}}}',
        values,
      })
}

/** "Floor plate · Ground floor", upstairs "Floor plate · Floor 1 · rests on Ground floor". */
export function floorPlateKicker(
  nodes: Record<string, AnyNode>,
  plate: SlabNode,
  i18n: PascalI18n,
  locale: string,
): string {
  const level = plate.parentId ? nodes[plate.parentId] : undefined
  // A supported floor rests on the storey right below it.
  let below: LevelNode | null = null
  if (level?.type === 'level' && floorFootprintSupportClass(nodes, plate) === 'supported')
    for (const node of Object.values(nodes))
      if (
        node.type === 'level' &&
        node.parentId === level.parentId &&
        node.level < level.level &&
        (!below || node.level > below.level)
      )
        below = node
  if (level?.type !== 'level')
    return i18n._({ id: 'editor.panels.floorFoundationPanel.kicker', message: 'Floor plate' })
  const levelName = localizedLevelName(level, i18n, locale)
  return below
    ? i18n._({
        id: 'editor.panels.floorFoundationPanel.kickerRestsOn',
        message: 'Floor plate · {level} · rests on {below}',
        values: { level: levelName, below: localizedLevelName(below, i18n, locale) },
      })
    : i18n._({
        id: 'editor.panels.floorFoundationPanel.kickerLevel',
        message: 'Floor plate · {level}',
        values: { level: levelName },
      })
}

/**
 * What the panel shows for a footprint. An upper floor rests on the walls
 * below: its height is its floor top, and raising it thickens the plate (the
 * two stay in sync); it has no ground preset and no foundation. A footprint on
 * the ground has two inputs, the slab thickness and the foundation height (0 on
 * the ground); its floor top above the ground is their sum, read-only.
 */
export function floorFoundationModel(nodes: Record<string, AnyNode>, plate: SlabNode) {
  const upper = upperFloorHeightControl(nodes, plate) !== null
  const height = footprintHeightValue(nodes, plate)
  const levelBase = plate.parentId
    ? (getLevelElevations(nodes as Record<AnyNodeId, AnyNode>).get(plate.parentId as AnyNodeId)
        ?.baseY ?? 0)
    : 0
  return {
    upper,
    preset: upper ? ('ground' as const) : footprintPreset(nodes, plate),
    /** Upstairs: the floor top (level-local). On the ground: the foundation height. */
    height,
    /** Upstairs: the floor top above the ground. On the ground: above the ground (foundation + slab). */
    floorTop: upper ? levelBase + height : floorTopAboveGround(nodes, plate),
    minHeight: footprintHeightMinimum(nodes, plate),
    minThickness: upper ? MIN_SLAB_THICKNESS : MIN_GROUND_FLOOR_THICKNESS,
    underFloor: !upper,
    thickFloor: thickFloorAdvice(nodes, plate),
  }
}

/**
 * A framed floor plate's "Floor build-up": its layers top down (`FloorBuildUpFields`), then the
 * thickness they make, read-only. A plate saved before its layers were kept shows the default
 * floor's and says its thickness follows them on the first change. Props only, so it renders
 * outside the editor's stores.
 */
export function FloorPlateBuildUp({
  buildUp,
  matches,
  thickness,
  unit,
  onCommit,
  onPreview,
}: {
  buildUp: FloorBuildUp
  /** Whether the plate's thickness is its layers' sum. */
  matches: boolean
  thickness: number
  unit: 'metric' | 'imperial'
  onCommit: (buildUp: FloorBuildUp) => void
  onPreview?: (buildUp: FloorBuildUp) => void
}) {
  const i18n = usePascalI18n()
  return (
    <div className="flex flex-col gap-1" data-floor-plate-build-up>
      <p className="px-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
        {i18n._({ id: 'editor.panels.floorFoundationPanel.floorBuildUp', message: 'Floor build-up' })}
      </p>
      <FloorBuildUpFields
        buildUp={buildUp}
        defaults={DEFAULT_FLOOR_BUILD_UP}
        onCommit={onCommit}
        onPreview={onPreview}
        presets={FLOOR_BUILD_UP_PRESETS}
        unit={unit}
      />
      <p
        className="px-0.5 pt-1 text-muted-foreground text-xs"
        data-floor-thickness
        title={i18n._({
          id: 'editor.panels.floorFoundationPanel.aThickerFloorGrowsUpwardThe',
          message: 'A thicker floor grows upward: the rooms below keep their height.',
        })}
      >
        {i18n._({
          id: 'editor.panels.floorFoundationPanel.floorThicknessValue',
          message: 'Floor thickness {thickness}',
          values: { thickness: formatLayerDepth(thickness, unit) },
        })}
      </p>
      {!matches && (
        <p className="px-0.5 text-muted-foreground text-xs" data-floor-build-up-follows>
          {i18n._({
            id: 'editor.panels.floorFoundationPanel.buildUpFollows',
            message:
              'Its layers make {thickness}; the thickness follows them on the first change.',
            values: { thickness: formatLayerDepth(floorBuildUpThickness(buildUp), unit) },
          })}
        </p>
      )}
    </div>
  )
}

/**
 * "Floor & foundation" for one footprint (the house, a shed, an upper storey),
 * in one column in the order it is built: the section, the slab (thickness,
 * edge finish) or upstairs the floor's layers, then what is under the floor —
 * on a ground-bearing footprint only — and the floor top that follows.
 * Scrubbing the foundation height, or a layer's thickness, moves the building
 * live and lands as one undo step.
 */
export function FloorFoundationPanel({ node, onClose }: { node: SlabNode; onClose: () => void }) {
  const i18n = usePascalI18n()
  const locale = useLocale()
  const nodes = useScene((state) => state.nodes)
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const [notice, setNotice] = useState<Notice | null>(null)
  const scrub = useRef<ReturnType<typeof beginFootprintHeightPreview> | null>(null)
  const thicknessScrub = useRef<ReturnType<typeof beginFootprintThicknessPreview> | null>(null)
  const plate = nodes[node.id as AnyNodeId]
  if (plate?.type !== 'slab' || plate.plateRole !== 'base') return null
  const length = (meters: number) => formatLinearMeasurement(meters, unit, metricNotation)
  const kicker = floorPlateKicker(nodes, plate, i18n, locale)
  const { upper, preset, height, floorTop, minHeight, minThickness, underFloor, thickFloor } =
    floorFoundationModel(nodes, plate)
  const level = plate.parentId ? nodes[plate.parentId as AnyNodeId] : undefined
  const maxHeight = level?.type === 'level' ? getStoredLevelHeight(level) - 0.5 : 3
  // A refused change says why, in the panel's words, never as an error; when
  // only the shared-storey rule refused it, it offers to move every footprint
  // under that storey together (checked once the change settles, not per frame).
  const report = (
    message: string | null,
    patch?: FloorFoundationPatch,
    buildUp?: FloorBuildUp,
  ) => {
    if (!message) return setNotice(null)
    const current = useScene.getState().nodes
    const together = patch ? footprintsToMoveTogether(current, plate.id, patch) : null
    const latest = current[plate.id as AnyNodeId]
    const lower =
      latest?.type !== 'slab'
        ? false
        : patch?.thickness !== undefined
          ? patch.thickness < latest.thickness
          : patch?.foundationHeight !== undefined
            ? patch.foundationHeight < footprintHeightValue(current, latest)
            : patch?.floorHeight == null ||
              patch.floorHeight < (latest.floorHeight ?? latest.elevation)
    setNotice({
      message,
      together: together && patch ? { ids: together, patch, lower, buildUp } : null,
    })
  }
  const heightPatchFor = (value: number) => {
    const current = useScene.getState().nodes
    const latest = current[plate.id as AnyNodeId]
    return latest?.type === 'slab' ? footprintHeightPatch(current, latest, value) : undefined
  }
  // A scrub previews live and lands once on release; a typed value lands directly.
  const previewHeight = (value: number) => {
    scrub.current ??= beginFootprintHeightPreview(plate.id)
    report(scrub.current.preview(value))
  }
  const commitHeight = (value: number) => {
    const session = scrub.current ?? beginFootprintHeightPreview(plate.id)
    scrub.current = null
    const message = session.commit(value)
    report(message, message ? heightPatchFor(value) : undefined)
  }
  // Upstairs the underside stays on the walls below: the floor's layers make
  // its thickness, and a change to them moves the floor top (and the storeys
  // above) with it. A scrub previews live through the same height session.
  const underside = height - plate.thickness
  const buildUp = floorBuildUpOf(plate)
  const previewBuildUp = (next: FloorBuildUp) =>
    previewHeight(underside + floorBuildUpThickness(next))
  const commitBuildUp = (next: FloorBuildUp) => {
    const session = scrub.current
    scrub.current = null
    // Let go where it started, nothing changes (an older plate keeps its own thickness) and a
    // preview it began is taken back.
    if (next === buildUp) {
      session?.cancel()
      return report(null)
    }
    const message = applyFloorBuildUp(plate.id, next, { session })
    const top = underside + floorBuildUpThickness(next)
    report(message, message ? heightPatchFor(top) : undefined, message ? next : undefined)
  }
  // On the ground the building's foundation is set here too; switched on, it is what the floor
  // stands on, in place of the footprint's own "raised on a foundation".
  const building = underFloor ? buildingOfPlate(nodes, plate) : null
  const designed = floorHeldByDesignedFoundation(nodes, plate)

  return (
    <PanelWrapper
      icon="/icons/floor.webp"
      kicker={kicker}
      onClose={onClose}
      title={localizedFloorFootprintName(nodes, plate, i18n)}
    >
      <div
        className="flex flex-col gap-3 px-4 pt-3 pb-4 text-sm"
        data-floor-foundation={plate.id}
        data-support={upper ? 'supported' : 'ground-bearing'}
      >
        {!designed && (
        <FloorSection
          foundationHeight={upper ? 0 : height}
          foundationLabel={length(height)}
          layers={upper ? floorSectionLayers(buildUp, unit, i18n) : undefined}
          raised={preset === 'raised'}
          supported={upper}
          thickness={plate.thickness}
          thicknessLabel={upper ? formatLayerDepth(plate.thickness, unit) : length(plate.thickness)}
          topLabel={upper ? undefined : length(floorTop)}
        />
        )}
        <section className="flex flex-col gap-1.5" data-floor-plate-group>
          <h3 className="font-medium text-muted-foreground text-xs">
            {upper
              ? i18n._({ id: 'editor.panels.floorFoundationPanel.floorPlate', message: 'Floor plate' })
              : designed
                ? i18n._({ id: 'editor.panels.floorFoundationPanel.floor', message: 'Floor' })
                : i18n._({ id: 'editor.panels.floorFoundationPanel.slab', message: 'Slab' })}
          </h3>
          {designed ? null : upper ? (
            <FloorPlateBuildUp
              buildUp={buildUp}
              matches={floorBuildUpMatches(plate)}
              onCommit={commitBuildUp}
              onPreview={previewBuildUp}
              thickness={plate.thickness}
              unit={unit}
            />
          ) : (
            <div title={i18n._({ id: 'editor.panels.floorFoundationPanel.theSlabSitsOnTheFoundation', message: 'The slab sits on the foundation (or the ground): a thicker slab raises the floor top and everything on it.' })}>
              <MetricControl
                className="h-9 text-xs"
                label={i18n._({ id: 'editor.panels.floorFoundationPanel.slabThickness', message: 'Slab thickness' })}
                max={1}
                min={minThickness}
                onChange={(next) => {
                  thicknessScrub.current ??= beginFootprintThicknessPreview(plate.id)
                  report(thicknessScrub.current.preview(Math.max(minThickness, next)))
                }}
                onCommit={(value) => {
                  const session =
                    thicknessScrub.current ?? beginFootprintThicknessPreview(plate.id)
                  thicknessScrub.current = null
                  const patch = { thickness: Math.max(minThickness, value) }
                  const message = session.commit(patch.thickness)
                  report(message, message ? patch : undefined)
                }}
                precision={2}
                restoreOnCommit={false}
                step={0.01}
                unit="m"
                value={plate.thickness}
              />
            </div>
          )}
          {upper && (
            <p className="px-0.5 text-muted-foreground text-xs" data-floor-top>
              {upperFloorTopLabel(floorTop, length, i18n)}
            </p>
          )}
          <FinishSwatch
            fallback={EDGE_DEFAULT}
            hint={i18n._({ id: 'editor.panels.floorFoundationPanel.theFloorSOutsideEdgeAll', message: 'The floor\'s outside edge, all around the footprint.' })}
            label={i18n._({ id: 'editor.panels.floorFoundationPanel.edgeFinish', message: 'Edge finish' })}
            node={plate}
            role="edge"
            value={plate.slots?.edge}
          />
          {thickFloor && (
            <p className="text-muted-foreground text-xs" data-thick-floor-hint>
              {THICK_FLOOR_HINT}
            </p>
          )}
        </section>
        {building && <BuildingFoundationSection building={building} />}
        {underFloor && !designed && (
          <section className="flex flex-col gap-1.5" data-under-floor-group>
            <h3 className="font-medium text-muted-foreground text-xs">{i18n._({ id: 'editor.panels.floorFoundationPanel.underTheFloor', message: 'Under the floor' })}</h3>
            <SegmentedControl
              onChange={(next: FootprintPreset) => {
                if (next === preset) return
                const patch = presetPatch(nodes, plate, next)
                report(applyFloorFoundation(plate.id, patch), patch)
              }}
              options={[
                { label: i18n._({ id: 'editor.panels.floorFoundationPanel.onTheGround', message: 'On the ground' }), value: 'ground' },
                { label: i18n._({ id: 'editor.panels.floorFoundationPanel.raisedOnAFoundation', message: 'Raised on a foundation' }), value: 'raised' },
              ]}
              value={preset}
            />
            {preset === 'raised' && (
              <>
                <div title={i18n._({ id: 'editor.panels.floorFoundationPanel.theFoundationStandsOnTheGround', message: 'The foundation stands on the ground; the slab sits on it.' })}>
                  <MetricControl
                    className="h-9 text-xs"
                    label={i18n._({ id: 'editor.panels.floorFoundationPanel.foundationHeight', message: 'Foundation height' })}
                    max={Math.max(0.05, maxHeight)}
                    min={minHeight}
                    onChange={previewHeight}
                    onCommit={commitHeight}
                    precision={2}
                    restoreOnCommit={false}
                    step={0.05}
                    unit="m"
                    value={height}
                  />
                </div>
                <FinishSwatch
                  fallback={FOUNDATION_DEFAULT}
                  label={i18n._({ id: 'editor.panels.floorFoundationPanel.foundationFinish', message: 'Foundation finish' })}
                  node={plate}
                  role="foundation"
                  value={
                    typeof plate.foundation?.material === 'string'
                      ? plate.foundation.material
                      : undefined
                  }
                />
              </>
            )}
            <p className="px-0.5 text-muted-foreground text-xs" data-floor-top>
              {i18n._({
                id: 'editor.panels.floorFoundationPanel.floorTopValue',
                message: 'Floor top {height}',
                values: { height: length(floorTop) },
              })}
            </p>
          </section>
        )}
        {notice && (
          <div
            className="flex flex-col items-start gap-2 rounded-lg bg-accent/30 px-2.5 py-2"
            data-floor-foundation-notice
          >
            <p className="text-muted-foreground text-xs" role="status">
              {notice.message}
            </p>
            {notice.together && (
              <Button
                className="rounded-full"
                onClick={() => {
                  const { ids, patch, buildUp: layers } = notice.together!
                  report(
                    layers
                      ? applyFloorBuildUp(plate.id, layers, { together: ids })
                      : applyFloorFoundation(ids, patch),
                  )
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {moveTogetherLabel(notice.together.ids.length, notice.together.lower, i18n)}
              </Button>
            )}
          </div>
        )}
      </div>
    </PanelWrapper>
  )
}
