/**
 * Generate into the open scene: roll (or take a template), validate, build
 * the nodes, replace the previously generated building, place the new one on
 * the parcel, select its level. The heavy lifting is pure (`roll.ts`,
 * `build.ts`); this file is the only one that touches the stores.
 */
import { useScene } from '@pascal-app/core'
import { buildSitePlanDrawing } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { buildHouse, GENERATED_BY, type Placement } from './build'
import type { PlanDocument } from './document'
import { rollDocument, type RollOptions } from './roll'
import { type RunSummary, useGenerate } from './store'
import { TEMPLATES } from './templates/poppy'

const FT = 0.3048

/** The parcel's buildable envelope and street edge, when the scene has a site. */
export function placementFromScene(): { placement: Placement | null; frontageFt: number | null; depthFt: number | null } {
  const s = useScene.getState()
  const site = Object.values(s.nodes).find((n) => (n as { type?: string }).type === 'site') as
    | { id: string; polygon?: { points?: [number, number][] } }
    | undefined
  if (!site || !site.polygon?.points || site.polygon.points.length < 3) {
    return { placement: null, frontageFt: null, depthFt: null }
  }
  const drawing = buildSitePlanDrawing({
    nodes: s.nodes,
    rootNodeIds: s.rootNodeIds,
    collections: s.collections ?? {},
    materials: s.materials ?? {},
    installedPlugins: s.installedPlugins ?? [],
  } as never)
  const envelope = drawing.meta.envelope
  if (envelope.length < 3) return { placement: null, frontageFt: null, depthFt: null }
  const i = drawing.meta.frontEdge
  const p = envelope[i] as [number, number]
  const q = envelope[(i + 1) % envelope.length] as [number, number]
  const frontage = Math.hypot(q[0] - p[0], q[1] - p[1])
  // Depth: from the front edge's midpoint straight back to the far side of the envelope.
  const mx = (p[0] + q[0]) / 2
  const my = (p[1] + q[1]) / 2
  let depth = 0
  for (const e of envelope) depth = Math.max(depth, Math.hypot(e[0] - mx, e[1] - my))
  return {
    placement: { siteId: site.id, envelope: envelope.map((e) => [e[0], e[1]] as [number, number]), frontEdge: i },
    frontageFt: frontage / FT,
    depthFt: depth / FT,
  }
}

/**
 * Remove everything a previous run generated (the building carries the tag;
 * its subtree goes with it) and any building that is still an empty shell —
 * a new scene opens with a "Level 0" nobody has drawn in, and left standing
 * it would put a blank floor plan in the sheet set beside the generated one.
 * A building with a single wall in it is somebody's work and stays.
 */
export function removeGenerated(): number {
  const s = useScene.getState()
  const nodes = s.nodes as Record<string, { id: string; type?: string; parentId?: string | null; metadata?: { generatedBy?: string }; children?: string[] }>
  const hasWork = (buildingId: string): boolean =>
    Object.values(nodes).some((n) => {
      if (n.type !== 'level' || n.parentId !== buildingId) return false
      return (n.children ?? []).some((c) => {
        const child = nodes[c]
        return child !== undefined && child.type !== 'slab' && child.type !== 'ceiling'
      })
    })
  const doomed = Object.values(nodes)
    .filter((n) => n.type === 'building' && (n.metadata?.generatedBy === GENERATED_BY || !hasWork(n.id)))
    .map((n) => n.id)
  if (doomed.length > 0) s.deleteNodes(doomed as never)
  return doomed.length
}

function applyDocument(document: PlanDocument, meta: { seed: number | null; template: string | null; options?: RollOptions }): RunSummary {
  const { placement } = placementFromScene()
  const built = buildHouse(document, {
    placement,
    generation: { seed: meta.seed, template: meta.template, options: meta.options ?? {}, at: new Date().toISOString() },
  })
  const summary: RunSummary = {
    ok: built.ok,
    name: document.name ?? 'plan',
    seed: meta.seed,
    template: meta.template,
    stats: built.ok ? built.stats : null,
    errors: built.errors,
    warnings: built.warnings,
    placed: placement !== null,
  }
  if (!built.ok) return summary
  removeGenerated()
  const scene = useScene.getState()
  scene.createNodes(built.ops.map((op) => ({ node: op.node as never, parentId: op.parentId as never })))
  if (built.levelId) {
    useViewer.getState().setSelection({ buildingId: built.buildingId as never, levelId: built.levelId as never })
  }
  return summary
}

/** Roll a house from the panel's seed and options and put it in the scene. */
export function generateHouse(overrides: RollOptions = {}): RunSummary {
  const S = useGenerate.getState()
  if (S.running) return S.last ?? { ok: false, name: '', seed: null, template: null, stats: null, errors: ['already running'], warnings: [], placed: false }
  S.setRunning(true)
  try {
    const { frontageFt, depthFt } = placementFromScene()
    const options: RollOptions = {
      ...S.options,
      ...overrides,
      ...(frontageFt ? { maxWidthFt: Math.floor(frontageFt) } : {}),
      ...(depthFt ? { maxDepthFt: Math.floor(depthFt) } : {}),
    }
    const rolled = rollDocument(S.seed, options)
    const summary = applyDocument(rolled.document, { seed: rolled.seed, template: null, options: rolled.options })
    summary.warnings = [...rolled.warnings, ...summary.warnings]
    useGenerate.getState().setLast(summary)
    return summary
  } finally {
    useGenerate.getState().setRunning(false)
  }
}

/** Build one of the authored templates (Poppy…) into the scene. */
export function generateTemplate(id: string): RunSummary {
  const template = TEMPLATES.find((t) => t.id === id)
  const S = useGenerate.getState()
  if (!template) {
    const summary: RunSummary = { ok: false, name: id, seed: null, template: id, stats: null, errors: [`no template "${id}"`], warnings: [], placed: false }
    S.setLast(summary)
    return summary
  }
  S.setRunning(true)
  try {
    const summary = applyDocument(template.document, { seed: null, template: template.id })
    useGenerate.getState().setLast(summary)
    return summary
  } finally {
    useGenerate.getState().setRunning(false)
  }
}
