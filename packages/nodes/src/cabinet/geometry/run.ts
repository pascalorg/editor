import type { CabinetModuleNode, CabinetNode, GeometryContext } from '@pascal-app/core'
import type { ColorPreset, RenderShading } from '@pascal-app/viewer'
import { Group, Mesh } from 'three'
import { getCabinetCountertopLayout } from '../countertop-layout'
import { buildFrontGeometry } from './fronts'
import { addBox, getCabinetSlotMaterials } from './shared'
import { cutSinkIntoCountertop } from './sink'

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
  for (const layout of getCabinetCountertopLayout(node, ctx)) {
    const { span, backOverhang, countertop: slab, bar, sinkCuts } = layout
    const { leftOverhang, rightOverhang, exposedLeft, exposedRight } = layout.ends
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

    if (node.withFinishedEnds) {
      for (const side of ['left', 'right'] as const) {
        const exposed = side === 'left' ? exposedLeft : exposedRight
        if (!exposed) continue
        const endPanel = new Mesh(
          buildFrontGeometry(node, span.depth, span.topY, false, null),
          materials.front,
        )
        endPanel.name = `cabinet-run-finished-end-${side}`
        endPanel.position.set(
          side === 'left'
            ? span.minX - node.frontThickness / 2
            : span.maxX + node.frontThickness / 2,
          span.topY / 2,
          span.centerZ,
        )
        endPanel.rotation.y = side === 'left' ? -Math.PI / 2 : Math.PI / 2
        endPanel.castShadow = true
        endPanel.receiveShadow = true
        endPanel.userData.slotId = 'front'
        group.add(endPanel)
      }
    }

    if (bar) {
      addBox(
        group,
        bar.support.size,
        bar.support.position,
        materials.front,
        'cabinet-run-bar-support',
        'front',
      )
      addBox(
        group,
        bar.slab.size,
        bar.slab.position,
        materials.countertop,
        'cabinet-run-bar-slab',
        'countertop',
      )
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

    if (slab) {
      const countertop = addBox(
        group,
        slab.size,
        slab.position,
        materials.countertop,
        'cabinet-run-countertop',
        'countertop',
      )

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
