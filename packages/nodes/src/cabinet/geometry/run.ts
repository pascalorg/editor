import type { CabinetModuleNode, CabinetNode, GeometryContext } from '@pascal-app/core'
import type { ColorPreset, RenderShading } from '@pascal-app/viewer'
import { Group, type Mesh } from 'three'
import { getRunSpanEnds, getRunSpans } from '../run-layout'
import { compartmentSinkLayout, stackForCabinet } from '../stack'
import { addBox, getCabinetSlotMaterials } from './shared'
import { cutSinkIntoCountertop, type SinkBowlSpec, sinkBowls } from './sink'

export function getRunModules(ctx?: GeometryContext): CabinetModuleNode[] {
  return (ctx?.children ?? []).filter(
    (child): child is CabinetModuleNode => child.type === 'cabinet-module',
  )
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
  const spanEnds = getRunSpanEnds(node, ctx, spans)

  for (const span of spans) {
    const spanIndex = spans.indexOf(span)
    const barEdge = node.barLedge?.edge
    const { leftOverhang, rightOverhang, exposedLeft, exposedRight } = spanEnds[spanIndex]!
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
