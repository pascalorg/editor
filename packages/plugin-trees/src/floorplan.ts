import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { flowerPetalColor } from './flower-geometry'
import { FLOWER_PRESETS } from './flower-presets'
import type { FlowerNode } from './flower-schema'
import { GRASS_PRESETS } from './grass-presets'
import type { GrassNode } from './grass-schema'
import { TREE_PRESETS } from './presets'
import type { TreeNode } from './schema'

/**
 * 2D plan builders for the plant kinds (`def.floorplan`) — the registry
 * floor-plan layer renders any kind that provides one, so this is all it takes
 * for plugin nodes to appear in the 2D view. Classic architect symbols:
 * a dashed canopy circle (dashed = overhead element, like a roof overhang)
 * with a solid trunk dot for trees; small colour dots for flowers/grass.
 */

/** Trunk radius in plan — also the selection footprint, so the move box hugs
 * the trunk instead of the whole canopy. */
export function treeTrunkRadius(tree: TreeNode): number {
  return Math.max(0.15, (tree.height ?? 7) * 0.025 * (tree.trunkThickness ?? 1))
}

/** Approximate canopy radius in plan (matches the old whole-tree footprint). */
export function treeCanopyRadius(tree: TreeNode): number {
  return Math.max(0.5, (tree.height ?? 7) * 0.28)
}

type ViewChrome = { stroke: string | null; selected: boolean }

/** Selection/hover stroke override shared by the three builders. */
function chromeOf(ctx: GeometryContext): ViewChrome {
  const view = ctx.viewState
  const palette = view?.palette
  if ((view?.selected || view?.highlighted) && palette)
    return { stroke: palette.selectedStroke, selected: view?.selected ?? false }
  if (view?.hovered && palette) return { stroke: palette.wallHoverStroke, selected: false }
  return { stroke: null, selected: false }
}

export function buildTreeFloorplan(node: TreeNode, ctx: GeometryContext): FloorplanGeometry {
  const [x, , z] = node.position ?? [0, 0, 0]
  const swatch = (TREE_PRESETS[node.preset] ?? TREE_PRESETS.oak).swatch
  const chrome = chromeOf(ctx)
  const stroke = chrome.stroke ?? swatch

  const children: FloorplanGeometry[] = [
    // Canopy ring — pointer-events on the stroke only, so the (large) disc
    // doesn't steal clicks from whatever sits under the canopy in plan.
    {
      kind: 'circle',
      cx: x,
      cy: z,
      r: treeCanopyRadius(node),
      stroke,
      strokeWidth: 0.03,
      strokeDasharray: '0.18 0.12',
      fill: swatch,
      fillOpacity: 0.06,
      pointerEvents: 'stroke',
    },
    // Trunk dot — the solid, always-clickable core of the symbol.
    {
      kind: 'circle',
      cx: x,
      cy: z,
      r: treeTrunkRadius(node),
      fill: chrome.stroke ?? '#6b4f2e',
      stroke,
      strokeWidth: 0.02,
      opacity: 0.95,
    },
  ]
  if (chrome.selected) children.push({ kind: 'move-handle', point: [x, z] })
  return { kind: 'group', children }
}

export function buildFlowerFloorplan(node: FlowerNode, ctx: GeometryContext): FloorplanGeometry {
  const [x, , z] = node.position ?? [0, 0, 0]
  const preset = FLOWER_PRESETS[node.preset] ?? FLOWER_PRESETS.daisy
  const chrome = chromeOf(ctx)
  const children: FloorplanGeometry[] = [
    {
      kind: 'circle',
      cx: x,
      cy: z,
      r: 0.1,
      fill: flowerPetalColor(node),
      stroke: chrome.stroke ?? preset.stemColor,
      strokeWidth: 0.02,
    },
    {
      kind: 'circle',
      cx: x,
      cy: z,
      r: 0.035,
      fill: preset.centerColor,
      pointerEvents: 'none',
    },
  ]
  if (chrome.selected) children.push({ kind: 'move-handle', point: [x, z] })
  return { kind: 'group', children }
}

export function buildGrassFloorplan(node: GrassNode, ctx: GeometryContext): FloorplanGeometry {
  const [x, , z] = node.position ?? [0, 0, 0]
  const preset = GRASS_PRESETS[node.preset] ?? GRASS_PRESETS.meadow
  const blade = node.bladeColor ?? preset.bladeColor
  const chrome = chromeOf(ctx)
  const children: FloorplanGeometry[] = [
    {
      kind: 'circle',
      cx: x,
      cy: z,
      r: 0.12,
      fill: blade,
      fillOpacity: 0.5,
      stroke: chrome.stroke ?? blade,
      strokeWidth: 0.02,
      strokeDasharray: '0.06 0.05',
    },
  ]
  if (chrome.selected) children.push({ kind: 'move-handle', point: [x, z] })
  return { kind: 'group', children }
}
