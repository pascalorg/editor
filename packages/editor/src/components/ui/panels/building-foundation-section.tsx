'use client'

import {
  BUILDING_FOUNDATION_LIMITS,
  type BasementReport,
  type BuildingFoundation,
  type BuildingFoundationDimension,
  type BuildingFoundationRecord,
  type BuildingNode,
  buildingFoundationOf,
  DEFAULT_RAISED_FLOOR_BUILD_UP,
  type DesignedFoundationReport,
  DRYWALL_THICKNESSES,
  designedFoundationReport,
  FLOOR_BUILD_UP_PRESETS,
  FLOORING_THICKNESS,
  FOUNDATION_SILL_IN,
  FRAMING_SPACINGS,
  type FloorBuildUp,
  type FloorBuildUpPreset,
  type FloorStructure,
  type FlooringKind,
  floorBuildUpThickness,
  floorStructureDepth,
  I_JOIST_DEPTH,
  type IJoistDepth,
  type InteriorFinishKind,
  LUMBER_DEPTH,
  type NominalLumber,
  type PanelKind,
  PLASTER_THICKNESS,
  SLAB_EDGE_TAPER_IN,
  SUBFLOOR_THICKNESSES,
  slabEdgeTaper,
  useScene,
  WOOD_PLANK_THICKNESS,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Check } from 'lucide-react'
import { useRef, useState } from 'react'
import {
  applyBuildingFoundation,
  foundationAdvice,
  standsOnBasement,
} from '../../../lib/building-foundation'
import {
  editedFloorBuildUp,
  type FloorLayerKey,
  floorStructureAs,
  renameFloorLayer,
  switchFloorLayer,
} from '../../../lib/floor-footprints'
import { formatLayerDepth, formatLayerThickness } from '../../../lib/layer-thickness'
import { formatLinearMeasurement, type LinearUnit } from '../../../lib/measurements'
import { cn } from '../../../lib/utils'
import { MetricControl } from '../controls/metric-control'
import { SegmentedControl } from '../controls/segmented-control'
import { SelectControl } from '../controls/select-control'
import { ToggleControl } from '../controls/toggle-control'
import { Button } from '../primitives/button'

const IN = 0.0254

type Field = { key: BuildingFoundationDimension | 'edgeTaperIn'; label: string; hint?: string }

/**
 * A slab edge's 45° taper as core pours it, metres: as the record sets it, else the rule's for the
 * edge's depth under the slab (its bottom under the pad, which is held the slab's top over grade).
 */
export function slabEdgeTaperOf(foundation: BuildingFoundation): number {
  const depth =
    (foundation.topAboveGradeIn + foundation.edgeDepthIn - foundation.slabThicknessIn) * IN
  return slabEdgeTaper(
    Math.max(0, depth),
    foundation.edgeTaperIn === null ? null : foundation.edgeTaperIn * IN,
  )
}

/** The numbers each kind of foundation is sized by, in the order it is built, top down. */
function fieldsFor(foundation: BuildingFoundation): Field[] {
  const piles = foundation.support === 'piles'
  const raised = foundation.type === 'raised'
  const floor: Field = {
    key: 'ffAboveGradeIn',
    label: 'Finish floor over grade',
    hint: 'Measured over the highest grade under the outside walls. The foundation grows down the slope from there.',
  }
  const top: Field = {
    key: 'topAboveGradeIn',
    label: raised ? 'Stem top over grade' : 'Slab top over grade',
    hint: raised
      ? 'IRC R317.1 keeps wood framing 8 in off the ground.'
      : 'The ground round the slab is graded to this on every side: filled where it falls away, cut where it rises (IRC R317.1: 8 in).',
  }
  // Where the floor's layers go (`RaisedFloorFraming`): the depth is theirs and the sill's.
  const framing: Field = {
    key: 'floorFramingDepthIn',
    label: 'Floor framing',
    hint: 'Floor top down to the stem: flooring, subfloor, joists, sill.',
  }
  // A slab's grade is held at its edge all round (fill on the low side), so only a raised floor steps.
  const steps: Field[] =
    raised && foundation.stepped
      ? [
          ...(piles
            ? []
            : [
                {
                  key: 'maxStemIn',
                  label: 'Tallest stem before stepping',
                  hint: 'A side whose stem would stand taller out of the ground steps down the slope: its stem drops to its top over grade, a cripple wall over it.',
                } as Field,
              ]),
          { key: 'stepHeightIn', label: 'Step height' },
          {
            key: 'minStepRunIn',
            label: 'Least step run',
            hint: 'IRC R403.1.5: the top of a footing is level; it steps where the ground falls.',
          },
        ]
      : []
  const crawl: Field = {
    key: 'crawlClearanceIn',
    label: 'Crawl space under joists',
    hint: 'Measured from the underside of the joists, which bear on the sill (IRC R317.1: 18 in to the dirt). The crawl space is dug out to it.',
  }
  if (piles)
    return [
      floor,
      top,
      ...(raised ? [framing, crawl] : [{ key: 'slabThicknessIn', label: 'Slab' } as Field]),
      { key: 'gradeBeamWidthIn', label: 'Grade beam width' },
      { key: 'gradeBeamDepthIn', label: 'Grade beam depth' },
      {
        key: 'footingDepthIn',
        label: 'Least depth under grade',
        hint: 'The beam goes at least this far under grade (IRC R403.1.4: 12 in, or the frost line); a deeper beam goes further.',
      },
      { key: 'pileDiameterIn', label: 'Pile diameter', hint: 'Piles are sized by the engineer.' },
      { key: 'pileSpacingIn', label: 'Pile spacing' },
      { key: 'pileLengthIn', label: 'Pile length' },
      ...steps,
    ]
  if (raised)
    return [
      floor,
      top,
      framing,
      crawl,
      { key: 'stemThicknessIn', label: 'Stem wall', hint: 'Table R404.1.2: 6 in for one storey, 8 in for more.' },
      {
        key: 'footingWidthIn',
        label: 'Footing width',
        hint: 'Table R403.1(1), 1500 psf soil: 12, 15, 23 in for 1, 2, 3 storeys.',
      },
      { key: 'footingThicknessIn', label: 'Footing thickness' },
      {
        key: 'footingDepthIn',
        label: 'Footing under grade',
        hint: 'IRC R403.1.4: at least 12 in under the ground beside it, outside and in the dug-out crawl space; deeper to the frost line.',
      },
      ...steps,
    ]
  return [
    floor,
    top,
    { key: 'slabThicknessIn', label: 'Slab', hint: 'IRC R506.1 asks 3½ in at least.' },
    { key: 'edgeDepthIn', label: 'Edge under grade', hint: 'IRC R403.1.4: at least 12 in, or the frost line.' },
    { key: 'edgeWidthIn', label: 'Edge width' },
    {
      key: 'edgeTaperIn',
      label: 'Taper',
      hint: 'The edge’s inside face stands plumb from its bottom, then tapers in at 45° to the slab. Auto runs it half the edge’s depth under the slab, 6 to 12 in, so a deeper edge grows plumb, not wider.',
    },
    ...steps,
  ]
}

