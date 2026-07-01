'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanGeometry,
  type LiveNodeOverrides,
  nodeRegistry,
  resolveBuildingForLevel,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { FloorplanGeometryRenderer } from '../../components/editor-2d/renderers/floorplan-geometry-renderer'
import {
  buildContext,
  floorplanLayerRank,
  getFloorplanLevelData,
  isFloorplanNodeVisible,
  splitFloorplanOverlay,
} from '../../components/editor-2d/renderers/floorplan-registry-layer'

/**
 * Floorplan PDF export.
 *
 * Re-runs the same registry-driven geometry pipeline the live 2D layer uses
 * (`def.floorplan(node, ctx)` → `FloorplanGeometryRenderer`) headlessly, with
 * a neutral `viewState` so nodes render in their default, unselected form.
 * Every level of the active building becomes its own page, titled with the
 * level's label, with the plan fit to the page (independent of the live
 * pan/zoom). jsPDF + svg2pdf are dynamically imported so they only load when
 * an export actually runs.
 *
 * `scope: 'structure'` keeps only `category === 'structure'` nodes (walls,
 * slabs, ceilings, doors, windows, stairs, columns, roofs…); `'full'` keeps
 * every node that has a floorplan builder and is visible.
 */
export type FloorplanExportScope = 'full' | 'structure'

const SVG_NS = 'http://www.w3.org/2000/svg'
/** Meters of margin around the plan bounds. */
const PADDING_M = 1
/** PDF page margin + title band, in pt. */
const PAGE_MARGIN_PT = 36
const TITLE_BAND_PT = 28

// Neutral view state — no selection / hover / palette, so builders emit their
// default appearance (the core palette only carries selection/handle colors).
const NEUTRAL_VIEW_STATE = {
  selected: false,
  highlighted: false,
  hovered: false,
  moving: false,
  palette: undefined,
} as const

type ExportLevel = { id: AnyNodeId; label: string }

export async function exportFloorplanPdf(scope: FloorplanExportScope): Promise<void> {
  const nodes = useScene.getState().nodes
  const levels = resolveExportLevels(nodes)
  if (levels.length === 0) {
    console.warn('[floorplan-export] no level to export')
    return
  }

  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  const host = document.createElement('div')
  host.style.cssText =
    'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;'
  document.body.appendChild(host)

  let pageCount = 0
  try {
    for (const level of levels) {
      const geometries = collectFloorplanGeometry(nodes, level.id, scope)
      if (geometries.length === 0) continue

      const mounted = await mountFloorplanSvg(host, geometries)
      if (!mounted) continue

      try {
        if (pageCount > 0) doc.addPage()
        pageCount++

        doc.setFontSize(14)
        doc.text(level.label, PAGE_MARGIN_PT, PAGE_MARGIN_PT + 12)

        // Fit the plan into the page below the title band, preserving aspect.
        const boxX = PAGE_MARGIN_PT
        const boxY = PAGE_MARGIN_PT + TITLE_BAND_PT
        const boxW = pageW - PAGE_MARGIN_PT * 2
        const boxH = pageH - PAGE_MARGIN_PT * 2 - TITLE_BAND_PT
        const aspect = mounted.width / mounted.height
        let w = boxW
        let h = w / aspect
        if (h > boxH) {
          h = boxH
          w = h * aspect
        }
        const x = boxX + (boxW - w) / 2
        const y = boxY + (boxH - h) / 2

        // svg2pdf doesn't honour `vector-effect: non-scaling-stroke` (which
        // many builders use to keep door/window/stair line weights constant
        // on screen). Left as-is, those pixel-sized widths render as
        // metre-wide strokes — huge grey blobs. Convert them to the real-unit
        // width that lands at the intended point weight once svg2pdf scales
        // the plan onto the page.
        inlineNonScalingStrokes(mounted.svg, w / mounted.width)

        await svg2pdf(mounted.svg, doc, { x, y, width: w, height: h })
      } finally {
        mounted.cleanup()
      }
    }

    if (pageCount === 0) {
      console.warn(`[floorplan-export] nothing to export for scope "${scope}"`)
      return
    }

    const date = new Date().toISOString().split('T')[0]
    doc.save(`floorplan_${scope}_${date}.pdf`)
  } finally {
    host.remove()
  }
}

