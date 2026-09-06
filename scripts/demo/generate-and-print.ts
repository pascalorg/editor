/**
 * Headless submittal path — drop a preset lot in, generate a house on it, lay
 * out the default sheet set and print it, with no browser in the loop:
 *
 *   bun scripts/demo/generate-and-print.ts [--lot "Miami Shores"] [--style farmhouse]
 *       [--seed 777] [--garage yes|no] [--beds 3] [--baths 2] [--out set.pdf]
 *
 * PASCAL_API (default http://localhost:3004) must be serving /api/parcel —
 * the lot drop-in resolves the parcel and the streets through it, the way
 * the Lot panel does. Everything after that runs in this process: the
 * generator writes the house into the scene store, the sheets plugin lays
 * the set out, `composeAll` composes every sheet and `exportSheetsToPdf`
 * prints them through the same pdfkit path the rail uses.
 *
 * Beside the PDF it writes `<out>-scene.json` (the scene graph) so the same
 * scene can be re-composed after an edit — the sheets have to follow the
 * plan — and `<out>-summary.json` (the generator's run summary and the
 * sheets created).
 */
import { nodeRegistry, registerNode, useScene } from '@pascal-app/core'
import { dropInLot, exportSheetsToPdf, registerSitePlanContributor } from '@pascal-app/editor'
import * as nodeDefs from '@pascal-app/nodes'
import { bonesPlugin } from '@pascal-app/plugin-bones'
import { generateHouse, useGenerate } from '@pascal-app/plugin-generate'
import { PRESET_LOTS, presetDropInInput } from '@pascal-app/plugin-lot'
import { buildElevationDrawing, buildSectionDrawing, sectionsPlugin } from '@pascal-app/plugin-sections'
import {
  composeAll,
  generateDefaultSet,
  registerBuiltinSheetProviders,
  registerSheetDrawingProvider,
  sheetsPlugin,
} from '@pascal-app/plugin-sheets'
import { buildUtilitiesDrawing, utilitiesPlugin } from '@pascal-app/plugin-utilities'

const API = process.env.PASCAL_API ?? 'http://localhost:3004'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback
}
const LOT = arg('lot', 'Miami Shores')
const STYLE = arg('style', 'farmhouse')
const SEED = Number(arg('seed', '777'))
const GARAGE = arg('garage', '')
const BEDS = arg('beds', '')
const BATHS = arg('baths', '')
const OUT = arg(
  'out',
  `C:/Users/steve/AppData/Local/Temp/claude/C--Dev-pascal-v1/3b7f6468-e457-47e3-8ee3-c0457961ca2f/scratchpad/fl-set.pdf`,
)

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
// the scene store schedules its dirty flush on a frame; give it a frame
if (!g.requestAnimationFrame) {
  g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 0)
  g.cancelAnimationFrame = (id: unknown) => clearTimeout(id as never)
}
if (!g.document) {
  g.document = {
    createElement: () => ({ click() {}, href: '', download: '' }),
    getElementById: () => null,
    head: { appendChild() {} },
  }
}

async function main() {
  // 1. the lot
  const preset = PRESET_LOTS.find((p) => p.label.toLowerCase().includes(LOT.toLowerCase()))
  if (!preset) throw new Error(`no preset lot matches "${LOT}"`)
  const t0 = performance.now()
  const lot = await dropInLot(presetDropInInput(preset), {
    fetchImpl: ((url: string, init?: RequestInit) => fetch(`${API}${url}`, init)) as never,
  })
  if (!lot.ok) throw new Error(`lot drop-in failed: ${lot.error ?? lot.message}`)
  console.log(`lot: ${preset.label} in ${Math.round(performance.now() - t0)} ms`)

  // 2. the house
  const G = useGenerate.getState()
  G.setSeed(SEED)
  G.setOptions({
    style: STYLE || undefined,
    garage: GARAGE === '' ? undefined : GARAGE === 'yes',
    beds: BEDS ? (Number(BEDS) as 2 | 3 | 4) : undefined,
    baths: BATHS ? (Number(BATHS) as 1 | 2 | 3) : undefined,
  })
  const summary = generateHouse()
  if (!summary.ok) throw new Error(`generate failed: ${summary.errors.join('; ')}`)
  console.log(`house: ${summary.name} (seed ${summary.seed})`)
  for (const w of summary.warnings) console.log(`  warn: ${w}`)

  // 3. the set
  const set = generateDefaultSet(useScene.getState().nodes as never)
  console.log(`sheets: created ${set.created.join(', ')}${set.skipped.length ? ` (kept ${set.skipped.join(', ')})` : ''}`)

  // 4. compose + print
  const nodes = useScene.getState().nodes
  const t1 = performance.now()
  const composed = composeAll({ nodes: nodes as never })
  console.log(`composed ${composed.length} sheets in ${Math.round(performance.now() - t1)} ms`)
  const count = (list: unknown[]): number =>
    list.reduce<number>((n, item) => {
      const c = (item as { children?: unknown[] }).children
      return n + 1 + (Array.isArray(c) ? count(c) : 0)
    }, 0)
  for (const sheet of composed) {
    const live = sheet.windows.reduce(
      (n, w) => n + count([w.model, w.annotations].filter(Boolean)),
      0,
    )
    console.log(
      `  ${sheet.sheet.number.padEnd(6)} ${String(sheet.sheet.title).padEnd(34)} plate ${count(sheet.plate)} overlay ${count(sheet.overlay)} live ${live}`,
    )
  }
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
  const base = OUT.replace(/\.pdf$/i, '')
  const s = useScene.getState()
  await Bun.write(
    `${base}-scene.json`,
    JSON.stringify({
      nodes: s.nodes,
      rootNodeIds: s.rootNodeIds,
      collections: s.collections ?? {},
      materials: s.materials ?? {},
      installedPlugins: s.installedPlugins ?? [],
    }),
  )
  await Bun.write(`${base}-summary.json`, JSON.stringify({ summary, set }, null, 2))
  console.log(`pdf ${(bytes.length / 1024 / 1024).toFixed(2)} MB → ${OUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
