/**
 * Generate into the open scene: roll (or take a template), validate, build
 * the nodes, replace the previously generated building, place the new one on
 * the parcel, select its level. The heavy lifting is pure (`roll.ts`,
 * `build.ts`); this file is the only one that touches the stores.
 */
import { commitTerrainField, heightAt, type SiteNode, terrainFieldOf, useScene, type ConventionSite } from '@pascal-app/core'
import { fillPad } from './grading'
import { buildSitePlanDrawing, CATALOG_ITEMS } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { buildHouse, GENERATED_BY, type Placement } from './build'
import type { PlanDocument } from './document'
import { bandFit, crossesSetback, type EdgeFit, envelopeEdges, refaceCandidates, refaceNote } from './fit'

const FT_M = 0.3048
/** A rear porch / deck the band must also hold, feet (porch.ts: 7 ft patio, up to 12 ft deck). */
const REAR_PORCH_ALLOWANCE_FT = 8

/** The rolled plan's width along the front, feet (the rooms' extent in x). */
function planWidthFt(doc: { rooms: { x: number; w: number }[] }): number {
  let w = 0
  for (const r of doc.rooms) w = Math.max(w, r.x + r.w)
  return w
}
/** The rolled plan's depth into the lot, feet (the rooms' extent in y). */
function planDepthFt(doc: { rooms: { y: number; d: number }[] }): number {
  let d = 0
  for (const r of doc.rooms) d = Math.max(d, r.y + r.d)
  return d
}
import { NARROW_W_MIN } from './narrow'
import { type RollOptions, rollDocument } from './roll'
import { type RunSummary, useGenerate } from './store'
import { TEMPLATES } from './templates/poppy'

const FT = 0.3048

/** The parcel's buildable envelope and street edge, when the scene has a site. */
export function placementFromScene(): {
  placement: Placement | null
  frontageFt: number | null
  depthFt: number | null
  /** Every envelope edge as a frontage with its square-on depth (feet). */
  edges: EdgeFit[]
} {
  const s = useScene.getState()
  const site = Object.values(s.nodes).find((n) => (n as { type?: string }).type === 'site') as
    | { id: string; polygon?: { points?: [number, number][] } }
    | undefined
  if (!site || !site.polygon?.points || site.polygon.points.length < 3) {
    return { placement: null, frontageFt: null, depthFt: null, edges: [] }
  }
  const drawing = buildSitePlanDrawing({
    nodes: s.nodes,
    rootNodeIds: s.rootNodeIds,
    collections: s.collections ?? {},
    materials: s.materials ?? {},
    installedPlugins: s.installedPlugins ?? [],
  } as never)
  const envelope = drawing.meta.envelope
  if (envelope.length < 3) return { placement: null, frontageFt: null, depthFt: null, edges: [] }
  // the ENVELOPE's front edge — the envelope no longer shares the lot's vertex count
  const i = drawing.meta.envelopeFrontEdge
  const edges = envelopeEdges(envelope)
  const street = edges[i]
  return {
    placement: {
      siteId: site.id,
      envelope: envelope.map((e) => [e[0], e[1]] as [number, number]),
      frontEdge: i,
    },
    frontageFt: street ? street.frontageFt : null,
    depthFt: street ? street.depthFt : null,
    edges,
  }
}

/**
 * Remove any building that is still an empty shell (and, when a caller asks
 * for a clean slate, the tagged generated building too) —
 * a new scene opens with a "Level 0" nobody has drawn in, and left standing
 * it would put a blank floor plan in the sheet set beside the generated one.
 * A building with a single wall in it is somebody's work and stays.
 */
