import type { AnyNode, CabinetModuleNode, CabinetNode, GeometryContext } from '@pascal-app/core'
import type { ColorPreset, RenderShading } from '@pascal-app/viewer'
import { Group, type Mesh } from 'three'
import { getRunSpans } from '../run-layout'
import { compartmentSinkLayout, stackForCabinet } from '../stack'
import { addBox, getCabinetSlotMaterials } from './shared'
import { cutSinkIntoCountertop, type SinkBowlSpec, sinkBowls } from './sink'

const ADJACENT_RUN_EPSILON = 1e-4
const ADJACENT_RUN_Z_TOLERANCE = 0.03

export function getRunModules(ctx?: GeometryContext): CabinetModuleNode[] {
  return (ctx?.children ?? []).filter(
    (child): child is CabinetModuleNode => child.type === 'cabinet-module',
  )
}

function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

function derivedCornerRole(
  metadata: unknown,
): { role: 'base-leg' | 'wall-leg' | 'bridge'; side: 'left' | 'right' } | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>).cabinetCornerDerivedRun
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const role = (value as { role?: unknown }).role
  const side = (value as { side?: unknown }).side
  if (
    (role !== 'base-leg' && role !== 'wall-leg' && role !== 'bridge') ||
    (side !== 'left' && side !== 'right')
  ) {
    return null
  }
  return { role, side }
}

function childDerivedBaseLegSides(ctx?: GeometryContext): Set<'left' | 'right'> {
  const sides = new Set<'left' | 'right'>()
  for (const child of ctx?.children ?? []) {
    if (child.type !== 'cabinet') continue
    const link = derivedCornerRole(child.metadata)
    if (link?.role === 'base-leg') sides.add(link.side)
  }
  return sides
}

function modulesForRun(node: CabinetNode, ctx?: GeometryContext): CabinetModuleNode[] {
  return (node.children ?? [])
    .map((id) => ctx?.resolve<AnyNode>(id))
    .filter((child): child is CabinetModuleNode => child?.type === 'cabinet-module')
}

function siblingCabinetSpansInRunLocal(node: CabinetNode, ctx?: GeometryContext) {
  if (!ctx) return []

  const localX = [Math.cos(node.rotation), -Math.sin(node.rotation)] as const
  const localZ = [Math.sin(node.rotation), Math.cos(node.rotation)] as const
  const spans: Array<{ minX: number; maxX: number; depth: number; z: number }> = []

  for (const sibling of ctx.siblings) {
    if (sibling.type !== 'cabinet' || sibling.id === node.id) continue
    if (Math.abs(angleDelta(sibling.rotation, node.rotation)) > 1e-3) continue

    const siblingModules = modulesForRun(sibling, ctx)
    const siblingSpans =
      siblingModules.length > 0
        ? getRunSpans(siblingModules, { runTier: sibling.runTier })
        : [
            {
              minX: -sibling.width / 2,
              maxX: sibling.width / 2,
              centerX: 0,
              centerZ: 0,
              width: sibling.width,
              depth: sibling.depth,
              minZ: -sibling.depth / 2,
              maxZ: sibling.depth / 2,
              topY: sibling.carcassHeight,
              hasCountertop: sibling.runTier !== 'tall',
            },
          ]
    const dx = sibling.position[0] - node.position[0]
    const dz = sibling.position[2] - node.position[2]
    const originX = dx * localX[0] + dz * localX[1]
    const originZ = dx * localZ[0] + dz * localZ[1]

    for (const span of siblingSpans) {
      spans.push({
        minX: originX + span.minX,
        maxX: originX + span.maxX,
        depth: span.depth,
        z: originZ + span.centerZ,
      })
    }
  }

  return spans
}

function hasAdjacentCabinetSpan({
  depth,
  edgeX,
  overhang,
  side,
  siblingSpans,
}: {
  depth: number
  edgeX: number
  overhang: number
  side: 'left' | 'right'
  siblingSpans: Array<{ minX: number; maxX: number; depth: number; z: number }>
}) {
  return siblingSpans.some((sibling) => {
    if (Math.abs(sibling.z) > (depth + sibling.depth) / 2 + ADJACENT_RUN_Z_TOLERANCE) {
      return false
    }
    const gap = side === 'left' ? edgeX - sibling.maxX : sibling.minX - edgeX
    return gap >= -ADJACENT_RUN_EPSILON && gap <= overhang + ADJACENT_RUN_EPSILON
  })
}

