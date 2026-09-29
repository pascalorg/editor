'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type FloorFoundationPatch,
  floorFootprintName,
  floorFootprintSupportClass,
  upperFloorHeightControl,
  getLevelDisplayName,
  getLevelElevations,
  getStoredLevelHeight,
  type LevelNode,
  MIN_GROUND_FLOOR_THICKNESS,
  MIN_SLAB_THICKNESS,
  type SlabNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useRef, useState } from 'react'
import {
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
import { formatLinearMeasurement } from '../../../lib/measurements'
import { FinishSwatch } from '../controls/finish-swatch'
import { MetricControl } from '../controls/metric-control'
import { SegmentedControl } from '../controls/segmented-control'
import { Button } from '../primitives/button'
import { PanelWrapper } from './panel-wrapper'

/** Unpainted finishes, as the plate renders them (nodes' slab slot defaults). */
const EDGE_DEFAULT = '#cccccc'
const FOUNDATION_DEFAULT = 'library:concrete-raw'

/**
 * A side section through the footprint's edge, top to bottom in the order it
 * is built. On the ground: the floor top, the slab, the foundation when the
 * footprint is raised on one, the ground — the slab always sits on the
 * foundation (or the ground), so the top is their sum. Upstairs: the floor
 * plate resting on the walls of the storey below. Drawn to a readable scale,
 * not to size.
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
}) {
  const base = 100
  const foundation = !supported && raised ? Math.min(40, 14 + foundationHeight * 30) : 0
  const band = Math.max(7, Math.min(16, thickness * 60))
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
  const right = 164
  const labels: { y: number; text: string; key: string }[] = [
    { key: 'top', y: bandTop - 9, text: 'Floor top' },
    {
      key: 'plate',
      y: bandTop + band / 2,
      text: supported ? `Floor plate · ${thicknessLabel}` : `Slab · ${thicknessLabel}`,
    },
    ...(foundation
      ? [
          {
            key: 'foundation',
            y: bandBottom + foundation / 2,
            text: foundationLabel ? `Foundation · ${foundationLabel}` : 'Foundation',
          },
        ]
      : []),
    { key: 'base', y: base + 9, text: supported ? 'Walls below' : 'Ground' },
  ]
  return (
    <figure className="flex flex-col gap-1" data-floor-section>
      <svg
        aria-label={
          supported
            ? `Floor plate ${thicknessLabel} thick, resting on the walls below`
            : raised
              ? `Slab ${thicknessLabel} thick on a ${foundationLabel} foundation, floor top ${topLabel ?? ''} above the ground`
              : `Slab ${thicknessLabel} thick on the ground, floor top ${topLabel ?? ''} above the ground`
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
        <rect
          className="fill-foreground"
          data-section-band
          height={band}
          width={right - left}
          x={left}
          y={bandTop}
        />
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
        {labels.map((label) => (
          <g key={label.key}>
            <line
              opacity="0.6"
              stroke="currentColor"
              x1={right + 4}
              x2={right + 12}
              y1={label.y}
              y2={label.y}
            />
            <text
              className="fill-foreground"
              dominantBaseline="middle"
              fontSize="10"
              x={right + 16}
              y={label.y}
            >
              {label.text}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="text-right text-[10px] text-muted-foreground/70">
        Not to scale
      </figcaption>
    </figure>
  )
}

type Notice = {
  message: string
  /** The footprints to move together, and the change, when that would be accepted. */
  together: { ids: string[]; patch: FloorFoundationPatch; lower: boolean } | null
}

export function moveTogetherLabel(count: number, lower: boolean) {
  const verb = lower ? 'Lower' : 'Raise'
  return count === 2 ? `${verb} both` : `${verb} all ${count}`
}

