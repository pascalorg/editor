import type { z } from 'zod'
import { previewId } from '../lib/preview-id'
import type { PanelNode, SlabNode } from '../schema'
import { FacadeUnitSchema } from '../systems/facade/facade-unit'
import { type FacadeFillPlan, planFacadeFill } from './facade'
import { type ElevationRun, facadeElevationSvg } from './facade-elevation'
import { PARTITION_THICKNESS, SCENARIO_WIDTHS, scenarioScene } from './facade-scenario'

const round = (value: number) => Math.round(value * 1000) / 1000

/**
 * The facade at four characters a metre: `|` corners, `#` interior walls,
 * `W`/`D` openings, `x` infill, `.` bare wall; a second line marks balconies.
 */
function sketch(width: number, partitions: readonly number[], plan: FacadeFillPlan | null) {
  const per = 4
  const cells = Math.max(1, Math.round(width * per))
  const row = Array.from({ length: cells }, () => '.')
  const under = Array.from({ length: cells }, () => ' ')
  const paint = (line: string[], left: number, right: number, char: string) => {
    for (let i = Math.floor(left * per); i < Math.ceil(right * per) && i < cells; i++)
      if (i >= 0) line[i] = char
  }
  const wallPlan = plan?.walls[0]
  for (const panel of wallPlan?.panels.values ?? [])
    if (String(panel.metadata.facadeCell).includes(':infill'))
      paint(row, panel.position[0] - panel.width / 2, panel.position[0] + panel.width / 2, 'x')
  for (const opening of wallPlan?.openings.values ?? [])
    paint(
      row,
      opening.position[0] - opening.width / 2,
      opening.position[0] + opening.width / 2,
      opening.type === 'door' ? 'D' : 'W',
    )
  for (const x of partitions)
    paint(row, x - PARTITION_THICKNESS / 2, x + PARTITION_THICKNESS / 2, '#')
  for (const part of wallPlan?.balconies.values ?? [])
    if (part.type === 'slab') {
      const xs = (part as SlabNode).polygon.map(([x]) => x)
      paint(under, Math.min(...xs), Math.max(...xs), '_')
    }
  const top = `|${row.join('')}|`
  const bottom = ` ${under.join('')} `
  return bottom.trim() ? `${top}\n${bottom.trimEnd()}` : top
}

function previewScenario(
  unit: z.infer<typeof FacadeUnitSchema>,
  width: number,
  height: number,
  partitions: readonly number[],
) {
  const scene = scenarioScene({ width, height, partitions })
  const inRange = scene.partitions.map((p) => p.start[0])
  let plan: FacadeFillPlan | null = null
  let error: string | null = null
  try {
    plan = planFacadeFill({ walls: [scene.wall], nodes: scene.nodes, unit })
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  }
  const wallPlan = plan?.walls[0]
  const run: ElevationRun = {
    width,
    height,
    partitions: inRange,
    partitionThickness: PARTITION_THICKNESS,
    nodes: [
      ...(wallPlan?.panels.values ?? []),
      ...(wallPlan?.openings.values ?? []),
      ...(wallPlan?.balconies.values ?? []),
    ],
    skipped: plan?.skipped ?? 0,
    error,
  }
  const extent = (node: { position: [number, number, number]; width: number; height: number }) => ({
    left: round(node.position[0] - node.width / 2),
    right: round(node.position[0] + node.width / 2),
    bottom: round(node.position[1] - node.height / 2),
    top: round(node.position[1] + node.height / 2),
  })
  const scenario = {
    width,
    runs: (plan?.runs ?? [])
      .map((run) => ({ start: round(run.start), end: round(run.end) }))
      .sort((a, b) => a.start - b.start),
    openings: (wallPlan?.openings.values ?? [])
      .map((node) => ({ kind: node.type, ...extent(node) }))
      .sort((a, b) => a.left - b.left),
    panels: (wallPlan?.panels.values ?? [])
      .map((node: PanelNode) => ({
        part: String(node.metadata.facadeCell).split(':').at(-1) ?? 'panel',
        ...extent(node),
      }))
      .sort((a, b) => a.left - b.left),
    balconies: (wallPlan?.balconies.values ?? [])
      .filter((node): node is SlabNode => node.type === 'slab')
      .map((slab) => {
        const xs = slab.polygon.map(([x]) => x)
        return { left: round(Math.min(...xs)), right: round(Math.max(...xs)) }
      })
      .sort((a, b) => a.left - b.left),
    skipped: plan?.skipped ?? 0,
    error,
    sketch: sketch(width, inRange, plan),
  }
  return { scenario, run }
}

type PreviewInput = {
  unit: z.infer<typeof FacadeUnitSchema>
  widths?: number[]
  height: number
  partitions: number[]
}

/**
 * A unit's fingerprint, after its defaults: what `preview_facade_unit` hands back and the apply
 * tools ask for, so a unit is never applied in a form nobody looked at (FNV-1a, 32 bits).
 */
export function facadeUnitPreviewId(unit: unknown): string {
  return previewId(FacadeUnitSchema.parse(unit))
}

/** The `preview_facade_unit` result, the same on every surface. */
export function previewFacadeUnit({ unit, widths, height, partitions }: PreviewInput) {
  const previews = (widths ?? [...SCENARIO_WIDTHS]).map((width) =>
    previewScenario(unit, width, height, partitions),
  )
  return {
    previewId: facadeUnitPreviewId(unit),
    scenarios: previews.map(({ scenario }) => scenario),
    elevationSvg: facadeElevationSvg(
      previews.map(({ run }) => run),
      unit.paint,
    ),
  }
}