export function buildCabinetRunGeometry(
  node: CabinetNode,
  ctx: GeometryContext | undefined,
  shading: RenderShading,
  textures: boolean,
  colorPreset: ColorPreset,
  sceneTheme: string | undefined,
): Group | null {
  const modules = getRunModules(ctx)
  if (modules.length === 0) return null

  const group = new Group()
  const materials = getCabinetSlotMaterials(node, ctx, shading, textures, colorPreset, sceneTheme)
  const plinth = node.showPlinth ? node.plinthHeight : 0
  // A back-edge bar ledge occupies the back edge, superseding the seating
  // overhang; side-edge bars leave it alone.
  const backOverhang =
    node.withCountertop && node.barLedge?.edge !== 'back' ? node.countertopBackOverhang : 0
  const spans = getRunSpans(modules, { runTier: node.runTier })
  const siblingSpans = siblingCabinetSpansInRunLocal(node, ctx)
  const cornerLink = derivedCornerRole(node.metadata)
  const childBaseLegSides = childDerivedBaseLegSides(ctx)

  for (const span of spans) {
    const spanIndex = spans.indexOf(span)
    const previousSpan = spans[spanIndex - 1]
    const nextSpan = spans[spanIndex + 1]
    const hasInternalLeftNeighbor =
      previousSpan && !previousSpan.hasCountertop && span.minX - previousSpan.maxX <= 1e-4
    const hasInternalRightNeighbor =
      nextSpan && !nextSpan.hasCountertop && nextSpan.minX - span.maxX <= 1e-4
    const hasExternalLeftNeighbor = hasAdjacentCabinetSpan({
      depth: span.depth,
      edgeX: span.minX,
      overhang: node.countertopOverhang,
      side: 'left',
      siblingSpans,
    })
    const hasExternalRightNeighbor = hasAdjacentCabinetSpan({
      depth: span.depth,
      edgeX: span.maxX,
      overhang: node.countertopOverhang,
      side: 'right',
      siblingSpans,
    })
    const barEdge = node.barLedge?.edge
    // A side bar's knee wall sits flush on that end — no slab overhang there.
    let leftOverhang =
      hasInternalLeftNeighbor || hasExternalLeftNeighbor || barEdge === 'left'
        ? 0
        : node.countertopOverhang
    let rightOverhang =
      hasInternalRightNeighbor || hasExternalRightNeighbor || barEdge === 'right'
        ? 0
        : node.countertopOverhang
    // A derived base leg mates back into the source run on its inner corner
    // edge, so that edge should be flush instead of carrying the usual exposed
    // countertop overhang.
    if (cornerLink?.role === 'base-leg') {
      if (cornerLink.side === 'right' && spanIndex === 0) leftOverhang = 0
      if (cornerLink.side === 'left' && spanIndex === spans.length - 1) rightOverhang = 0
    }
    // The source run that spawned an L leg should also stay flush on the side
    // where that derived base leg joins back in.
    if (childBaseLegSides.has('left') && spanIndex === 0) leftOverhang = 0
    if (childBaseLegSides.has('right') && spanIndex === spans.length - 1) rightOverhang = 0
    const toeKickDepth = node.showPlinth
      ? Math.min(node.toeKickDepth, span.depth - node.boardThickness * 2)
      : 0
    const plinthDepth = Math.max(node.boardThickness, span.depth - toeKickDepth)
    if (node.showPlinth && plinth > 0) {
      addBox(
        group,
        [span.width, plinth, plinthDepth],
        [span.centerX, plinth / 2, span.minZ + plinthDepth / 2],
        materials.plinth,
        'cabinet-run-plinth',
        'plinth',
      )
    }

    // Finished decorative back panel (island backs are visible) — floor to
    // countertop plane, flush against the carcass back face.
    if (node.withFinishedBack) {
      addBox(
        group,
        [span.width, span.topY, node.boardThickness],
        [span.centerX, span.topY / 2, span.minZ - node.boardThickness / 2],
        materials.front,
        'cabinet-run-back-panel',
        'front',
      )
    }

    // Raised bar counter: knee wall against one run face topped by a slab at
    // bar height, cantilevered outward as knee space for stools. Side bars
    // apply only to the run's end span on that side.
    const spanHasBar =
      node.barLedge &&
      span.hasCountertop &&
      (barEdge === 'back' ||
        (barEdge === 'left' && spanIndex === 0) ||
        (barEdge === 'right' && spanIndex === spans.length - 1))
    if (node.barLedge && spanHasBar) {
      const slabThickness = Math.max(node.countertopThickness, 0.02)
      const supportHeight = Math.max(0.1, node.barLedge.height - slabThickness)
      // Knee wall spans the slab's full footprint on the shared axis so the
      // two faces stay flush — a carcass-sized wall reads as a seam under
      // the wider slab.
      if (barEdge === 'back') {
        const backZ = span.minZ - (node.withFinishedBack ? node.boardThickness : 0)
        const barWidth = span.width + leftOverhang + rightOverhang
        const barCenterX = span.centerX + (rightOverhang - leftOverhang) / 2
        addBox(
          group,
          [barWidth, supportHeight, node.boardThickness],
          [barCenterX, supportHeight / 2, backZ - node.boardThickness / 2],
          materials.front,
          'cabinet-run-bar-support',
          'front',
        )
        addBox(
          group,
          [barWidth, slabThickness, node.barLedge.depth],
          [barCenterX, supportHeight + slabThickness / 2, backZ - node.barLedge.depth / 2],
          materials.countertop,
          'cabinet-run-bar-slab',
          'countertop',
        )
      } else {
        const sign = barEdge === 'left' ? -1 : 1
        const edgeX = barEdge === 'left' ? span.minX : span.maxX
        const slabDepth = span.depth + node.countertopOverhang + backOverhang
        const slabCenterZ = span.centerZ + (node.countertopOverhang - backOverhang) / 2
        addBox(
          group,
          [node.boardThickness, supportHeight, slabDepth],
          [edgeX + sign * (node.boardThickness / 2), supportHeight / 2, slabCenterZ],
          materials.front,
          'cabinet-run-bar-support',
          'front',
        )
        addBox(
          group,
          [node.barLedge.depth, slabThickness, slabDepth],
          [
            edgeX + sign * (node.barLedge.depth / 2),
            supportHeight + slabThickness / 2,
            slabCenterZ,
          ],
          materials.countertop,
          'cabinet-run-bar-slab',
          'countertop',
        )
      }
    }

    // Waterfall ends: the slab material drops to the floor on exposed run
    // ends (skipped where a neighbor abuts or a side bar occupies the end).
    if (node.withWaterfall && span.hasCountertop && node.countertopThickness > 0) {
      const slabDepth = span.depth + node.countertopOverhang + backOverhang
      const slabCenterZ = span.centerZ + (node.countertopOverhang - backOverhang) / 2
      const exposedLeft =
        spanIndex === 0 &&
        !hasExternalLeftNeighbor &&
        !hasInternalLeftNeighbor &&
        barEdge !== 'left'
      const exposedRight =
        spanIndex === spans.length - 1 &&
        !hasExternalRightNeighbor &&
        !hasInternalRightNeighbor &&
        barEdge !== 'right'
      for (const side of ['left', 'right'] as const) {
        if (side === 'left' ? !exposedLeft : !exposedRight) continue
        const sign = side === 'left' ? -1 : 1
        const outerX = side === 'left' ? span.minX - leftOverhang : span.maxX + rightOverhang
        // Outer face flush with the slab edge; the slab covers the panel top.
        addBox(
          group,
          [node.countertopThickness, span.topY, slabDepth],
          [outerX - sign * (node.countertopThickness / 2), span.topY / 2, slabCenterZ],
          materials.countertop,
          `cabinet-run-waterfall-${side}`,
          'countertop',
        )
      }
    }

    if (node.withCountertop && span.hasCountertop && node.countertopThickness > 0) {
      const countertop = addBox(
        group,
        [
          span.width + leftOverhang + rightOverhang,
          node.countertopThickness,
          span.depth + node.countertopOverhang + backOverhang,
        ],
        [
          span.centerX + (rightOverhang - leftOverhang) / 2,
          span.topY + node.countertopThickness / 2,
          span.centerZ + (node.countertopOverhang - backOverhang) / 2,
        ],
        materials.countertop,
        'cabinet-run-countertop',
        'countertop',
      )

      // Undermount sink modules cut their bowl openings out of the run's
      // slab (modules inside a run never own a countertop themselves).
      const sinkCuts: Array<{ bowls: SinkBowlSpec[]; x: number; z: number }> = []
      for (const module of modules) {
        if (module.position[0] < span.minX - 1e-4 || module.position[0] > span.maxX + 1e-4) {
          continue
        }
        const sink = stackForCabinet(module).find((compartment) => compartment.type === 'sink')
        if (!sink) continue
        sinkCuts.push({
          bowls: sinkBowls(
            compartmentSinkLayout(sink),
            Math.max(0.01, module.width - 2 * module.boardThickness),
            module.depth,
          ),
          x: module.position[0],
          z: module.position[2],
        })
      }
      if (sinkCuts.length > 0) {
        group.remove(countertop)
        let cut: Mesh = countertop
        for (const sinkCut of sinkCuts) {
          const next = cutSinkIntoCountertop(
            cut,
            sinkCut.bowls,
            sinkCut.x,
            sinkCut.z,
            node.countertopThickness,
          )
          cut.geometry.dispose()
          cut = next
        }
        group.add(cut)
      }
    }
  }

  return group
}