export function removeGenerated(includeGenerated = false): number {
  const s = useScene.getState()
  const nodes = s.nodes as Record<
    string,
    {
      id: string
      type?: string
      parentId?: string | null
      metadata?: { generatedBy?: string }
      children?: string[]
    }
  >
  const hasWork = (buildingId: string): boolean =>
    Object.values(nodes).some((n) => {
      if (n.type !== 'level' || n.parentId !== buildingId) return false
      return (n.children ?? []).some((c) => {
        const child = nodes[c]
        return child !== undefined && child.type !== 'slab' && child.type !== 'ceiling'
      })
    })
  const doomed = Object.values(nodes)
    .filter(
      (n) =>
        n.type === 'building' &&
        ((includeGenerated && n.metadata?.generatedBy === GENERATED_BY) || !hasWork(n.id)),
    )
    .map((n) => n.id)
  if (doomed.length > 0) s.deleteNodes(doomed as never)
  return doomed.length
}

type SceneNode = {
  id: string
  type?: string
  parentId?: string | null
  metadata?: { generatedBy?: string }
  children?: string[]
}

/** The building a previous run made, with its level, when the scene still has it. */
function generatedBuilding(): { buildingId: string; levelId: string } | null {
  const nodes = useScene.getState().nodes as Record<string, SceneNode>
  const building = Object.values(nodes).find(
    (n) => n.type === 'building' && n.metadata?.generatedBy === GENERATED_BY,
  )
  if (!building) return null
  const level = Object.values(nodes).find((n) => n.type === 'level' && n.parentId === building.id)
  return level ? { buildingId: building.id, levelId: level.id } : null
}