/** "Floor plate · Ground floor", upstairs "Floor plate · Floor 1 · rests on Ground floor". */
export function floorPlateKicker(nodes: Record<string, AnyNode>, plate: SlabNode): string {
  const level = plate.parentId ? nodes[plate.parentId] : undefined
  const levelName = level?.type === 'level' ? ` · ${getLevelDisplayName(level)}` : ''
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
  const restsOn = below ? ` · rests on ${getLevelDisplayName(below)}` : ''
  return `Floor plate${levelName}${restsOn}`
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
    kicker: floorPlateKicker(nodes, plate),
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
 * "Floor & foundation" for one footprint (the house, a shed, an upper storey),
 * in one column in the order it is built: the section, the slab (thickness,
 * edge finish), then what is under the floor — on a ground-bearing footprint
 * only — and the floor top that follows. Scrubbing the foundation height moves
 * the building live and lands as one undo step.
 */
export function FloorFoundationPanel({ node, onClose }: { node: SlabNode; onClose: () => void }) {
  const nodes = useScene((state) => state.nodes)
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const [notice, setNotice] = useState<Notice | null>(null)
  const scrub = useRef<ReturnType<typeof beginFootprintHeightPreview> | null>(null)
  const thicknessScrub = useRef<ReturnType<typeof beginFootprintThicknessPreview> | null>(null)
  const plate = nodes[node.id as AnyNodeId]
  if (plate?.type !== 'slab' || plate.plateRole !== 'base') return null
  const length = (meters: number) => formatLinearMeasurement(meters, unit, metricNotation)
  const { upper, kicker, preset, height, floorTop, minHeight, minThickness, underFloor, thickFloor } =
    floorFoundationModel(nodes, plate)
  const level = plate.parentId ? nodes[plate.parentId as AnyNodeId] : undefined
  const maxHeight = level?.type === 'level' ? getStoredLevelHeight(level) - 0.5 : 3
  // A refused change says why, in the panel's words, never as an error; when
  // only the shared-storey rule refused it, it offers to move every footprint
  // under that storey together (checked once the change settles, not per frame).
  const report = (message: string | null, patch?: FloorFoundationPatch) => {
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
    setNotice({ message, together: together && patch ? { ids: together, patch, lower } : null })
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
  // Upstairs the underside stays on the walls below: the thickness is the one
  // control, and it moves the floor top (and the storeys above) with it.
  const underside = height - plate.thickness

  return (
    <PanelWrapper
      icon="/icons/floor.webp"
      kicker={kicker}
      onClose={onClose}
      title={floorFootprintName(nodes, plate)}
    >
      <div
        className="flex flex-col gap-3 px-4 pt-3 pb-4 text-sm"
        data-floor-foundation={plate.id}
        data-support={upper ? 'supported' : 'ground-bearing'}
      >
        <FloorSection
          foundationHeight={upper ? 0 : height}
          foundationLabel={length(height)}
          raised={preset === 'raised'}
          supported={upper}
          thickness={plate.thickness}
          thicknessLabel={length(plate.thickness)}
          topLabel={upper ? undefined : length(floorTop)}
        />
        <section className="flex flex-col gap-1.5" data-floor-plate-group>
          <h3 className="font-medium text-muted-foreground text-xs">
            {upper ? 'Floor plate' : 'Slab'}
          </h3>
          {upper ? (
            <div title="A thicker floor grows upward: the rooms below keep their height.">
              <MetricControl
                className="h-9 text-xs"
                label="Floor thickness"
                max={Math.max(MIN_SLAB_THICKNESS, maxHeight - underside)}
                min={Math.max(MIN_SLAB_THICKNESS, minHeight - underside)}
                onChange={(next) => previewHeight(underside + next)}
                onCommit={(next) => commitHeight(underside + next)}
                precision={2}
                restoreOnCommit={false}
                step={0.01}
                unit="m"
                value={plate.thickness}
              />
            </div>
          ) : (
            <div title="The slab sits on the foundation (or the ground): a thicker slab raises the floor top and everything on it.">
              <MetricControl
                className="h-9 text-xs"
                label="Slab thickness"
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
              Floor top +{length(floorTop)}
            </p>
          )}
          <FinishSwatch
            fallback={EDGE_DEFAULT}
            hint="The floor's outside edge, all around the footprint."
            label="Edge finish"
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
        {underFloor && (
          <section className="flex flex-col gap-1.5" data-under-floor-group>
            <h3 className="font-medium text-muted-foreground text-xs">Under the floor</h3>
            <SegmentedControl
              onChange={(next: FootprintPreset) => {
                if (next === preset) return
                const patch = presetPatch(nodes, plate, next)
                report(applyFloorFoundation(plate.id, patch), patch)
              }}
              options={[
                { label: 'On the ground', value: 'ground' },
                { label: 'Raised on a foundation', value: 'raised' },
              ]}
              value={preset}
            />
            {preset === 'raised' && (
              <>
                <div title="The foundation stands on the ground; the slab sits on it.">
                  <MetricControl
                    className="h-9 text-xs"
                    label="Foundation height"
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
                  label="Foundation finish"
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
              Floor top {length(floorTop)}
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
                  const { ids, patch } = notice.together!
                  report(applyFloorFoundation(ids, patch))
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {moveTogetherLabel(notice.together.ids.length, notice.together.lower)}
              </Button>
            )}
          </div>
        )}
      </div>
    </PanelWrapper>
  )
}
