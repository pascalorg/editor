/**
 * Headless "Print / PDF" — writes the scene's sheet set to a PDF file exactly
 * the way the Sheets rail does in the browser (same `composeAll`, same
 * `exportSheetsToPdf`), so what prints can be inspected page by page.
 *
 *   bun scripts/demo/print-set.ts [out.pdf]
 *
 * Mirrors the provider wiring in apps/editor/lib/bootstrap.ts. Node kinds are
 * registered from @pascal-app/nodes and the plugins, because the plan
 * viewports draw through the registry (`collectSheetGeometry`).
 */
import { nodeRegistry, registerNode, useScene } from '@pascal-app/core'
import { exportSheetsToPdf, registerSitePlanContributor } from '@pascal-app/editor'
import * as nodeDefs from '@pascal-app/nodes'
import { bonesPlugin } from '@pascal-app/plugin-bones'
import { buildElevationDrawing, buildSectionDrawing, sectionsPlugin } from '@pascal-app/plugin-sections'
import {
  composeAll,
  registerBuiltinSheetProviders,
  registerSheetDrawingProvider,
  sheetsPlugin,
} from '@pascal-app/plugin-sheets'
import { buildUtilitiesDrawing, utilitiesPlugin } from '@pascal-app/plugin-utilities'

const API = process.env.PASCAL_API ?? 'http://localhost:3002'
const SCENE_ID = process.env.PASCAL_SCENE ?? 'plancrafters-cottage'
const OUT = process.argv[2] ?? `C:/Users/steve/AppData/Local/Temp/claude/C--Dev-Pascal/a595fb05-e3d2-4d5c-afdf-c017ab20e61b/scratchpad/${SCENE_ID}-set.pdf`

// ── registry: every kind the scene can contain ─────────────────────────
for (const value of Object.values(nodeDefs)) {
  const def = value as { kind?: string; schema?: unknown }
  if (def && typeof def.kind === 'string' && def.schema && !nodeRegistry.get(def.kind)) {
    registerNode(def as never)
  }
}
for (const plugin of [sheetsPlugin, sectionsPlugin, utilitiesPlugin, bonesPlugin]) {
  for (const def of (plugin as { nodes?: { kind: string }[] }).nodes ?? []) {
    if (!nodeRegistry.get(def.kind)) registerNode(def as never)
  }
}

// ── providers, as bootstrap wires them ─────────────────────────────────
registerSheetDrawingProvider('section', (nodes, args) =>
  buildSectionDrawing({ nodes: nodes as never }, args as never),
)
registerSheetDrawingProvider('elevation', (nodes, args) =>
  buildElevationDrawing(
    { nodes: nodes as never },
    ((args as { direction?: string }).direction ?? 'south') as never,
  ),
)
registerSitePlanContributor('utilities', (scene) => buildUtilitiesDrawing(scene as never))
registerBuiltinSheetProviders()

// ── the browser bits `save()` touches ──────────────────────────────────
let captured: Blob | null = null
const g = globalThis as unknown as Record<string, unknown>
;(URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (blob: Blob) => {
  captured = blob
  return 'blob:captured'
}
;(URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {}
if (!g.document) {
  g.document = {
    createElement: () => ({ click() {}, href: '', download: '' }),
    getElementById: () => null,
    head: { appendChild() {} },
  }
}

async function main() {
  const res = await fetch(`${API}/api/scenes/${SCENE_ID}`)
  if (!res.ok) throw new Error(`GET scene failed: ${res.status}`)
  const scene = (await res.json()) as { version: number; graph: Record<string, unknown> }
  const graph = scene.graph as {
    nodes: Record<string, Record<string, unknown>>
    rootNodeIds: string[]
    collections?: unknown
    materials?: unknown
    installedPlugins?: string[]
  }
  // The site-plan provider reads the scene store, not the node map it is handed.
  useScene.setState({
    nodes: graph.nodes as never,
    rootNodeIds: graph.rootNodeIds as never,
    collections: (graph.collections ?? {}) as never,
    materials: (graph.materials ?? {}) as never,
    installedPlugins: (graph.installedPlugins ?? []) as never,
  } as never)

  const t0 = performance.now()
  const composed = composeAll({ nodes: graph.nodes as never })
  console.log(`composed ${composed.length} sheets in ${Math.round(performance.now() - t0)} ms`)
  for (const sheet of composed) {
    const count = (list: unknown[]): number =>
      list.reduce<number>((n, g) => {
        const c = (g as { children?: unknown[] }).children
        return n + 1 + (Array.isArray(c) ? count(c) : 0)
      }, 0)
    const live = sheet.windows.reduce(
      (n, w) => n + count([w.model, w.annotations].filter(Boolean)),
      0,
    )
    console.log(
      `  ${sheet.sheet.number.padEnd(6)} plate ${count(sheet.plate)} overlay ${count(sheet.overlay)} live ${live}`,
    )
  }
  const t1 = performance.now()
  await exportSheetsToPdf(
    composed.map((c) => ({
      widthIn: c.widthIn,
      heightIn: c.heightIn,
      plate: c.plate,
      windows: c.windows,
      overlay: c.overlay,
    })),
    'set.pdf',
  )
  if (!captured) throw new Error('the export produced no blob')
  const bytes = new Uint8Array(await (captured as Blob).arrayBuffer())
  await Bun.write(OUT, bytes)
  console.log(`pdf ${(bytes.length / 1024 / 1024).toFixed(2)} MB in ${Math.round(performance.now() - t1)} ms → ${OUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