type MountedFloorplan = {
  svg: SVGSVGElement
  /** Padded viewBox dimensions, in meters — used for aspect-preserving fit. */
  width: number
  height: number
  cleanup: () => void
}

async function mountFloorplanSvg(
  parent: HTMLElement,
  geometries: { id: AnyNodeId; base: FloorplanGeometry }[],
): Promise<MountedFloorplan | null> {
  const container = document.createElement('div')
  parent.appendChild(container)
  const root = createRoot(container)
  const cleanup = () => {
    root.unmount()
    container.remove()
  }

  // Render a full `<svg>` as the React root child so React enters the SVG
  // namespace at the `<svg>` tag, then mutate the DOM node afterwards —
  // viewBox/background depend on the post-mount measured bounds.
  flushSync(() => {
    root.render(
      createElement(
        'svg',
        { xmlns: SVG_NS },
        createElement(
          'g',
          { 'data-floorplan-content': '' },
          geometries.map(({ id, base }) =>
            createElement(FloorplanGeometryRenderer, { key: id, geometry: base }),
          ),
        ),
      ),
    )
  })

  // Give async asset images (item icons) a couple of frames to resolve so
  // they're included in the measured bounds and the rendered output.
  await nextFrames(2)

  const svg = container.querySelector('svg')
  const content = svg?.querySelector('[data-floorplan-content]') as SVGGraphicsElement | null
  const bbox = content?.getBBox()
  if (!svg || !bbox || bbox.width === 0 || bbox.height === 0) {
    cleanup()
    return null
  }

  const minX = bbox.x - PADDING_M
  const minY = bbox.y - PADDING_M
  const width = bbox.width + PADDING_M * 2
  const height = bbox.height + PADDING_M * 2
  svg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`)
  svg.setAttribute('width', `${width}`)
  svg.setAttribute('height', `${height}`)

  const background = document.createElementNS(SVG_NS, 'rect')
  background.setAttribute('x', `${minX}`)
  background.setAttribute('y', `${minY}`)
  background.setAttribute('width', `${width}`)
  background.setAttribute('height', `${height}`)
  background.setAttribute('fill', '#ffffff')
  svg.insertBefore(background, svg.firstChild)

  return { svg, width, height, cleanup }
}

/**
 * Bake `vector-effect: non-scaling-stroke` widths into real user units.
 *
 * svg2pdf ignores the non-scaling hint, so a `stroke-width="1.25"` meant as
 * "1.25 screen px" would otherwise render as 1.25 metres on the page. We
 * rewrite each such width (and any dash pattern) to `px / ptPerUnit` so it
 * lands at ~`px` points once svg2pdf scales the plan by `ptPerUnit`, then drop
 * the now-misleading attribute.
 */
function inlineNonScalingStrokes(svg: SVGSVGElement, ptPerUnit: number) {
  if (!Number.isFinite(ptPerUnit) || ptPerUnit <= 0) return
  for (const el of svg.querySelectorAll('[vector-effect="non-scaling-stroke"]')) {
    const sw = el.getAttribute('stroke-width')
    if (sw) {
      const px = Number.parseFloat(sw)
      if (Number.isFinite(px)) el.setAttribute('stroke-width', `${px / ptPerUnit}`)
    }
    const dash = el.getAttribute('stroke-dasharray')
    if (dash) {
      const scaled = dash
        .split(/[\s,]+/)
        .map((v) => {
          const n = Number.parseFloat(v)
          return Number.isFinite(n) ? `${n / ptPerUnit}` : v
        })
        .join(' ')
      el.setAttribute('stroke-dasharray', scaled)
    }
    el.removeAttribute('vector-effect')
  }
}

function collectFloorplanGeometry(
  nodes: Record<string, AnyNode>,
  levelId: AnyNodeId,
  scope: FloorplanExportScope,
): { id: AnyNodeId; base: FloorplanGeometry }[] {
  const noLiveOverrides = new Map<string, LiveNodeOverrides>()
  const levelNodeIdsByType = new Map<string, AnyNodeId[]>()
  const entries: { id: AnyNodeId; node: AnyNode }[] = []

  const visit = (id: AnyNodeId) => {
    const node = nodes[id]
    if (!node) return
    const def = nodeRegistry.get(node.type)
    if (def?.computeFloorplanLevelData) {
      const ids = levelNodeIdsByType.get(node.type)
      if (ids) ids.push(id)
      else levelNodeIdsByType.set(node.type, [id])
    }
    if (
      def?.floorplan &&
      isFloorplanNodeVisible(node) &&
      (scope === 'full' || def.category === 'structure')
    ) {
      entries.push({ id, node })
    }
    const childIds = (node as { children?: AnyNodeId[] }).children
    if (Array.isArray(childIds)) for (const cid of childIds) visit(cid)
  }
  visit(levelId)

  // Document order is paint order — sort the same way the live layer does so
  // zones sit under walls/slabs/furniture rather than on top of them.
  entries.sort((a, b) => floorplanLayerRank(a.node.type) - floorplanLayerRank(b.node.type))

  // One-shot per-type cache for `computeFloorplanLevelData`; value type is
  // module-private to the registry layer, so let it infer.
  const levelDataCache = new Map()
  const out: { id: AnyNodeId; base: FloorplanGeometry }[] = []
  for (const { id, node } of entries) {
    const builder = nodeRegistry.get(node.type)?.floorplan
    if (!builder) continue
    const levelData = getFloorplanLevelData(
      node.type,
      nodes,
      noLiveOverrides,
      levelNodeIdsByType,
      levelDataCache,
    )
    const ctx = buildContext(node, nodes, NEUTRAL_VIEW_STATE, levelData)
    const geometry = builder(node, ctx)
    if (!geometry) continue
    const { base } = splitFloorplanOverlay(geometry)
    if (base) out.push({ id, base })
  }
  return out
}

/**
 * Levels to export, ordered bottom-to-top. The active building (the building
 * owning the selected level, or the first one found) contributes all of its
 * level children; if there is no building wrapper we fall back to the single
 * resolved level.
 */
function resolveExportLevels(nodes: Record<string, AnyNode>): ExportLevel[] {
  const selected = useViewer.getState().selection.levelId as AnyNodeId | null | undefined
  const activeLevelId = selected && nodes[selected] ? selected : firstLevelId(nodes)
  if (!activeLevelId) return []

  const buildingId = resolveBuildingForLevel(activeLevelId, nodes as Record<AnyNodeId, AnyNode>)
  let levelNodes: AnyNode[]
  if (buildingId) {
    const childIds = (nodes[buildingId] as { children?: AnyNodeId[] }).children ?? []
    levelNodes = childIds.map((id) => nodes[id]).filter((n): n is AnyNode => n?.type === 'level')
  } else {
    const node = nodes[activeLevelId]
    levelNodes = node ? [node] : []
  }

  levelNodes.sort((a, b) => levelIndexOf(a) - levelIndexOf(b))
  return levelNodes.map((n) => ({ id: n.id as AnyNodeId, label: levelLabelOf(n) }))
}

function firstLevelId(nodes: Record<string, AnyNode>): AnyNodeId | null {
  for (const node of Object.values(nodes)) {
    if (node.type === 'level') return node.id as AnyNodeId
  }
  return null
}

function levelIndexOf(node: AnyNode): number {
  return (node as { level?: number }).level ?? 0
}

function levelLabelOf(node: AnyNode): string {
  const name = node.name?.trim()
  if (name) return name
  return `Level ${levelIndexOf(node)}`
}

function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const tick = (remaining: number) => {
      if (remaining <= 0) {
        resolve()
        return
      }
      requestAnimationFrame(() => tick(remaining - 1))
    }
    tick(count)
  })
}