/**
 * The numbers a house over a basement is sized by: how far its walls' top stands over grade, and
 * the walls, footing and slab it pours (none where the basement's walls are its own: they stand on
 * their own footing, its floor its own plates).
 */
function basementFieldsFor(ownWalls: boolean): Field[] {
  const top: Field = {
    key: 'basementTopAboveGradeIn',
    label: 'Basement wall top over grade',
    hint: 'Measured over the highest grade along the house: the sill and the floor framing sit on it, 8 in off the ground at least (IRC R317.1). Set it higher for a daylight basement.',
  }
  if (ownWalls) return [top]
  return [
    top,
    {
      key: 'basementWallThicknessIn',
      label: 'Basement wall',
      hint: 'Poured concrete: 8 in for most basements (IRC Table R404.1.2(1)).',
    },
    {
      key: 'footingWidthIn',
      label: 'Footing width',
      hint: 'Table R403.1(1), 1500 psf soil: 12, 15, 23 in for 1, 2, 3 storeys.',
    },
    { key: 'footingThicknessIn', label: 'Footing thickness' },
    { key: 'slabThicknessIn', label: 'Basement slab', hint: 'IRC R506.1 asks 3½ in at least.' },
  ]
}

/** One number of the record, in the panel's length unit; a scrub previews in the field, a release writes it. */
function FoundationNumber({
  field,
  value,
  min,
  onCommit,
}: {
  field: Field
  value: number
  min: number
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<number | null>(null)
  // Foundation sizes read in inches on an imperial plan (feet would show 8 in as 0.67).
  const imperial = useViewer((state) => state.unit) === 'imperial'
  const [low, high] =
    field.key === 'edgeTaperIn' ? SLAB_EDGE_TAPER_IN : BUILDING_FOUNDATION_LIMITS[field.key]
  const toShown = (inches: number) => (imperial ? inches : inches * IN)
  const fromShown = (shown: number) => (imperial ? shown : shown / IN)
  return (
    <div data-foundation-field={field.key} title={field.hint}>
      <MetricControl
        className="h-9 text-xs"
        label={field.label}
        max={toShown(high)}
        min={toShown(Math.max(low, min))}
        onChange={(next) => setDraft(next)}
        onCommit={(next) => {
          setDraft(null)
          onCommit(Math.round(fromShown(next) * 100) / 100)
        }}
        precision={imperial ? 2 : 3}
        restoreOnCommit={false}
        step={imperial ? 0.5 : 0.5 * IN}
        unit={imperial ? 'in' : 'm'}
        value={draft ?? toShown(value)}
      />
    </div>
  )
}

/**
 * The slab edge's taper: as the record sets it, or auto, the rule's for the edge's depth
 * (`slabEdgeTaperOf`). A number typed sets it; Auto hands it back to the rule.
 */
function EdgeTaperNumber({
  field,
  foundation,
  onCommit,
}: {
  field: Field
  foundation: BuildingFoundation
  onCommit: (edgeTaperIn: number | undefined) => void
}) {
  const auto = foundation.edgeTaperIn === null
  return (
    <div className="flex flex-col gap-1">
      <FoundationNumber
        field={auto ? { ...field, label: `${field.label} (auto)` } : field}
        min={Number.NEGATIVE_INFINITY}
        onCommit={onCommit}
        value={foundation.edgeTaperIn ?? slabEdgeTaperOf(foundation) / IN}
      />
      {!auto && (
        <button
          className="self-start rounded-full border border-border/50 px-3 py-1 text-muted-foreground text-xs hover:text-foreground"
          data-foundation-taper-auto
          onClick={() => onCommit(undefined)}
          title="Half the edge’s depth under the slab, 6 to 12 in"
          type="button"
        >
          Auto
        </button>
      )}
    </div>
  )
}

/** A spacing on centre, as the roof's framing reads: `16" o.c.` or `406 mm o.c.`. */
function formatSpacing(metres: number, unit: LinearUnit): string {
  if (unit === 'imperial') return `${formatLayerThickness(metres, unit)} o.c.`
  return `${Math.round(metres * 1000)} mm o.c.`
}

const FLOORING_OPTIONS: { label: string; value: FlooringKind }[] = [
  { label: 'Hardwood', value: 'hardwood' },
  { label: 'Engineered wood', value: 'engineered-wood' },
  { label: 'Laminate', value: 'laminate' },
  { label: 'Vinyl plank', value: 'vinyl-plank' },
  { label: 'Ceramic tile', value: 'ceramic-tile' },
  { label: 'Carpet', value: 'carpet' },
]

const PANEL_OPTIONS: { label: string; value: PanelKind }[] = [
  { label: 'Plywood', value: 'plywood' },
  { label: 'OSB', value: 'osb' },
]

const CEILING_OPTIONS: { label: string; value: InteriorFinishKind }[] = [
  { label: 'Drywall', value: 'drywall' },
  { label: 'Plaster', value: 'plaster' },
  { label: 'Wood plank', value: 'wood-plank' },
]

const CEILING_THICKNESS: Record<InteriorFinishKind, number> = {
  drywall: DRYWALL_THICKNESSES[0]!,
  plaster: PLASTER_THICKNESS,
  'wood-plank': WOOD_PLANK_THICKNESS,
}

const labelOf = <T extends string>(options: { label: string; value: T }[], value: T) =>
  options.find((option) => option.value === value)?.label ?? value

/** A floor's joist sizes: lumber by its nominal size and dressed depth, I-joists by their depth. */
function structureSizeOptions(system: FloorStructure['system'], unit: LinearUnit) {
  return system === 'joists'
    ? (Object.keys(LUMBER_DEPTH) as NominalLumber[]).map((size) => ({
        label: `${size} (${formatLayerThickness(LUMBER_DEPTH[size], unit)})`,
        value: size as string,
      }))
    : (Object.keys(I_JOIST_DEPTH) as IJoistDepth[]).map((size) => ({
        label: `${formatLayerThickness(I_JOIST_DEPTH[size], unit)} I-joist`,
        value: size as string,
      }))
}

/**
 * One layer of a floor as a section draws it, top down: what it reads as, its thickness in metres,
 * and that thickness written out.
 */
export type SectionLayer = { key: string; name: string; thickness: number; size: string }

/**
 * A framed floor's layers as its section draws them, top down, each named as the person named its
 * material, else by its kind; `sill` adds the sill a raised floor's joists bear on.
 */
export function floorSectionLayers(
  buildUp: FloorBuildUp,
  unit: LinearUnit,
  sill = false,
): SectionLayer[] {
  const layer = (key: string, name: string, thickness: number): SectionLayer => ({
    key,
    name,
    thickness,
    size: formatLayerThickness(thickness, unit),
  })
  const { flooring, sheathing, structure, ceiling } = buildUp
  return [
    ...(flooring
      ? [layer('flooring', flooring.name ?? labelOf(FLOORING_OPTIONS, flooring.kind), flooring.thickness)]
      : []),
    ...(sheathing
      ? [
          layer(
            'sheathing',
            sheathing.name ?? `${labelOf(PANEL_OPTIONS, sheathing.kind)} subfloor`,
            sheathing.thickness,
          ),
        ]
      : []),
    layer(
      'joists',
      structure.system === 'joists' ? `${structure.size} joists` : 'I-joists',
      floorStructureDepth(structure),
    ),
    ...(ceiling
      ? [
          layer(
            'ceiling',
            ceiling.name ?? `${labelOf(CEILING_OPTIONS, ceiling.kind)} ceiling`,
            ceiling.thickness,
          ),
        ]
      : []),
    ...(sill ? [layer('sill', 'Sill', FOUNDATION_SILL_IN * IN)] : []),
  ]
}

/** The layers' fills, alike in the floor plate's section and the foundation's: wood tones, a pale ceiling board, a treated sill. */
export const SECTION_LAYER_FILL: Record<string, string> = {
  flooring: 'fill-[#8b5e34]',
  sheathing: 'fill-[#dcc08f]',
  joists: 'fill-[#c9a46b]',
  framing: 'fill-[#c9a46b]',
  ceiling: 'fill-[#ececec]',
  sill: 'fill-[#a3b18a]',
}

/** A name as a section's callout shows it: a long one cut short so it stays in the drawing. */
export const calloutName = (name: string) => (name.length > 22 ? `${name.slice(0, 21)}…` : name)

/**
 * Heights for a section's callouts: each as near its own height as it can be with `gap` between
 * neighbours (a run of thin layers fans out round its middle), within `low`..`high`. In the order
 * given.
 */
export function stackLabels(
  wanted: readonly number[],
  gap: number,
  low: number,
  high: number,
): number[] {
  const order = wanted.map((y, index) => ({ y, index })).sort((a, b) => a.y - b.y)
  const runs: { top: number; ys: number[] }[] = []
  for (const { y } of order) {
    let run = { top: y, ys: [y] }
    // A label too close under the run above joins it, the run centred on the heights it holds.
    while (runs.length > 0) {
      const above = runs[runs.length - 1]!
      if (above.top + above.ys.length * gap <= run.top + 1e-9) break
      runs.pop()
      const ys = [...above.ys, ...run.ys]
      const middle = ys.reduce((sum, value) => sum + value, 0) / ys.length
      run = { top: middle - ((ys.length - 1) * gap) / 2, ys }
    }
    runs.push(run)
  }
  const placed = runs.flatMap((run) => run.ys.map((_, k) => run.top + k * gap))
  const last = placed.length - 1
  for (let k = last; k >= 0; k--) placed[k] = Math.min(placed[k]!, high - (last - k) * gap)
  for (let k = 0; k <= last; k++) placed[k] = Math.max(placed[k]!, low + k * gap)
  const result = new Array<number>(wanted.length)
  order.forEach(({ index }, k) => {
    result[index] = placed[k]!
  })
  return result
}

/**
 * A section through the foundation where the ground is highest (the side that sets the floor),
 * drawn to scale: the grade, the wall on it, and the slab with its turned-down edge, or the stem
 * wall on its footing under the floor framing, or the grade beam on a pile. A raised floor's
 * framing is drawn layer by layer down to its sill, the crawl space dug out under the joists, and
 * the footing where core lays it: as deep under the crawl space's dirt as under the grade outside.
 */
export function FoundationSectionDrawing({
  foundation,
  length,
  framing,
}: {
  foundation: BuildingFoundation
  length: (meters: number) => string
  /** A raised floor's framing, top down to its sill (`floorSectionLayers`); absent, it is one band. */
  framing?: readonly SectionLayer[]
}) {
  const raised = foundation.type === 'raised'
  const piles = foundation.support === 'piles'
  const m = (inches: number) => inches * IN
  // Metres, the grade at 0, up positive; the outside face at x 0, the building to the right.
  const floor = m(foundation.ffAboveGradeIn)
  const top = raised ? floor - m(foundation.floorFramingDepthIn) : floor
  // The joists bear on the sill on the stem's top. The crawl space under them is dug out to its
  // clearance where that falls under the grade (where the ground already stands lower it stays).
  const underside = top + m(FOUNDATION_SILL_IN)
  const crawl = raised ? Math.min(0, underside - m(foundation.crawlClearanceIn)) : 0
  // A footing's bottom is its depth under the lower of the grade outside and the crawl space's dirt
  // (IRC R403.1.4), as core lays it; a grade beam's is under the grade.
  const bottom = piles
    ? Math.min(top - m(foundation.gradeBeamDepthIn), -m(foundation.footingDepthIn))
    : raised
      ? crawl - m(foundation.footingDepthIn)
      : -m(foundation.edgeDepthIn)
  const pileShown = piles ? Math.min(m(foundation.pileLengthIn), 0.6) : 0
  const lowest = Math.min(bottom - pileShown, crawl)
  const wallHeight = 0.35
  const span = floor + wallHeight - lowest
  const [width, height, pad] = [280, 170, 14]
  const scale = Math.min((height - pad * 2) / span, 260)
  const x0 = 70
  const sx = (x: number) => x0 + x * scale
  const sy = (y: number) => pad + (floor + wallHeight - y) * scale
  const right = width - 8
  // A raised floor is drawn this far into the house; its callouts stand clear past it.
  const reach = 0.75
  const labelX = sx(reach) + (raised ? 10 : 6)
  const wallWidth = m(5.5)
  const perimeter = m(piles ? foundation.gradeBeamWidthIn : foundation.stemThicknessIn)
  const footingInside = m(foundation.stemThicknessIn) / 2 + m(foundation.footingWidthIn) / 2
  const concrete = 'fill-[#9a9a9a] stroke-current'
  const shapes: Array<{ key: string; points: Array<[number, number]>; className: string }> = []
  /** A callout; `from` (metres across) leads a line to it from the end of the layer it names. */
  const labels: Array<{ key: string; y: number; text: string; from?: number }> = []

  if (piles) {
    const beam = m(foundation.gradeBeamWidthIn)
    const beamBottom = bottom
    shapes.push({
      key: 'beam',
      className: concrete,
      points: [
        [0, beamBottom],
        [beam, beamBottom],
        [beam, top],
        [0, top],
      ],
    })
    const pile = m(foundation.pileDiameterIn)
    const px = beam / 2 - pile / 2
    shapes.push({
      key: 'pile',
      className: concrete,
      points: [
        [px, beamBottom - pileShown],
        [px + pile, beamBottom - pileShown],
        [px + pile, beamBottom],
        [px, beamBottom],
      ],
    })
    labels.push({ key: 'beam', y: (top + beamBottom) / 2, text: `Grade beam ${length(beam)} × ${length(top - beamBottom)}` })
    labels.push({
      key: 'pile',
      y: beamBottom - pileShown / 2,
      text: `Pile ${length(pile)} @ ${length(m(foundation.pileSpacingIn))}, ${length(m(foundation.pileLengthIn))} deep`,
    })
  } else if (raised) {
    const stem = m(foundation.stemThicknessIn)
    const footing = m(foundation.footingWidthIn)
    const thick = m(foundation.footingThicknessIn)
    const fx = stem / 2 - footing / 2
    shapes.push({
      key: 'footing',
      className: concrete,
      points: [
        [fx, bottom],
        [fx + footing, bottom],
        [fx + footing, bottom + thick],
        [fx, bottom + thick],
      ],
    })
    shapes.push({
      key: 'stem',
      className: concrete,
      points: [
        [0, bottom + thick],
        [stem, bottom + thick],
        [stem, top],
        [0, top],
      ],
    })
    labels.push({ key: 'stem', y: (top + Math.max(0, bottom + thick)) / 2, text: `Stem wall ${length(stem)}` })
    labels.push({ key: 'footing', y: bottom + thick / 2, text: `Footing ${length(footing)} × ${length(thick)}` })
  } else {
    // The edge's inside face plumb from its square bottom, then in at 45° to the slab's underside.
    const slab = m(foundation.slabThicknessIn)
    const edge = m(foundation.edgeWidthIn)
    const rise = floor - slab - bottom
    const taper = Math.min(rise, slabEdgeTaperOf(foundation))
    shapes.push({
      key: 'slab',
      className: concrete,
      points: [
        [0, bottom],
        [edge, bottom],
        [edge, floor - slab - taper],
        [edge + taper, floor - slab],
        [(right - x0) / scale, floor - slab],
        [(right - x0) / scale, floor],
        [0, floor],
      ],
    })
    labels.push({ key: 'slab', y: floor - slab / 2, text: `Slab ${length(slab)}` })
    labels.push({ key: 'taper', y: floor - slab - taper / 2, text: `Taper ${length(taper)} at 45°` })
    labels.push({ key: 'edge', y: bottom + 0.04, text: `Edge ${length(edge)} wide` })
  }
  // The wall stands on the subfloor; the finished floor runs inside it.
  let wallBase = floor
  if (raised) {
    const layers = framing ?? [
      { key: 'framing', name: 'Floor framing', thickness: floor - top, size: length(floor - top) },
    ]
    // Top down from the floor: the sill only under the wall, on the stem (or beam) it is bolted to.
    let y = floor
    for (const layer of layers) {
      if (layer.thickness <= 0) continue
      const from = layer.key === 'flooring' ? wallWidth : 0
      const to = layer.key === 'sill' ? Math.min(wallWidth, perimeter) : reach
      if (layer.key === 'flooring') wallBase = y - layer.thickness
      shapes.push({
        key: layer.key,
        className: `${SECTION_LAYER_FILL[layer.key] ?? SECTION_LAYER_FILL.framing} stroke-current`,
        points: [
          [from, y - layer.thickness],
          [to, y - layer.thickness],
          [to, y],
          [from, y],
        ],
      })
      labels.push({
        key: layer.key,
        y: y - layer.thickness / 2,
        text: `${calloutName(layer.name)} ${layer.size}`,
        from: to,
      })
      y -= layer.thickness
    }
  }
  shapes.push({
    key: 'wall',
    className: 'fill-muted stroke-current',
    points: [
      [0, wallBase],
      [wallWidth, wallBase],
      [wallWidth, floor + wallHeight],
      [0, floor + wallHeight],
    ],
  })

  type Dim = { key: string; from: number; to: number; text: string; x: number; extend?: number }
  // A footing's depth is read from the lower ground beside it: in the crawl space where that is dug
  // out under the grade, chained under the crawl's own height.
  const inCrawl = raised && !piles && crawl < 0
  const depthTo = raised && !piles ? crawl : 0
  const depth = { key: 'depth', from: bottom, to: depthTo, text: `${length(depthTo - bottom)} down` }
  const outside = [
    { key: 'floor', from: 0, to: floor, text: `${length(floor)} FF` },
    ...(raised ? [{ key: 'top', from: 0, to: top, text: `${length(top)} top` }] : []),
    ...(inCrawl ? [] : [depth]),
  ]
  const crawlX = (sx(perimeter) + sx(reach)) / 2
  const dims: Dim[] = [
    ...outside.map((dim, index) => ({ ...dim, x: 10 + index * 18 })),
    ...(raised
      ? [{ key: 'crawl', from: crawl, to: underside, text: `${length(underside - crawl)} crawl`, x: crawlX }]
      : []),
    ...(inCrawl ? [{ ...depth, x: crawlX, extend: footingInside }] : []),
  ]
  const toPath = (points: Array<[number, number]>) =>
    points.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ')
  const placed = stackLabels(
    labels.map((label) => sy(label.y)),
    9,
    8,
    height - 6,
  )

  return (
    <figure className="flex flex-col gap-1" data-foundation-section={foundation.type}>
      <svg
        aria-label={`Foundation section: ${raised ? 'raised floor on a stem wall' : 'slab on grade'}${piles ? ' on piles' : ''}, finish floor ${length(floor)} over grade${raised ? `, crawl space ${length(underside - crawl)} under the joists` : ''}`}
        className="h-auto w-full text-muted-foreground"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        {/* Grade: outside, and under a slab the ground under the house. */}
        <line stroke="currentColor" x1="4" x2={raised ? sx(0) : right} y1={sy(0)} y2={sy(0)} />
        {Array.from({ length: 6 }, (_, i) => (
          <line
            key={i}
            opacity="0.35"
            stroke="currentColor"
            x1={8 + i * 9}
            x2={2 + i * 9}
            y1={sy(0) + 1}
            y2={sy(0) + 7}
          />
        ))}
        {raised && (
          // The crawl space's dirt, inside the stem: dug out to its clearance under the joists.
          <g data-section-crawl={crawl.toFixed(4)}>
            <line stroke="currentColor" x1={sx(perimeter)} x2={sx(reach)} y1={sy(crawl)} y2={sy(crawl)} />
            {Array.from(
              { length: Math.max(0, Math.floor((sx(reach) - sx(perimeter) - 4) / 9)) },
              (_, i) => (
                <line
                  key={i}
                  opacity="0.35"
                  stroke="currentColor"
                  x1={sx(perimeter) + 10 + i * 9}
                  x2={sx(perimeter) + 4 + i * 9}
                  y1={sy(crawl) + 1}
                  y2={sy(crawl) + 7}
                />
              ),
            )}
          </g>
        )}
        {shapes.map((shape) => (
          <polygon
            className={shape.className}
            data-section-part={shape.key}
            key={shape.key}
            points={toPath(shape.points)}
            strokeOpacity="0.6"
            strokeWidth="0.75"
          />
        ))}
        {dims.map((dim) => (
          <g className="text-foreground" data-section-dim={dim.key} key={dim.key}>
            {dim.extend !== undefined && (
              <line
                opacity="0.6"
                stroke="currentColor"
                strokeDasharray="2 2"
                x1={sx(dim.extend)}
                x2={dim.x + 3}
                y1={sy(dim.from)}
                y2={sy(dim.from)}
              />
            )}
            <line stroke="currentColor" x1={dim.x} x2={dim.x} y1={sy(dim.from)} y2={sy(dim.to)} />
            <line stroke="currentColor" x1={dim.x - 3} x2={dim.x + 3} y1={sy(dim.from)} y2={sy(dim.from)} />
            <line stroke="currentColor" x1={dim.x - 3} x2={dim.x + 3} y1={sy(dim.to)} y2={sy(dim.to)} />
            <text
              className="fill-foreground"
              dominantBaseline="middle"
              fontSize="7"
              transform={`rotate(-90 ${dim.x - 4} ${(sy(dim.from) + sy(dim.to)) / 2})`}
              textAnchor="middle"
              x={dim.x - 4}
              y={(sy(dim.from) + sy(dim.to)) / 2}
            >
              {dim.text}
            </text>
          </g>
        ))}
        {labels.map((label, index) => (
          <g key={label.key}>
            {label.from !== undefined && (
              <polyline
                fill="none"
                opacity="0.6"
                points={`${sx(label.from) + 1},${sy(label.y)} ${labelX - 6},${placed[index]} ${labelX - 2},${placed[index]}`}
                stroke="currentColor"
                strokeWidth="0.75"
              />
            )}
            <text
              className="fill-foreground"
              data-section-label={label.key}
              dominantBaseline="middle"
              fontSize="8"
              x={labelX}
              y={placed[index]}
            >
              {label.text}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="text-right text-[10px] text-muted-foreground/70">
        At the high side of the ground, to scale
      </figcaption>
    </figure>
  )
}

/**
 * A section through a house's basement wall where the ground is highest, drawn to scale: the grade
 * outside meeting the wall where it lies, the poured wall from its footing up to the sill and the
 * floor framing it carries `basementTopAboveGradeIn` over that grade, the slab inside at the
 * basement's floor, and no ground inside the wall (dug out to the slab's underside). Its depth is
 * the basement's own, read off `basement` (the house as it stands); a basement with walls of its
 * own draws them as one.
 */
export function BasementSectionDrawing({
  foundation,
  report,
  basement,
  length,
}: {
  foundation: BuildingFoundation
  report: DesignedFoundationReport
  basement: BasementReport
  length: (meters: number) => string
}) {
  const m = (inches: number) => inches * IN
  // Metres, the grade at 0, up positive; the wall's outside face at x 0, the basement to the right.
  const top = m(foundation.basementTopAboveGradeIn)
  const floor = top - (basement.wallTopY - report.floorTopY)
  const framed = top + Math.max(m(FOUNDATION_SILL_IN), basement.groundFloorTopY - basement.wallTopY)
  const slab = m(foundation.slabThicknessIn)
  const slabBottom = floor - (basement.ownWalls ? 0 : slab)
  const thick = m(foundation.footingThicknessIn)
  const bottom = slabBottom - thick
  const wall = m(foundation.basementWallThicknessIn)
  const footing = Math.max(wall, m(foundation.footingWidthIn))
  const houseWall = 0.35
  const [width, height, pad] = [280, 220, 14]
  const span = framed + houseWall - bottom
  const scale = Math.min((height - pad * 2) / span, 260)
  const x0 = 70
  const sx = (x: number) => x0 + x * scale
  const sy = (y: number) => pad + (framed + houseWall - y) * scale
  const right = width - 8
  const reach = 0.75
  const labelX = sx(reach) + 10
  const concrete = 'fill-[#9a9a9a] stroke-current'
  const box = (x: number, y: number, w: number, h: number): Array<[number, number]> => [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]
  const fx = wall / 2 - footing / 2
  const shapes = [
    { key: 'footing', className: concrete, points: box(fx, bottom, footing, thick) },
    { key: 'basement-wall', className: concrete, points: box(0, slabBottom, wall, top - slabBottom) },
    ...(basement.ownWalls
      ? []
      : [{ key: 'slab', className: concrete, points: box(wall, slabBottom, reach - wall, slab) }]),
    {
      key: 'sill',
      className: `${SECTION_LAYER_FILL.sill} stroke-current`,
      points: box(0, top, wall, m(FOUNDATION_SILL_IN)),
    },
    {
      key: 'framing',
      className: `${SECTION_LAYER_FILL.framing} stroke-current`,
      points: box(0, top + m(FOUNDATION_SILL_IN), reach, framed - top - m(FOUNDATION_SILL_IN)),
    },
    { key: 'wall', className: 'fill-muted stroke-current', points: box(0, framed, m(5.5), houseWall) },
  ]
  const labels = [
    { key: 'framing', y: (top + framed) / 2, text: `Floor framing and sill ${length(framed - top)}` },
    {
      key: 'basement-wall',
      y: (top + floor) / 2,
      text: basement.ownWalls ? 'Basement wall (its own)' : `Basement wall ${length(wall)}`,
    },
    ...(basement.ownWalls ? [] : [{ key: 'slab', y: floor - slab / 2, text: `Slab ${length(slab)}` }]),
    { key: 'footing', y: bottom + thick / 2, text: `Footing ${length(footing)} × ${length(thick)}` },
  ]
  const placed = stackLabels(
    labels.map((label) => sy(label.y)),
    9,
    8,
    height - 6,
  )
  const dims = [
    { key: 'top', from: 0, to: top, text: `${length(top)} top` },
    { key: 'deep', from: floor, to: 0, text: `${length(-floor)} deep` },
    { key: 'down', from: bottom, to: 0, text: `${length(-bottom)} down` },
  ].map((dim, index) => ({ ...dim, x: 10 + index * 18 }))
  const toPath = (points: Array<[number, number]>) =>
    points.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ')

  return (
    <figure className="flex flex-col gap-1" data-foundation-section="basement">
      <svg
        aria-label={`Foundation section: basement, its wall's top ${length(top)} over grade, its floor ${length(-floor)} under it`}
        className="h-auto w-full text-muted-foreground"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        {/* Grade: outside the wall only, meeting it where it lies; inside it is dug out. */}
        <line data-section-grade stroke="currentColor" x1="4" x2={sx(0)} y1={sy(0)} y2={sy(0)} />
        {Array.from({ length: 6 }, (_, i) => (
          <line
            key={i}
            opacity="0.35"
            stroke="currentColor"
            x1={8 + i * 9}
            x2={2 + i * 9}
            y1={sy(0) + 1}
            y2={sy(0) + 7}
          />
        ))}
        {shapes.map((shape) => (
          <polygon
            className={shape.className}
            data-section-part={shape.key}
            key={shape.key}
            points={toPath(shape.points)}
            strokeOpacity="0.6"
            strokeWidth="0.75"
          />
        ))}
        <line
          opacity="0.4"
          stroke="currentColor"
          strokeDasharray="2 2"
          x1={sx(wall)}
          x2={right}
          y1={sy(0)}
          y2={sy(0)}
        />
        {dims.map((dim) => (
          <g className="text-foreground" data-section-dim={dim.key} key={dim.key}>
            <line stroke="currentColor" x1={dim.x} x2={dim.x} y1={sy(dim.from)} y2={sy(dim.to)} />
            <line stroke="currentColor" x1={dim.x - 3} x2={dim.x + 3} y1={sy(dim.from)} y2={sy(dim.from)} />
            <line stroke="currentColor" x1={dim.x - 3} x2={dim.x + 3} y1={sy(dim.to)} y2={sy(dim.to)} />
            <text
              className="fill-foreground"
              dominantBaseline="middle"
              fontSize="7"
              transform={`rotate(-90 ${dim.x - 4} ${(sy(dim.from) + sy(dim.to)) / 2})`}
              textAnchor="middle"
              x={dim.x - 4}
              y={(sy(dim.from) + sy(dim.to)) / 2}
            >
              {dim.text}
            </text>
          </g>
        ))}
        {labels.map((label, index) => (
          <text
            className="fill-foreground"
            data-section-label={label.key}
            dominantBaseline="middle"
            fontSize="8"
            key={label.key}
            x={labelX}
            y={placed[index]}
          >
            {label.text}
          </text>
        ))}
      </svg>
      <figcaption className="text-right text-[10px] text-muted-foreground/70">
        At the high side of the ground, to scale; the dashed line is the grade
      </figcaption>
    </figure>
  )
}

/** A select over standard sizes; a stored size off the list stays selectable, so it reads back as it is. */
function SizeSelect({
  label,
  value,
  sizes,
  format,
  onChange,
}: {
  label: string
  value: number
  sizes: readonly number[]
  format: (value: number) => string
  onChange: (value: number) => void
}) {
  const key = (size: number) => size.toFixed(6)
  const listed = sizes.some((size) => Math.abs(size - value) < 1e-6)
  const choices = listed ? sizes : [value, ...sizes]
  const current = choices.find((size) => Math.abs(size - value) < 1e-6) ?? value
  return (
    <SelectControl
      className="h-9 text-xs"
      label={label}
      onChange={(next) => {
        const picked = choices.find((size) => key(size) === next)
        if (picked !== undefined) onChange(picked)
      }}
      options={choices.map((size) => ({ label: format(size), value: key(size) }))}
      value={key(current)}
    />
  )
}

/**
 * A free layer thickness in the panel's length unit, as the foundation's sizes read (inches on an
 * imperial plan, metres otherwise), in 8ths of an inch; a scrub previews, a release writes.
 */
function LayerThickness({
  layer,
  metres,
  min,
  max,
  unit,
  onPreview,
  onCommit,
}: {
  layer: string
  metres: number
  min: number
  max: number
  unit: LinearUnit
  onPreview: (metres: number) => void
  onCommit: (metres: number) => void
}) {
  const imperial = unit === 'imperial'
  const toShown = (value: number) => (imperial ? value / IN : value)
  const fromShown = (shown: number) => Math.round((imperial ? shown * IN : shown) * 1e6) / 1e6
  return (
    <div data-floor-layer-thickness={layer}>
      <MetricControl
        className="h-9 text-xs"
        label="Thickness"
        max={toShown(max)}
        min={toShown(min)}
        onChange={(next) => onPreview(fromShown(next))}
        onCommit={(next) => onCommit(fromShown(next))}
        precision={3}
        restoreOnCommit={false}
        step={imperial ? 0.125 : 0.125 * IN}
        unit={imperial ? 'in' : 'm'}
        value={toShown(metres)}
      />
    </div>
  )
}

/**
 * A layer's title line: its switch (absent for the joists, which are always there), and once on
 * the name of its material, typed in place over the kind's (cleared, it reads as the kind again).
 */
function FloorLayerHead({
  layer,
  title,
  on,
  onSwitch,
  name,
  kind,
  onRename,
}: {
  layer: string
  title: string
  on: boolean
  onSwitch?: (on: boolean) => void
  name?: string
  /** The kind's own name, what the layer reads as unnamed. */
  kind?: string
  onRename?: (name: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const dropped = useRef(false)
  const commit = () => {
    if (!dropped.current && draft !== null && draft.trim() !== (name ?? '')) onRename?.(draft)
    dropped.current = false
    setDraft(null)
  }
  return (
    <div className="flex h-8 items-center gap-2 px-0.5" data-floor-layer={layer} data-on={on}>
      {onSwitch ? (
        <button
          aria-checked={on}
          aria-label={title}
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
            on
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-black/5 text-transparent hover:border-muted-foreground dark:bg-black/20',
          )}
          data-floor-layer-switch={layer}
          onClick={() => onSwitch(!on)}
          role="switch"
          type="button"
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </button>
      ) : (
        <span aria-hidden className="w-4 shrink-0" />
      )}
      <span
        className={cn(
          'shrink-0 font-medium text-xs',
          on ? 'text-muted-foreground' : 'text-muted-foreground/60',
        )}
      >
        {title}
      </span>
      {!on ? (
        <span className="ml-auto text-[11px] text-muted-foreground/60">Off</span>
      ) : onRename ? (
        <input
          aria-label={`${title} material`}
          className="ml-auto min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-right text-foreground text-xs outline-none transition-colors placeholder:text-foreground hover:bg-accent/50 focus:border-ring/60 focus:bg-accent/40"
          data-floor-layer-name={layer}
          maxLength={60}
          onBlur={commit}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              dropped.current = true
              event.currentTarget.blur()
            }
          }}
          placeholder={kind}
          spellCheck={false}
          title="Name the material"
          type="text"
          value={draft ?? name ?? ''}
        />
      ) : null}
    </div>
  )
}

const CUSTOM = 'custom'

/**
 * A framed floor's layers, top down, as a roof plane's read: a preset, then each layer's product
 * and size. The flooring, the subfloor sheathing, the joists and (under a storey's floor) the
 * ceiling hung from them. A layer can be switched off (it goes; back on, it is `defaults`' again)
 * and its material named; the joists are always there. Each change is the whole build-up,
 * `onCommit`; a thickness scrub calls `onPreview` on the way. Props only, so it renders anywhere.
 */
export function FloorBuildUpFields({
  buildUp,
  defaults,
  presets,
  ceiling = true,
  unit,
  onCommit,
  onPreview,
}: {
  buildUp: FloorBuildUp
  /** The floor a layer switched back on comes back as. */
  defaults: FloorBuildUp
  presets: readonly FloorBuildUpPreset[]
  /** Whether a ceiling hangs under it (a storey's floor; not one over a crawl space). */
  ceiling?: boolean
  unit: LinearUnit
  onCommit: (buildUp: FloorBuildUp) => void
  onPreview?: (buildUp: FloorBuildUp) => void
}) {
  // A scrub shows its build-up here until it lands.
  const [draft, setDraft] = useState<FloorBuildUp | null>(null)
  const shown = draft ?? buildUp
  const commit = (next: FloorBuildUp) => {
    setDraft(null)
    onCommit(next)
  }
  // A change that changes nothing (a scrub let go where it started) keeps the preset; it still
  // lands, so a preview it began is closed.
  const edit = (change: Partial<FloorBuildUp>) => {
    const next = editedFloorBuildUp(buildUp, change)
    const { presetId: _, ...layers } = buildUp
    commit(JSON.stringify(next) === JSON.stringify(layers) ? buildUp : next)
  }
  const preview = (change: Partial<FloorBuildUp>) => {
    const next = editedFloorBuildUp(buildUp, change)
    setDraft(next)
    onPreview?.(next)
  }
  const head = (layer: FloorLayerKey, title: string, kind: string | undefined) => (
    <FloorLayerHead
      kind={kind}
      layer={layer}
      name={shown[layer]?.name}
      on={shown[layer] !== undefined}
      onRename={(name) => commit(renameFloorLayer(buildUp, layer, name))}
      onSwitch={(on) => commit(switchFloorLayer(buildUp, layer, on, defaults))}
      title={title}
    />
  )
  const preset = presets.some((entry) => entry.id === buildUp.presetId)
    ? buildUp.presetId!
    : CUSTOM
  const { flooring, sheathing, structure } = shown
  const hung = ceiling ? shown.ceiling : undefined

  return (
    <div className="flex flex-col gap-1" data-floor-build-up>
      <SelectControl
        className="h-9 text-xs"
        label="Preset"
        onChange={(id) => {
          // A copy: picked again, a preset still lands (an older floor takes its layers).
          const picked = presets.find((entry) => entry.id === id)
          if (picked) commit({ ...picked.buildUp })
        }}
        options={[
          ...(preset === CUSTOM ? [{ label: 'Custom', value: CUSTOM }] : []),
          ...presets.map((entry) => ({ label: entry.label, value: entry.id })),
        ]}
        value={preset}
      />
      {head('flooring', 'Flooring', flooring && labelOf(FLOORING_OPTIONS, flooring.kind))}
      {flooring && (
        <>
          <SelectControl
            className="h-9 text-xs"
            label="Kind"
            onChange={(kind) => edit({ flooring: { kind, thickness: FLOORING_THICKNESS[kind] } })}
            options={FLOORING_OPTIONS}
            value={flooring.kind}
          />
          <LayerThickness
            layer="flooring"
            max={3 * IN}
            metres={flooring.thickness}
            min={IN / 8}
            onCommit={(thickness) => edit({ flooring: { ...flooring, thickness } })}
            onPreview={(thickness) => preview({ flooring: { ...flooring, thickness } })}
            unit={unit}
          />
        </>
      )}
      {head('sheathing', 'Subfloor sheathing', sheathing && labelOf(PANEL_OPTIONS, sheathing.kind))}
      {sheathing && (
        <>
          <SelectControl
            className="h-9 text-xs"
            label="Panel"
            onChange={(kind) => edit({ sheathing: { kind, thickness: sheathing.thickness } })}
            options={PANEL_OPTIONS}
            value={sheathing.kind}
          />
          <SizeSelect
            format={(value) => formatLayerThickness(value, unit)}
            label="Thickness"
            onChange={(thickness) => edit({ sheathing: { ...sheathing, thickness } })}
            sizes={SUBFLOOR_THICKNESSES}
            value={sheathing.thickness}
          />
        </>
      )}
      <FloorLayerHead layer="joists" on title="Joists" />
      <SegmentedControl
        onChange={(system: FloorStructure['system']) =>
          edit({ structure: floorStructureAs(structure, system) })
        }
        options={[
          { label: 'Lumber', value: 'joists' },
          { label: 'I-joists', value: 'i-joists' },
        ]}
        value={structure.system}
      />
      <SelectControl
        className="h-9 text-xs"
        label="Size"
        onChange={(size) => edit({ structure: { ...structure, size } as FloorStructure })}
        options={structureSizeOptions(structure.system, unit)}
        value={structure.size as string}
      />
      <SizeSelect
        format={(value) => formatSpacing(value, unit)}
        label="Spacing"
        onChange={(spacing) => edit({ structure: { ...structure, spacing } })}
        sizes={FRAMING_SPACINGS}
        value={structure.spacing}
      />
      {ceiling && head('ceiling', 'Ceiling', hung && labelOf(CEILING_OPTIONS, hung.kind))}
      {hung && (
        <>
          <SelectControl
            className="h-9 text-xs"
            label="Finish"
            onChange={(kind) => edit({ ceiling: { kind, thickness: CEILING_THICKNESS[kind] } })}
            options={CEILING_OPTIONS}
            value={hung.kind}
          />
          {hung.kind === 'drywall' && (
            <SizeSelect
              format={(value) => formatLayerThickness(value, unit)}
              label="Thickness"
              onChange={(thickness) => edit({ ceiling: { ...hung, thickness } })}
              sizes={DRYWALL_THICKNESSES}
              value={hung.thickness}
            />
          )}
        </>
      )}
    </div>
  )
}

/** A raised floor's presets: the floor presets less their ceilings (the default storey floor is the crawl space's less its ceiling, so it goes). */
const RAISED_FLOOR_PRESETS: readonly FloorBuildUpPreset[] = FLOOR_BUILD_UP_PRESETS.slice(1).map(
  ({ buildUp: { ceiling: _, ...buildUp }, ...preset }) => ({ ...preset, buildUp }),
)

/**
 * A raised floor's framing over its crawl space: the floor's layers (no ceiling under them), then
 * the depth they and the sill make, which sets the stem's top under the floor. A record that only
 * set the depth keeps it until a layer is set.
 */
export function RaisedFloorFraming({
  foundation,
  unit,
  onCommit,
}: {
  foundation: BuildingFoundation
  unit: LinearUnit
  onCommit: (floorBuildUp: FloorBuildUp) => void
}) {
  const framing = foundation.floorFramingDepthIn * IN
  const layered = floorBuildUpThickness(foundation.floorBuildUp) + FOUNDATION_SILL_IN * IN
  // Written only when it changes: an older record's depth stays until a layer does.
  const commitChanged = (next: FloorBuildUp) => {
    if (JSON.stringify(next) !== JSON.stringify(foundation.floorBuildUp)) onCommit(next)
  }
  return (
    <div className="flex flex-col gap-1" data-raised-floor-framing>
      <p className="px-0.5 pt-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
        Floor framing
      </p>
      <FloorBuildUpFields
        buildUp={foundation.floorBuildUp}
        ceiling={false}
        defaults={DEFAULT_RAISED_FLOOR_BUILD_UP}
        onCommit={commitChanged}
        presets={RAISED_FLOOR_PRESETS}
        unit={unit}
      />
      <p className="px-0.5 text-muted-foreground text-xs" data-floor-framing-total>
        Floor framing {formatLayerDepth(framing, unit)}, sill{' '}
        {formatLayerThickness(FOUNDATION_SILL_IN * IN, unit)} included
      </p>
      {Math.abs(framing - layered) > 1e-4 && (
        <p className="px-0.5 text-muted-foreground text-xs" data-floor-framing-follows>
          Its layers make {formatLayerDepth(layered, unit)} with the sill; the framing follows them
          once a layer is set.
        </p>
      )}
    </div>
  )
}

/**
 * The building's foundation (`metadata.foundation`): switched on, the engine draws it under every
 * outside wall, sized as set here, and the floor is seated over the high side of the ground; off,
 * the generic one is drawn. Type, support and every size, then what the foundation as drawn
 * misses or how it stands, with the fix where there is one. Over a basement, the basement's walls
 * in their place: how far their top stands over grade (the house seated by it) and what they pour.
 * `heading` off, the panel it sits in is titled "Foundation" already; a string names the section
 * otherwise.
 */
export function BuildingFoundationSection({
  building,
  heading = true,
}: {
  building: BuildingNode
  heading?: boolean | string
}) {
  const nodes = useScene((state) => state.nodes)
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const length = (meters: number) => formatLinearMeasurement(meters, unit, metricNotation)
  const foundation = buildingFoundationOf(nodes, building.id)
  if (!foundation) return null
  const report: DesignedFoundationReport | null = foundation.enabled
    ? designedFoundationReport(nodes, building.id)
    : null
  const apply = (patch: BuildingFoundationRecord) => applyBuildingFoundation(building.id, patch)
  const advice = report ? foundationAdvice(report, length) : []
  // Over a basement the type and its sizes wait for the basement to go: its walls' are shown.
  const basement = report?.basement
  // A raised floor is drawn layer by layer once its framing is its layers' (an older record that
  // only set a depth draws it as one band).
  const layered =
    Math.abs(
      floorBuildUpThickness(foundation.floorBuildUp) / IN +
        FOUNDATION_SILL_IN -
        foundation.floorFramingDepthIn,
    ) < 1e-3

  return (
    <section className="flex flex-col gap-1.5" data-building-foundation={building.id}>
      {heading && (
        <h3 className="font-medium text-muted-foreground text-xs">
          {heading === true ? 'Foundation' : heading}
        </h3>
      )}
      <ToggleControl
        checked={foundation.enabled}
        label="Draw the foundation"
        onChange={(enabled) => apply({ enabled })}
      />
      {foundation.enabled && basement && report && (
        <>
          <p className="px-0.5 text-muted-foreground text-xs" data-foundation-basement>
            The house stands on its basement, cut into the ground: the ground round it is left as
            it lies.{' '}
            {basement.ownWalls
              ? 'Its walls are the basement’s own, on their footing.'
              : 'Its walls are poured under the house’s outside walls.'}{' '}
            Delete the basement and it stands on its{' '}
            {foundation.type === 'raised' ? 'raised floor' : 'slab'} again.
          </p>
          <BasementSectionDrawing
            basement={basement}
            foundation={foundation}
            length={length}
            report={report}
          />
          {basementFieldsFor(basement.ownWalls).map((field) => (
            <FoundationNumber
              field={field}
              key={field.key}
              min={Number.NEGATIVE_INFINITY}
              onCommit={(value) => apply({ [field.key]: value })}
              value={foundation[field.key as BuildingFoundationDimension]}
            />
          ))}
        </>
      )}
      {foundation.enabled && !basement && (
        <>
          <SegmentedControl
            onChange={(type: BuildingFoundation['type']) => apply({ type })}
            options={[
              { label: 'Slab on grade', value: 'slab' },
              { label: 'Raised floor', value: 'raised' },
            ]}
            value={foundation.type}
          />
          <SegmentedControl
            onChange={(support: BuildingFoundation['support']) => apply({ support })}
            options={[
              { label: foundation.type === 'raised' ? 'Stem wall and footing' : 'Turned-down edge', value: 'footing' },
              { label: 'Grade beam on piles', value: 'piles' },
            ]}
            value={foundation.support}
          />
          <FoundationSectionDrawing
            framing={
              foundation.type === 'raised' && layered
                ? floorSectionLayers(foundation.floorBuildUp, unit, true)
                : undefined
            }
            foundation={foundation}
            length={length}
          />
          {fieldsFor(foundation).map((field) =>
            field.key === 'floorFramingDepthIn' ? (
              // The floor's layers write the record's build-up; the depth (and the house's seat
              // over the ground) follows them in the same step.
              <RaisedFloorFraming
                foundation={foundation}
                key={field.key}
                onCommit={(floorBuildUp) => apply({ floorBuildUp })}
                unit={unit}
              />
            ) : field.key === 'edgeTaperIn' ? (
              <EdgeTaperNumber
                field={field}
                foundation={foundation}
                key={field.key}
                onCommit={(edgeTaperIn) => apply({ edgeTaperIn })}
              />
            ) : (
              <FoundationNumber
                field={field}
                key={field.key}
                min={field.key === 'ffAboveGradeIn' ? foundation.ffMinIn : Number.NEGATIVE_INFINITY}
                onCommit={(value) => apply({ [field.key]: value })}
                value={foundation[field.key]}
              />
            ),
          )}
          {foundation.type === 'raised' && (
            <ToggleControl
              checked={foundation.stepped}
              label="Step down the slope"
              onChange={(stepped) => apply({ stepped })}
            />
          )}
          {!report && (
            <p className="px-0.5 text-muted-foreground text-xs" data-foundation-open>
              {standsOnBasement(nodes, building.id)
                ? 'The house stands on a basement: its walls are the foundation walls, so only their footing is drawn.'
                : 'Close the outside walls into a loop to draw the foundation under them.'}
            </p>
          )}
        </>
      )}
      {foundation.enabled &&
          advice.map((item) => (
            <div
              className={
                item.tone === 'warning'
                  ? 'flex flex-col items-start gap-2 rounded-lg bg-accent/30 px-2.5 py-2'
                  : 'px-0.5'
              }
              data-foundation-advice={item.key}
              key={item.key}
            >
              <p className="text-muted-foreground text-xs" role={item.tone === 'warning' ? 'status' : undefined}>
                {item.text}
              </p>
              {item.fix && (
                <Button
                  className="rounded-full"
                  onClick={() => apply(item.fix!.patch)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {item.fix.label}
                </Button>
              )}
            </div>
          ))}
    </section>
  )
}
