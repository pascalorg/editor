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
        ? getRunSpans(siblingModules)
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
  const spans = getRunSpans(modules)
  const siblingSpans = siblingCabinetSpansInRunLocal(node, ctx)

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
    const leftOverhang =
      hasInternalLeftNeighbor || hasExternalLeftNeighbor ? 0 : node.countertopOverhang
    const rightOverhang =
      hasInternalRightNeighbor || hasExternalRightNeighbor ? 0 : node.countertopOverhang
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

    if (node.withCountertop && span.hasCountertop && node.countertopThickness > 0) {
      const countertop = addBox(
        group,
        [
          span.width + leftOverhang + rightOverhang,
          node.countertopThickness,
          span.depth + node.countertopOverhang,
        ],
        [
          span.centerX + (rightOverhang - leftOverhang) / 2,
          span.topY + node.countertopThickness / 2,
          span.centerZ + node.countertopOverhang / 2,
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