function applyDocument(
  document: PlanDocument,
  meta: { seed: number | null; template: string | null; options?: RollOptions },
  placementOverride?: Placement | null,
): RunSummary {
  const placement =
    placementOverride === undefined ? placementFromScene().placement : placementOverride
  const scene = useScene.getState()
  const nodes = scene.nodes as Record<string, SceneNode>
  const site = Object.values(nodes).find((n) => n.type === 'site')
  // Reuse the previous building only where it already hangs off the site;
  // one that landed at the root (a scene that had no site then) is rebuilt
  // under the site so the site plan and the cover find it.
  const previous = generatedBuilding()
  const reuse =
    previous && (!site || nodes[previous.buildingId]?.parentId === site.id) ? previous : null
  // The ground: the site's USGS heightfield, when the lot drop-in read one.
  const field = site ? terrainFieldOf(site as unknown as SiteNode) : null
  const built = buildHouse(document, {
    placement,
    siteId: site?.id ?? null,
    gradeAt: field ? (x, z) => heightAt(field, x, z) : null,
    // the fixtures and furniture come from the editor's item catalog
    catalog: CATALOG_ITEMS,
    reuse,
    generation: {
      seed: meta.seed,
      template: meta.template,
      options: meta.options ?? {},
      at: new Date().toISOString(),
    },
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
    porch: built.ok ? built.porch : null,
    rear: built.ok ? built.rear : null,
    foundation: built.ok ? built.foundation : null,
    finishes: built.ok ? built.finishes : null,
  }
  if (!built.ok) return summary
  if (reuse) {
    // Replace the level's contents in place. Section markers stay: the
    // default cuts run through the plan's centre lines, and a generated
    // house is centred on its level, so they still cut the new house.
    const level = nodes[reuse.levelId]
    const contents = (level?.children ?? []).filter((id) => nodes[id]?.type !== 'section-marker')
    if (contents.length > 0) scene.deleteNodes(contents as never)
    const [buildingOp, levelOp, ...rest] = built.ops
    if (buildingOp) {
      const {
        id: _id,
        type: _type,
        parentId: _parent,
        children: _children,
        ...patch
      } = buildingOp.node as Record<string, unknown>
      scene.updateNode(reuse.buildingId as never, patch as never)
    }
    if (levelOp) {
      const {
        id: _id,
        type: _type,
        parentId: _parent,
        children: _children,
        ...patch
      } = levelOp.node as Record<string, unknown>
      scene.updateNode(reuse.levelId as never, patch as never)
    }
    scene.createNodes(
      rest.map((op) => ({ node: op.node as never, parentId: op.parentId as never })),
    )
  } else {
    removeGenerated(true)
    scene.createNodes(
      built.ops.map((op) => ({ node: op.node as never, parentId: op.parentId as never })),
    )
  }
  // the building pad: fill the site's ground under a slab (grading.ts)
  if (site && field && built.grading) {
    const graded = fillPad(field, built.grading)
    if (graded.filledSamples > 0) {
      scene.updateNode(site.id as never, { terrain: commitTerrainField(graded.field) } as never)
      summary.warnings.push(
        `Grading: ${graded.filledSamples} ground samples filled under the slab, up to ${(graded.maxFillM / 0.0254).toFixed(0)} in — the pad the slab bears on.`,
      )
    }
  }
  if (built.levelId) {
    useViewer
      .getState()
      .setSelection({ buildingId: built.buildingId as never, levelId: built.levelId as never })
  }
  return summary
}

/**
 * Where the scene's site is — state, county, latitude — for the roll's
 * regional wall-system convention. Null without a site.
 */
export function siteConventionOptions(): ConventionSite | null {
  const s = useScene.getState()
  const site = Object.values(s.nodes).find((n) => (n as { type?: string }).type === 'site') as
    | {
        address?: { state?: string }
        parcel?: { state?: string; county?: string; originLngLat?: [number, number] }
        dossier?: { point?: { lat?: number } }
      }
    | undefined
  if (!site) return null
  const state = site.address?.state ?? site.parcel?.state ?? null
  const county = site.parcel?.county ?? null
  const lat = site.parcel?.originLngLat?.[1] ?? site.dossier?.point?.lat ?? null
  if (!state && !county && lat === null) return null
  return { state, county, lat }
}

/** Roll a house from the panel's seed and options and put it in the scene. */
export function generateHouse(overrides: RollOptions = {}): RunSummary {
  const S = useGenerate.getState()
  if (S.running)
    return (
      S.last ?? {
        ok: false,
        name: '',
        seed: null,
        template: null,
        stats: null,
        errors: ['already running'],
        warnings: [],
        placed: false,
      }
    )
  S.setRunning(true)
  try {
    const { placement, edges } = placementFromScene()
    const siteOptions = siteConventionOptions()
    const optionsFor = (edge: EdgeFit | undefined): RollOptions => ({
      ...(siteOptions ? { site: siteOptions } : {}),
      ...S.options,
      ...overrides,
      ...(edge && edge.frontageFt > 0 ? { maxWidthFt: Math.floor(edge.frontageFt) } : {}),
      ...(edge && edge.depthFt > 0 ? { maxDepthFt: Math.floor(edge.depthFt) } : {}),
    })
    const street = placement ? edges[placement.frontEdge] : undefined
    let rolled = rollDocument(S.seed, optionsFor(street))
    let placed = placement
    // The BAND the plan actually occupies (fit.ts bandFit): on a tapered or
    // odd lot the frontage is not the width the house has at its depth. Roll
    // once on the frontage, measure the band the rolled depth reaches (plus
    // a rear porch), and re-roll narrower while the plan is wider than it —
    // then stand the house on the band's centre (Steve, 2026-09-09: "the
    // procedural designs go into the setbacks").
    if (placement && street) {
      // the band the house needs, plus the rear porch's when the lot is deep
      // enough to hold one behind the house (else the porch is build.ts's
      // problem: a landing, or none) — never a band the plan cannot reach,
      // whose centre would carry the house sideways out of the lot
      const fitBand = (): { widthFt: number; offsetM: number; depthFt: number } => {
        const depthFt = planDepthFt(rolled.document)
        // the band's depth is where it narrows under the narrowest house the roll builds
        const widthM = NARROW_W_MIN * FT_M
        const withPorch = bandFit(placement.envelope, placement.frontEdge, (depthFt + REAR_PORCH_ALLOWANCE_FT) * FT_M, 0.5, widthM)
        if (withPorch.depthFt >= depthFt + REAR_PORCH_ALLOWANCE_FT - 0.5 && withPorch.widthFt > 8) return withPorch
        return bandFit(placement.envelope, placement.frontEdge, depthFt * FT_M, 0.5, widthM)
      }
      const tooWide = (b: { widthFt: number; depthFt: number }): boolean =>
        b.widthFt > 8 && (planWidthFt(rolled.document) > b.widthFt + 0.25 || planDepthFt(rolled.document) > b.depthFt + 0.25)
      let band = fitBand()
      for (let pass = 0; pass < 3 && tooWide(band); pass++) {
        rolled = rollDocument(S.seed, { ...optionsFor(street), maxWidthFt: Math.floor(band.widthFt), maxDepthFt: Math.floor(band.depthFt) })
        band = fitBand()
      }
      const sideRoomM = Math.max(0, (band.widthFt - planWidthFt(rolled.document)) / 2) * FT_M
      placed = { ...placement, lateralOffsetM: band.offsetM, sideRoomM }
      if (band.widthFt > 8 && planWidthFt(rolled.document) > band.widthFt + 0.25) {
        rolled.warnings.push(
          `The lot narrows to ${band.widthFt.toFixed(0)}' where this plan stands ${planWidthFt(rolled.document).toFixed(0)}' wide — the plan cannot shrink further; it will cross a side setback (a narrower plan or another frontage).`,
        )
      }
    }
    // PlanCrafters' generateFit: the roll could not narrow the plan to the
    // street frontage — face the widest lot edge that takes it, and say so.
    // A reface that still crosses a setback is not taken; the street-facing
    // run and its warnings stand.
    if (placement && street && crossesSetback(rolled.warnings)) {
      for (const alt of refaceCandidates(edges, placement.frontEdge)) {
        const trial = rollDocument(S.seed, optionsFor(alt))
        if (crossesSetback(trial.warnings)) continue
        rolled = trial
        rolled.warnings.push(refaceNote(street, alt))
        placed = { ...placement, frontEdge: alt.index }
        break
      }
    }
    // a reface changes the front edge: the band is measured again for it
    if (placed && placement && placed.frontEdge !== placement.frontEdge) {
      const depthFt = planDepthFt(rolled.document)
      const widthM = NARROW_W_MIN * FT_M
      let band = bandFit(placement.envelope, placed.frontEdge, (depthFt + REAR_PORCH_ALLOWANCE_FT) * FT_M, 0.5, widthM)
      if (band.depthFt < depthFt + REAR_PORCH_ALLOWANCE_FT - 0.5 || band.widthFt <= 8) band = bandFit(placement.envelope, placed.frontEdge, depthFt * FT_M, 0.5, widthM)
      placed = { ...placed, lateralOffsetM: band.offsetM, sideRoomM: Math.max(0, (band.widthFt - planWidthFt(rolled.document)) / 2) * FT_M }
    }
    const summary = applyDocument(
      rolled.document,
      { seed: rolled.seed, template: null, options: rolled.options },
      placed,
    )
    // the wall system the roll chose, and why — the first line of the summary
    // (Steve, 2026-09-09: "can you confirm we are speccing the right house")
    const wallLine = `Exterior walls: ${rolled.document.wallSystem === 'cmu' ? '8 in concrete block, stucco outside, furring + drywall inside' : '2x6 wood frame'} (${rolled.document.wallSystemBasis ?? 'wood frame assumed'}).`
    summary.warnings = [wallLine, ...rolled.warnings, ...summary.warnings]
    summary.levelId = generatedBuilding()?.levelId ?? null
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
    const summary: RunSummary = {
      ok: false,
      name: id,
      seed: null,
      template: id,
      stats: null,
      errors: [`no template "${id}"`],
      warnings: [],
      placed: false,
    }
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
