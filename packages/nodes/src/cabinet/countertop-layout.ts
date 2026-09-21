import type { CabinetModuleNode, CabinetNode, GeometryContext } from '@pascal-app/core'
import { type SinkBowlSpec, sinkBowls } from './appliance-layout'
import { getRunSpanEnds, getRunSpanGroups } from './run-layout'
import { compartmentSinkLayout } from './stack'

export type CabinetSlab = {
  size: [number, number, number]
  position: [number, number, number]
}

export type RunSinkCut = { bowls: SinkBowlSpec[]; x: number; z: number }

export function getCabinetCountertopLayout(node: CabinetNode, ctx?: GeometryContext) {
  const modules = (ctx?.children ?? []).filter(
    (child): child is CabinetModuleNode => child.type === 'cabinet-module',
  )
  const groups = getRunSpanGroups(modules, { runTier: node.runTier })
  const ends = getRunSpanEnds(
    node,
    ctx,
    groups.map(({ span }) => span),
  )
  // A back bar replaces the seating overhang; side bars leave it alone.
  const backOverhang =
    node.withCountertop && node.barLedge?.edge !== 'back' ? node.countertopBackOverhang : 0

  return groups.map(({ span, modules: spanModules }, index) => {
    const spanEnds = ends[index]!
    const { leftOverhang, rightOverhang } = spanEnds
    const width = span.width + leftOverhang + rightOverhang
    const centerX = span.centerX + (rightOverhang - leftOverhang) / 2
    const depth = span.depth + node.countertopOverhang + backOverhang
    const centerZ = span.centerZ + (node.countertopOverhang - backOverhang) / 2
    const countertop: CabinetSlab | null =
      node.withCountertop && span.hasCountertop && node.countertopThickness > 0
        ? {
            size: [width, node.countertopThickness, depth],
            position: [centerX, span.topY + node.countertopThickness / 2, centerZ],
          }
        : null
    const ledge = node.barLedge
    let bar: {
      slab: CabinetSlab
      support: CabinetSlab
      edge: NonNullable<CabinetNode['barLedge']>['edge']
    } | null = null
    if (
      ledge &&
      span.hasCountertop &&
      (ledge.edge === 'back' ||
        (ledge.edge === 'left' && index === 0) ||
        (ledge.edge === 'right' && index === groups.length - 1))
    ) {
      const thickness = Math.max(node.countertopThickness, 0.02)
      const height = Math.max(0.1, ledge.height - thickness)
      if (ledge.edge === 'back') {
        const backZ = span.minZ - (node.withFinishedBack ? node.boardThickness : 0)
        bar = {
          edge: ledge.edge,
          support: {
            size: [width, height, node.boardThickness],
            position: [centerX, height / 2, backZ - node.boardThickness / 2],
          },
          slab: {
            size: [width, thickness, ledge.depth],
            position: [centerX, height + thickness / 2, backZ - ledge.depth / 2],
          },
        }
      } else {
        const sign = ledge.edge === 'left' ? -1 : 1
        const edgeX = ledge.edge === 'left' ? span.minX : span.maxX
        bar = {
          edge: ledge.edge,
          support: {
            size: [node.boardThickness, height, depth],
            position: [edgeX + (sign * node.boardThickness) / 2, height / 2, centerZ],
          },
          slab: {
            size: [ledge.depth, thickness, depth],
            position: [edgeX + (sign * ledge.depth) / 2, height + thickness / 2, centerZ],
          },
        }
      }
    }
    const sinkCuts: RunSinkCut[] = []
    if (countertop) {
      for (const module of modules) {
        if (module.position[0] < span.minX - 1e-4 || module.position[0] > span.maxX + 1e-4) continue
        // The default stack contains only storage; avoid generating compartment IDs in a query.
        const sink = module.stack?.find((compartment) => compartment.type === 'sink')
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
    }
    return { span, modules: spanModules, ends: spanEnds, backOverhang, countertop, bar, sinkCuts }
  })
}
